import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { WorkerEnv } from './types';
import { canSignSessions, readSession, signSession } from './session';

const env = { ADMIN_SECRET: 'secret-for-sessions-1234' } as unknown as WorkerEnv;

describe('сеанс сайта', () => {
  it('подписывает сеанс и читает его обратно', async () => {
    const token = await signSession(env, 'tg:4242');
    expect(await readSession(env, token)).toBe('tg:4242');
    expect(await readSession(env, `${token}x`)).toBeNull();
    expect(await readSession(env, 'abc')).toBeNull();
    expect(await readSession({ ADMIN_SECRET: 'another-secret-5678' } as unknown as WorkerEnv, token)).toBeNull();
  });

  it('не подписывает сеансы без секрета', () => {
    expect(canSignSessions({} as unknown as WorkerEnv)).toBe(false);
    expect(canSignSessions({ ADMIN_SECRET: 'a'.repeat(20), BOT_TOKEN: '1:2' } as unknown as WorkerEnv)).toBe(true);
  });

  it('случайный токен не превращается в пользователя', async () => {
    const forged = `${Buffer.from(JSON.stringify({ u: 'tg:1', e: Date.now() + 10000 })).toString('base64url')}.${randomBytes(
      8,
    ).toString('hex')}`;
    expect(await readSession(env, forged)).toBeNull();
  });
});
