import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEnv } from './types';
import {
  AUTH_LINK_TTL_MS,
  authCallbackData,
  authStartParam,
  confirmAuthLink,
  consumeAuthLink,
  createAuthLink,
  isAuthCode,
  parseAuthCallback,
  parseAuthStartParam,
  readAuthLink,
  rejectAuthLink,
  type AuthLinkRow,
} from './authLink';

/**
 * Мини-D1 на шесть запросов модуля привязки. Достаточно, чтобы проверить
 * машину состояний кода: pending, confirmed, used, rejected, expired.
 */
function fakeDb() {
  const rows = new Map<string, AuthLinkRow>();

  function statement(sql: string, values: unknown[]) {
    return {
      run: async () => {
        if (sql.startsWith('INSERT')) {
          const [code, status, guestId, createdAt, updatedAt] = values as string[];
          rows.set(code, {
            code,
            status: status as AuthLinkRow['status'],
            guest_id: guestId,
            user_id: null,
            first_name: '',
            username: null,
            tg_id: null,
            created_at: Number(createdAt),
            updated_at: Number(updatedAt),
          });
        } else if (sql.includes("SET status = 'expired'") && sql.includes('guest_id = ?')) {
          const [, guestId] = values as number[];
          for (const row of rows.values()) {
            if (row.guest_id === String(guestId) && row.status === 'pending') row.status = 'expired';
          }
        } else if (sql.includes("SET status = 'expired'")) {
          const code = values[values.length - 1] as string;
          const row = rows.get(code);
          if (row && row.status === 'pending') row.status = 'expired';
        } else if (sql.includes("SET status = 'confirmed'")) {
          const [userId, tgId, firstName, username, , code] = values as (string | number | null)[];
          const row = rows.get(String(code));
          if (row && row.status === 'pending') {
            row.status = 'confirmed';
            row.user_id = String(userId);
            row.tg_id = Number(tgId);
            row.first_name = String(firstName);
            row.username = username === null ? null : String(username);
          }
        } else if (sql.includes("SET status = 'rejected'")) {
          const row = rows.get(String(values[values.length - 1]));
          if (row && row.status === 'pending') row.status = 'rejected';
        } else if (sql.includes("SET status = 'used'")) {
          const row = rows.get(String(values[values.length - 1]));
          if (row && row.status === 'confirmed') row.status = 'used';
        }
        return { success: true };
      },
      first: async () => {
        const code = values[0] as string;
        const row = rows.get(code);
        return row ? { ...row } : null;
      },
      all: async () => ({ results: [...rows.values()].map((row) => ({ ...row })) }),
    };
  }

  return {
    rows,
    env: {
      DB: {
        prepare: (sql: string) => ({
          bind: (...values: unknown[]) => statement(sql, values),
          run: () => statement(sql, []).run(),
          first: () => statement(sql, []).first(),
          all: () => statement(sql, []).all(),
        }),
        batch: async () => [],
      },
    } as unknown as WorkerEnv,
  };
}

let clock = 1_700_000_000_000;

beforeEach(() => {
  clock = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('код привязки сайта к Telegram', () => {
  it('выдаёт код и гасит прежний запрос того же браузера', async () => {
    const { env, rows } = fakeDb();
    const first = await createAuthLink(env, 'a'.repeat(32));
    expect(isAuthCode(first.code)).toBe(true);
    const second = await createAuthLink(env, 'a'.repeat(32));
    expect(second.code).not.toBe(first.code);
    expect(rows.get(first.code)?.status).toBe('expired');
    expect(rows.get(second.code)?.status).toBe('pending');
  });

  it('не знает чужих кодов', async () => {
    const { env } = fakeDb();
    expect(await readAuthLink(env, 'zzzzzzzzzzzzzzzz')).toBeNull();
    expect(await confirmAuthLink(env, 'zzzzzzzzzzzzzzzz', { id: 1, firstName: 'X' })).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('подтверждает ровно один раз и только свежий запрос', async () => {
    const { env } = fakeDb();
    const { code } = await createAuthLink(env, 'b'.repeat(32));
    expect(await confirmAuthLink(env, code, { id: 4242, firstName: 'Игрок', username: 'player' })).toEqual({ ok: true });

    const row = await readAuthLink(env, code);
    expect(row?.status).toBe('confirmed');
    expect(row?.user_id).toBe('tg:4242');
    expect(row?.tg_id).toBe(4242);

    expect(await confirmAuthLink(env, code, { id: 99, firstName: 'Друг' })).toMatchObject({ ok: false, reason: 'already' });
    expect((await readAuthLink(env, code))?.user_id).toBe('tg:4242');
  });

  it('срок жизни пять минут', async () => {
    const { env } = fakeDb();
    const { code, expiresAt } = await createAuthLink(env, 'c'.repeat(32));
    expect(expiresAt - clock).toBe(AUTH_LINK_TTL_MS);
    clock += AUTH_LINK_TTL_MS + 1;
    expect((await readAuthLink(env, code))?.status).toBe('expired');
    expect(await confirmAuthLink(env, code, { id: 1, firstName: 'Игрок' })).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('отказ убивает запрос', async () => {
    const { env } = fakeDb();
    const { code } = await createAuthLink(env, 'd'.repeat(32));
    await rejectAuthLink(env, code);
    expect((await readAuthLink(env, code))?.status).toBe('rejected');
    expect(await confirmAuthLink(env, code, { id: 1, firstName: 'Игрок' })).toMatchObject({ ok: false, reason: 'rejected' });
  });

  it('токен выдаётся один раз', async () => {
    const { env } = fakeDb();
    const { code } = await createAuthLink(env, 'e'.repeat(32));
    expect(await consumeAuthLink(env, code)).toBeNull();
    await confirmAuthLink(env, code, { id: 7, firstName: 'Игрок' });
    const granted = await consumeAuthLink(env, code);
    expect(granted?.guest_id).toBe('e'.repeat(32));
    expect(granted?.user_id).toBe('tg:7');
    expect(await consumeAuthLink(env, code)).toBeNull();
    expect((await readAuthLink(env, code))?.status).toBe('used');
  });

  it('deep link и callback_data распознаются', () => {
    const code = 'abcdefghjkmnp234';
    expect(authStartParam(code)).toBe(`auth_${code}`);
    expect(parseAuthStartParam(`auth_${code}`)).toBe(code);
    expect(parseAuthStartParam('ref_abc123')).toBeNull();
    expect(parseAuthStartParam('auth_короткий')).toBeNull();
    expect(parseAuthCallback(authCallbackData('yes', code))).toEqual({ action: 'yes', code });
    expect(parseAuthCallback(authCallbackData('no', code))?.action).toBe('no');
    expect(parseAuthCallback(`auth:yes:${code}${code}`)).toBeNull();
    expect(parseAuthCallback('play:next:1')).toBeNull();
  });
});
