import { nowMs } from './http';
import type { WorkerEnv } from './types';

/**
 * Привязка сайта к Telegram через бота.
 *
 * Схема такая: сайт просит одноразовый код, открывает чат бота с deep link
 * `/start auth_<код>`, бот спрашивает «привязать прогресс?», игрок нажимает
 * «Да», а сайт опрашивает статус и получает токен сеанса. Никаких доменов в
 * BotFather, никаких внешних OAuth: у бота уже есть канал связи с игроком, и
 * подпись вебхува ему уже доверяется.
 */

export type AuthLinkStatus = 'pending' | 'confirmed' | 'rejected' | 'used' | 'expired';

export interface AuthLinkRow {
  code: string;
  status: AuthLinkStatus;
  guest_id: string;
  user_id: string | null;
  first_name: string;
  username: string | null;
  tg_id: number | null;
  created_at: number;
  updated_at: number;
}

/** Время жизни кода: игрок успевает переключиться во вкладку Telegram. */
export const AUTH_LINK_TTL_MS = 5 * 60 * 1000;
export const AUTH_LINK_PREFIX = 'auth_';

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 16;

export function newAuthCode(): string {
  let code = '';
  try {
    const bytes = new Uint8Array(CODE_LENGTH);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  } catch {
    while (code.length < CODE_LENGTH) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Текст deep link, который бот получит в `/start`. */
export function authStartParam(code: string): string {
  return `${AUTH_LINK_PREFIX}${code}`;
}

export function parseAuthStartParam(payload: string | undefined): string | null {
  if (!payload || !payload.startsWith(AUTH_LINK_PREFIX)) return null;
  const code = payload.slice(AUTH_LINK_PREFIX.length);
  return isAuthCode(code) ? code : null;
}

export function isAuthCode(value: string): boolean {
  return /^[a-z2-9]{16}$/.test(value);
}

/** `callback_data` кнопок инлайн-клавиатуры. */
export function authCallbackData(action: 'yes' | 'no', code: string): string {
  return `auth:${action}:${code}`;
}

export function parseAuthCallback(data: string): { action: 'yes' | 'no'; code: string } | null {
  const match = /^auth:(yes|no):([a-z2-9]+)$/.exec(data);
  if (!match) return null;
  const code = match[2];
  if (!isAuthCode(code)) return null;
  return { action: match[1] as 'yes' | 'no', code };
}

async function run(env: WorkerEnv, sql: string, ...values: unknown[]): Promise<void> {
  await env.DB.prepare(sql).bind(...(values as (string | number | null)[])).run();
}

/** Новый код для гостя; прежние его незакрытые коды гасятся. */
export async function createAuthLink(env: WorkerEnv, guestId: string): Promise<{ code: string; expiresAt: number }> {
  const now = nowMs();
  await run(env, "UPDATE auth_links SET status = 'expired', updated_at = ? WHERE guest_id = ? AND status = 'pending'", now, guestId);
  const code = newAuthCode();
  await run(
    env,
    'INSERT INTO auth_links (code, status, guest_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    code,
    'pending',
    guestId,
    now,
    now,
  );
  return { code, expiresAt: now + AUTH_LINK_TTL_MS };
}

/**
 * Код с учётом срока жизни: протухший pending возвращается как expired,
 * `null` означает, что такого кода нет (или он был удалён).
 */
export async function readAuthLink(env: WorkerEnv, code: string): Promise<AuthLinkRow | null> {
  const row = await env.DB.prepare('SELECT * FROM auth_links WHERE code = ?').bind(code).first<AuthLinkRow>();
  if (!row) return null;
  if (row.status === 'pending' && nowMs() - row.created_at > AUTH_LINK_TTL_MS) {
    await run(env, "UPDATE auth_links SET status = 'expired', updated_at = ? WHERE code = ?", nowMs(), code);
    return { ...row, status: 'expired' };
  }
  return row;
}

/** Подтверждение из бота. Работает только со свежим pending: повторный клик ничего не меняет. */
export async function confirmAuthLink(
  env: WorkerEnv,
  code: string,
  tg: { id: number; firstName: string; username?: string },
): Promise<{ ok: boolean; reason?: string }> {
  const row = await readAuthLink(env, code);
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.status === 'confirmed' || row.status === 'used') return { ok: false, reason: 'already' };
  if (row.status !== 'pending') return { ok: false, reason: row.status };
  await run(
    env,
    "UPDATE auth_links SET status = 'confirmed', user_id = ?, tg_id = ?, first_name = ?, username = ?, updated_at = ? WHERE code = ? AND status = 'pending'",
    `tg:${tg.id}`,
    tg.id,
    tg.firstName,
    tg.username ?? null,
    nowMs(),
    code,
  );
  return { ok: true };
}

export async function rejectAuthLink(env: WorkerEnv, code: string): Promise<void> {
  await run(env, "UPDATE auth_links SET status = 'rejected', updated_at = ? WHERE code = ? AND status = 'pending'", nowMs(), code);
}

/**
 * Выдать код браузеру один раз. Подтверждённый код сразу помечается использованным,
 * поэтому украденная ссылка не даст второй токен.
 */
export async function consumeAuthLink(env: WorkerEnv, code: string): Promise<AuthLinkRow | null> {
  const row = await readAuthLink(env, code);
  if (!row || row.status !== 'confirmed' || !row.user_id) return null;
  await run(env, "UPDATE auth_links SET status = 'used', updated_at = ? WHERE code = ? AND status = 'confirmed'", nowMs(), code);
  return row;
}
