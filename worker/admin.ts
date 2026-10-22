import { Hono } from 'hono';
import {
  auditState,
  availablePieceTypes,
  createCampaignLevel,
  difficultyBand,
  pieceCountForLevel,
  sizeForLevel,
  heightForLevel,
  type AuditResult,
  type PieceType,
} from '../src/engine';
import { parseModeLevels, profileModes, resumableRun } from './db';
import { SCHEMA_VERSION } from './schema';
import { fail, readJson } from './http';
import { botToken, hasBotToken } from './token';
import type { AppEnv, UserRow, WorkerEnv } from './types';
import { webAppKeyStatus } from './webAppKey';

/**
 * Админка.
 *
 * Доступ только по паролю: пароль хранится в секретах воркера, вход выдаёт
 * подписанный токен на 12 часов. Токен живёт в sessionStorage браузера,
 * поэтому перезапуск вкладки требует повторного ввода пароля.
 */

const encoder = new TextEncoder();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function adminConfigured(env: WorkerEnv): boolean {
  const password = env.ADMIN_PASSWORD?.trim() ?? '';
  const hash = env.ADMIN_PASSWORD_HASH?.trim() ?? '';
  const secret = env.ADMIN_SECRET?.trim() ?? '';
  return Boolean((password || hash) && secret);
}

async function passwordMatches(env: WorkerEnv, password: string): Promise<boolean> {
  const hash = env.ADMIN_PASSWORD_HASH?.trim();
  if (hash) {
    const computed = await sha256Hex(password);
    return safeEqual(computed, hash.toLowerCase());
  }
  const plain = env.ADMIN_PASSWORD?.trim() ?? '';
  if (!plain) return false;
  return safeEqual(password, plain);
}

/** Подписанный токен вида `exp.signature`. */
export async function signAdminToken(
  secret: string,
  now = Date.now(),
  ttl = TOKEN_TTL_MS,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now + ttl;
  const signature = await hmacHex(secret, `admin|${expiresAt}`);
  return { token: `${expiresAt}.${signature}`, expiresAt };
}

/** Проверка токена: срок и подпись. Возвращает время истечения или null. */
export async function verifyAdminToken(
  secret: string,
  token: string,
  now = Date.now(),
): Promise<number | null> {
  if (!secret || !token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const expiresRaw = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(expiresAt) || expiresAt <= now) return null;
  const expected = await hmacHex(secret, `admin|${expiresAt}`);
  if (!safeEqual(expected, signature)) return null;
  return expiresAt;
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header('CF-Connecting-IP')?.trim() ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'local'
  ).slice(0, 64);
}

function intParam(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY = 86_400_000;

function fillSeries(rows: Array<{ d: string; n: number }>, days: number, now: number) {
  const map = new Map(rows.map((row) => [row.d, Number(row.n)]));
  const series: Array<{ day: string; value: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(now - i * DAY);
    series.push({ day, value: map.get(day) ?? 0 });
  }
  return series;
}

/* ─────────────────────────────── роуты ─────────────────────────────── */

export const adminApp = new Hono<AppEnv>();

const PUBLIC_PATHS = new Set(['/api/admin/status', '/api/admin/login']);

adminApp.use('*', async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  const secret = c.env.ADMIN_SECRET?.trim() ?? '';
  if (!secret) fail(503, 'admin_disabled', 'Админка не настроена: добавьте ADMIN_SECRET');
  const header = c.req.header('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  const expiresAt = await verifyAdminToken(secret, token);
  if (!expiresAt) fail(401, 'admin_unauthorized', 'Требуется вход в админку');
  c.set('adminExpiresAt', expiresAt);
  return next();
});

adminApp.get('/status', async (c) => {
  const configured = adminConfigured(c.env);
  if (!configured) {
    return c.json({ configured: false, authenticated: false, expiresAt: null });
  }
  const secret = c.env.ADMIN_SECRET!.trim();
  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const expiresAt = await verifyAdminToken(secret, token);
  return c.json({ configured: true, authenticated: Boolean(expiresAt), expiresAt });
});

adminApp.post('/login', async (c) => {
  if (!adminConfigured(c.env)) {
    fail(503, 'admin_disabled', 'Админка не настроена: добавьте ADMIN_PASSWORD и ADMIN_SECRET');
  }

  const ip = clientIp(c);
  const now = Date.now();
  const body = await readJson(c);
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';

  // Счётчик попыток живёт в D1. Если таблицы ещё нет, вход не блокируем:
  // администратор должен попасть внутрь и увидеть, что база не готова.
  let fails: { n: number; first: number | null } | null = null;
  let limiterWorks = true;
  try {
    fails = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n, MIN(created_at) AS first FROM admin_attempts WHERE ip = ? AND ok = 0 AND created_at > ?',
    )
      .bind(ip, now - LOGIN_WINDOW_MS)
      .first<{ n: number; first: number | null }>();
  } catch (error) {
    limiterWorks = false;
    console.error('admin login: attempts table unavailable', String(error).slice(0, 200));
  }

  if (limiterWorks && Number(fails?.n ?? 0) >= LOGIN_MAX_FAILS) {
    const retryInMs = Math.max(0, Number(fails?.first ?? now) + LOGIN_WINDOW_MS - now);
    fail(429, 'too_many_attempts', 'Слишком много попыток. Попробуйте позже.', { retryInMs });
  }

  const ok = password.length > 0 && (await passwordMatches(c.env, password));

  if (limiterWorks) {
    try {
      await c.env.DB.prepare('INSERT INTO admin_attempts (ip, ok, created_at) VALUES (?, ?, ?)')
        .bind(ip, ok ? 1 : 0, now)
        .run();
    } catch (error) {
      console.error('admin login: attempts insert failed', String(error).slice(0, 200));
    }
  }

  if (!ok) {
    const left = Math.max(0, LOGIN_MAX_FAILS - Number(fails?.n ?? 0) - 1);
    fail(401, 'bad_password', 'Неверный пароль', { attemptsLeft: left });
  }

  // Чистка старых попыток не должна мешать входу.
  try {
    await c.env.DB.prepare('DELETE FROM admin_attempts WHERE created_at < ?').bind(now - 7 * DAY).run();
  } catch (error) {
    console.error('admin login: cleanup failed', String(error).slice(0, 200));
  }

  const { token, expiresAt } = await signAdminToken(c.env.ADMIN_SECRET!.trim());
  return c.json({ token, expiresAt });
});

adminApp.post('/logout', (c) => c.json({ ok: true }));

adminApp.get('/overview', async (c) => {
  const now = Date.now();
  const days = intParam(c.req.query('days'), 14, 1, 90);
  const start = now - days * DAY;
  const db = c.env.DB;

  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS users,
              COALESCE(SUM(is_guest), 0) AS guests,
              COALESCE(SUM(ad_free), 0) AS adFree,
              COALESCE(SUM(coins), 0) AS coins,
              COALESCE(SUM(CASE WHEN max_level > 1 THEN 1 ELSE 0 END), 0) AS played,
              COALESCE(SUM(CASE WHEN max_level > 10 THEN 1 ELSE 0 END), 0) AS endlessUnlocked,
              COALESCE(SUM(CASE WHEN endless_best > 0 THEN 1 ELSE 0 END), 0) AS endlessPlayed,
              COALESCE(MAX(max_level), 0) AS topLevel,
              COALESCE(MAX(endless_best), 0) AS topEndless
       FROM users`,
    )
    .first<Record<string, number>>();

  const dailyUsers = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS d, COUNT(*) AS n
       FROM users WHERE created_at >= ? GROUP BY d ORDER BY d`,
    )
    .bind(start)
    .all<{ d: string; n: number }>();

  const dailyActive = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d', updated_at / 1000, 'unixepoch') AS d, COUNT(DISTINCT user_id) AS n
       FROM runs WHERE updated_at >= ? GROUP BY d ORDER BY d`,
    )
    .bind(start)
    .all<{ d: string; n: number }>();

  const dailyRuns = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS d, status, COUNT(*) AS n
       FROM runs WHERE created_at >= ? GROUP BY d, status ORDER BY d`,
    )
    .bind(start)
    .all<{ d: string; status: string; n: number }>();

  const runsSummary = await db
    .prepare(
      `SELECT mode, status, COUNT(*) AS n, COALESCE(AVG(moves), 0) AS moves, COALESCE(AVG(score), 0) AS score
       FROM runs WHERE created_at >= ? GROUP BY mode, status`,
    )
    .bind(start)
    .all<{ mode: string; status: string; n: number; moves: number; score: number }>();

  const economy = await db
    .prepare(
      `SELECT kind, COUNT(*) AS n, COALESCE(SUM(value), 0) AS value
       FROM events WHERE created_at >= ? GROUP BY kind`,
    )
    .bind(start)
    .all<{ kind: string; n: number; value: number }>();

  // Один запрос на все режимы: сколько людей играет каждый режим и как часто выигрывает.
  const modeStats = await db
    .prepare(
      `SELECT mode,
              COUNT(*) AS n,
              COUNT(DISTINCT user_id) AS players,
              COALESCE(SUM(status = 'won'), 0) AS won,
              COALESCE(SUM(status = 'lost'), 0) AS lost,
              COALESCE(AVG(moves), 0) AS avgMoves
       FROM runs WHERE created_at >= ? GROUP BY mode ORDER BY n DESC`,
    )
    .bind(start)
    .all<{ mode: string; n: number; players: number; won: number; lost: number; avgMoves: number }>();

  const adEvents = await db
    .prepare('SELECT kind, COUNT(*) AS n FROM ad_events WHERE created_at >= ? GROUP BY kind')
    .bind(start)
    .all<{ kind: string; n: number }>();

  const payments = await db
    .prepare(
      `SELECT sku, status, COUNT(*) AS n, COALESCE(SUM(stars), 0) AS stars
       FROM payments WHERE created_at >= ? GROUP BY sku, status`,
    )
    .bind(start)
    .all<{ sku: string; status: string; n: number; stars: number }>();

  const funnel = await db
    .prepare('SELECT max_level AS level, COUNT(*) AS n FROM users GROUP BY max_level ORDER BY max_level')
    .all<{ level: number; n: number }>();

  const levelAttempts = await db
    .prepare(
      `SELECT level, status, COUNT(*) AS n FROM runs WHERE mode = 'campaign' AND level > 0
       GROUP BY level, status ORDER BY level`,
    )
    .all<{ level: number; status: string; n: number }>();

  const endlessBuckets = await db
    .prepare(
      `SELECT CASE
                WHEN endless_best = 0 THEN '0'
                WHEN endless_best < 5 THEN '1-4'
                WHEN endless_best < 10 THEN '5-9'
                WHEN endless_best < 20 THEN '10-19'
                WHEN endless_best < 40 THEN '20-39'
                ELSE '40+' END AS bucket,
              COUNT(*) AS n
       FROM users GROUP BY bucket`,
    )
    .all<{ bucket: string; n: number }>();

  const topPlayers = await db
    .prepare(
      `SELECT id, first_name AS name, username, max_level AS level, endless_best AS best, coins
       FROM users ORDER BY max_level DESC, endless_best DESC, created_at ASC LIMIT 10`,
    )
    .all<{ id: string; name: string; username: string | null; level: number; best: number; coins: number }>();

  const recentUsers = await db
    .prepare(
      `SELECT id, first_name AS name, username, is_guest AS isGuest, max_level AS level,
              endless_best AS best, created_at AS createdAt
       FROM users ORDER BY created_at DESC LIMIT 10`,
    )
    .all<{
      id: string;
      name: string;
      username: string | null;
      isGuest: number;
      level: number;
      best: number;
      createdAt: number;
    }>();

  // Возврат: доля игроков, у которых была активность на следующий день и через неделю.
  const cohort = await db
    .prepare(
      `SELECT u.created_at AS createdAt,
              (SELECT MAX(r.updated_at) FROM runs r WHERE r.user_id = u.id) AS lastAt
       FROM users u WHERE u.created_at >= ? AND u.created_at <= ?`,
    )
    .bind(start, now - DAY)
    .all<{ createdAt: number; lastAt: number | null }>();

  let d1 = 0;
  let d7 = 0;
  let cohortSize = 0;
  for (const row of cohort.results ?? []) {
    cohortSize += 1;
    const delta = row.lastAt ? row.lastAt - row.createdAt : 0;
    if (delta >= DAY) d1 += 1;
    if (delta >= 7 * DAY) d7 += 1;
  }

  const runSeries: Array<{ day: string; started: number; won: number; lost: number; quit: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    runSeries.push({ day: dayKey(now - i * DAY), started: 0, won: 0, lost: 0, quit: 0 });
  }
  const runIndex = new Map(runSeries.map((row) => [row.day, row]));
  for (const row of dailyRuns.results ?? []) {
    const entry = runIndex.get(row.d);
    if (!entry) continue;
    entry.started += Number(row.n);
    if (row.status === 'won') entry.won += Number(row.n);
    if (row.status === 'lost') entry.lost += Number(row.n);
    if (row.status === 'quit') entry.quit += Number(row.n);
  }

  const attemptsByLevel = new Map<number, { played: number; won: number }>();
  for (const row of levelAttempts.results ?? []) {
    const entry = attemptsByLevel.get(Number(row.level)) ?? { played: 0, won: 0 };
    entry.played += Number(row.n);
    if (row.status === 'won') entry.won += Number(row.n);
    attemptsByLevel.set(Number(row.level), entry);
  }

  const economyMap = new Map(economy.results?.map((row) => [row.kind, row]) ?? []);
  const totalRuns = (runsSummary.results ?? []).reduce((sum, row) => sum + Number(row.n), 0);
  const endedRuns = (runsSummary.results ?? [])
    .filter((row) => row.status !== 'active')
    .reduce((sum, row) => sum + Number(row.n), 0);
  const wonRuns = (runsSummary.results ?? [])
    .filter((row) => row.status === 'won')
    .reduce((sum, row) => sum + Number(row.n), 0);

  return c.json({
    generatedAt: now,
    days,
    totals: {
      users: Number(totals?.users ?? 0),
      guests: Number(totals?.guests ?? 0),
      telegram: Number(totals?.users ?? 0) - Number(totals?.guests ?? 0),
      adFree: Number(totals?.adFree ?? 0),
      coins: Number(totals?.coins ?? 0),
      played: Number(totals?.played ?? 0),
      endlessUnlocked: Number(totals?.endlessUnlocked ?? 0),
      endlessPlayed: Number(totals?.endlessPlayed ?? 0),
      topLevel: Number(totals?.topLevel ?? 0),
      topEndless: Number(totals?.topEndless ?? 0),
    },
    series: {
      newUsers: fillSeries(dailyUsers.results ?? [], days, now),
      activeUsers: fillSeries(dailyActive.results ?? [], days, now),
      runs: runSeries,
    },
    retention: {
      cohort: cohortSize,
      d1,
      d7,
      d1Rate: cohortSize ? d1 / cohortSize : 0,
      d7Rate: cohortSize ? d7 / cohortSize : 0,
    },
    runs: {
      total: totalRuns,
      ended: endedRuns,
      won: wonRuns,
      winRate: endedRuns ? wonRuns / endedRuns : 0,
      campaign: (runsSummary.results ?? []).filter((row) => row.mode === 'campaign'),
      jam: (runsSummary.results ?? []).filter((row) => row.mode === 'jam'),
      race: (runsSummary.results ?? []).filter((row) => row.mode === 'race'),
      endless: (runsSummary.results ?? []).filter((row) => row.mode === 'endless'),
    },
    modes: (modeStats.results ?? []).map((row) => ({
      mode: String(row.mode),
      n: Number(row.n),
      players: Number(row.players),
      won: Number(row.won),
      lost: Number(row.lost),
      avgMoves: Number(row.avgMoves),
      winRate: Number(row.n) > 0 ? Number(row.won) / Number(row.n) : 0,
    })),
    economy: {
      coinsEarned: Number(economyMap.get('coins_earned')?.value ?? 0),
      coinsSpent: Number(economyMap.get('coins_spent')?.value ?? 0),
      livesLost: Number(economyMap.get('life_lost')?.n ?? 0),
      purchases: Number(economyMap.get('purchase')?.n ?? 0),
      starsEarned: Number(economyMap.get('purchase')?.value ?? 0),
      refunds: Number(economyMap.get('refund')?.n ?? 0),
      bonusesUsed: Number(economyMap.get('bonus_used')?.n ?? 0),
      adEvents: adEvents.results ?? [],
    },
    payments: payments.results ?? [],
    funnel: funnel.results ?? [],
    levels: Array.from(attemptsByLevel.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([level, data]) => ({
        level,
        played: data.played,
        won: data.won,
        winRate: data.played ? data.won / data.played : 0,
      })),
    endlessBuckets: endlessBuckets.results ?? [],
    topPlayers: topPlayers.results ?? [],
    recentUsers: recentUsers.results ?? [],
  });
});

adminApp.get('/users', async (c) => {
  const query = (c.req.query('query') ?? '').trim().slice(0, 64);
  const page = intParam(c.req.query('page'), 0, 0, 10_000);
  const pageSize = intParam(c.req.query('pageSize'), 25, 5, 100);
  const sortRaw = c.req.query('sort') ?? 'recent';
  const order =
    sortRaw === 'level'
      ? 'u.max_level DESC, u.endless_best DESC'
      : sortRaw === 'best'
        ? 'u.endless_best DESC, u.max_level DESC'
        : sortRaw === 'coins'
          ? 'u.coins DESC, u.max_level DESC'
          : 'u.updated_at DESC';

  const like = `%${query}%`;
  const where = query
    ? 'WHERE u.first_name LIKE ? OR u.username LIKE ? OR u.id LIKE ?'
    : '';
  const binds = query ? [like, like, like] : [];

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`)
    .bind(...binds)
    .first<{ n: number }>();

  const rows = await listUsers(c.env.DB, where, binds, order, pageSize, page * pageSize);

  return c.json({
    total: Number(total?.n ?? 0),
    page,
    pageSize,
    rows: rows.rows,
    degraded: rows.degraded,
  });
});

const USER_COLUMNS = `u.id, u.first_name AS name, u.username, u.is_guest AS isGuest, u.level,
       u.max_level AS maxLevel, u.coins, u.lives, u.endless_best AS best, u.ad_free AS adFree,
       u.created_at AS createdAt, u.updated_at AS updatedAt, u.skin,
       (SELECT COUNT(*) FROM runs r WHERE r.user_id = u.id) AS runs,
       (SELECT COUNT(*) FROM payments p WHERE p.user_id = u.id AND p.status = 'paid') AS purchases`;

/**
 * Список игроков. `mode_levels` появляется только с миграцией 0004, а админка
 * должна работать и до неё, и после: если колонки нет, повторяем запрос без неё
 * и отдаём `degraded`, чтобы вкладка показала предупреждение, а не пустой экран.
 */
async function listUsers(
  db: D1Database,
  where: string,
  binds: unknown[],
  order: string,
  pageSize: number,
  offset: number,
): Promise<{ rows: Record<string, unknown>[]; degraded: boolean }> {
  const withProgress = `SELECT ${USER_COLUMNS}, u.mode_levels AS modeLevels
     FROM users u ${where}
     ORDER BY ${order}
     LIMIT ? OFFSET ?`;
  try {
    const result = await db.prepare(withProgress).bind(...binds, pageSize, offset).all<Record<string, unknown>>();
    return { rows: decorateUsers(result.results ?? [], false), degraded: false };
  } catch {
    const fallback = await db
      .prepare(`SELECT ${USER_COLUMNS} FROM users u ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...binds, pageSize, offset)
      .all<Record<string, unknown>>();
    // Колонки нет: цифры не выдумываем, отдаём null, вкладка покажет «нет данных».
    return { rows: decorateUsers(fallback.results ?? [], true), degraded: true };
  }
}

/** Прогресс «Парковки» и «Гонок» из JSON кладём в те же строки, что отдаём таблице. */
function decorateUsers(rows: Record<string, unknown>[], degraded: boolean): Record<string, unknown>[] {
  return rows.map((row) => {
    const levels = degraded ? {} : parseModeLevels(row.modeLevels);
    const { modeLevels: _drop, ...rest } = row;
    void _drop;
    return {
      ...rest,
      jamLevel: degraded ? null : levels.jam?.level ?? 1,
      jamMax: degraded ? null : levels.jam?.maxLevel ?? 1,
      raceLevel: degraded ? null : levels.race?.level ?? 1,
      raceMax: degraded ? null : levels.race?.maxLevel ?? 1,
    };
  });
}

adminApp.get('/users/:id', async (c) => {
  const id = c.req.param('id');
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!user) fail(404, 'user_not_found', 'Игрок не найден');

  const runs = await c.env.DB.prepare(
    `SELECT id, mode, level, seed, moves, score, status, result, created_at AS createdAt, updated_at AS updatedAt
     FROM runs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 60`,
  )
    .bind(id)
    .all<Record<string, unknown>>();

  // История по уровням: сколько раз запускал, сколько выиграл, когда вернулся.
  const history = await c.env.DB.prepare(
    `SELECT mode, level,
            COUNT(*) AS played,
            SUM(status = 'won') AS won,
            SUM(status = 'lost') AS lost,
            SUM(status = 'quit') AS quit,
            COALESCE(AVG(moves), 0) AS avgMoves,
            MIN(created_at) AS firstAt,
            MAX(updated_at) AS lastAt
     FROM runs WHERE user_id = ?
     GROUP BY mode, level
     ORDER BY mode, level DESC`,
  )
    .bind(id)
    .all<Record<string, unknown>>();

  const grants = await c.env.DB.prepare(
    `SELECT kind, source, COUNT(*) AS n, MIN(created_at) AS firstAt, MAX(created_at) AS lastAt
     FROM grants WHERE user_id = ? GROUP BY kind, source ORDER BY n DESC`,
  )
    .bind(id)
    .all<Record<string, unknown>>();

  const ads = await c.env.DB.prepare(
    'SELECT kind, COUNT(*) AS n FROM ad_events WHERE user_id = ? GROUP BY kind',
  )
    .bind(id)
    .all<{ kind: string; n: number }>();

  const active = await c.env.DB.prepare(
    `SELECT mode, COUNT(*) AS n FROM runs WHERE user_id = ? GROUP BY mode`,
  )
    .bind(id)
    .all<{ mode: string; n: number }>();

  const payments = await c.env.DB.prepare(
    `SELECT charge_id AS chargeId, sku, stars, status, created_at AS createdAt, paid_at AS paidAt
     FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`,
  )
    .bind(id)
    .all<Record<string, unknown>>();

  const events = await c.env.DB.prepare(
    `SELECT kind, value, created_at AS createdAt FROM events WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(id)
    .all<Record<string, unknown>>();

  return c.json({
    user,
    progress: profileModes(user as unknown as UserRow),
    runs: (runs.results ?? []).map(describeRun),
    history: history.results ?? [],
    grants: grants.results ?? [],
    ads: ads.results ?? [],
    byMode: active.results ?? [],
    payments: payments.results ?? [],
    events: events.results ?? [],
  });
});

/**
 * Итог забега лежит в JSON `result`. Разворачиваем его в плоские поля, иначе
 * таблице админки пришлось бы разбирать JSON на клиенте, а причина поражения
 * (взятие или тупик) важна именно в таблице.
 */
function describeRun(row: Record<string, unknown>): Record<string, unknown> {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = row.result ? (JSON.parse(String(row.result)) as Record<string, unknown>) : {};
  } catch {
    /* повреждённый JSON: показываем забег без деталей */
  }
  const { result: _drop, ...rest } = row;
  void _drop;
  const reason = String(parsed.reason ?? '');
  return {
    ...rest,
    outcome: String(parsed.outcome ?? row.status ?? ''),
    capturedBy: parsed.capturedBy ?? null,
    reason,
    // В «Парковке» фигура никого не бьёт: там проигрыш это кончившийся бюджет,
    // а `won` означает, что с поля увели всех.
    stuck: parsed.outcome === 'lost' && parsed.capturedBy == null && row.mode !== 'jam',
    budgetOut: row.mode === 'jam' && reason === 'budget',
    coinsEarned: Number(parsed.coinsEarned ?? 0),
    levelUp: Boolean(parsed.levelUp),
    modeLevel: parsed.level ?? row.level,
    // Для режимов без финиша важен рекорд: забег без победы, но с новым
    // результатом это нормальный забег, а не провал.
    newBest: Boolean(parsed.newBest),
    bestScore: parsed.bestScore ?? null,
  };
}

/**
 * Прохождения по уровням: чем заканчиваются уровни режима, сколько попыток
 * уходит на один уровень и где игроки встают. Это ответ на вопрос «какие
 * уровни стоит оставить, а какие перебрать».
 */
adminApp.get('/levels/stats', async (c) => {
  const mode = parseLevelMode(c.req.query('mode'));
  const days = intParam(c.req.query('days'), 30, 1, 365);
  const start = Date.now() - days * DAY;

  const levels = await c.env.DB.prepare(
    `SELECT level,
            COUNT(*) AS played,
            COUNT(DISTINCT user_id) AS players,
            SUM(status = 'won') AS won,
            SUM(status = 'lost') AS lost,
            SUM(status = 'quit') AS quit,
            SUM(status = 'active') AS active,
            COALESCE(AVG(moves), 0) AS avgMoves,
            COALESCE(AVG(score), 0) AS avgScore,
            COALESCE(MAX(score), 0) AS bestScore,
            MIN(created_at) AS firstAt,
            MAX(updated_at) AS lastAt
     FROM runs
     WHERE mode = ? AND level > 0 AND created_at >= ?
     GROUP BY level
     ORDER BY level
     LIMIT 300`,
  )
    .bind(mode, start)
    .all<Record<string, unknown>>();

  // Причина поражения видна только в JSON результата: «тупик» это про генератор,
  // «съеден» про игру. Считаем отдельно, чтобы не тащить JSON в первую выборку.
  // Для пешечных режимов «плохое поле» это поражение без взятия (тупик). У
  // «Парковки» своей фигуры-охотника нет, там тот же смысл несёт кончившийся
  // бюджет ходов: уровень не пройти за данное число перестановок.
  // У «Гонок» уровня-победы нет: там плохой забег это короткий, он показывает,
  // что конвейер складывается раньше, чем игрок успевает разобрать поле.
  const stuck =
    mode === 'race'
      ? await c.env.DB.prepare(
          `SELECT level, COUNT(*) AS n
           FROM runs
           WHERE mode = ? AND status = 'lost' AND level > 0 AND created_at >= ? AND score < 5
           GROUP BY level`,
        )
          .bind(mode, start)
          .all<{ level: number; n: number }>()
      : await c.env.DB.prepare(
          `SELECT level, COUNT(*) AS n
           FROM runs
           WHERE mode = ? AND status = 'lost' AND level > 0 AND created_at >= ? AND result LIKE ?
           GROUP BY level`,
        )
          .bind(mode, start, mode === 'jam' ? '%"reason":"budget"%' : '%"capturedBy":null%')
          .all<{ level: number; n: number }>();

  const bonuses = await c.env.DB.prepare(
    `SELECT r.level AS level, g.kind AS kind, COUNT(*) AS n
     FROM grants g JOIN runs r ON r.id = g.run_id
     WHERE r.mode = ? AND r.created_at >= ?
     GROUP BY r.level, g.kind`,
  )
    .bind(mode, start)
    .all<{ level: number; kind: string; n: number }>();

  const stuckByLevel = new Map((stuck.results ?? []).map((row) => [Number(row.level), Number(row.n)]));
  const bonusByLevel = new Map<number, Record<string, number>>();
  for (const row of bonusList(bonuses.results ?? [])) {
    const entry = bonusByLevel.get(row.level) ?? {};
    entry[row.kind] = (entry[row.kind] ?? 0) + row.n;
    bonusByLevel.set(row.level, entry);
  }

  const rows = (levels.results ?? []).map((row) => {
    const level = Number(row.level);
    const played = Number(row.played);
    const won = Number(row.won);
    return {
      level,
      played,
      players: Number(row.players),
      won,
      lost: Number(row.lost),
      quit: Number(row.quit),
      active: Number(row.active),
      stuck: stuckByLevel.get(level) ?? 0,
      winRate: played > 0 ? won / played : 0,
      attemptsPerPlayer: Number(row.players) > 0 ? played / Number(row.players) : 0,
      avgMoves: Number(row.avgMoves),
      avgScore: Number(row.avgScore),
      bestScore: Number(row.bestScore),
      hints: bonusByLevel.get(level)?.hint ?? 0,
      freezes: bonusByLevel.get(level)?.freeze ?? 0,
      undos: bonusByLevel.get(level)?.undo ?? 0,
      firstAt: Number(row.firstAt),
      lastAt: Number(row.lastAt),
    };
  });

  const stuckLabel = mode === 'jam' ? 'Бюджет не осилили' : mode === 'race' ? 'Короткие забеги' : 'Тупиков';
  // У режима без победы колонка «доля побед» бессмысленна: там уровнем правит
  // рекорд, поэтому в ответе отдельный флаг, а не подмена чисел.
  return c.json({ mode, days, rows, stuckLabel, recordMode: mode === 'race' });
});

/** Режимы с номером уровня: только они попадают в статистику прохождений. */
function parseLevelMode(value: unknown): 'campaign' | 'jam' | 'race' {
  return value === 'jam' || value === 'race' ? value : 'campaign';
}

function bonusList(rows: Record<string, unknown>[]): { level: number; kind: string; n: number }[] {
  return rows
    .map((row) => ({ level: Number(row.level), kind: String(row.kind), n: Number(row.n) }))
    .filter((row) => Number.isFinite(row.level));
}

adminApp.get('/payments', async (c) => {
  const days = intParam(c.req.query('days'), 30, 1, 365);
  const start = Date.now() - days * DAY;

  const summary = await c.env.DB.prepare(
    `SELECT sku, status, COUNT(*) AS n, COALESCE(SUM(stars), 0) AS stars
     FROM payments WHERE created_at >= ? GROUP BY sku, status`,
  )
    .bind(start)
    .all<{ sku: string; status: string; n: number; stars: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT p.charge_id AS chargeId, p.sku, p.stars, p.status, p.created_at AS createdAt, p.paid_at AS paidAt,
            u.id AS userId, u.first_name AS name, u.username
     FROM payments p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.created_at >= ? ORDER BY p.created_at DESC LIMIT 100`,
  )
    .bind(start)
    .all<Record<string, unknown>>();

  const stars = (summary.results ?? []).reduce(
    (sum: number, row: { status: string; stars: number }) =>
      row.status === 'paid' ? sum + Number(row.stars) : sum,
    0,
  );

  return c.json({ days, stars, summary: summary.results ?? [], rows: rows.results ?? [] });
});

adminApp.get('/levels', async (c) => {
  const checks = await c.env.DB.prepare('SELECT * FROM level_checks ORDER BY level').all<
    Record<string, unknown>
  >();
  const reports = await c.env.DB.prepare(
    'SELECT id, kind, spec, summary, created_at AS createdAt FROM audit_runs ORDER BY created_at DESC LIMIT 30',
  ).all<Record<string, unknown>>();
  return c.json({ checks: checks.results ?? [], reports: reports.results ?? [] });
});

adminApp.post('/levels/check', async (c) => {
  const body = await readJson(c);
  const level = intParam(String(body.level ?? ''), 0, 1, 60);
  const seeds = intParam(String(body.seeds ?? ''), 4, 1, 8);
  if (!level) fail(400, 'bad_level', 'Укажите уровень от 1 до 60');

  const band = difficultyBand(level);
  const results: Array<{
    seed: number;
    solvable: boolean;
    score: number;
    steps: number;
    firstMoves: number;
    pieces: number;
    ms: number;
  }> = [];

  const startedAt = Date.now();
  for (let index = 0; index < seeds; index++) {
    const seed = Math.imul(level * 7919 + index * 104729 + 17, 2654435761) >>> 0;
    const t0 = Date.now();
    const state = createCampaignLevel(level, seed);
    const audit: AuditResult = auditState(state);
    results.push({
      seed,
      solvable: audit.solvable,
      score: audit.score,
      steps: audit.steps,
      firstMoves: audit.firstMoves,
      pieces: state.enemies.length,
      ms: Date.now() - t0,
    });
  }

  const solvable = results.filter((row) => row.solvable);
  const scores = solvable.map((row) => row.score);
  const inBand = solvable.filter((row) => row.score >= band.min && row.score <= band.max).length;
  const report = {
    level,
    size: sizeForLevel(level),
    height: heightForLevel(level),
    band,
    types: availablePieceTypes(level) as PieceType[],
    targetPieces: pieceCountForLevel(level),
    seeds,
    total: results.length,
    solvable: solvable.length,
    inBand,
    avgScore: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0,
    minScore: scores.length ? Math.min(...scores) : 0,
    maxScore: scores.length ? Math.max(...scores) : 0,
    avgPieces: results.length
      ? results.reduce((sum, row) => sum + row.pieces, 0) / results.length
      : 0,
    elapsedMs: Date.now() - startedAt,
    results,
  };

  await c.env.DB.prepare(
    `INSERT INTO level_checks (level, seeds, total, solvable, avg_score, min_score, max_score, avg_pieces, payload, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(level) DO UPDATE SET
       seeds = excluded.seeds, total = excluded.total, solvable = excluded.solvable,
       avg_score = excluded.avg_score, min_score = excluded.min_score, max_score = excluded.max_score,
       avg_pieces = excluded.avg_pieces, payload = excluded.payload, checked_at = excluded.checked_at`,
  )
    .bind(
      level,
      seeds,
      report.total,
      report.solvable,
      report.avgScore,
      report.minScore,
      report.maxScore,
      report.avgPieces,
      JSON.stringify(report),
      Date.now(),
    )
    .run();

  return c.json({ report });
});

adminApp.post('/reports', async (c) => {
  const body = await readJson(c);
  const kind = body.kind === 'placements' ? 'placements' : body.kind === 'levels' ? 'levels' : null;
  if (!kind) fail(400, 'bad_kind', 'Неизвестный тип отчёта');
  const spec = typeof body.spec === 'string' ? body.spec.slice(0, 4000) : JSON.stringify(body.spec ?? {}).slice(0, 4000);
  const summary =
    typeof body.summary === 'string' ? body.summary.slice(0, 4000) : JSON.stringify(body.summary ?? {}).slice(0, 4000);
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO audit_runs (id, kind, spec, summary, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, kind, spec, summary, Date.now())
    .run();
  return c.json({ id });
});

adminApp.delete('/reports/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM audit_runs WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/* ─────────────────────────── бот и вебхук ─────────────────────────── */

interface TelegramReply<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

const TELEGRAM_API = 'https://api.telegram.org';
const WEBHOOK_PATH = '/api/telegram/webhook';

/** Прямой вызов Bot API с текстом ошибки, чтобы показать его в админке. */
async function telegramCall<T>(
  env: WorkerEnv,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<TelegramReply<T>> {
  const token = botToken(env);
  if (!token) return { ok: false, description: 'Не задан BOT_TOKEN' };
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as TelegramReply<T>;
    return { ok: Boolean(data.ok), result: data.result, description: data.description };
  } catch (error) {
    console.error('Telegram request failed', String(error).slice(0, 200));
    return { ok: false, description: 'Нет связи с Telegram. Проверьте исходящие запросы воркера.' };
  }
}

/** Адрес приложения: https, без слэша на конце. */
export function normalizeAppUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Полный адрес вебхука: к домену добавляется путь, если его нет. */
export function normalizeWebhookUrl(value: string): string | null {
  const base = normalizeAppUrl(value);
  if (!base) return null;
  if (base.endsWith(WEBHOOK_PATH)) return base;
  return `${base}${WEBHOOK_PATH}`;
}

interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
  last_error_date?: number;
  ip_address?: string;
}

async function readBotStatus(env: WorkerEnv, origin: string) {
  const appUrl = normalizeAppUrl(env.WEBAPP_URL ?? '') ?? '';
  const expectedUrl = `${origin}${WEBHOOK_PATH}`;
  const configured = hasBotToken(env);
  const base = {
    configured,
    expectedUrl,
    appUrl,
    webappUrl: (env.WEBAPP_URL ?? '').trim(),
    webappUrlOk: Boolean(appUrl) && appUrl === normalizeAppUrl(origin),
    secretSet: Boolean(env.WEBHOOK_SECRET?.trim()),
    devMode: env.DEV_MODE === 'true',
    checkedAt: Date.now(),
  };
  if (!configured) {
    return {
      ...base,
      username: '',
      mainWebApp: false,
      webhook: null,
      botError: 'Не задан BOT_TOKEN',
    };
  }
  const me = await telegramCall<{ username?: string; first_name?: string; has_main_web_app?: boolean }>(
    env,
    'getMe',
  );
  const info = await telegramCall<WebhookInfo>(env, 'getWebhookInfo');
  const webhook = info.ok && info.result
    ? {
        url: info.result.url ?? '',
        pending: Number(info.result.pending_update_count ?? 0),
        lastError: info.result.last_error_message ?? '',
        lastErrorAt: Number(info.result.last_error_date ?? 0) * 1000 || null,
        ipAddress: info.result.ip_address ?? '',
      }
    : null;
  return {
    ...base,
    username: me.result?.username ?? '',
    mainWebApp: me.result?.has_main_web_app === true,
    webhook,
    botError: me.ok ? '' : me.description ?? 'Telegram не ответил',
  };
}

adminApp.get('/bot', async (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(await readBotStatus(c.env, origin));
});

adminApp.get('/diag', async (c) => {
  const db = c.env.DB;
  const since = Date.now() - 24 * 60 * 60 * 1000;
  await db.prepare("DELETE FROM events WHERE kind = 'init_data_rejected' AND created_at < ?").bind(since).run().catch(() => undefined);
  const rows = await db
    .prepare("SELECT created_at, meta FROM events WHERE kind = 'init_data_rejected' ORDER BY id DESC LIMIT 20")
    .all<{ created_at: number; meta: string }>();
  const entries = (rows.results ?? []).map((row) => {
    let raw = '';
    let reason = '';
    let signed = '';
    try {
      const meta = JSON.parse(row.meta) as { raw?: string; reason?: string; signed?: { note?: string } };
      raw = meta.raw ?? '';
      reason = meta.reason ?? '';
      signed = meta.signed?.note ?? '';
    } catch {
      /* повреждённая запись */
    }
    return { at: row.created_at, reason, raw, signed };
  });
  // Отдельная живая проверка: был ли ключ подписи у приложения на момент просмотра.
  const webApp = await webAppKeyStatus(c.env);
  // Колонки смотрим напрямую: неприменённая миграция видна игроку как ошибка
  // сохранения, а здесь она превращается в одну строку предупреждения.
  const usersInfo = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>().catch(() => null);
  const usersColumns = (usersInfo?.results ?? []).map((col) => col.name);
  const hasModeLevels = usersColumns.includes('mode_levels');
  // Активные партии, которые текущий клиент продолжить не сможет: поле или
  // журнал written прежней сборкой. Старт режима закрывает их сам, но в
  // диагностике их видно, чтобы не гадать, почему «поле не загрузилось».
  const actives = await db
    .prepare(
      `SELECT id, mode, level, initial_state, actions, updated_at
       FROM runs WHERE status = 'active' ORDER BY updated_at DESC LIMIT 300`,
    )
    .all<{ id: string; mode: string; level: number; initial_state: string; actions: string; updated_at: number }>()
    .catch(() => null);
  const stale = (actives?.results ?? []).filter((row) => !resumableRun(row));
  const staleByMode = new Map<string, number>();
  for (const row of stale) staleByMode.set(row.mode, (staleByMode.get(row.mode) ?? 0) + 1);
  return c.json({
    enabled: true,
    authDebug: c.env.AUTH_DEBUG === 'true',
    webApp: { present: webApp.present, note: webApp.note, checkedAt: webApp.checkedAt },
    schema: {
      version: SCHEMA_VERSION,
      usersColumns,
      modeLevels: hasModeLevels,
      note: hasModeLevels
        ? 'колонка mode_levels на месте, прогресс «Парковки» и «Гонок» сохраняется'
        : 'нет колонки mode_levels: примените migrations/0004_mode_levels.sql в SQL консоли D1, иначе прогресс режимов не сохранится',
    },
    runs: {
      active: actives?.results.length ?? 0,
      stale: stale.length,
      byMode: Object.fromEntries(staleByMode),
      oldestAt: stale.length ? Math.min(...stale.map((row) => row.updated_at)) : null,
      note:
        stale.length === 0
          ? 'все активные партии подходят текущим правилам'
          : 'партии прежних сборок: старт режима закроет их и выдаст новое поле, ничего делать не нужно',
    },
    entries,
  });
});

adminApp.post('/bot/setup', async (c) => {
  if (!hasBotToken(c.env)) {
    fail(400, 'bot_token_missing', 'Сначала добавьте секрет BOT_TOKEN и перезапустите воркер');
  }
  const body = await readJson(c);
  const origin = new URL(c.req.url).origin;
  const requestedAppUrl = typeof body.appUrl === 'string' ? body.appUrl.trim() : '';
  const appUrl = requestedAppUrl ? normalizeAppUrl(requestedAppUrl) : normalizeAppUrl(origin);
  if (!appUrl) fail(400, 'bad_app_url', 'Адрес приложения должен начинаться с https://');

  const requestedWebhook = typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : '';
  const webhookUrl = requestedWebhook ? normalizeWebhookUrl(requestedWebhook) : `${appUrl}${WEBHOOK_PATH}`;
  if (!webhookUrl) fail(400, 'bad_webhook_url', 'Адрес вебхука должен начинаться с https://');

  const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
  if (secret && !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    fail(400, 'bad_secret', 'Секрет: буквы, цифры, дефис и подчёркивание, до 256 символов');
  }

  const steps: Array<{ name: string; ok: boolean; detail: string }> = [];

  const webhookPayload: Record<string, unknown> = {
    url: webhookUrl,
    drop_pending_updates: body.dropPending === true,
  };
  if (secret) webhookPayload.secret_token = secret;
  const webhook = await telegramCall(c.env, 'setWebhook', webhookPayload);
  steps.push({
    name: 'Вебхук',
    ok: webhook.ok,
    detail: webhook.ok ? webhookUrl : webhook.description ?? 'не удалось',
  });

  if (body.commands !== false) {
    const commands = await telegramCall(c.env, 'setMyCommands', {
      commands: [
        { command: 'start', description: 'Открыть игру' },
        { command: 'play', description: 'Продолжить партию' },
        { command: 'help', description: 'Правила и поддержка' },
      ],
    });
    steps.push({
      name: 'Команды',
      ok: commands.ok,
      detail: commands.ok ? 'start, play, help' : commands.description ?? 'не удалось',
    });
  }

  if (body.menuButton !== false) {
    const menu = await telegramCall(c.env, 'setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Играть', web_app: { url: appUrl } },
    });
    steps.push({
      name: 'Кнопка меню',
      ok: menu.ok,
      detail: menu.ok ? appUrl : menu.description ?? 'не удалось',
    });
  }

  return c.json({ steps, status: await readBotStatus(c.env, origin) });
});

adminApp.post('/bot/webhook/off', async (c) => {
  const result = await telegramCall(c.env, 'deleteWebhook', { drop_pending_updates: false });
  if (!result.ok) fail(400, 'telegram_error', result.description ?? 'Telegram не ответил');
  const origin = new URL(c.req.url).origin;
  return c.json({ status: await readBotStatus(c.env, origin) });
});
