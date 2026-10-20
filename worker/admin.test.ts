import { describe, expect, it } from 'vitest';
import { adminConfigured, signAdminToken, verifyAdminToken } from './admin';
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
