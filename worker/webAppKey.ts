import { botToken } from './token';
import type { WorkerEnv } from './types';

const API = 'https://api.telegram.org';
const TTL_MS = 6 * 60 * 60 * 1000;

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

/** base64 и base64url приходят от разных клиентов, приводим оба к одному виду. */
function fromB64(value: string): Uint8Array {
  const norm = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(norm), (char) => char.charCodeAt(0));
}

/** В логах и ответах не оставляем следов токена: Telegram URL содержит /bot<token>/. */
export function redact(text: string): string {
  return text.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot:token').slice(0, 200);
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
      cache = { at: Date.now(), key, status: { present: true, checkedAt: Date.now(), note: 'Telegram выдал ключ подписи' } };
      return;
    }
    // Ключ не выдан: помечаем причину, но не кешируем надолго, вдруг приложение перерегистрируют.
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

/** Ответ для админки: есть ли у приложения ключ подписи и почему нет. */
export async function webAppKeyStatus(env: WorkerEnv): Promise<WebAppKeyStatus> {
  await loadKey(env);
  return cache.status;
}

/**
 * Проверка подписи Ed25519 для приложений с авторизацией по ключу бота.
 * `hash` в таком initData это SHA-256 от строки склейки, а настоящая подпись в `signature`.
 */
export async function verifySignedInitData(
  env: WorkerEnv,
  candidates: string[],
  signature: string,
): Promise<boolean> {
  if (!signature) return false;
  await loadKey(env);
  const keyB64 = cache.key;
  if (!keyB64) {
    // Подпись клиент прислал, а проверять её нечем. Без этой строки случай
    // выглядит как «ключ неверный», хотя воркер вообще не получил ключ.
    console.warn('webapp_key_missing', cache.status.note);
    return false;
  }
  try {
    const key = await crypto.subtle.importKey('raw', fromB64(keyB64), { name: 'Ed25519' }, false, ['verify']);
    const bytes = fromB64(signature);
    // Клиенты подписывают либо саму строку склейки, либо её SHA-256, поэтому пробуем и то, и другое.
    for (const message of candidates) {
      const enc = new TextEncoder().encode(message);
      const digest = await crypto.subtle.digest('SHA-256', enc);
      if (await crypto.subtle.verify('Ed25519', key, bytes, enc)) return true;
      if (await crypto.subtle.verify('Ed25519', key, bytes, digest)) return true;
    }
  } catch (error) {
    console.warn('webapp_key_verify_failed', redact(String(error)));
  }
  return false;
}
