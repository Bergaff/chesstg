import { createMiddleware } from 'hono/factory';
import type { AppEnv, TelegramUser, WorkerEnv } from './types';
import { fail } from './http';
import { botToken } from './token';
import { verifySignedInitData } from './webAppKey';
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

/** Почему Telegram-данные не подошли. В ответе клиенту это русским текстом. */
export type InitDataReason =
  | 'no_params'
  | 'no_hash'
  | 'bad_signature'
  | 'no_auth_date'
  | 'too_old'
  | 'clock_skew'
  | 'no_user'
  | 'bad_user'
  | 'third_party';

export const INIT_DATA_MESSAGES: Record<InitDataReason, string> = {
  no_params: 'Не пришли подписанные данные Telegram: приложение открыто не из бота',
  no_hash: 'В данных Telegram нет подписи',
  bad_signature: 'Подпись данных Telegram не совпадает с BOT_TOKEN воркера',
  no_auth_date: 'В данных Telegram нет отметки времени',
  too_old: 'Данные Telegram устарели, это кэш недавних приложений',
  clock_skew: 'Часы устройства сильно расходятся с сервером',
  no_user: 'В данных Telegram нет профиля игрока',
  bad_user: 'Профиль в данных Telegram повреждён',
  third_party: 'Данные подписаны не этим ботом: приложение открыто через чужого бота',
};

export interface InitDataResult {
  check: InitDataCheck | null;
  reason: InitDataReason | null;
  ageSec: number | null;
  fields: string[];
  /** Схема склейки, по которой сошлась подпись. Нужна, чтобы видеть, что присылают клиенты. */
  variant: InitDataVariant | null;
}

type InitDataVariant =
  | 'canonical'
  | 'no_signature'
  | 'keep_empty'
  | 'no_signature_keep_empty'
  | 'signed';

interface VariantRule {
  name: InitDataVariant;
  dropSignature: boolean;
  dropEmpty: boolean;
}

/**
 * Документы Telegram говорят: в `data_check_string` идут все поля кроме `hash` и пустых значений.
 * На практике приложения, открытые по ссылке из канала, дополнительно приносят `signature`,
 * и разные клиенты Telegram считают подпись то с ним, то без него. Поэтому перебираем четыре
 * варианта и принимаем любой совпавший: подделать их без токена нельзя, а отказ игроку стоит
 * ровно «игра не открывается».
 */
const VARIANTS: VariantRule[] = [
  { name: 'canonical', dropSignature: false, dropEmpty: true },
  { name: 'no_signature', dropSignature: true, dropEmpty: true },
  { name: 'keep_empty', dropSignature: false, dropEmpty: false },
  { name: 'no_signature_keep_empty', dropSignature: true, dropEmpty: false },
];

function checkString(params: URLSearchParams, rule: VariantRule): string {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    if (rule.dropSignature && key === 'signature') continue;
    if (rule.dropEmpty && value === '') continue;
    entries.push([key, value]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries.map(([key, value]) => `${key}=${value}`).join('\n');
}

/** Проверка подписи Telegram WebApp initData. */
export async function validateInitData(
  initData: string,
  token: string,
  verifySigned?: (candidates: string[], signature: string) => Promise<boolean>,
): Promise<InitDataResult> {
  const empty: InitDataResult = { check: null, reason: null, ageSec: null, fields: [], variant: null };
  if (!token || !initData) return { ...empty, reason: 'no_params' };

  const params = new URLSearchParams(initData);
  const fields = [...new Set([...params.keys()])].sort();
  if (fields.length === 0) return { ...empty, reason: 'no_params' };

  const hash = params.get('hash');
  if (!hash) return { ...empty, fields, reason: 'no_hash' };
  const expected = hash.toLowerCase();

  const secretKey = await hmac(encoder.encode(token), 'WebAppData');
  let matched: VariantRule | null = null;
  for (const rule of VARIANTS) {
    const signature = toHex(await hmac(secretKey, checkString(params, rule)));
    if (safeEqual(signature, expected)) {
      matched = rule;
      break;
    }
  }
  if (!matched) {
    // У сторонних приложений `hash` это не HMAC по токену, а обычный SHA-256,
    // а подпись несёт поле `signature`. Так отличаем чужое приложение от опечатки в токене.
    const candidates = VARIANTS.slice(0, 2).map((rule) => checkString(params, rule));
    let thirdParty = false;
    for (const text of candidates) {
      const plain = toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
      if (plain === expected) {
        thirdParty = true;
        break;
      }
    }
    if (thirdParty && verifySigned) {
      const signature = params.get('signature') ?? '';
      if (signature && (await verifySigned(candidates, signature))) {
        matched = { name: 'signed', dropSignature: true, dropEmpty: true };
      }
    }
    if (!matched) return { ...empty, fields, reason: thirdParty ? 'third_party' : 'bad_signature' };
  }

  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw ? Number(authDateRaw) : 0;
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ...empty, fields, variant: matched.name, reason: 'no_auth_date' };
  }
  const ageSec = Math.round(Date.now() / 1000 - authDate);
  if (ageSec > 60 * 60 * 48) {
    return { ...empty, fields, ageSec, variant: matched.name, reason: 'too_old' };
  }
  if (ageSec < -300) {
    return { ...empty, fields, ageSec, variant: matched.name, reason: 'clock_skew' };
  }

  const rawUser = params.get('user');
  if (!rawUser) return { ...empty, fields, ageSec, variant: matched.name, reason: 'no_user' };
  try {
    const parsed = JSON.parse(rawUser) as Record<string, unknown>;
    const bad = (reason: InitDataReason) => ({ ...empty, fields, ageSec, variant: matched?.name ?? null, reason });
    if (typeof parsed.id !== 'number' || !Number.isFinite(parsed.id)) return bad('bad_user');
    if (typeof parsed.first_name !== 'string') return bad('bad_user');
    return {
      check: {
        user: {
          id: parsed.id,
          first_name: parsed.first_name.slice(0, 100),
          last_name: typeof parsed.last_name === 'string' ? parsed.last_name.slice(0, 100) : undefined,
          username: typeof parsed.username === 'string' ? parsed.username.slice(0, 64) : undefined,
          language_code: typeof parsed.language_code === 'string' ? parsed.language_code : undefined,
          is_premium: parsed.is_premium === true,
        },
        authDate,
      },
      reason: null,
      ageSec,
      fields,
      variant: matched.name,
    };
  } catch {
    return { ...empty, fields, ageSec, variant: matched.name, reason: 'bad_user' };
  }
}

const GUEST_ID_RE = /^[a-f0-9]{32}$/i;

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authorization = c.req.header('Authorization') ?? '';

  if (authorization.startsWith('tma ')) {
    const initData = authorization.slice(4).trim();
    const token = botToken(c.env);
    if (!token) {
      fail(503, 'auth_not_configured', 'Бот ещё не настроен: добавь BOT_TOKEN или открой демо');
    }
    if (c.env.AUTH_DEBUG === 'true') {
      // Временная диагностика для владельца бота: без значений поля `hash`
      // ничего лишнего в логи не уходит, а по строке видно, что прислал клиент.
      console.info('init_data_raw', initData.replace(/hash=[0-9a-f]{6}/gi, 'hash=XXXXXX').slice(0, 900));
    }
    const result = await validateInitData(initData, token, (candidates, signature) =>
      verifySignedInitData(c.env, candidates, signature),
    );
    if (!result.check) {
      const reason = result.reason ?? 'bad_signature';
      // Без этого в логах видно только факт отказа, а причины разные: кэш недавних
      // приложений, чужой токен, другой способ открыть приложение.
      console.warn(
        'init_data_rejected',
        reason,
        `age=${result.ageSec ?? '?'}`,
        `fields=${result.fields.join(',')}`,
      );
      fail(401, 'invalid_init_data', INIT_DATA_MESSAGES[reason], {
        reason,
        authDateAgeSec: result.ageSec,
      });
    }
    if (result.variant && result.variant !== 'canonical') {
      // Клиент подписал не то, что описано в документах. Работаем, но смотрим, кто так делает.
      console.info('init_data_variant', result.variant, `fields=${result.fields.join(',')}`);
    }
    const check = result.check;
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
