import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  AD_COINS_REWARD,
  addLife,
  type AnyRunState,
  applyActions,
  BONUSES,
  type BonusId,
  campaignCoinReward,
  createCampaignLevel,
  createEndlessRun,
  createJamPuzzle,
  createRaceLevel,
  createSpecialLevel,
  endlessCoinReward,
  type GameAction,
  type GameState,
  isBonusId,
  isJamState,
  isLevelMode,
  isWinLadder,
  isSkinId,
  jamHint,
  type JamState,
  loseLife,
  materializeLives,
  MAX_LIVES,
  modeDef,
  raceCoinReward,
  raceLevelForMoves,
  modeGate,
  modeUnlocked,
  parseRunState,
  randomSeed,
  replayRun,
  RuleError,
  rulesFor,
  type RunAction,
  snapshotOf,
} from '../src/engine';
import { authMiddleware, syncTelegramName } from './auth';
import { adminApp } from './admin';
import { logEventInBackground } from './events';
import { botToken, hasBotToken } from './token';
import { canSignSessions, signSession } from './session';
import {
  authStartParam,
  consumeAuthLink,
  createAuthLink,
  isAuthCode,
  parseAuthCallback,
  parseAuthStartParam,
  readAuthLink,
  confirmAuthLink,
  rejectAuthLink,
} from './authLink';
import { SCHEMA_VERSION, isDatabaseError, readSchema } from './schema';
import { build as BUILD } from '../version.json';
import {
  activeRuns,
  getOrCreateUser,
  getRun,
  getUserById,
  grantsForRun,
  hasModeLevels,
  modeProgress,
  ownedSkins,
  parseModeLevels,
  publicConfig,
  REFERRAL_BONUS,
  refreshLives,
  requireOwnRun,
  serializeModeLevels,
  resumableRun,
  serializeRun,
  toProfile,
} from './db';
import { fail, HttpError, isPrefix, parseActions, parseRunMode, parseStartOptions, readJson, nowMs } from './http';
import { createInvoice, fulfillPayment, getPayment, isProductSku, refundPayment } from './payments';
import {
  answerCallbackQuery,
  answerPreCheckout,
  authReturnUrl,
  editAuthMessage,
  sendAuthPrompt,
  sendPlain,
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

const publicPaths = new Set(['/api/health', '/api/config', '/api/telegram/webhook', '/api/auth/link', '/api/auth/logout']);

app.use('/api/*', async (c, next) => {
  if (publicPaths.has(c.req.path)) return next();
  // У админки своя проверка токена, игровая авторизация к ней не применяется.
  if (c.req.path === '/api/admin' || c.req.path.startsWith('/api/admin/')) return next();
  return authMiddleware(c, next);
});

app.route('/api/admin', adminApp);

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json(
      { error: err.code, message: err.message, ...(err.details ?? {}) },
      err.status as ContentfulStatusCode,
    );
  }
  // Ошибки D1 чаще всего означают неприменённые миграции. Без этой ветки
  // клиент получал невнятное «внутренняя ошибка», а причина была в базе.
  if (isDatabaseError(err)) {
    console.error('Database error', err instanceof Error ? err.stack ?? err.message : String(err));
    return c.json(
      {
        error: 'db_not_ready',
        message: 'База данных не готова. Примените миграции и обновите страницу.',
        hint: 'npm run db:remote',
      },
      503,
    );
  }
  console.error('Unhandled error', err instanceof Error ? err.stack ?? err.message : String(err));
  return c.json({ error: 'internal', message: 'Внутренняя ошибка сервера' }, 500);
});

app.notFound((c) => c.json({ error: 'not_found', message: 'Такого метода нет' }, 404));

function auth(c: Context<AppEnv>) {
  return c.get('auth');
}

function safeParseActions(raw: string): RunAction[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) fail(500, 'run_corrupt');
    return parsed as RunAction[];
  } catch {
    fail(500, 'run_corrupt', 'Повреждённый журнал ходов');
  }
}

/**
 * Проиграть журнал ходов поверх сохранённого поля. Форма состояния зависит от
 * режима: у «Парковки» свои правила, поэтому разбор и применение идут через
 * общий диспетчер движка, а наружу отдаётся снимок счётчиков.
 */
function replay(run: RunRow, actions: RunAction[]): AnyRunState {
  let initial: AnyRunState;
  try {
    initial = parseRunState(JSON.parse(run.initial_state));
  } catch {
    fail(500, 'run_corrupt', 'Повреждённое поле');
  }
  try {
    return replayRun(initial, actions);
  } catch (error) {
    if (error instanceof RuleError) fail(422, 'invalid_actions', error.message);
    fail(422, 'invalid_actions', 'Ходы не соответствуют правилам');
  }
}

/**
 * Продолжаема ли сохранённая партия: поле проходит проверку формы и весь журнал
 * проигрывается без ошибки правил. Без этой проверки старт возвращал ту же
 * строку снова и снова, и игрок оставался один на один с надписью «поле не
 * загрузилось»: партия из прежней сборки клиенту не подходила, а выхода из
 * экрана не было.
 */
function resumableByReplay(run: RunRow): boolean {
  try {
    replay(run, safeParseActions(run.actions));
    return true;
  } catch {
    return false;
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

/** Локальный адрес воркера: его Telegram не откроет. */
function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost');
  } catch {
    return true;
  }
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
  const origin = new URL(c.req.url).origin;

  // Публичный список того, что забыли настроить при деплое. Секретов тут нет,
  // только отметки «задано или нет».
  const warnings: string[] = [];
  const webappUrl = c.env.WEBAPP_URL?.trim() ?? '';
  if (!webappUrl) {
    // В бою адрес приложения берётся из самого запроса, пустая переменная допустима.
    // На localhost такие ссылки боту бесполезны, поэтому предупреждаем только там.
    if (isLocalOrigin(origin)) warnings.push('webapp_url_missing');
  } else if (!webappUrl.startsWith('https://')) {
    warnings.push('webapp_url_not_https');
  } else {
    try {
      // На локальном хосте совпадений не ищем: там адрес всегда свой.
      if (!isLocalOrigin(origin) && new URL(webappUrl).origin !== origin) warnings.push('webapp_url_origin_mismatch');
    } catch {
      warnings.push('webapp_url_invalid');
    }
  }
  if (!hasBotToken(c.env)) warnings.push('bot_token_missing');
  if (!c.env.WEBHOOK_SECRET?.trim()) warnings.push('webhook_secret_missing');
  if (!c.env.ADMIN_SECRET?.trim()) {
    warnings.push('admin_secret_missing');
  } else if (!c.env.ADMIN_PASSWORD?.trim() && !c.env.ADMIN_PASSWORD_HASH?.trim()) {
    warnings.push('admin_password_missing');
  }
  if (!c.env.ADSGRAM_BLOCK_ID?.trim()) warnings.push('adsgram_block_missing');
  if (!canSignSessions(c.env)) warnings.push('session_secret_missing');
  if (c.env.DEV_MODE === 'true') warnings.push('dev_mode');

  const base = {
    now: nowMs(),
    service: 'pawn-vs-all',
    // Версия кода воркера: по ней видно, какая сборка реально в бою.
    build: BUILD,
    origin,
    schemaVersion: SCHEMA_VERSION,
    config: publicConfig(c.env),
    warnings,
  };

  let schema;
  try {
    schema = await readSchema(c.env);
  } catch (error) {
    console.error('Health: database is not reachable', error instanceof Error ? error.message : String(error));
    return c.json(
      {
        ...base,
        ok: false,
        error: 'db_unavailable',
        message: 'База данных не отвечает. Проверьте привязку D1 и database_id.',
      },
      503,
    );
  }

  if (schema.missingGame.length > 0) {
    return c.json(
      {
        ...base,
        ok: false,
        error: 'db_not_ready',
        message: `В базе нет таблиц: ${schema.missingGame.join(', ')}. Игра не сможет создать игрока.`,
        hint: 'Примените миграции к боевой базе: npm run db:remote',
        missing: schema.missingGame,
        tables: schema.tables,
      },
      503,
    );
  }

  if (schema.missingAdmin.length > 0) warnings.push('admin_tables_missing');
  // Игра работает и без неё, но привязать прогресс на сайте не получится.
  if (schema.missingAuth.length > 0) warnings.push('auth_tables_missing');

  return c.json({
    ...base,
    ok: true,
    tables: schema.tables,
    missing: schema.missingAdmin,
    warnings,
  });
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

const GUEST_RE = /^[a-f0-9]{32}$/;

/**
 * Перенос гостевого профиля в телеграмовский.
 *
 * Строка `guest:<id>` переименовывается в `tg:<id>`, вместе с ней едут забеги,
 * награды, реклама, платежи и события. Если телеграмовский профиль уже есть,
 * гостевой остаётся как есть: два прогресса не сливаем в один.
 */
async function attachGuestToTelegram(
  env: WorkerEnv,
  guestId: string,
  tg: { id: number; first_name: string; username?: string },
): Promise<{ user: UserRow; merged: boolean }> {
  const userId = `tg:${tg.id}`;
  const now = nowMs();
  let user = await getUserById(env, userId);
  let merged = false;

  if (!user) {
    const guest = GUEST_RE.test(guestId) ? await getUserById(env, `guest:${guestId}`) : null;
    if (guest) {
      const tables = ['runs', 'grants', 'ad_events', 'payments', 'events'];
      const statements = [
        env.DB.prepare(
          'UPDATE users SET id = ?, tg_id = ?, is_guest = 0, first_name = ?, username = ?, updated_at = ? WHERE id = ?',
        ).bind(userId, tg.id, tg.first_name, tg.username ?? null, now, guest.id),
        ...tables.map((table) => env.DB.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`).bind(userId, guest.id)),
      ];
      const moved = await env.DB.batch(statements).then(() => true).catch(() => false);
      if (moved) {
        user = await getUserById(env, userId);
        merged = Boolean(user);
      }
    }
  }

  if (!user) {
    const created = await getOrCreateUser(env, {
      id: userId,
      isGuest: false,
      tgUser: { id: tg.id, first_name: tg.first_name || 'Игрок', username: tg.username },
    });
    user = created.user;
  } else {
    await env.DB.prepare('UPDATE users SET first_name = ?, username = ?, updated_at = ? WHERE id = ?')
      .bind(tg.first_name || user.first_name, tg.username ?? user.username, now, user.id)
      .run()
      .catch(() => undefined);
    user = (await getUserById(env, user.id)) ?? user;
  }

  return { user: await refreshLives(env, user), merged };
}

/**
 * Запрос привязки: сайт получает одноразовый код и ссылку на чат бота.
 *
 * Так не нужно настраивать домен в BotFather и полагаться на виджет Telegram
 * Login: бот уже умеет говорить с игроком, а вебхук подписан секретом.
 */
app.post('/api/auth/link', async (c) => {
  const username = (c.env.BOT_USERNAME ?? '').trim().replace(/^@/, '');
  if (!username) fail(503, 'bot_username_missing', 'В воркере не указан BOT_USERNAME, ссылка на бота не соберётся');
  if (!canSignSessions(c.env)) {
    fail(503, 'session_secret_missing', 'Воркеру нечем подписывать сеансы: добавьте секрет ADMIN_SECRET или SESSION_SECRET');
  }
  const guestId = (c.req.header('X-Guest-Id') ?? '').trim().toLowerCase();
  if (!GUEST_RE.test(guestId)) fail(400, 'guest_required', 'Нет идентификатора браузера, привязка невозможна');

  try {
    const { code, expiresAt } = await createAuthLink(c.env, guestId);
    return c.json({
      code,
      botUsername: `@${username}`,
      link: `https://t.me/${username}?start=${authStartParam(code)}`,
      expiresIn: Math.max(0, Math.round((expiresAt - nowMs()) / 1000)),
    });
  } catch (error) {
    if (isDatabaseError(error)) fail(503, 'auth_not_ready', 'В базе нет таблицы auth_links, примените миграцию 0003');
    throw error;
  }
});

/**
 * Опрос статуса кода. Как только бот получил «Да», здесь же выдаётся токен
 * сеанса и обновлённый профиль: код используется один раз.
 */
app.get('/api/auth/link', async (c) => {
  const code = c.req.query('code') ?? '';
  if (!isAuthCode(code)) fail(400, 'bad_code', 'Некорректный код привязки');

  let row;
  try {
    row = await readAuthLink(c.env, code);
  } catch (error) {
    if (isDatabaseError(error)) fail(503, 'auth_not_ready', 'В базе нет таблицы auth_links, примените миграцию 0003');
    throw error;
  }
  if (!row) return c.json({ status: 'unknown' });
  if (row.status !== 'confirmed' && row.status !== 'granted') {
    return c.json({ status: row.status });
  }

  const guestId = (c.req.header('X-Guest-Id') ?? '').trim().toLowerCase();
  if (guestId && row.guest_id && guestId !== row.guest_id) {
    fail(403, 'link_forbidden', 'Этот код выдал другой браузер');
  }

  const consumed = await consumeAuthLink(c.env, code);
  if (!consumed || !consumed.tg_id) return c.json({ status: 'expired' });

  const { user, merged } = await attachGuestToTelegram(c.env, consumed.guest_id, {
    id: consumed.tg_id,
    first_name: consumed.first_name || 'Игрок',
    username: consumed.username ?? undefined,
  });
  const session = await signSession(c.env, user.id);
  await c.env.DB.prepare('INSERT INTO events (user_id, kind, value, meta, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, 'telegram_link', 1, JSON.stringify({ merged, username: consumed.username ?? null }), nowMs())
    .run()
    .catch(() => undefined);

  return c.json({ status: 'linked', token: session, merged, profile: toProfile(user), config: publicConfig(c.env) });
});

/** Выход на сайте: токен подписан и ничего не хранит, поэтому достаточно удалить его у клиента. */
app.post('/api/auth/logout', (c) => c.json({ ok: true }));

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
  const mode = parseRunMode(body.mode);
  if (!mode) fail(400, 'bad_mode', 'Неизвестный режим');

  const user = await refreshLives(c.env, authCtx.user);
  if (!modeUnlocked(mode, user.max_level)) {
    // Код для бесконечного режима исторический: на него смотрит и клиент, и
    // интеграционный тест. Остальные режимы получают общий `mode_locked`.
    fail(
      403,
      mode === 'endless' ? 'endless_locked' : 'mode_locked',
      `Режим «${modeDef(mode).name}» откроется на ${modeGate(mode)} уровне кампании`,
      { mode, unlockAtLevel: modeGate(mode) },
    );
  }

  // «Парковка» и «Гонки» помнят уровень только в колонке mode_levels. Без
  // миграции 0004 забег всё равно не сохранить: финиш падал бы на каждом
  // уровне, поэтому режим не пускаем дальше проверки.
  if (isLevelMode(mode) && mode !== 'campaign' && !(await hasModeLevels(c.env))) {
    fail(
      503,
      'db_migration_required',
      'Прогресс режима некуда сохранять: примените миграцию 0004_mode_levels.sql в SQL консоли D1',
      { migration: '0004_mode_levels.sql' },
    );
  }

  const options = parseStartOptions(body);
  const existing = await c.env.DB.prepare(
    `SELECT * FROM runs WHERE user_id = ? AND mode = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(user.id, mode)
    .first<RunRow>();

  // `fresh` (кнопка «Начать заново») не смотрит на старую строку вовсе: игрок
  // уже решил, что continuация ему не нужна.
  if (existing && !options.fresh && resumableRun(existing) && resumableByReplay(existing)) {
    return c.json({ resumed: true, run: serializeRun(existing) });
  }
  if (existing) {
    // Активная партия из прежней сборки: её поле или журнал текущий клиент
    // принять не может, а без закрытия старт режима возвращал бы ту же строку вечно.
    // Считаем выходом: жизнь не списываем, награду не начисляем.
    const closedAt = nowMs();
    await c.env.DB
      .prepare(`UPDATE runs SET status = 'quit', updated_at = ?, finished_at = ? WHERE id = ? AND status = 'active'`)
      .bind(closedAt, closedAt, existing.id)
      .run();
  }

  const lives = materializeLives(user.lives, user.lives_at, nowMs());
  if (lives.lives <= 0) {
    fail(402, 'no_lives', 'Жизни закончились. Подожди восстановления или возьми бонус.', {
      lives: 0,
      nextLifeAt: lives.livesAt + 30 * 60 * 1000,
    });
  }

  const repeat = options.repeat;
  // Уровень берём из прогресса режима: у гонок он растёт от рядов, а не от побед.
  const level = isLevelMode(mode) ? modeProgress(user, mode).level : 0;
  let seed = randomSeed();
  // «Переиграть» просит то же поле, что было в последнем забеге на этом уровне.
  // Зерно храним в runs, поэтому повтор дешёвый и честный: сервер сам решает,
  // какую расстановку выдать, клиент не может выбрать лёгкую.
  if (repeat && isLevelMode(mode)) {
    const previous = await c.env.DB.prepare(
      'SELECT seed FROM runs WHERE user_id = ? AND mode = ? AND level = ? ORDER BY created_at DESC LIMIT 1',
    )
      .bind(user.id, mode, level)
      .first<{ seed: number | string | null }>();
    const stored = Number(previous?.seed);
    if (Number.isFinite(stored) && stored >= 0) seed = Math.floor(stored) >>> 0;
  }
  // Генератор свой у каждого режима: кампания отбирает расстановку по полосе
  // сложности, «Парковка» ищет план ухода фигур с поля, «Гонки» выдают полосу
  // притока, а сложность в них растёт внутри забега.
  const initial =
    mode === 'jam'
      ? createJamPuzzle(level, seed)
      : mode === 'race'
        ? createRaceLevel(level, seed)
        : mode === 'campaign'
          ? createCampaignLevel(level, seed)
          : mode === 'endless'
            ? createEndlessRun(seed)
            : createSpecialLevel(mode, level, seed);
  const id = crypto.randomUUID();
  const now = nowMs();

  await c.env.DB.prepare(
    `INSERT INTO runs (id, user_id, mode, level, seed, initial_state, actions, moves, score, status, result, finish_id, created_at, updated_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', 0, 0, 'active', NULL, NULL, ?, ?, NULL)`,
  )
    .bind(id, user.id, mode, level, seed, JSON.stringify(initial), now, now)
    .run();

  const run = await getRun(c.env, id);
  if (!run) fail(500, 'run_create_failed');
  return c.json({ resumed: false, run: serializeRun(run) });
});

/**
 * Подсказка в «Парковке». Сервер знает план решателя, поэтому отдаёт ход,
 * который точно ведёт к решению, а не догадку клиента. Клиент плана не видит:
 * serializeRun вырезает его, иначе подсказка была бы бесплатной.
 *
 * Подсказка платная: перед запросом клиент покупает её через /api/bonus/use, а
 * здесь сервер сверяет запись награды по позиции журнала.
 */
app.post('/api/run/:id/hint', async (c) => {
  const authCtx = auth(c);
  const run = await requireOwnRun(c.env, c.req.param('id'), authCtx.user.id);
  if (run.mode !== 'jam') fail(400, 'hint_not_supported', 'Подсказка на сервере нужна только в «Парковке»');
  if (run.status !== 'active') fail(409, 'run_finished', 'Забег уже завершён');

  const body = await readJson(c);
  const incoming = Array.isArray(body.actions) ? parseActions(body.actions, run.mode) : safeParseActions(run.actions);
  const stored = safeParseActions(run.actions);
  if (!isPrefix(stored, incoming)) {
    fail(409, 'actions_conflict', 'История ходов изменилась не по правилам');
  }

  const grants = await grantsForRun(c.env, run.id);
  const paid = grants.some((grant) => grant.kind === 'hint' && grant.action_index === incoming.length);
  if (!paid) fail(402, 'hint_not_paid', 'Подсказка не оплачена');

  const state = replay(run, incoming);
  if (!isJamState(state)) fail(500, 'run_corrupt', 'Поле «Парковки» повреждено');
  const move = jamHint(state);
  if (!move) fail(409, 'no_hint', 'Полезного хода не видно: попробуйте разобрать пробку с другого края');
  return c.json({
    move,
    removed: state.removed,
    total: state.total,
    movesLeft: Math.max(0, state.budget - state.moves),
  });
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

  const incoming = parseActions(body.actions, run.mode);
  const stored = safeParseActions(run.actions);
  if (!isPrefix(incoming, stored) && !isPrefix(stored, incoming)) {
    fail(409, 'actions_conflict', 'История ходов изменилась не по правилам');
  }

  const snapshot = snapshotOf(replay(run, incoming));
  const now = nowMs();
  const result = await c.env.DB.prepare(
    `UPDATE runs SET actions = ?, moves = ?, score = ?, updated_at = ?
     WHERE id = ? AND status = 'active' AND actions = ?`,
  )
    .bind(JSON.stringify(incoming), snapshot.moves, snapshot.score, now, run.id, run.actions)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    fail(409, 'save_conflict', 'Партия изменилась на другом устройстве');
  }

  return { ok: true, saved: incoming.length, moves: snapshot.moves, score: snapshot.score };
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
  const actions = parseActions(body.actions, run.mode);
  const stored = safeParseActions(run.actions);
  if (!isPrefix(stored, actions) && !isPrefix(actions, stored)) {
    fail(409, 'actions_conflict', 'История ходов не совпадает');
  }

  const state = replay(run, actions);
  const snapshot = snapshotOf(state);

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
    snapshot.status === 'won' ? 'won' : snapshot.status === 'lost' ? 'lost' : 'quit';

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
  // Колонки endless_* принадлежат бесконечному режиму: «Гонки» пишут рекорд в
  // mode_levels, иначе два режима дрались бы за одно поле.
  let endlessRecord = false;
  let modeLevelsAfter = user.mode_levels;
  let modeLevelsChanged = false;

  // Режимы с уровнем (кампания, «Парковка», «Гонки») продвигаются одинаково:
  // победа на своём уровне даёт награду и следующий уровень, поражение стоит
  // жизнь и оставляет уровень тот же. Разница только в том, где лежит прогресс:
  // у кампании в колонках профиля, у остальных в JSON `mode_levels`.
  const mode = run.mode;
  if (isWinLadder(mode)) {
    const progress = modeProgress(user, mode);
    if (outcome === 'won') {
      if (run.level > progress.level) {
        fail(409, 'level_out_of_sync', 'Уровень забега опережает профиль');
      }
      if (run.level === progress.level) {
        reward = campaignCoinReward(run.level);
        levelUp = true;
        levelAfter = progress.level + 1;
        if (mode === 'campaign') {
          maxLevelAfter = Math.max(user.max_level, levelAfter);
        } else {
          const levels = parseModeLevels(user.mode_levels);
          levels[mode] = { level: levelAfter, maxLevel: Math.max(progress.maxLevel, levelAfter) };
          modeLevelsAfter = serializeModeLevels(levels);
          modeLevelsChanged = true;
        }
      }
    } else if (outcome === 'lost') {
      const next = loseLife(user.lives, user.lives_at, now);
      livesAfter = next.lives;
      livesAtAfter = next.livesAt;
    }
  } else if (mode === 'race') {
    // «Гонки»: уровня-победы нет, счёт - пережитые ходы. Рекорд и уровень режима
    // лежат в mode_levels.race, награда капается за длину забега, а не за новый
    // рекорд: иначе игрок без рекорда сидел бы без монет совсем.
    const progress = modeProgress(user, 'race');
    const survived = snapshot.score;
    const bestBefore = progress.best ?? 0;
    newBest = survived > bestBefore;
    // Монеты платим только когда фигуры реально поймали короля: выйти из забега
    // на двадцатом ходу и получить награду было бы слишком просто.
    reward = outcome === 'lost' ? raceCoinReward(survived) : 0;
    if (newBest || raceLevelForMoves(survived) > progress.level) {
      const levels = parseModeLevels(user.mode_levels);
      const nextLevel = Math.max(progress.level, raceLevelForMoves(survived));
      levels.race = {
        level: nextLevel,
        maxLevel: Math.max(progress.maxLevel, nextLevel),
        best: Math.max(bestBefore, survived),
        bestMoves: Math.max(progress.bestMoves ?? 0, snapshot.moves),
      };
      modeLevelsAfter = serializeModeLevels(levels);
      modeLevelsChanged = true;
    }
    if (outcome === 'lost') {
      const next = loseLife(user.lives, user.lives_at, now);
      livesAfter = next.lives;
      livesAtAfter = next.livesAt;
    }
  } else {
    if (snapshot.score > user.endless_best) {
      newBest = true;
      endlessRecord = true;
      bestAfter = snapshot.score;
      bestTierAfter = snapshot.tier;
      bestMovesAfter = snapshot.moves;
      reward = endlessCoinReward(snapshot.score);
    }
    if (outcome === 'lost') {
      const next = loseLife(user.lives, user.lives_at, now);
      livesAfter = next.lives;
      livesAtAfter = next.livesAt;
    }
  }

  const wasUnlocked = modeUnlocked('endless', user.max_level);
  const endlessUnlockedNow = !wasUnlocked && modeUnlocked('endless', maxLevelAfter);
  const finishId = crypto.randomUUID();
  const newStatus = outcome === 'won' ? 'won' : outcome === 'lost' ? 'lost' : 'quit';

  const result = {
    outcome,
    mode: run.mode,
    level: run.level,
    score: snapshot.score,
    moves: snapshot.moves,
    coinsEarned: reward,
    levelUp,
    nextLevel: levelAfter,
    maxLevel: maxLevelAfter,
    lives: livesAfter,
    capturedBy: snapshot.capturedBy ?? null,
    // В «Парковке» конца фигуры не бывает: там причина - кончившийся бюджет ходов.
    reason: isJamState(state) ? state.lastEvent ?? '' : '',
    newBest,
    bestScore:
      run.mode === 'endless'
        ? Math.max(user.endless_best, snapshot.score)
        : run.mode === 'race'
          ? Math.max(modeProgress(user, 'race').best ?? 0, snapshot.score)
          : null,
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
  if (levelUp || modeLevelsChanged) {
    if (mode === 'campaign') {
      set.push('level = ?', 'max_level = MAX(max_level, ?)');
      binds.push(levelAfter, levelAfter);
    } else {
      // У «Парковки» и «Гонок» кампанийный максимум не растёт: режимы открываются
      // по кампании, а свой прогресс хранят в отдельном поле.
      set.push('mode_levels = ?');
      binds.push(modeLevelsAfter);
    }
  }
  if (outcome === 'lost') {
    set.push('lives = ?', 'lives_at = ?');
    binds.push(livesAfter, livesAtAfter);
  }
  if (endlessRecord) {
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

  if (Number(batch[0]?.meta?.changes ?? 0) > 0) {
    const ctx = c.executionCtx;
    if (reward > 0) {
      logEventInBackground(c.env, ctx, user.id, 'coins_earned', reward, {
        mode: run.mode,
        level: run.level,
        outcome,
      });
    }
    if (outcome === 'lost') {
      logEventInBackground(c.env, ctx, user.id, 'life_lost', 1, { mode: run.mode, level: run.level });
    }
  }

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
    fail(402, 'not_enough_coins', `Не хватает монет: нужно ${price}`, { price, kind });
  }

  // Грант пишется на каждый бонус, который партия потом проверяет: заморозка
  // сверяется на /move, подсказка «Парковки» - на /hint. Без строки гранта
  // оплаченная подсказка превращалась в ошибку «Подсказка не оплачена», и
  // монеты списывались впустую.
  if (kind === 'freeze' || kind === 'hint') {
    await c.env.DB.prepare(
      `INSERT INTO grants (run_id, user_id, kind, action_index, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(run.id, user.id, kind, at, source, now)
      .run();
  }

  const fresh = await getUserById(c.env, user.id);
  if (!fresh) fail(500, 'user_missing');

  logEventInBackground(c.env, c.executionCtx, user.id, 'bonus_used', 1, { kind, source });
  if (source === 'coins') {
    logEventInBackground(c.env, c.executionCtx, user.id, 'coins_spent', price, { kind });
  }

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
    fail(402, 'not_enough_coins', `Не хватает монет: нужно ${price}`, { price, kind });
  }

  const fresh = await getUserById(c.env, authCtx.user.id);
  if (!fresh) fail(500, 'user_missing');

  logEventInBackground(c.env, c.executionCtx, authCtx.user.id, 'coins_spent', price, {
    kind,
    source: 'shop',
  });

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
  if (authCtx.user.ad_free) fail(403, 'ad_free', 'Реклама отключена, награды за просмотр недоступны');

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
  logEventInBackground(c.env, c.executionCtx, user.id, 'ad_reward', 1, { kind });
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
  const metricRaw = c.req.query('metric');
  const metric: 'campaign' | 'endless' | 'jam' | 'race' =
    metricRaw === 'campaign' || metricRaw === 'jam' || metricRaw === 'race' ? metricRaw : 'endless';
  const friends = c.req.query('scope') === 'friends';
  // Прогресс «Парковки» и «Гонок» лежит в JSON-колонке: сравнивать его приходится
  // json_extract'ом. Если миграции не применены, запрос упадёт и onError отдаст
  // понятный db_not_ready вместо пустой таблицы.
  const modeColumn = (mode: 'jam' | 'race') =>
    `COALESCE(CAST(json_extract(mode_levels, '$.${mode}.level') AS INTEGER), 0)`;
  // В «Гонках» уровень это следствие рекорда, поэтому в таблице сравниваем сами
  // ряды: два игрока на пятом уровне могли пройти 52 и 96 рядов.
  const raceRowsColumn = `COALESCE(CAST(json_extract(mode_levels, '$.race.best') AS INTEGER), 0)`;
  const rankColumn =
    metric === 'campaign'
      ? 'max_level'
      : metric === 'endless'
        ? 'endless_best'
        : metric === 'race'
          ? raceRowsColumn
          : modeColumn(metric);
  const order =
    metric === 'campaign'
      ? 'max_level DESC, endless_best DESC, updated_at ASC'
      : metric === 'endless'
        ? 'endless_best DESC, max_level DESC, updated_at ASC'
        : metric === 'race'
          ? `${raceRowsColumn} DESC, ${modeColumn('race')} DESC, max_level DESC, updated_at ASC`
          : `${rankColumn} DESC, max_level DESC, updated_at ASC`;

  const where = friends
    ? '(id = ? OR referred_by = ?)'
    : 'is_guest = 0';
  const bindings = friends ? [user.id, user.id] : [];

  const { results } = await c.env.DB.prepare(
    `SELECT id, first_name, endless_best, endless_best_tier, max_level, level, mode_levels FROM users
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
      mode_levels: string | null;
    }>();

  const rows = results.map((row, index) => ({
    rank: index + 1,
    name: row.first_name || 'Игрок',
    isMe: row.id === user.id,
    endlessBest: row.endless_best,
    maxLevel: row.max_level,
    level: row.level,
    modeLevel:
      metric === 'jam' || metric === 'race' ? modeProgress(row as unknown as UserRow, metric).level : 0,
    modeBest: metric === 'race' ? modeProgress(row as unknown as UserRow, 'race').best ?? 0 : undefined,
  }));

  const rankWhere = friends
    ? `(id = ? OR referred_by = ?) AND `
    : `is_guest = 0 AND `;
  const myValue =
    metric === 'campaign'
      ? user.max_level
      : metric === 'endless'
        ? user.endless_best
        : metric === 'race'
          ? (modeProgress(user, 'race').best ?? 0)
          : modeProgress(user, metric).level;
  const rankBindings = friends ? [user.id, user.id, myValue] : [myValue];
  const rankRow = await c.env.DB.prepare(
    `SELECT COUNT(*) + 1 AS rank FROM users WHERE ${rankWhere}${rankColumn} > ?`,
  )
    .bind(...rankBindings)
    .first<{ rank: number }>();

  const inviteLink = botStartLink(c.env, `ref_${user.invite_code}`);
  // Гости не попадают в мировую таблицу, значит и места в ней у них нет.
  const ranked = friends || !user.is_guest;
  return c.json({
    metric,
    scope: friends ? 'friends' : 'global',
    rows,
    myRank: ranked ? Number(rankRow?.rank ?? 0) : 0,
    invitedCount: await invitedCount(c.env, user.id),
    inviteLink,
  });
});

// ─────────────────────────────── Telegram webhook ───────────────────────────────

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Ссылки в сообщениях бота должны вести на реальный домен. Если в переменных
 * остался localhost или пустое значение, подставляем origin запроса.
 */
function withRequestOrigin(env: WorkerEnv, origin: string): WorkerEnv {
  const configured = (env.WEBAPP_URL ?? '').trim();
  if (configured.startsWith('https://')) return env;
  return { ...env, WEBAPP_URL: origin.startsWith('https://') ? origin : '' };
}

/** Ответ на нажатие кнопок «Да» и «Нет» в сообщении про привязку. */
async function handleAuthCallback(env: WorkerEnv, callback: Record<string, unknown>): Promise<void> {
  const queryId = typeof callback.id === 'string' ? callback.id : '';
  const data = typeof callback.data === 'string' ? callback.data : '';
  const parsed = parseAuthCallback(data);
  const from = record(callback.from);
  const message = record(callback.message);
  const chatId = typeof record(message?.chat)?.id === 'number' ? (record(message?.chat)?.id as number) : null;
  const messageId = typeof message?.message_id === 'number' ? message.message_id : null;

  if (!parsed) {
    if (queryId) await answerCallbackQuery(env, queryId);
    return;
  }
  const returnUrl = authReturnUrl(env, parsed.code);

  if (parsed.action === 'no') {
    await rejectAuthLink(env, parsed.code);
    if (queryId) await answerCallbackQuery(env, queryId, { text: 'Отменили' });
    if (chatId && messageId) await editAuthMessage(env, chatId, messageId, 'Привязка отменена. Ничего не изменилось.');
    return;
  }

  const tgId = Number(from?.id);
  const firstName = typeof from?.first_name === 'string' ? from.first_name : 'Игрок';
  const username = typeof from?.username === 'string' ? from.username : undefined;
  if (!Number.isInteger(tgId) || tgId <= 0) {
    if (queryId) await answerCallbackQuery(env, queryId, { text: 'Telegram не передал профиль, попробуй ещё раз', alert: true });
    return;
  }

  const result = await confirmAuthLink(env, parsed.code, { id: tgId, firstName, username });
  if (result.ok) {
    // url в ответе на callback заставляет клиента Telegram открыть сайт:
    // игроку не нужно искать вкладку с игрой руками.
    if (queryId) await answerCallbackQuery(env, queryId, { text: 'Готово, возвращаем в игру', url: returnUrl || undefined });
    if (chatId && messageId) {
      await editAuthMessage(
        env,
        chatId,
        messageId,
        returnUrl
          ? 'Привязал. Открыл игру, если вкладка не появилась нажми кнопку ниже. Прогресс теперь хранится в этом аккаунте Telegram.'
          : 'Привязал. Открой вкладку с игрой в браузере: прогресс подтянется сам. Дальше он хранится в этом аккаунте Telegram.',
        returnUrl || undefined,
      );
    }
    return;
  }

  const reasonText: Record<string, string> = {
    expired: 'Ссылка устарела, она живёт пять минут. Нажми «Привязать Telegram» в игре ещё раз.',
    rejected: 'Этот запрос уже отменили.',
    used: 'Этот запрос уже использован.',
    unknown: 'Не нашёл такой запрос: возможно, его выдали с другого браузера.',
    already: 'Запрос уже подтверждён. Открой вкладку с игрой.',
  };
  const text = reasonText[result.reason ?? 'unknown'] ?? 'Не получилось подтвердить запрос.';
  if (queryId) await answerCallbackQuery(env, queryId, { text, alert: true });
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
      // Код привязки сайта: вместо приветствия просим подтвердить переход прогресса.
      const authCode = parseAuthStartParam(payload);
      if (authCode) {
        const link = await readAuthLink(env, authCode);
        if (!link || link.status !== 'pending') {
          await sendPlain(
            env,
            chatId,
            'Такая ссылка уже не действует: они живут пять минут. Открой игру в браузере и нажми «Привязать Telegram» ещё раз.',
          );
          return;
        }
        await sendAuthPrompt(env, chatId, firstName, authCode);
        return;
      }
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

  const callback = record(update.callback_query);
  if (callback) {
    await handleAuthCallback(env, callback);
    return;
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
    await handleUpdate(withRequestOrigin(c.env, new URL(c.req.url).origin), update);
  } catch (error) {
    console.error('Webhook handling error', error instanceof Error ? error.message : String(error));
  }
  return c.json({ ok: true });
});

// Совместимость с Telegram: некоторые клиенты дергают webhook GET-ом при проверке.
app.get('/api/telegram/webhook', (c) => c.json({ ok: true, hint: 'POST only' }));

export default app;
