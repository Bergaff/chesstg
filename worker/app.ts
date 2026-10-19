import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  AD_COINS_REWARD,
  BONUSES,
  MAX_LIVES,
  addLife,
  applyActions,
  campaignCoinReward,
  createCampaignLevel,
  createEndlessRun,
  endlessCoinReward,
  isBonusId,
  isSkinId,
  loseLife,
  materializeLives,
  randomSeed,
  RuleError,
  type BonusId,
  type GameAction,
  type GameState,
} from '../src/engine';
import { authMiddleware, syncTelegramName } from './auth';
import {
  activeRuns,
  getRun,
  getUserById,
  grantsForRun,
  ownedSkins,
  publicConfig,
  refreshLives,
  requireOwnRun,
  serializeRun,
  toProfile,
  REFERRAL_BONUS,
} from './db';
import { fail, HttpError, isPrefix, parseActions, readJson, nowMs } from './http';
import { createInvoice, fulfillPayment, getPayment, isProductSku, refundPayment } from './payments';
import {
  answerPreCheckout,
  botStartLink,
  sendHelp,
  sendWelcome,
  notifyReferrer,
} from './telegram';
import type { AppEnv, RunRow, UserRow, WorkerEnv } from './types';

const app = new Hono<AppEnv>();

app.use('/api/*', cors({ origin: '*', allowHeaders: ['Authorization', 'X-Guest-Id', 'Content-Type'], allowMethods: ['GET', 'POST', 'OPTIONS'] }));
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

const publicPaths = new Set(['/api/health', '/api/config', '/api/telegram/webhook']);

app.use('/api/*', async (c, next) => {
  if (publicPaths.has(c.req.path)) return next();
  return authMiddleware(c, next);
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json(
      { error: err.code, message: err.message, ...(err.details ?? {}) },
      err.status as ContentfulStatusCode,
    );
  }
  console.error('Unhandled error', err instanceof Error ? err.stack ?? err.message : String(err));
  return c.json({ error: 'internal', message: 'Внутренняя ошибка сервера' }, 500);
});

app.notFound((c) => c.json({ error: 'not_found', message: 'Такого метода нет' }, 404));

function auth(c: Context<AppEnv>) {
  return c.get('auth');
}

function safeParseActions(raw: string): GameAction[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) fail(500, 'run_corrupt');
    return parsed as GameAction[];
  } catch {
    fail(500, 'run_corrupt', 'Повреждённый журнал ходов');
  }
}

function replay(run: RunRow, actions: GameAction[]): GameState {
  let initial: GameState;
  try {
    initial = JSON.parse(run.initial_state) as GameState;
  } catch {
    fail(500, 'run_corrupt', 'Повреждённое поле');
  }
  try {
    return applyActions(initial, actions);
  } catch (error) {
    if (error instanceof RuleError) fail(422, 'invalid_actions', error.message);
    fail(422, 'invalid_actions', 'Ходы не соответствуют правилам');
  }
}

function parseStartParam(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

function challengeFrom(param: string): { level: number; score: number } | null {
  const match = /^ch_(\d{1,3})_(\d{1,5})$/.exec(param);
  if (!match) return null;
  return { level: Number(match[1]), score: Number(match[2]) };
}

async function invitedCount(env: WorkerEnv, userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').bind(userId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function sessionBody(env: WorkerEnv, authCtx: AppEnv['Variables']['auth'], extra: Record<string, unknown> = {}) {
  return {
    profile: toProfile(authCtx.user),
    config: publicConfig(env),
    active: await activeRuns(env, authCtx.user.id),
    invitedCount: await invitedCount(env, authCtx.user.id),
    ...extra,
  };
}

app.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true, now: nowMs(), service: 'pawn-vs-all' });
  } catch {
    return c.json({ ok: false, error: 'db_unavailable' }, 503);
  }
});

app.get('/api/config', (c) => c.json({ config: publicConfig(c.env) }));

// ─────────────────────────────── Сессия ───────────────────────────────

app.post('/api/session', async (c) => {
  const authCtx = auth(c);
  // имя могло измениться в Telegram
  if (authCtx.kind === 'telegram') {
    await syncTelegramName(c.env, authCtx);
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await c.req.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  const startParam = parseStartParam(body.startParam);
  const challenge = challengeFrom(startParam);

  authCtx.user = await refreshLives(c.env, authCtx.user);

  let referral: { rewarded: boolean; bonus: number } | null = null;
  const refMatch = /^ref_([a-z0-9]{6,16})$/i.exec(startParam);
  if (authCtx.fresh && authCtx.kind === 'telegram' && refMatch) {
    const referrer = await c.env.DB.prepare(
      'SELECT id, first_name, tg_id, invite_code FROM users WHERE invite_code = ? AND is_guest = 0 AND id <> ? LIMIT 1',
    )
      .bind(refMatch[1], authCtx.user.id)
      .first<{ id: string; first_name: string; tg_id: number | null; invite_code: string }>();

    if (referrer) {
      const now = nowMs();
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE users SET referred_by = ?, coins = coins + ?, updated_at = ? WHERE id = ?').bind(
          referrer.id,
          REFERRAL_BONUS,
          now,
          authCtx.user.id,
        ),
        c.env.DB.prepare('UPDATE users SET coins = coins + ?, updated_at = ? WHERE id = ?').bind(
          REFERRAL_BONUS,
          now,
          referrer.id,
        ),
      ]);
      authCtx.user = {
        ...authCtx.user,
        coins: authCtx.user.coins + REFERRAL_BONUS,
        referred_by: referrer.id,
      };
      referral = { rewarded: true, bonus: REFERRAL_BONUS };

      if (referrer.tg_id) {
        try {
          c.executionCtx.waitUntil(
            notifyReferrer(c.env, referrer.tg_id, authCtx.user.first_name, REFERRAL_BONUS),
          );
        } catch {
          /* executionCtx недоступен в некоторых средах */
        }
      }
    }
  }

  return c.json(await sessionBody(c.env, authCtx, { challenge, referral }));
});

app.get('/api/session', async (c) => {
  const authCtx = auth(c);
  authCtx.user = await refreshLives(c.env, authCtx.user);
  const challenge = challengeFrom(parseStartParam(c.req.query('startParam')));
  return c.json(await sessionBody(c.env, authCtx, { challenge }));
});

// ─────────────────────────────── Забеги ───────────────────────────────

app.post('/api/run/start', async (c) => {
  const authCtx = auth(c);
  const body = await readJson(c);
  const mode = body.mode === 'endless' ? 'endless' : body.mode === 'campaign' ? 'campaign' : null;
  if (!mode) fail(400, 'bad_mode', 'Неизвестный режим');

  const user = await refreshLives(c.env, authCtx.user);
  if (mode === 'endless' && user.max_level <= 10) {
    fail(403, 'endless_locked', 'Бесконечный режим откроется после 10 уровня', {
      unlockAtLevel: 10,
    });
  }

  const existing = await c.env.DB.prepare(
    `SELECT * FROM runs WHERE user_id = ? AND mode = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(user.id, mode)
    .first<RunRow>();

  if (existing) {
    return c.json({ resumed: true, run: serializeRun(existing) });
  }

  const lives = materializeLives(user.lives, user.lives_at, nowMs());
  if (lives.lives <= 0) {
    fail(402, 'no_lives', 'Жизни закончились. Подожди восстановления или возьми бонус.', {
      lives: 0,
      nextLifeAt: lives.livesAt + 30 * 60 * 1000,
    });
  }

  const seed = randomSeed();
  const initial = mode === 'campaign' ? createCampaignLevel(user.level, seed) : createEndlessRun(seed);
  const id = crypto.randomUUID();
  const now = nowMs();

  await c.env.DB.prepare(
    `INSERT INTO runs (id, user_id, mode, level, seed, initial_state, actions, moves, score, status, result, finish_id, created_at, updated_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', 0, 0, 'active', NULL, NULL, ?, ?, NULL)`,
  )
    .bind(id, user.id, mode, mode === 'campaign' ? user.level : 0, seed, JSON.stringify(initial), now, now)
    .run();

  const run = await getRun(c.env, id);
  if (!run) fail(500, 'run_create_failed');
  return c.json({ resumed: false, run: serializeRun(run) });
});

app.get('/api/run/:id', async (c) => {
  const authCtx = auth(c);
  const run = await requireOwnRun(c.env, c.req.param('id'), authCtx.user.id);
  return c.json({ run: serializeRun(run) });
});

async function saveActions(c: Context<AppEnv>, user: UserRow, runId: string) {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const run = await requireOwnRun(c.env, runId, user.id);
  if (run.status !== 'active') fail(409, 'run_finished', 'Этот забег уже завершён');

  const incoming = parseActions(body.actions);
  const stored = safeParseActions(run.actions);
  if (!isPrefix(incoming, stored) && !isPrefix(stored, incoming)) {
    fail(409, 'actions_conflict', 'История ходов изменилась не по правилам');
  }

  const state = replay(run, incoming);
  const now = nowMs();
  const result = await c.env.DB.prepare(
    `UPDATE runs SET actions = ?, moves = ?, score = ?, updated_at = ?
     WHERE id = ? AND status = 'active' AND actions = ?`,
  )
    .bind(JSON.stringify(incoming), state.moves, state.score, now, run.id, run.actions)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    fail(409, 'save_conflict', 'Партия изменилась на другом устройстве');
  }

  return { ok: true, saved: incoming.length, moves: state.moves, score: state.score };
}

app.post('/api/run/:id/save', async (c) => {
  const authCtx = auth(c);
  const data = await saveActions(c, authCtx.user, c.req.param('id'));
  return c.json(data);
});

app.post('/api/run/:id/actions', async (c) => {
  const authCtx = auth(c);
  const data = await saveActions(c, authCtx.user, c.req.param('id'));
  return c.json(data);
});

app.post('/api/run/:id/finish', async (c) => {
  const authCtx = auth(c);
  const run = await requireOwnRun(c.env, c.req.param('id'), authCtx.user.id);

  if (run.status !== 'active') {
    const storedResult = run.result ? JSON.parse(run.result) : { outcome: run.status };
    const user = await refreshLives(c.env, authCtx.user);
    return c.json({ result: { ...storedResult, alreadyFinished: true }, profile: toProfile(user) });
  }

  const body = await readJson(c);
  const actions = parseActions(body.actions);
  const stored = safeParseActions(run.actions);
  if (!isPrefix(stored, actions) && !isPrefix(actions, stored)) {
    fail(409, 'actions_conflict', 'История ходов не совпадает');
  }

  const state = replay(run, actions);

  // Каждый применённый бонус должен быть оплачен/получен за рекламу заранее.
  const grants = await grantsForRun(c.env, run.id);
  const available = new Map<string, number>();
  for (const grant of grants) {
    const key = `${grant.kind}:${grant.action_index}`;
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.type !== 'buff') continue;
    const key = `${action.buff}:${i}`;
    const count = available.get(key) ?? 0;
    if (count <= 0) {
      fail(422, 'missing_grant', 'Бонус не был оплачен', { index: i, buff: action.buff });
    }
    available.set(key, count - 1);
  }

  const now = nowMs();
  let user = await refreshLives(c.env, authCtx.user, now);
  const outcome: 'won' | 'lost' | 'quit' =
    state.status === 'won' ? 'won' : state.status === 'lost' ? 'lost' : 'quit';

  let reward = 0;
  let levelUp = false;
  let livesAfter = user.lives;
  let livesAtAfter = user.lives_at;
  let levelAfter = user.level;
  let maxLevelAfter = user.max_level;
  let bestAfter = user.endless_best;
  let bestTierAfter = user.endless_best_tier;
  let bestMovesAfter = user.endless_best_moves;
  let newBest = false;

  if (run.mode === 'campaign') {
    if (outcome === 'won') {
      if (run.level > user.level) {
        fail(409, 'level_out_of_sync', 'Уровень забега опережает профиль');
      }
      if (run.level === user.level) {
        reward = campaignCoinReward(run.level);
        levelUp = true;
        levelAfter = user.level + 1;
        maxLevelAfter = Math.max(user.max_level, levelAfter);
      }
    } else if (outcome === 'lost') {
      const next = loseLife(user.lives, user.lives_at, now);
      livesAfter = next.lives;
      livesAtAfter = next.livesAt;
    }
  } else {
    if (state.score > user.endless_best) {
      newBest = true;
      bestAfter = state.score;
      bestTierAfter = state.tier;
      bestMovesAfter = state.moves;
      reward = endlessCoinReward(state.score);
    }
    if (outcome === 'lost') {
      const next = loseLife(user.lives, user.lives_at, now);
      livesAfter = next.lives;
      livesAtAfter = next.livesAt;
    }
  }

  const wasUnlocked = user.max_level > 10;
  const endlessUnlockedNow = !wasUnlocked && maxLevelAfter > 10;
  const finishId = crypto.randomUUID();
  const newStatus = outcome === 'won' ? 'won' : outcome === 'lost' ? 'lost' : 'quit';

  const result = {
    outcome,
    mode: run.mode,
    level: run.level,
    score: state.score,
    moves: state.moves,
    coinsEarned: reward,
    levelUp,
    nextLevel: levelAfter,
    maxLevel: maxLevelAfter,
    lives: livesAfter,
    capturedBy: state.capturedBy ?? null,
    newBest,
    bestScore: run.mode === 'endless' ? Math.max(user.endless_best, state.score) : null,
    endlessUnlockedNow,
  };

  const runUpdate = c.env.DB.prepare(
    `UPDATE runs SET status = ?, actions = ?, moves = ?, score = ?, result = ?, finish_id = ?,
      updated_at = ?, finished_at = ?
     WHERE id = ? AND status = 'active'`,
  )
    .bind(
      newStatus,
      JSON.stringify(actions),
      state.moves,
      state.score,
      JSON.stringify(result),
      finishId,
      now,
      now,
      run.id,
    );

  const set: string[] = ['updated_at = ?'];
  const binds: unknown[] = [now];
  if (reward > 0) {
    set.push('coins = coins + ?');
    binds.push(reward);
  }
  if (levelUp) {
    set.push('level = ?', 'max_level = MAX(max_level, ?)');
    binds.push(levelAfter, levelAfter);
  }
  if (outcome === 'lost') {
    set.push('lives = ?', 'lives_at = ?');
    binds.push(livesAfter, livesAtAfter);
  }
  if (newBest) {
    set.push('endless_best = ?', 'endless_best_tier = ?', 'endless_best_moves = ?');
    binds.push(bestAfter, bestTierAfter, bestMovesAfter);
  }
  binds.push(user.id, run.id, finishId);

  const userUpdate = c.env.DB.prepare(
    `UPDATE users SET ${set.join(', ')}
     WHERE id = ? AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND finish_id = ?)`,
  ).bind(...binds);

  const batch = await c.env.DB.batch([runUpdate, userUpdate]);
  const fresh = await getUserById(c.env, user.id);
  if (!fresh) fail(500, 'user_missing');

  if (Number(batch[0]?.meta?.changes ?? 0) === 0) {
    const again = await getRun(c.env, run.id);
    const storedResult = again?.result ? JSON.parse(again.result) : result;
    return c.json({ result: { ...storedResult, alreadyFinished: true }, profile: toProfile(fresh) });
  }

  return c.json({ result, profile: toProfile(fresh) });
});

// ─────────────────────────────── Бонусы ───────────────────────────────

const BONUS_COLUMN: Record<'hint' | 'freeze' | 'undo', 'inv_hint' | 'inv_freeze' | 'inv_undo'> = {
  hint: 'inv_hint',
  freeze: 'inv_freeze',
  undo: 'inv_undo',
};

app.post('/api/bonus/use', async (c) => {
  const authCtx = auth(c);
  const body = await readJson(c);
  const kind = body.kind;
  if (!isBonusId(kind) || !['hint', 'freeze', 'undo'].includes(kind)) {
    fail(400, 'bad_bonus', 'Неизвестный бонус');
  }
  if (kind !== 'hint' && kind !== 'freeze' && kind !== 'undo') fail(400, 'bad_bonus');

  const runId = typeof body.runId === 'string' ? body.runId : '';
  if (!runId) fail(400, 'bad_request', 'Не указан забег');
  const run = await requireOwnRun(c.env, runId, authCtx.user.id);
  if (run.status !== 'active') fail(409, 'run_finished', 'Забег уже завершён');

  const at = Number(body.at);
  if (!Number.isInteger(at) || at < 0 || at > 5000) fail(400, 'bad_request', 'Некорректная позиция бонуса');

  const user = await refreshLives(c.env, authCtx.user);
  const column = BONUS_COLUMN[kind];
  const price = BONUSES[kind].price;
  const now = nowMs();

  let source: 'inventory' | 'coins';
  let charged;
  if (user[column] > 0) {
    source = 'inventory';
    charged = await c.env.DB.prepare(
      `UPDATE users SET ${column} = ${column} - 1, updated_at = ? WHERE id = ? AND ${column} > 0`,
    )
      .bind(now, user.id)
      .run();
  } else {
    source = 'coins';
    charged = await c.env.DB.prepare(
      'UPDATE users SET coins = coins - ?, updated_at = ? WHERE id = ? AND coins >= ?',
    )
      .bind(price, now, user.id, price)
      .run();
  }

  if (Number(charged.meta?.changes ?? 0) === 0) {
    fail(402, 'not_enough_coins', `Не хватает монет: нужно ${price} 🪙`, { price, kind });
  }

  if (kind === 'freeze') {
    await c.env.DB.prepare(
      `INSERT INTO grants (run_id, user_id, kind, action_index, source, created_at)
       VALUES (?, ?, 'freeze', ?, ?, ?)`,
    )
      .bind(run.id, user.id, at, source, now)
      .run();
  }

  const fresh = await getUserById(c.env, user.id);
  if (!fresh) fail(500, 'user_missing');
  return c.json({
    ok: true,
    kind,
    source,
    price: source === 'coins' ? price : 0,
    coins: fresh.coins,
    inventory: { hint: fresh.inv_hint, freeze: fresh.inv_freeze, undo: fresh.inv_undo },
    grant: kind === 'freeze' ? { kind: 'freeze', at } : null,
  });
});

app.post('/api/shop/bonus', async (c) => {
  const authCtx = auth(c);
  const body = await readJson(c);
  const kind = body.kind;
  if (kind !== 'hint' && kind !== 'freeze' && kind !== 'undo') fail(400, 'bad_bonus', 'Неизвестный бонус');

  const column = BONUS_COLUMN[kind];
  const price = BONUSES[kind].price;
  const now = nowMs();
  const updated = await c.env.DB.prepare(
    `UPDATE users SET coins = coins - ?, ${column} = ${column} + 1, updated_at = ?
     WHERE id = ? AND coins >= ?`,
  )
    .bind(price, now, authCtx.user.id, price)
    .run();

  if (Number(updated.meta?.changes ?? 0) === 0) {
    fail(402, 'not_enough_coins', `Не хватает монет: нужно ${price} 🪙`, { price, kind });
  }

  const fresh = await getUserById(c.env, authCtx.user.id);
  if (!fresh) fail(500, 'user_missing');
  return c.json({
    ok: true,
    profile: toProfile(fresh),
    inventory: { hint: fresh.inv_hint, freeze: fresh.inv_freeze, undo: fresh.inv_undo },
  });
});

app.post('/api/profile/skin', async (c) => {
  const authCtx = auth(c);
  const body = await readJson(c);
  const skin = body.skin;
  if (!isSkinId(skin)) fail(400, 'bad_skin', 'Неизвестный скин');
  const owned = ownedSkins(authCtx.user);
  if (!owned.includes(skin)) fail(403, 'skin_locked', 'Скин не куплен');

  await c.env.DB.prepare('UPDATE users SET skin = ?, updated_at = ? WHERE id = ?')
    .bind(skin, nowMs(), authCtx.user.id)
    .run();
  const fresh = await getUserById(c.env, authCtx.user.id);
  if (!fresh) fail(500, 'user_missing');
  return c.json({ ok: true, profile: toProfile(fresh) });
});

// ─────────────────────────────── Реклама ───────────────────────────────

const AD_COOLDOWN: Record<'life' | 'coins' | 'shield', number> = {
  life: 45_000,
  coins: 60_000,
  shield: 20_000,
};

app.post('/api/ads/reward', async (c) => {
  const authCtx = auth(c);
  if (authCtx.user.ad_free) fail(403, 'ad_free', 'Реклама отключена — бонусы за просмотр недоступны');

  const body = await readJson(c);
  const kind = body.kind;
  if (kind !== 'life' && kind !== 'coins' && kind !== 'shield') fail(400, 'bad_ad_reward');

  const now = nowMs();
  const last = await c.env.DB.prepare(
    'SELECT created_at FROM ad_events WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(authCtx.user.id, kind)
    .first<{ created_at: number }>();
  if (last && now - last.created_at < AD_COOLDOWN[kind]) {
    fail(429, 'cooldown', 'Слишком часто. Попробуй чуть позже.', {
      retryInMs: AD_COOLDOWN[kind] - (now - last.created_at),
    });
  }

  let user = await refreshLives(c.env, authCtx.user, now);
  let grant: { kind: 'shield'; at: number } | null = null;

  if (kind === 'life') {
    if (user.lives >= MAX_LIVES) fail(409, 'lives_full', 'Жизни уже полны');
    const next = addLife(user.lives, user.lives_at, now, 1);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET lives = ?, lives_at = ?, updated_at = ? WHERE id = ?').bind(
        next.lives,
        next.livesAt,
        now,
        user.id,
      ),
      c.env.DB.prepare('INSERT INTO ad_events (user_id, kind, created_at) VALUES (?, ?, ?)').bind(
        user.id,
        kind,
        now,
      ),
    ]);
  } else if (kind === 'coins') {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET coins = coins + ?, updated_at = ? WHERE id = ?').bind(AD_COINS_REWARD, now, user.id),
      c.env.DB.prepare('INSERT INTO ad_events (user_id, kind, created_at) VALUES (?, ?, ?)').bind(
        user.id,
        kind,
        now,
      ),
    ]);
  } else {
    const runId = typeof body.runId === 'string' ? body.runId : '';
    const at = Number(body.at);
    if (!runId || !Number.isInteger(at) || at < 0 || at > 5000) fail(400, 'bad_request');
    const run = await requireOwnRun(c.env, runId, user.id);
    if (run.status !== 'active') fail(409, 'run_finished');
    const existing = await c.env.DB.prepare(
      `SELECT 1 FROM grants WHERE run_id = ? AND kind = 'shield' LIMIT 1`,
    )
      .bind(run.id)
      .first();
    if (existing) fail(409, 'already_used', 'Щит уже взят в этом забеге');

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO grants (run_id, user_id, kind, action_index, source, created_at)
         VALUES (?, ?, 'shield', ?, 'ad', ?)`,
      ).bind(run.id, user.id, at, now),
      c.env.DB.prepare('INSERT INTO ad_events (user_id, kind, created_at) VALUES (?, ?, ?)').bind(
        user.id,
        kind,
        now,
      ),
    ]);
    grant = { kind: 'shield', at };
  }

  const fresh = await getUserById(c.env, user.id);
  if (!fresh) fail(500, 'user_missing');
  user = fresh;
  const profile = toProfile(user);
  return c.json({
    ok: true,
    kind,
    coins: profile.coins,
    lives: profile.lives,
    nextLifeAt: profile.nextLifeAt,
    grant,
    profile,
  });
});

// ─────────────────────────────── Платежи ───────────────────────────────

app.post('/api/shop/invoice', async (c) => {
  const authCtx = auth(c);
  const body = await readJson(c);
  const sku = body.sku;
  if (!isProductSku(sku)) fail(400, 'bad_sku', 'Неизвестный товар');
  const user = await refreshLives(c.env, authCtx.user);
  const invoice = await createInvoice(c.env, user, sku);
  return c.json(invoice);
});

app.get('/api/pay/status', async (c) => {
  const authCtx = auth(c);
  const charge = c.req.query('charge')?.trim() ?? '';
  if (!charge) fail(400, 'bad_request');
  const payment = await getPayment(c.env, charge);
  if (!payment || payment.user_id !== authCtx.user.id) fail(404, 'payment_not_found');
  return c.json({ status: payment.status, sku: payment.sku, stars: payment.stars });
});

// ─────────────────────────────── Рекорды ───────────────────────────────

app.get('/api/leaderboard', async (c) => {
  const authCtx = auth(c);
  const user = authCtx.user;
  const metric = c.req.query('metric') === 'campaign' ? 'campaign' : 'endless';
  const friends = c.req.query('scope') === 'friends';
  const order =
    metric === 'campaign'
      ? 'max_level DESC, endless_best DESC, updated_at ASC'
      : 'endless_best DESC, max_level DESC, updated_at ASC';

  const where = friends
    ? '(id = ? OR referred_by = ?)'
    : 'is_guest = 0';
  const bindings = friends ? [user.id, user.id] : [];

  const { results } = await c.env.DB.prepare(
    `SELECT id, first_name, endless_best, endless_best_tier, max_level, level FROM users
     WHERE ${where} ORDER BY ${order} LIMIT 50`,
  )
    .bind(...bindings)
    .all<{
      id: string;
      first_name: string;
      endless_best: number;
      endless_best_tier: number;
      max_level: number;
      level: number;
    }>();

  const rows = results.map((row, index) => ({
    rank: index + 1,
    name: row.first_name || 'Игрок',
    isMe: row.id === user.id,
    endlessBest: row.endless_best,
    maxLevel: row.max_level,
    level: row.level,
  }));

  const rankWhere = friends
    ? `(id = ? OR referred_by = ?) AND `
    : `is_guest = 0 AND `;
  const rankColumn = metric === 'campaign' ? 'max_level' : 'endless_best';
  const myValue = metric === 'campaign' ? user.max_level : user.endless_best;
  const rankBindings = friends ? [user.id, user.id, myValue] : [myValue];
  const rankRow = await c.env.DB.prepare(
    `SELECT COUNT(*) + 1 AS rank FROM users WHERE ${rankWhere}${rankColumn} > ?`,
  )
    .bind(...rankBindings)
    .first<{ rank: number }>();

  const inviteLink = botStartLink(c.env, `ref_${user.invite_code}`);
  return c.json({
    metric,
    scope: friends ? 'friends' : 'global',
    rows,
    myRank: Number(rankRow?.rank ?? 0),
    invitedCount: await invitedCount(c.env, user.id),
    inviteLink,
  });
});

// ─────────────────────────────── Telegram webhook ───────────────────────────────

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function handleUpdate(env: WorkerEnv, update: Record<string, unknown>): Promise<void> {
  const message = record(update.message);
  if (message) {
    const chat = record(message.chat);
    const chatId = typeof chat?.id === 'number' ? chat.id : null;
    const text = typeof message.text === 'string' ? message.text : '';
    const firstName = typeof record(message.from)?.first_name === 'string'
      ? (record(message.from)?.first_name as string)
      : 'друг';

    if (chatId && text.startsWith('/start')) {
      const payload = text.split(/\s+/)[1] ?? undefined;
      await sendWelcome(env, chatId, firstName, payload);
      return;
    }
    if (chatId && text.startsWith('/play')) {
      await sendWelcome(env, chatId, firstName);
      return;
    }
    if (chatId && text.startsWith('/help')) {
      await sendHelp(env, chatId);
      return;
    }

    const payment = record(message.successful_payment);
    if (payment) {
      const payload = typeof payment.invoice_payload === 'string' ? payment.invoice_payload : '';
      const currency = payment.currency;
      const amount = payment.total_amount;
      const telegramCharge = typeof payment.telegram_payment_charge_id === 'string'
        ? payment.telegram_payment_charge_id
        : null;
      const row = payload ? await getPayment(env, payload) : null;
      if (row && currency === 'XTR' && amount === row.stars) {
        await fulfillPayment(env, payload, telegramCharge);
      } else {
        console.warn('Payment mismatch or unknown payload', payload, currency, amount);
      }
      return;
    }

    const refund = record(message.refunded_payment);
    if (refund && typeof refund.invoice_payload === 'string') {
      await refundPayment(env, refund.invoice_payload);
      return;
    }
  }

  const preCheckout = record(update.pre_checkout_query);
  if (preCheckout) {
    const id = typeof preCheckout.id === 'string' ? preCheckout.id : '';
    const payload = typeof preCheckout.invoice_payload === 'string' ? preCheckout.invoice_payload : '';
    const currency = preCheckout.currency;
    const amount = preCheckout.total_amount;
    const row = payload ? await getPayment(env, payload) : null;
    const ok = Boolean(row && row.status === 'pending' && currency === 'XTR' && amount === row.stars);
    if (!id) return;
    await answerPreCheckout(env, id, ok, ok ? undefined : 'Счёт устарел. Открой магазин и попробуй снова.');
    return;
  }
}

app.post('/api/telegram/webhook', async (c) => {
  const secret = c.env.WEBHOOK_SECRET?.trim();
  if (secret) {
    if (c.req.header('X-Telegram-Bot-Api-Secret-Token') !== secret) {
      return c.text('forbidden', 403);
    }
  } else if (c.env.DEV_MODE !== 'true') {
    return c.text('webhook is not configured', 503);
  }

  let update: Record<string, unknown>;
  try {
    const data = await c.req.json();
    const parsed = record(data);
    if (!parsed) return c.json({ ok: false });
    update = parsed;
  } catch {
    return c.json({ ok: false });
  }

  try {
    await handleUpdate(c.env, update);
  } catch (error) {
    console.error('Webhook handling error', error instanceof Error ? error.message : String(error));
  }
  return c.json({ ok: true });
});

// Совместимость с Telegram: некоторые клиенты дергают webhook GET-ом при проверке.
app.get('/api/telegram/webhook', (c) => c.json({ ok: true, hint: 'POST only' }));

export default app;
