import { botToken } from './token';
import type { WorkerEnv } from './types';

const API = 'https://api.telegram.org';
const TTL_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; key: string } = { at: 0, key: '' };

function fromB64(value: string): Uint8Array {
  const norm = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(norm), (char) => char.charCodeAt(0));
}

/** Публичный ключ приложения, Telegram отдаёт его в base64. Кешируем на 6 часов. */
async function publicKey(env: WorkerEnv): Promise<string> {
  if (cache.key && Date.now() - cache.at < TTL_MS) return cache.key;
  const token = botToken(env);
  if (!token) return '';
  try {
    const response = await fetch(`${API}/bot${token}/getWebAppAttachInfo`, { method: 'POST' });
    const data = (await response.json()) as { ok: boolean; result?: { public_key?: string } };
    const key = data.ok ? (data.result?.public_key ?? '') : '';
    if (key) cache = { at: Date.now(), key };
    return key;
  } catch (error) {
    console.warn('webapp_key_fetch_failed', String(error).slice(0, 160));
    return '';
  }
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
  const keyB64 = await publicKey(env);
  if (!keyB64) return false;
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
    console.warn('webapp_key_verify_failed', String(error).slice(0, 160));
  }
  return false;
}
