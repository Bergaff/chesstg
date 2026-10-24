import { describe, expect, it } from 'vitest';
import { analyzeState, applyActions, type GameAction, type GameState } from './index';

const API = process.env.API_URL ?? 'http://127.0.0.1:8787';

// Интеграционные тесты ходят в живой Worker (wrangler dev).
// Если он не запущен, сьют пропускается, чтобы `npm test` работал на чистой машине.
const apiReachable = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2000) })
  .then((response) => response.ok)
  .catch(() => false);

/** Тема, которую сервер обязан принять: контраст и плашка в норме. */
const readableTokens = {
  piece: '#ffe6b3',
  plate: '#2b1a12',
  edge: '#c9762f',
  cellLight: '#2b2018',
  cellDark: '#221911',
  frame: '#191009',
  backdrop: '#140c07',
  wash: '#3b2416',
};

function makeClient() {
  const gid = crypto.randomUUID().replace(/-/g, '');
  const headers = { 'X-Guest-Id': gid, 'Content-Type': 'application/json' };
  return async (path: string, init: RequestInit = {}) => {
    const res = await fetch(API + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    const data = await res.json();
    return { status: res.status, data: data as any };
  };
}

/**
 * Награду за ролик сервер выдаёт, только когда реклама включена: задан блок
 * Adsgram или играет демо-ролик. Локальный воркер блока не видит и отвечает 503,
 * поэтому тесты на награду спрашивают у сервера, а не у своего `.dev.vars`.
 * Проба сделана неизвестным kind: она упирается в валидацию и ничего не начисляет.
 */
async function adsReady(api: ReturnType<typeof makeClient>): Promise<boolean> {
  const probe = await api('/api/ads/reward', { method: 'POST', body: JSON.stringify({ kind: 'probe' }) });
  if (probe.status === 503) {
    expect(probe.data.error).toBe('ads_not_configured');
    return false;
  }
  return true;
}

describe.runIf(apiReachable)('API integration', () => {
  it('полный цикл кампании и бонусов', async () => {
    const api = makeClient();
    const session = await api('/api/session', { method: 'POST', body: '{}' });
    expect(session.status).toBe(200);
    expect(session.data.profile.coins).toBe(30);

    const start = await api('/api/run/start', { method: 'POST', body: JSON.stringify({ mode: 'campaign' }) });
    expect(start.status).toBe(200);
    const run = start.data.run;
    const initial = run.initial as GameState;
    const win = analyzeState(initial, { maxDepth: 6, maxNodes: 8000 });
    expect(win.solvable).toBe(true);

    const save = await api(`/api/run/${run.id}/save`, {
      method: 'POST',
      body: JSON.stringify({ actions: win.path.slice(0, 1) }),
    });
    expect(save.status).toBe(200);

    const firstDx = win.path[0].type === 'move' ? win.path[0].dx : 0;
    const otherDx = firstDx === 0 ? 1 : 0;
    const bad = await api(`/api/run/${run.id}/save`, {
      method: 'POST',
      body: JSON.stringify({ actions: [{ type: 'move', dx: otherDx }] }),
    });
    expect(bad.status).toBe(409);

    const finish = await api(`/api/run/${run.id}/finish`, {
      method: 'POST',
      body: JSON.stringify({ actions: win.path }),
    });
    expect(finish.status).toBe(200);
    expect(finish.data.result.outcome).toBe('won');
    expect(finish.data.result.coinsEarned).toBe(10);
    expect(finish.data.profile.level).toBe(2);
    expect(finish.data.profile.coins).toBe(40);

    const repeat = await api(`/api/run/${run.id}/finish`, {
      method: 'POST',
      body: JSON.stringify({ actions: win.path }),
    });
    expect(repeat.status).toBe(200);
    expect(repeat.data.result.alreadyFinished).toBe(true);
    expect(repeat.data.profile.coins).toBe(40);

    const buyHint = await api('/api/shop/bonus', { method: 'POST', body: JSON.stringify({ kind: 'hint' }) });
    expect(buyHint.status).toBe(200);
    expect(buyHint.data.profile.coins).toBe(20);
    expect(buyHint.data.inventory.hint).toBe(1);

    const buyFreeze = await api('/api/shop/bonus', { method: 'POST', body: JSON.stringify({ kind: 'freeze' }) });
    expect(buyFreeze.status).toBe(402);

    const run2 = (await api('/api/run/start', { method: 'POST', body: JSON.stringify({ mode: 'campaign' }) })).data.run;
    const useHint = await api('/api/bonus/use', {
      method: 'POST',
      body: JSON.stringify({ kind: 'hint', runId: run2.id, at: 0 }),
    });
    expect(useHint.status).toBe(200);
    expect(useHint.data.inventory.hint).toBe(0);

    const win2 = analyzeState(run2.initial, { maxDepth: 8, maxNodes: 10000 });
    expect(win2.solvable).toBe(true);
    const finish2 = await api(`/api/run/${run2.id}/finish`, {
      method: 'POST',
      body: JSON.stringify({ actions: win2.path }),
    });
    expect(finish2.status).toBe(200);
    expect(finish2.data.profile.level).toBe(3);
    expect(finish2.data.profile.coins).toBe(32);
  });

  it('бонус без гранта отклоняется, а с грантом работает', async () => {
    const api = makeClient();
    // Грант щита выдаётся только за ролик: без настроенной рекламы проверять нечего.
    if (!(await adsReady(api))) return;
    const run = (await api('/api/run/start', { method: 'POST', body: JSON.stringify({ mode: 'campaign' }) })).data.run;
    const initial = run.initial as GameState;
    const win = analyzeState(initial, { maxDepth: 8, maxNodes: 10000 });
    const actions: GameAction[] = [{ type: 'buff', buff: 'shield' }, ...win.path];

    const noGrant = await api(`/api/run/${run.id}/finish`, {
      method: 'POST',
      body: JSON.stringify({ actions }),
    });
    expect(noGrant.status).toBe(422);
    expect(noGrant.data.error).toBe('missing_grant');

    const shield = await api('/api/ads/reward', {
      method: 'POST',
      body: JSON.stringify({ kind: 'shield', runId: run.id, at: 0 }),
    });
    expect(shield.status).toBe(200);
    expect(shield.data.grant).toEqual({ kind: 'shield', at: 0 });

    const result = applyActions(initial, actions);
    expect(result.status).toBe('won');

    const finish = await api(`/api/run/${run.id}/finish`, {
      method: 'POST',
      body: JSON.stringify({ actions }),
    });
    expect(finish.status).toBe(200);
    expect(finish.data.result.outcome).toBe('won');
  });

  it('жизни: реклама и нехватка жизней', async () => {
    const api = makeClient();
    if (!(await adsReady(api))) return;
    const session = await api('/api/session', { method: 'POST', body: '{}' });
    if (session.data.profile.lives >= 5) {
      const full = await api('/api/ads/reward', { method: 'POST', body: JSON.stringify({ kind: 'life' }) });
      expect(full.status).toBe(409);
      expect(full.data.error).toBe('lives_full');
    }
    const coins = await api('/api/ads/reward', { method: 'POST', body: JSON.stringify({ kind: 'coins' }) });
    expect(coins.status).toBe(200);
    expect(coins.data.profile.coins).toBeGreaterThan(30);
    const cooldown = await api('/api/ads/reward', { method: 'POST', body: JSON.stringify({ kind: 'coins' }) });
    expect(cooldown.status).toBe(429);
  });

  it('бесконечный режим закрыт до 10 уровня', async () => {
    const api = makeClient();
    const res = await api('/api/run/start', { method: 'POST', body: JSON.stringify({ mode: 'endless' }) });
    expect(res.status).toBe(403);
    expect(res.data.error).toBe('endless_locked');
  });

  it('рекорды отдают валидную структуру', async () => {
    const api = makeClient();
    const res = await api('/api/leaderboard?metric=endless&scope=global');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.rows)).toBe(true);
    expect(typeof res.data.myRank).toBe('number');
  });

  it('своя тема: для себя бесплатно, мусор не проходит', async () => {
    const api = makeClient();
    const session = await api('/api/session', { method: 'POST', body: '{}' });
    expect(session.status).toBe(200);
    expect(session.data.profile.skin).toBe('classic');
    expect(session.data.profile.customSkin).toBeNull();

    // Кривой цвет и цвет, сливающийся с полем, сервер отбивает: магазин не
    // должен уметь выдать тему, которой не видно на доске.
    const brokenColor = await api('/api/profile/skin-custom', {
      method: 'POST',
      body: JSON.stringify({ skin: { name: 'мусор', glyph: '♟', tokens: { ...readableTokens, piece: 'red' } } }),
    });
    expect(brokenColor.status).toBe(422);
    expect(brokenColor.data.error).toBe('skin_unreadable');

    const invisible = await api('/api/profile/skin-custom', {
      method: 'POST',
      body: JSON.stringify({ skin: { name: 'невидимка', glyph: '♟', tokens: { ...readableTokens, piece: '#1a1a1a', plate: '' } } }),
    });
    expect(invisible.status).toBe(422);
    expect(String(invisible.data.message)).toContain('не видно');

    const saved = await api('/api/profile/skin-custom', {
      method: 'POST',
      body: JSON.stringify({ skin: { name: 'Проверка', glyph: '❖', tokens: readableTokens } }),
    });
    expect(saved.status).toBe(200);
    expect(saved.data.profile.skin).toBe('custom');
    expect(saved.data.profile.customSkin.name).toBe('Проверка');
    expect(saved.data.readability.ok).toBe(true);

    // Свою тему можно снять - и она снимается без счёта.
    const back = await api('/api/profile/skin', { method: 'POST', body: JSON.stringify({ skin: 'classic' }) });
    expect(back.status).toBe(200);
    expect(back.data.profile.skin).toBe('classic');

    // Чужая тема из галереи ставится бесплатно, но только одобренная.
    const gallery = await api('/api/skins/gallery');
    expect(gallery.status).toBe(200);
    expect(Array.isArray(gallery.data.items)).toBe(true);
    const install = await api('/api/skins/install', { method: 'POST', body: JSON.stringify({ id: 999999 }) });
    expect(install.status).toBe(404);

    // Тема, за которую не платили, не надевается - кроме витрины сезона и наград.
    const locked = await api('/api/profile/skin', { method: 'POST', body: JSON.stringify({ skin: 'royal' }) });
    expect([200, 403]).toContain(locked.status);
    if (locked.status === 403) expect(locked.data.error).toBe('skin_locked');

    const unknown = await api('/api/profile/skin', { method: 'POST', body: JSON.stringify({ skin: '<script>' }) });
    expect(unknown.status).toBe(400);
  });

  it('витрина магазина отвечает цифрами, которыми платит клиент', async () => {
    const api = makeClient();
    const res = await api('/api/skins/showcase');
    expect(res.status).toBe(200);
    expect(['gold', 'neon', 'royal']).toContain(res.data.skin);
    expect(res.data.shareFee).toBeGreaterThan(0);
    expect(res.data.setFee).toBeGreaterThan(res.data.singleFee);
    expect(res.data.endsAt).toBeGreaterThan(Date.now());
    const opened = await api('/api/shop/open', { method: 'POST', body: '{}' });
    expect(opened.status).toBe(200);
  });
});
