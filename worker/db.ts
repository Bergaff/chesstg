import {
  ASH_RECORD_MOVES,
  BONUSES,
  checkSkin,
  isLevelMode,
  isSkinId,
  materializeLives,
  MAX_LIVES,
  modeGate,
  modeUnlocked,
  msUntilNextLife,
  PAID_SKINS,
  PLAYABLE_MODES,
  RACE_KING_ROW,
  RACE_KING_ROWS,
  RACE_ROWS,
  randomSeed,
  shortCode,
  SKINS,
  SKIN_CUSTOM_SLOTS_MAX,
  type CustomSkin,
  type GameMode,
  type SkinId,
} from '../src/engine';
import { fail, parseActions } from './http';
import type { TelegramUser, UserRow, WorkerEnv, RunRow } from './types';

export const WELCOME_COINS = 30;
export const REFERRAL_BONUS = 25;

export function publicConfig(env: WorkerEnv) {
  const devMode = env.DEV_MODE === 'true';
  const blockId = env.ADSGRAM_BLOCK_ID?.trim() ?? '';
  const demoAds = devMode && !blockId;
  return {
    botUsername: env.BOT_USERNAME?.trim() ?? '',
    webappUrl: env.WEBAPP_URL?.trim() ?? '',
    allowGuests: env.ALLOW_GUESTS === 'true',
    devMode,
    demoAds,
    // Рекламу включаем, только когда есть что показывать: блок Adsgram задан
    // либо играет демо-ролик локальной сборки. Кнопка «посмотреть рекламу» не
    // должна обещать награду, пока владелец не впишет ADSGRAM_BLOCK_ID.
    adsEnabled: Boolean(blockId) || demoAds,
    paymentsEnabled: Boolean(env.BOT_TOKEN?.trim()),
    // Переменная ENVIRONMENT задаётся в wrangler.jsonc (production) и в .dev.vars (development).
    environment: env.ENVIRONMENT?.trim() || 'development',
    adsgram: {
      blockId,
      src: env.ADSGRAM_SRC?.trim() || 'https://sad.adsgram.ai/js/sad.min.js',
    },
  };
}

export function ownedSkins(user: UserRow, qa = false): SkinId[] {
  const owned = user.skins
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SkinId => isSkinId(s));
  const set = new Set<SkinId>(['classic', ...owned]);
  // Аккаунт из QA-списка владеет всеми темами, наградные включая: проверять
  // контраст, чужие установки и очередь публикации нужно без тестового
  // кошелька. В базу ничего не дописывается - снимешь переменную, и темы снова
  // надо покупать. «custom» сюда не попадает: своя тема либо собрана, либо нет.
  if (qa) for (const id of Object.keys(SKINS)) if (id !== 'custom') set.add(id as SkinId);
  return [...set];
}

/**
 * Сколько слотов своей темы куплено. Один слот - одна тема: правки в ней
 * бесплатны, код уходит в чат бесплатно, а второй рисунок стоит ещё один слот.
 * `custom_paid` (миграция 0006) переживает этот выпуск как «мастерская открыта
 * вообще»: строки, купленные до 0007, несут ровно этот флаг и ни одного
 * `custom_slots`, поэтому берём максимум из двух - иначе игрок, заплативший
 * вчера, проснулся бы без мастерской.
 */
export function customSlotsOf(user: UserRow): number {
  const bought = Number(user.custom_slots ?? 0);
  const legacy = Number(user.custom_paid ?? 0) === 1 ? 1 : 0;
  return Math.min(SKIN_CUSTOM_SLOTS_MAX, Math.max(bought, legacy));
}

/**
 * Колонки слотов. `skin_custom` остаётся первым: переименовывать его значило бы
 * писать миграцию переноса там, где достаточно порядка колонок.
 */
const CUSTOM_SLOT_COLUMNS = ['skin_custom', 'skin_custom_2', 'skin_custom_3'] as const;

function readSkinJson(raw: unknown): CustomSkin | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    const check = checkSkin(JSON.parse(text) as unknown);
    return check.ok ? check.skin : null;
  } catch {
    return null;
  }
}

/** Тема в конкретном слоте (1..`SKIN_CUSTOM_SLOTS_MAX`); пустой слот - null. */
export function customSkinInSlot(user: UserRow, slot: number): CustomSkin | null {
  const index = Math.trunc(Number(slot)) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= CUSTOM_SLOT_COLUMNS.length) return null;
  return readSkinJson(user[CUSTOM_SLOT_COLUMNS[index] as keyof UserRow]);
}

/**
 * Заморожены ли темы игрока: права рисовать у него не отбираем, но надеть,
 * сохранить и показать чужим заблокированная тема не может.
 */
export function customBlocked(user: UserRow): boolean {
  return Number(user.custom_blocked ?? 0) === 1;
}

/**
 * Все купленные слоты - список для магазина и для админской ревизии. Длина
 * равна числу слотов намеренно: «места нет» и «место пустует» - разные
 * состояния, и рисуются они по-разному.
 */
export function customSkinsOf(user: UserRow): (CustomSkin | null)[] {
  const slots = customSlotsOf(user);
  return Array.from({ length: slots }, (_, index) => customSkinInSlot(user, index + 1));
}

/**
 * Какой слот надет. Если в выбранном слоте ничего нет - надеваем первую
 * непустую тему: возврат платежа или чистка слота не должны оставлять игрока
 * без скина при полном-то поле.
 */
export function customActiveSlot(user: UserRow): number {
  const slots = Math.max(1, customSlotsOf(user));
  const wanted = Math.trunc(Number(user.custom_active ?? 1));
  const first = Number.isInteger(wanted) && wanted >= 1 && wanted <= slots ? wanted : 1;
  if (customSkinInSlot(user, first)) return first;
  for (let slot = 1; slot <= slots; slot += 1) {
    if (customSkinInSlot(user, slot)) return slot;
  }
  return first;
}

/**
 * Своя тема игрока: собранная в студии или установленная из галереи. Разбор
 * намеренно молчаливый - кривой JSON из старой записи не должен ломать профиль,
 * он просто означает «своей темы нет», и доска надевает «Кость».
 */
export function customSkinOf(user: UserRow): CustomSkin | null {
  if (customBlocked(user)) return null;
  return customSkinInSlot(user, customActiveSlot(user));
}

/**
 * Открыта ли мастерская: куплен хотя бы один слот (звёздами или монетами) либо
 * право выдано льготой из `QA_LIVES_IDS`. Студия при этом открыта всем - платят
 * не за рисование, а за то, что надели.
 */
export function workshopOwned(user: UserRow, qa = false): boolean {
  return qa || customSlotsOf(user) >= 1;
}

export function selectedSkin(user: UserRow, qa = false): SkinId {
  const wanted = user.skin;
  if (wanted === 'custom') return workshopOwned(user, qa) && customSkinOf(user) ? 'custom' : 'classic';
  if (!isSkinId(wanted)) return 'classic';
  return skinAvailable(user, wanted, qa) ? wanted : 'classic';
}

/**
 * Открыта ли тема: куплена (звёздами или монетами), бесплатна, собрана самим
 * игроком в оплаченной мастерской или выдана льготным списком. Сезонных витрин нет - «бесплатно до
 * конца квартала» означало бы, что одна тема в магазине лежит на полке, а три
 * нет, и цена набора спорит с собственной щедростью.
 */
export function skinAvailable(user: UserRow, id: SkinId, qa = false): boolean {
  if (id === 'classic' || id === 'graphite') return true;
  if (id === 'custom') return workshopOwned(user, qa) && customSkinOf(user) !== null;
  if (qa) return true;
  // Награду не открывает ни покупка, ни щедрость списка: её нужно заработать.
  if (SKINS[id].reward) return ownedSkins(user).includes(id);
  return ownedSkins(user).includes(id);
}

export function toProfile(user: UserRow, now = Date.now(), qa = false) {
  const lives = materializeLives(user.lives, user.lives_at, now);
  const nextLifeInMs = qa ? 0 : msUntilNextLife(lives.lives, lives.livesAt, now);
  return {
    id: user.id,
    name: user.first_name || (user.is_guest ? 'Гость' : 'Игрок'),
    isGuest: Boolean(user.is_guest),
    level: user.level,
    maxLevel: user.max_level,
    levelsCleared: Math.max(0, user.max_level - 1),
    coins: user.coins,
    // Вечные сердца показываются полным рядом и с флагом: проверяющий должен
    // видеть, что список сработал, а не молча получать пять сердец.
    lives: qa ? MAX_LIVES : lives.lives,
    maxLives: MAX_LIVES,
    eternalLives: qa,
    // Один флаг на все льготы списка: магазин по нему прячет цены, меню - вход
    // в лабораторию. Решает сервер, клиент только рисует.
    qa,
    nextLifeAt: nextLifeInMs > 0 ? now + nextLifeInMs : null,
    nextLifeInMs,
    serverNow: now,
    endlessBest: user.endless_best,
    endlessBestTier: user.endless_best_tier,
    endlessBestMoves: user.endless_best_moves,
    endlessUnlocked: user.max_level > 10,
    adFree: Boolean(user.ad_free),
    customPaid: workshopOwned(user, qa),
    skins: ownedSkins(user, qa),
    skin: selectedSkin(user, qa),
    customSkin: customSkinOf(user),
    // Слоты своей темы: активный слот - тот, что надет (`customSkin` выше),
    // список - для магазина, где видна каждая купленная тема и пустое место.
    customSlots: customSlotsOf(user),
    customMaxSlots: SKIN_CUSTOM_SLOTS_MAX,
    customActive: customActiveSlot(user),
    customBlocked: customBlocked(user),
    customSkins: customSkinsOf(user),
    ashRecordMoves: ASH_RECORD_MOVES,
    inventory: {
      hint: user.inv_hint,
      freeze: user.inv_freeze,
      undo: user.inv_undo,
    },
    inviteCode: user.invite_code,
    createdAt: user.created_at,
    prices: Object.fromEntries(Object.values(BONUSES).map((b) => [b.id, b.price])),
    modes: profileModes(user),
  };
}

/**
 * Прогресс по всем четырём режимам одним объектом, чтобы меню рисовало карточки
 * без отдельных запросов: уровень, лучший уровень, открыт ли режим и на каком.
 */
export function profileModes(user: UserRow) {
  const levels = parseModeLevels(user.mode_levels);
  const entry = (mode: GameMode) => {
    const gate = modeGate(mode);
    const progress = mode === 'campaign' ? { level: user.level, maxLevel: user.max_level } : levels[mode] ?? { level: 1, maxLevel: 1 };
    return {
      level: progress.level,
      maxLevel: progress.maxLevel,
      unlocked: modeUnlocked(mode, user.max_level),
      unlockAtLevel: gate,
      ...(progress.best === undefined ? {} : { best: progress.best }),
      ...(progress.bestMoves === undefined ? {} : { bestMoves: progress.bestMoves }),
    };
  };
  return {
    campaign: entry('campaign'),
    jam: entry('jam'),
    race: entry('race'),
    // У бесконечного режима уровня нет, там счёт это рекорд: он в profile.endlessBest.
    endless: { level: 0, maxLevel: 0, unlocked: modeUnlocked('endless', user.max_level), unlockAtLevel: modeGate('endless') },
  };
}

export async function getUserById(env: WorkerEnv, id: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

async function generateInviteCode(env: WorkerEnv): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = shortCode(randomSeed() ^ attempt, 8);
    const exists = await env.DB.prepare('SELECT 1 FROM users WHERE invite_code = ?').bind(code).first();
    if (!exists) return code;
  }
  return shortCode(randomSeed(), 12);
}

export async function createUser(
  env: WorkerEnv,
  params: { id: string; tgUser?: TelegramUser; isGuest: boolean },
): Promise<UserRow> {
  const now = Date.now();
  const inviteCode = await generateInviteCode(env);
  const name = params.tgUser?.first_name?.slice(0, 40) || (params.isGuest ? 'Гость' : 'Игрок');

  try {
    await env.DB.prepare(
      `INSERT INTO users
        (id, tg_id, first_name, username, is_guest, level, max_level, coins, lives, lives_at,
         endless_best, endless_best_tier, endless_best_moves, ad_free, skins, skin,
         inv_hint, inv_freeze, inv_undo, invite_code, referred_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, 0, 1, 0, 0, 'classic', 'classic', 0, 0, 0, ?, NULL, ?, ?)`,
    )
      .bind(
        params.id,
        params.tgUser?.id ?? null,
        name,
        params.tgUser?.username?.slice(0, 40) ?? null,
        params.isGuest ? 1 : 0,
        WELCOME_COINS,
        MAX_LIVES,
        now,
        inviteCode,
        now,
        now,
      )
      .run();
  } catch (error) {
    // Гонка двух первых запросов: просто читаем уже созданную запись.
    const existing = await getUserById(env, params.id);
    if (existing) return existing;
    throw error;
  }

  const user = await getUserById(env, params.id);
  if (!user) fail(500, 'user_create_failed');
  return user;
}

export async function getOrCreateUser(
  env: WorkerEnv,
  params: { id: string; tgUser?: TelegramUser; isGuest: boolean },
): Promise<{ user: UserRow; created: boolean }> {
  const existing = await getUserById(env, params.id);
  if (existing) return { user: existing, created: false };
  const user = await createUser(env, params);
  return { user, created: true };
}

/**
 * Есть ли в базе колонка `users.mode_levels` (миграция 0004). Результат
 * кэшируется на изолятор на минуту: проверка это один дешёвый PRAGMA, а
 * поднимать забег без куда сохранять прогресс смысла нет.
 */
let modeLevelsProbe: { at: number; present: boolean } | null = null;

export async function hasModeLevels(env: WorkerEnv): Promise<boolean> {
  const now = Date.now();
  if (modeLevelsProbe && now - modeLevelsProbe.at < 60_000) return modeLevelsProbe.present;
  let present = false;
  try {
    const info = await env.DB.prepare('PRAGMA table_info(users)').all<{ name: string }>();
    present = (info.results ?? []).some((col) => col.name === 'mode_levels');
  } catch {
    present = false;
  }
  modeLevelsProbe = { at: now, present };
  return present;
}

/** Только для тестов: сбросить кэш проверки колонок. */
export function resetModeLevelsProbe(): void {
  modeLevelsProbe = null;
}

/** Пересчитывает жизни с учётом времени и сохраняет, если что-то изменилось. */
/**
 * Вечные сердца. `QA_LIVES_IDS` - список Telegram id через запятую (или пробел),
 * переменная окружения воркера. Аккаунт из списка играет без списания жизней.
 *
 * Проверка идёт по `tg_id`, а не по гостевому id: гостю список не назначить,
 * зато подделать себя нельзя - `tg_id` берётся из подписанного initData. Пустая
 * или отсутствующая переменная значит «режима нет», поэтому на проде без
 * настройки ничего не меняется.
 */
/**
 * Аккаунт в списке `QA_LIVES_IDS`. Список один на все льготы: вечные сердца,
 * все темы поля, публикация без взноса и вход в лабораторию из меню. Два
 * отдельных списка однажды разъехались бы, и проверяющий гадаль бы, почему
 * сердца вечные, а тему не надеть.
 */
export function qaAccount(env: WorkerEnv, user: Pick<UserRow, 'tg_id'>): boolean {
  const raw = env.QA_LIVES_IDS?.trim();
  if (!raw || user.tg_id == null) return false;
  const id = String(user.tg_id);
  return raw
    .split(/[\s,;]+/)
    .some((token) => token.length > 0 && token === id);
}

/** Вечные сердца - частный случай льгот из `qaAccount`; имя оставлено ради HUD. */
export function eternalLives(env: WorkerEnv, user: Pick<UserRow, 'tg_id'>): boolean {
  return qaAccount(env, user);
}

export async function refreshLives(env: WorkerEnv, user: UserRow, now = Date.now()): Promise<UserRow> {
  // Вечным аккаунтам строку не пишем: снимешь переменную - и регенерация
  // продолжится с того же момента, что и была.
  if (qaAccount(env, user)) return user.lives === MAX_LIVES ? user : { ...user, lives: MAX_LIVES };
  const lives = materializeLives(user.lives, user.lives_at, now);
  if (lives.lives === user.lives && lives.livesAt === user.lives_at) return user;
  await env.DB.prepare('UPDATE users SET lives = ?, lives_at = ?, updated_at = ? WHERE id = ?')
    .bind(lives.lives, lives.livesAt, now, user.id)
    .run();
  return { ...user, lives: lives.lives, lives_at: lives.livesAt };
}

export async function getRun(env: WorkerEnv, id: string): Promise<RunRow | null> {
  return env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(id).first<RunRow>();
}

export async function requireOwnRun(env: WorkerEnv, runId: string, userId: string): Promise<RunRow> {
  const run = await getRun(env, runId);
  if (!run) fail(404, 'run_not_found', 'Забег не найден');
  if (run.user_id !== userId) fail(403, 'forbidden', 'Это чужой забег');
  return run;
}

export function runSummary(run: RunRow) {
  return {
    id: run.id,
    mode: run.mode,
    level: run.level,
    moves: run.moves,
    score: run.score,
    status: run.status,
    updatedAt: run.updated_at,
  };
}

/**
 * Форма начального поля должна совпадать с режимом.
 *
 * Активные партии переживают сборку: «Парковка» до экрана головоломки была
 * песочницей с пешкой, а «Гонки» были погоней с нулевого ряда. Если отдать
 * клиенту такую строку, его экран её не нарисует, а активная она быть не может,
 * потому что старт режима всегда возвращает именно её. По этому признаку
 * старую партию закрываем, жизнь и награды при этом не трогаем.
 */
export function runShapeMatchesMode(run: { mode: string; initial_state: string } | null | undefined): boolean {
  if (!run) return false;
  let state: unknown = null;
  try {
    state = JSON.parse(run.initial_state);
  } catch {
    return false;
  }
  return initialMatchesMode(state, run.mode);
}

/**
 * Можно ли продолжить активную партию: поле должно подходить режиму, а журнал
 * разбираться его правилами. Старые сборки писали в `runs` другие состояния, и
 * такой забег проще закрыть, чем чинить: клиент на нём только спотыкается.
 */
export function resumableRun(run: { mode: string; initial_state: string; actions: string } | null | undefined): boolean {
  if (!runShapeMatchesMode(run)) return false;
  try {
    parseActions(JSON.parse(run!.actions) as unknown, run!.mode as GameMode);
    return true;
  } catch {
    return false;
  }
}

/** Тот же разбор для уже распарсенного состояния: нужен диагностике админки. */
export function initialMatchesMode(state: unknown, mode: string): boolean {
  if (!state || typeof state !== 'object') return false;
  const value = state as {
    mode?: unknown;
    version?: unknown;
    pieces?: unknown;
    removed?: unknown;
    width?: unknown;
    height?: unknown;
    enemies?: unknown;
    player?: { x?: unknown; y?: unknown };
  };
  if (value.mode !== mode) return false;
  if (mode === 'jam') {
    // Версия входит в проверку: задача «разойтись половинами» тоже была
    // `mode: 'jam'`, и на её состоянии новый экран падает на первом же шаге.
    return value.version === 3 && Array.isArray(value.pieces) && typeof value.removed === 'number';
  }
  const shaped =
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    Array.isArray(value.enemies) &&
    typeof value.player?.x === 'number' &&
    typeof value.player?.y === 'number';
  if (!shaped) return false;
  if (mode === 'race') {
    // Ряд и высота поля входят в проверку: у «Гонок» менялась и геометрия, и
    // правило про игрока. Стартовый забег обязан начинаться там, где его ждёт
    // клиент, - в полосе из `RACE_KING_ROWS` нижних рядов, на ряду генератора.
    // Партия прежних сборок (12 рядов, потом бегущий ряд) закрывается как выход,
    // а не продолжается: возобновлять её нечестно, правила уже другие.
    const band = typeof value.player?.y === 'number' && value.player.y >= 0 && value.player.y < RACE_KING_ROWS;
    return value.player?.y === RACE_KING_ROW && band && value.height === RACE_ROWS;
  }
  return true;
}

export function serializeRun(run: RunRow) {
  let initial: unknown = null;
  let actions: unknown = [];
  let result: unknown = null;
  try {
    initial = JSON.parse(run.initial_state);
    actions = JSON.parse(run.actions);
    result = run.result ? JSON.parse(run.result) : null;
  } catch {
    fail(500, 'run_corrupt', 'Повреждённые данные забега');
  }
  // План решателя решает уровень целиком: клиенту он не показываем, иначе
  // подсказка становится бесплатной.
  if (initial && typeof initial === 'object' && 'mode' in initial && (initial as { mode?: string }).mode === 'jam') {
    const { plan: _plan, ...jamPublic } = initial as Record<string, unknown>;
    void _plan;
    initial = jamPublic;
  }

  return {
    id: run.id,
    mode: run.mode,
    level: run.level,
    seed: run.seed,
    initial,
    actions,
    moves: run.moves,
    score: run.score,
    status: run.status,
    result,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

/** Прогресс режима с уровнем: текущий, пройденный и рекорд рядов («Гонки»). */
export interface ModeProgress {
  level: number;
  maxLevel: number;
  /** Рекорд в пережитых ходах: у «Гонок» финиша нет, поэтому считается длина. */
  best?: number;
  /** Ходов в лучшем забеге. */
  bestMoves?: number;
}

/**
 * Прогресс «Парковки» и «Гонок» живёт в одном текстовом поле `users.mode_levels`
 * как JSON вида {"jam":{"level":4,"maxLevel":6}}. Отдельные колонки под каждый
 * режим означали бы миграцию на каждый новый режим, а их число в лаборатории
 * растёт. Кампания по-прежнему в `level` и `max_level`: она была там до появления
 * остальных режимов, и трогать её смысла нет.
 */
/** Режимы, чей уровень хранится в JSON-колонке: кампания и бесконечный живут в своих. */
const STORED_MODES: readonly GameMode[] = PLAYABLE_MODES.filter((mode) => isLevelMode(mode) && mode !== 'campaign');

export function parseModeLevels(raw: unknown): Record<string, ModeProgress> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ModeProgress>>;
    const out: Record<string, ModeProgress> = {};
    for (const mode of STORED_MODES) {
      const value = parsed?.[mode];
      if (!value) continue;
      const level = Number(value.level);
      const maxLevel = Number(value.maxLevel);
      const current = Number.isFinite(level) && level > 0 ? Math.floor(level) : 1;
      const reached = Number.isFinite(maxLevel) && maxLevel > 0 ? Math.floor(maxLevel) : current;
      const entry: ModeProgress = { level: current, maxLevel: Math.max(current, reached) };
      // Рекорд рядов есть не у всех режимов: пишем его, только если он пришёл
      // числом, иначе профиль отдаёт best: 0 там, где рекорда не было никогда.
      const rows = Number(value.best);
      if (Number.isFinite(rows) && rows > 0) entry.best = Math.floor(rows);
      const moves = Number(value.bestMoves);
      if (Number.isFinite(moves) && moves > 0) entry.bestMoves = Math.floor(moves);
      // Пройденный уровень не может быть меньше текущего: иначе админка покажет
      // «открыто 2, играешь 7», а генератор возьмёт уровень из maxLevel.
      out[mode] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeModeLevels(map: Record<string, ModeProgress>): string {
  return JSON.stringify(map);
}

export function modeProgress(user: UserRow, mode: GameMode): ModeProgress {
  if (mode === 'campaign') return { level: user.level, maxLevel: user.max_level };
  // В бесконечном режиме уровня нет: там счёт это высота, она в endless_best.
  if (mode === 'endless') return { level: 0, maxLevel: 0 };
  return parseModeLevels(user.mode_levels)[mode] ?? { level: 1, maxLevel: 1 };
}

export async function activeRuns(env: WorkerEnv, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM runs WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC`,
  )
    .bind(userId)
    .all<RunRow>();
  const byMode: Record<string, ReturnType<typeof runSummary> | undefined> = {};
  for (const run of results) byMode[run.mode] = runSummary(run);
  return byMode;
}

export async function grantsForRun(env: WorkerEnv, runId: string) {
  const { results } = await env.DB.prepare(
    'SELECT kind, action_index, source FROM grants WHERE run_id = ? ORDER BY id ASC',
  )
    .bind(runId)
    .all<{ kind: string; action_index: number; source: string }>();
  return results;
}

export function paidSkinsList(): SkinId[] {
  return PAID_SKINS.filter((s) => Boolean(SKINS[s]));
}
