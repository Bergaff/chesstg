import { describe, expect, it } from 'vitest';
import handler, { enforceHttps } from './index';
import type { WorkerEnv } from './types';

const assets: Fetcher = {
  fetch: async () => new Response('ok', { status: 200 }),
} as unknown as Fetcher;

const env = { ASSETS: assets } as WorkerEnv;
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

/** Свойство cf в конструкторе Request недоступно, поэтому адрес клиента задаём заголовком. */
function requestFrom(url: string, ip: string | null, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  if (ip) headers.set('CF-Connecting-IP', ip);
  return new Request(url, { ...init, headers });
}

const CLIENT = '203.0.113.7';

describe('перенаправление на https', () => {
  it('для боевого хоста отвечает 308 и сохраняет путь', async () => {
    const response = await handler.fetch(
      requestFrom('http://chesstg.tgmg.workers.dev/admin?x=1', CLIENT),
      env,
      ctx,
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://chesstg.tgmg.workers.dev/admin?x=1');
  });

  it('POST на api уходит на https тем же методом', async () => {
    const response = await handler.fetch(
      requestFrom('http://chesstg.tgmg.workers.dev/api/session', CLIENT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
      ctx,
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://chesstg.tgmg.workers.dev/api/session');
  });

  it('не трогает https и локальный запуск', () => {
    const cases = [
      'https://chesstg.tgmg.workers.dev/api/health',
      'http://127.0.0.1:8787/api/health',
      'http://localhost:5173/',
      'http://demo.localhost:5173/admin',
      'http://[::1]:8787/api/health',
    ];
    for (const raw of cases) {
      expect(enforceHttps(new URL(raw), requestFrom(raw, CLIENT))).toBeNull();
    }
  });

  it('не редиректит, когда адрес клиента не виден', () => {
    const raw = 'http://chesstg.tgmg.workers.dev/';
    expect(enforceHttps(new URL(raw), requestFrom(raw, null))).toBeNull();
  });

  it('обычный запрос по https доходит до раздачи файлов', async () => {
    const response = await handler.fetch(requestFrom('https://chesstg.tgmg.workers.dev/', CLIENT), env, ctx);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });
});
