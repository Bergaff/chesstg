import {
  BONUSES,
  MAX_LIVES,
  PAID_SKINS,
  SKINS,
  isSkinId,
  materializeLives,
  msUntilNextLife,
  shortCode,
  randomSeed,
  type SkinId,
} from '../src/engine';
import { fail } from './http';
import type { TelegramUser, UserRow, WorkerEnv, RunRow } from './types';

export const WELCOME_COINS = 30;
export const REFERRAL_BONUS = 25;

export function publicConfig(env: WorkerEnv) {
  const devMode = env.DEV_MODE === 'true';
  const blockId = env.ADSGRAM_BLOCK_ID?.trim() ?? '';
  return {
    botUsername: env.BOT_USERNAME?.trim() ?? '',
    webappUrl: env.WEBAPP_URL?.trim() ?? '',
    allowGuests: env.ALLOW_GUESTS === 'true',
    devMode,
    demoAds: devMode && !blockId,
    paymentsEnabled: Boolean(env.BOT_TOKEN?.trim()),
    environment: env.ENVIRONMENT ?? 'development',
    adsgram: {
      blockId,
      src: env.ADSGRAM_SRC?.trim() || 'https://sad.adsgram.ai/js/sad.min.js',
    },
  };
}

export function ownedSkins(user: UserRow): SkinId[] {
  const owned = user.skins
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SkinId => isSkinId(s));
  return [...new Set<SkinId>(['classic', ...owned])];
}

export function selectedSkin(user: UserRow): SkinId {
  const owned = ownedSkins(user);
  return isSkinId(user.skin) && owned.includes(user.skin) ? user.skin : 'classic';
}

export function toProfile(user: UserRow, now = Date.now()) {
  const lives = materializeLives(user.lives, user.lives_at, now);
  const nextLifeInMs = msUntilNextLife(lives.lives, lives.livesAt, now);
  return {
    id: user.id,
    name: user.first_name || (user.is_guest ? 'Гость' : 'Игрок'),
    isGuest: Boolean(user.is_guest),
    level: user.level,
    maxLevel: user.max_level,
    levelsCleared: Math.max(0, user.max_level - 1),
    coins: user.coins,
    lives: lives.lives,
    maxLives: MAX_LIVES,
    nextLifeAt: nextLifeInMs > 0 ? now + nextLifeInMs : null,
    nextLifeInMs,
    serverNow: now,
    endlessBest: user.endless_best,
    endlessBestTier: user.endless_best_tier,
    endlessBestMoves: user.endless_best_moves,
    endlessUnlocked: user.max_level > 10,
    adFree: Boolean(user.ad_free),
    skins: ownedSkins(user),
    skin: selectedSkin(user),
    inventory: {
      hint: user.inv_hint,
      freeze: user.inv_freeze,
      undo: user.inv_undo,
    },
    inviteCode: user.invite_code,
    createdAt: user.created_at,
    prices: Object.fromEntries(Object.values(BONUSES).map((b) => [b.id, b.price])),
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

/** Пересчитывает жизни с учётом времени и сохраняет, если что-то изменилось. */
export async function refreshLives(env: WorkerEnv, user: UserRow, now = Date.now()): Promise<UserRow> {
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
