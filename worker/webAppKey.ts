import { botToken } from './token';
import type { WorkerEnv } from './types';

const API = 'https://api.telegram.org';
const TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Публичные ключи Ed25519 из документов Telegram. Формально они для сторонних
 * приложений, но держим их всегда: `getWebAppAttachInfo` ключ отдаёт не каждому
 * боту, а клиент подпись в `signature` присылает в любом случае.
 */
const TELEGRAM_PUBLIC_KEYS = {
  production: 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d',
  test: '40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec',
};

export interface WebAppKeyStatus {
  present: boolean;
  checkedAt: number;
  note: string;
}

let cache: { at: number; key: string; status: WebAppKeyStatus } = {
  at: 0,
  key: '',
  status: { present: false, checkedAt: 0, note: 'ключ ещё не запрашивали' },
};

/** В логах и ответах не оставляем следов токена: URL Telegram содержит /bot<token>/. */
export function redact(text: string): string {
  return text.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot:token').slice(0, 200);
}

function fromHex(value: string): Uint8Array {
  const hex = value.replace(/[^0-9a-fA-F]/g, '');
  return Uint8Array.from(hex.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? [], (b) => b);
}

/** base64 и base64url приходят от разных клиентов, паддинг Telegram не досылает. */
function fromB64(value: string): Uint8Array {
  const norm = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(norm), (char) => char.charCodeAt(0));
}

/** Публичный ключ приложения, Telegram отдаёт его в base64. Успех кешируем на 6 часов. */
async function loadKey(env: WorkerEnv): Promise<void> {
  if (cache.key && Date.now() - cache.at < TTL_MS) return;
  const token = botToken(env);
  if (!token) {
    cache.status = { present: false, checkedAt: Date.now(), note: 'BOT_TOKEN не задан' };
    return;
  }
  try {
    const response = await fetch(`${API}/bot${token}/getWebAppAttachInfo`, { method: 'POST' });
    const data = (await response.json()) as {
      ok: boolean;
      description?: string;
      result?: { public_key?: string };
    };
    const key = data.ok ? (data.result?.public_key ?? '') : '';
    if (key) {
      cache = {
        at: Date.now(),
        key,
        status: { present: true, checkedAt: Date.now(), note: 'Telegram выдал ключ подписи' },
      };
      return;
    }
    // Ключа нет: причину помечаем, но надолго не кешируем, приложение могут перерегистрировать.
    cache.status = {
      present: false,
      checkedAt: Date.now(),
      note: redact(`ключ не выдан, HTTP ${response.status} ${data.description ?? 'пустой public_key'}`),
    };
  } catch (error) {
    cache.status = {
      present: false,
      checkedAt: Date.now(),
      note: redact(`запрос ключа не прошёл: ${String(error)}`),
    };
    console.warn('webapp_key_fetch_failed', redact(String(error)));
  }
}

/** Ответ для админки: есть ли у приложения ключ подписи и почему его нет. */
export async function webAppKeyStatus(env: WorkerEnv): Promise<WebAppKeyStatus> {
  await loadKey(env);
  return cache.status;
}

/**
 * Проверка подписи Ed25519. Кандидатов передаёт вызывающий: строка склейки
 * зависит от того, какие поля клиент в неё положил, а `signature` может быть
 * поставлена как над самой строкой, так и над её SHA-256.
 */
export async function verifySignedInitData(
  env: WorkerEnv,
  candidates: string[],
  signature: string,
): Promise<boolean> {
  if (!signature) return false;
  await loadKey(env);
  const keys: Uint8Array[] = [];
  if (cache.key) keys.push(fromB64(cache.key));
  keys.push(fromHex(TELEGRAM_PUBLIC_KEYS.production), fromHex(TELEGRAM_PUBLIC_KEYS.test));
  try {
    const imported: CryptoKey[] = [];
    for (const raw of keys) {
      if (raw.length !== 32) continue;
      try {
        imported.push(await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']));
      } catch {
        /* ключ неподходящей длины или не Ed25519, пробуем следующий */
      }
    }
    if (imported.length === 0) {
      console.warn('webapp_key_invalid', `ключей ${keys.length}, пригодных нет`);
      return false;
    }
    const bytes = fromB64(signature);
    if (bytes.length !== 64) return false;
    for (const message of candidates) {
      const enc = new TextEncoder().encode(message);
      const digest = await crypto.subtle.digest('SHA-256', enc);
      for (const key of imported) {
        if (await crypto.subtle.verify('Ed25519', key, bytes, enc)) return true;
        if (await crypto.subtle.verify('Ed25519', key, bytes, digest)) return true;
      }
    }
  } catch (error) {
    console.warn('webapp_key_verify_failed', redact(String(error)));
  }
  return false;
}
