import { describe, expect, it } from 'vitest';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import type { WorkerEnv } from './types';
import { canSignSessions, readSession, signSession, verifyLoginWidget } from './session';

const TOKEN = '123456:TEST-token-for-login-widget';

/** Так же, как это делает Telegram: SHA-256 от токена как ключ, HMAC по строке данных. */
function sign(fields: Record<string, string>): string {
  const dataCheckString = Object.keys(fields)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secretKey = createHash('sha256').update(TOKEN).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

function payload(overrides: Record<string, string> = {}): Record<string, string> {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    first_name: 'Игрок',
    id: '4242',
    username: 'player',
    ...overrides,
  };
  fields.hash = sign(fields);
  return fields;
}

const env = { ADMIN_SECRET: 'secret-for-sessions-1234' } as unknown as WorkerEnv;

describe('вход через Telegram Login', () => {
  it('принимает профиль с верной подписью', async () => {
    const result = await verifyLoginWidget(payload(), TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(4242);
      expect(result.user.username).toBe('player');
    }
  });

  it('пустые значения не ломают строку данных', async () => {
    const fields = payload({ last_name: '' });
    // Пересобираем подпись уже с пустым полем: Telegram включает их в data_check_string.
    fields.hash = sign(fields);
    const result = await verifyLoginWidget(fields, TOKEN);
    expect(result.ok).toBe(true);
  });

  it('отклоняет изменённый профиль и чужой токен', async () => {
    const tampered = payload();
    tampered.id = '9999';
    expect((await verifyLoginWidget(tampered, TOKEN)).ok).toBe(false);
    expect((await verifyLoginWidget(payload(), `${TOKEN}x`)).ok).toBe(false);
    expect(await verifyLoginWidget({ id: '1' }, TOKEN)).toMatchObject({ ok: false, reason: 'no_hash' });
  });

  it('отклоняет слишком старый ответ', async () => {
    const result = await verifyLoginWidget(payload({ auth_date: String(Math.floor(Date.now() / 1000) - 90000) }), TOKEN);
    expect(result).toEqual({ ok: false, reason: 'too_old' });
  });

  it('подписывает сеанс и читает его обратно', async () => {
    const token = await signSession(env, 'tg:4242');
    expect(await readSession(env, token)).toBe('tg:4242');
    expect(await readSession(env, `${token}x`)).toBeNull();
    expect(await readSession(env, 'abc')).toBeNull();
    expect(await readSession({ ADMIN_SECRET: 'another-secret-5678' } as unknown as WorkerEnv, token)).toBeNull();
  });

  it('не подписывает сеансы без секрета', () => {
    expect(canSignSessions({} as unknown as WorkerEnv)).toBe(false);
    expect(canSignSessions({ ADMIN_SECRET: 'a'.repeat(20), BOT_TOKEN: TOKEN } as unknown as WorkerEnv)).toBe(true);
  });

  it('случайный токен не превращается в пользователя', async () => {
    const forged = `${Buffer.from(JSON.stringify({ u: 'tg:1', e: Date.now() + 10000 })).toString('base64url')}.${randomBytes(
      8,
    ).toString('hex')}`;
    expect(await readSession(env, forged)).toBeNull();
  });
});
