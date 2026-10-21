import { describe, expect, it } from 'vitest';
import app from './app';
import { adminConfigured, normalizeAppUrl, normalizeWebhookUrl, signAdminToken, verifyAdminToken } from './admin';
import type { WorkerEnv } from './types';

function env(partial: Partial<WorkerEnv> = {}): WorkerEnv {
  return { DB: {} as WorkerEnv['DB'], ASSETS: {} as WorkerEnv['ASSETS'], ...partial };
}

describe('токен админки', () => {
  const secret = 'test-secret-value';

  it('подписывает и проверяет токен', async () => {
    const { token, expiresAt } = await signAdminToken(secret);
    expect(token).toContain('.');
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(await verifyAdminToken(secret, token)).toBe(expiresAt);
  });

  it('не принимает чужую подпись', async () => {
    const { token } = await signAdminToken(secret);
    const [expires, signature] = token.split('.');
    const forged = `${expires}.${signature.slice(0, -2)}00`;
    expect(await verifyAdminToken(secret, forged)).toBeNull();
    expect(await verifyAdminToken('other-secret', token)).toBeNull();
    expect(await verifyAdminToken(secret, '')).toBeNull();
    expect(await verifyAdminToken(secret, 'мусор')).toBeNull();
  });

  it('не принимает истёкший токен', async () => {
    const now = Date.now();
    const { token } = await signAdminToken(secret, now, 1000);
    expect(await verifyAdminToken(secret, token, now + 500)).not.toBeNull();
    expect(await verifyAdminToken(secret, token, now + 2000)).toBeNull();
  });

  it('токен нельзя продлить подменой срока', async () => {
    const { token } = await signAdminToken(secret, Date.now(), 60_000);
    const signature = token.split('.')[1];
    const extended = `${Date.now() + 60 * 60 * 1000}.${signature}`;
    expect(await verifyAdminToken(secret, extended)).toBeNull();
  });
});

describe('настройка админки', () => {
  it('требует пароль и секрет', () => {
    expect(adminConfigured(env({}))).toBe(false);
    expect(adminConfigured(env({ ADMIN_PASSWORD: 'pw' }))).toBe(false);
    expect(adminConfigured(env({ ADMIN_SECRET: 's' }))).toBe(false);
    expect(adminConfigured(env({ ADMIN_PASSWORD: 'pw', ADMIN_SECRET: 's' }))).toBe(true);
    expect(adminConfigured(env({ ADMIN_PASSWORD_HASH: 'a'.repeat(64), ADMIN_SECRET: 's' }))).toBe(true);
    expect(adminConfigured(env({ ADMIN_PASSWORD: '   ', ADMIN_SECRET: 's' }))).toBe(false);
  });
});

describe('адрес бота', () => {
  it('приводит адрес приложения к https без слэша', () => {
    expect(normalizeAppUrl('https://pawn.workers.dev/')).toBe('https://pawn.workers.dev');
    expect(normalizeAppUrl(' https://pawn.workers.dev/game/ ')).toBe('https://pawn.workers.dev/game');
    expect(normalizeAppUrl('http://localhost:8787')).toBeNull();
    expect(normalizeAppUrl('pawn.workers.dev')).toBeNull();
    expect(normalizeAppUrl('')).toBeNull();
  });

  it('достраивает путь вебхука', () => {
    expect(normalizeWebhookUrl('https://pawn.workers.dev')).toBe(
      'https://pawn.workers.dev/api/telegram/webhook',
    );
    expect(normalizeWebhookUrl('https://pawn.workers.dev/')).toBe(
      'https://pawn.workers.dev/api/telegram/webhook',
    );
    expect(normalizeWebhookUrl('https://pawn.workers.dev/api/telegram/webhook')).toBe(
      'https://pawn.workers.dev/api/telegram/webhook',
    );
    expect(normalizeWebhookUrl('https://example.com/bot')).toBe('https://example.com/bot/api/telegram/webhook');
    expect(normalizeWebhookUrl('http://pawn.workers.dev')).toBeNull();
  });
});

async function call(path: string, init: RequestInit = {}, partial: Partial<WorkerEnv> = {}) {
  const base = env({ ADMIN_PASSWORD: 'pw', ADMIN_SECRET: 'secret', ...partial });
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  const { token } = await signAdminToken('secret');
  headers.set('Authorization', `Bearer ${token}`);
  return app.fetch(new Request(`https://pawn.test/api/admin${path}`, { ...init, headers }), base);
}

describe('роуты бота', () => {
  it('не пускает без токена админки', async () => {
    const response = await app.fetch(
      new Request('https://pawn.test/api/admin/bot'),
      env({ ADMIN_PASSWORD: 'pw', ADMIN_SECRET: 'secret' }),
    );
    expect(response.status).toBe(401);
  });

  it('просит добавить BOT_TOKEN', async () => {
    const response = await call('/bot/setup', { method: 'POST', body: '{}' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('bot_token_missing');
  });

  it('отклоняет незащищённый адрес', async () => {
    const response = await call(
      '/bot/setup',
      { method: 'POST', body: JSON.stringify({ appUrl: 'http://pawn.test' }) },
      { BOT_TOKEN: '123:abc' },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('bad_app_url');
  });

  it('отклоняет секрет с пробелами', async () => {
    const response = await call(
      '/bot/setup',
      { method: 'POST', body: JSON.stringify({ secret: 'плохой секрет' }) },
      { BOT_TOKEN: '123:abc' },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('bad_secret');
  });

  it('отдаёт состояние без токена бота', async () => {
    const response = await call('/bot');
    const data = (await response.json()) as { configured: boolean; expectedUrl: string };
    expect(response.status).toBe(200);
    expect(data.configured).toBe(false);
    expect(data.expectedUrl).toBe('https://pawn.test/api/telegram/webhook');
  });
});

describe('вход при неготовой базе', () => {
  it('пускает по паролю, даже если таблицы попыток ещё нет', async () => {
    const brokenDb = {
      prepare: () => {
        throw new Error('D1_ERROR: no such table: admin_attempts: SQLITE_ERROR');
      },
    } as unknown as WorkerEnv['DB'];

    const response = await app.fetch(
      new Request('https://pawn.test/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'pw' }),
      }),
      env({ ADMIN_PASSWORD: 'pw', ADMIN_SECRET: 'secret', DB: brokenDb }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { token?: string };
    expect(typeof data.token).toBe('string');
  });
});
