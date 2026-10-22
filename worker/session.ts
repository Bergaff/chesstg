import { botToken } from './token';
import type { WorkerEnv } from './types';

/**
 * Вход через Telegram на сайте и подписанные сеансы.
 *
 * Mini App получает личность из initData, а у сайта в браузере её нет. Для сайта
 * есть виджет Telegram Login: Telegram отдаёт профиль вместе с подписью, мы её
 * проверяем и выдаём свой короткий токен сеанса. Дальше клиент приносит его в
 * заголовке Authorization, и прогресс игрока переживает перезапуск браузера и
 * смену устройства.
 */

const encoder = new TextEncoder();
const DAY_SEC = 24 * 60 * 60;
const SESSION_TTL_MS = 30 * DAY_SEC * 1000;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value: string): Uint8Array {
  const norm = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(norm);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export interface LoginUser {
  id: number;
  firstName: string;
  username: string;
  photoUrl: string;
  authDate: number;
}

export type LoginCheck = { ok: true; user: LoginUser } | { ok: false; reason: string };

/**
 * Проверка подписи виджета Telegram Login.
 *
 * Важно: у виджета ключ другой, чем у Mini App. Здесь secret_key это обычный
 * SHA-256 от токена, а не HMAC с константой WebAppData, поэтому функции не
 * взаимозаменяемы.
 */
export async function verifyLoginWidget(fields: Record<string, string>, token: string): Promise<LoginCheck> {
  const hash = (fields.hash ?? '').trim().toLowerCase();
  if (!hash) return { ok: false, reason: 'no_hash' };
  const id = Number(fields.id);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'no_user' };

  const dataCheckString = Object.keys(fields)
    .filter((key) => key !== 'hash' && key !== '')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');

  const secretKey = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
  const expected = toHex(await hmac(secretKey, dataCheckString));
  if (!safeEqual(expected, hash)) return { ok: false, reason: 'bad_signature' };

  const authDate = Number(fields.auth_date ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'no_auth_date' };
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec > DAY_SEC) return { ok: false, reason: 'too_old' };
  if (ageSec < -300) return { ok: false, reason: 'clock_skew' };

  return {
    ok: true,
    user: {
      id,
      firstName: (fields.first_name ?? '').slice(0, 64),
      username: (fields.username ?? '').slice(0, 64),
      photoUrl: fields.photo_url ?? '',
      authDate,
    },
  };
}

function sessionSecret(env: WorkerEnv): string {
  return env.SESSION_SECRET?.trim() || env.ADMIN_SECRET?.trim() || '';
}

/**
 * Может ли воркер подписывать сеансы: нужен секрет и токен бота, которым
 * проверяется подпись виджета.
 */
export function canSignSessions(env: WorkerEnv): boolean {
  return sessionSecret(env).length > 0 && Boolean(botToken(env));
}

/** Токен сеанса: `полезная нагрузка.подпись`, без внешнего JWT-стека. */
export async function signSession(env: WorkerEnv, userId: string): Promise<string> {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('session_secret_missing');
  const payload = b64url(encoder.encode(JSON.stringify({ u: userId, e: Date.now() + SESSION_TTL_MS })));
  const key = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret)));
  const signature = b64url(new Uint8Array(await hmac(key, payload)));
  return `${payload}.${signature}`;
}

/** Возвращает идентификатор пользователя, если токен подписан нами и не истёк. */
export async function readSession(env: WorkerEnv, token: string): Promise<string | null> {
  const secret = sessionSecret(env);
  if (!secret || !token.includes('.')) return null;
  const [payload, signature] = token.split('.', 2);
  if (!payload || !signature) return null;
  try {
    const key = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret)));
    const expected = b64url(new Uint8Array(await hmac(key, payload)));
    if (!safeEqual(expected, signature)) return null;
    const json = new TextDecoder().decode(b64urlDecode(payload));
    const parsed = JSON.parse(json) as { u?: unknown; e?: unknown };
    if (typeof parsed.u !== 'string' || !parsed.u || parsed.u.length > 80) return null;
    if (typeof parsed.e !== 'number' || parsed.e < Date.now()) return null;
    return parsed.u;
  } catch {
    return null;
  }
}
