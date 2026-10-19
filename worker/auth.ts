import { createMiddleware } from 'hono/factory';
import type { AppEnv, TelegramUser, WorkerEnv } from './types';
import { fail } from './http';
import { getOrCreateUser } from './db';

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface InitDataCheck {
  user: TelegramUser;
  authDate: number;
}

/** Проверка подписи Telegram WebApp initData. */
export async function validateInitData(initData: string, botToken: string): Promise<InitDataCheck | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  const entries: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash' || key === 'signature') continue;
    entries.push([key, value]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join('\n');

  const secret = await hmac(encoder.encode(botToken), 'WebAppData');
  const signature = toHex(await hmac(secret, dataCheckString));
  if (!safeEqual(signature, hash.toLowerCase())) return null;

  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw ? Number(authDateRaw) : 0;
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const age = Date.now() / 1000 - authDate;
  if (age > 60 * 60 * 48 || age < -300) return null;

  const rawUser = params.get('user');
  if (!rawUser) return null;
  try {
    const parsed = JSON.parse(rawUser) as Record<string, unknown>;
    if (typeof parsed.id !== 'number' || !Number.isFinite(parsed.id)) return null;
    if (typeof parsed.first_name !== 'string') return null;
    return {
      user: {
        id: parsed.id,
        first_name: parsed.first_name.slice(0, 100),
        last_name: typeof parsed.last_name === 'string' ? parsed.last_name.slice(0, 100) : undefined,
        username: typeof parsed.username === 'string' ? parsed.username.slice(0, 64) : undefined,
        language_code: typeof parsed.language_code === 'string' ? parsed.language_code : undefined,
        is_premium: parsed.is_premium === true,
      },
      authDate,
    };
  } catch {
    return null;
  }
}

const GUEST_ID_RE = /^[a-f0-9]{32}$/i;

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authorization = c.req.header('Authorization') ?? '';

  if (authorization.startsWith('tma ')) {
    const initData = authorization.slice(4).trim();
    const botToken = c.env.BOT_TOKEN?.trim();
    if (!botToken) {
      fail(503, 'auth_not_configured', 'Бот ещё не настроен: добавь BOT_TOKEN или открой демо');
    }
    const check = await validateInitData(initData, botToken);
    if (!check) {
      fail(401, 'invalid_init_data', 'Не удалось проверить данные Telegram');
    }
    const { user, created } = await getOrCreateUser(c.env, {
      id: `tg:${check.user.id}`,
      tgUser: check.user,
      isGuest: false,
    });
    c.set('auth', { user, kind: 'telegram', fresh: created, tgUser: check.user });
    await next();
    return;
  }

  const guestId = c.req.header('X-Guest-Id')?.trim() ?? '';
  if (guestId) {
    if (c.env.ALLOW_GUESTS !== 'true') {
      fail(401, 'guests_disabled', 'Гостевой режим выключен. Открой игру в Telegram.');
    }
    if (!GUEST_ID_RE.test(guestId)) fail(400, 'bad_guest_id', 'Некорректный гостевой идентификатор');
    const { user, created } = await getOrCreateUser(c.env, {
      id: `guest:${guestId.toLowerCase()}`,
      isGuest: true,
    });
    c.set('auth', { user, kind: 'guest', fresh: created });
    await next();
    return;
  }

  fail(401, 'unauthorized', 'Нужна авторизация Telegram');
});

/** Обновляет имя/username при заходе из Telegram. */
export async function syncTelegramName(env: WorkerEnv, auth: AppEnv['Variables']['auth']): Promise<void> {
  if (!auth.tgUser) return;
  const name = auth.tgUser.first_name.slice(0, 40);
  const username = auth.tgUser.username?.slice(0, 40) ?? null;
  if (name === auth.user.first_name && username === auth.user.username) return;
  await env.DB.prepare('UPDATE users SET first_name = ?, username = ?, updated_at = ? WHERE id = ?')
    .bind(name, username, Date.now(), auth.user.id)
    .run();
  auth.user = { ...auth.user, first_name: name, username };
}
