import { describe, expect, it } from 'vitest';
import app from './app';
import { ADMIN_TABLES, GAME_TABLES } from './schema';
import type { WorkerEnv } from './types';

interface DbOptions {
  tables?: readonly string[];
  throws?: boolean;
}

function fakeDb(options: DbOptions = {}): WorkerEnv['DB'] {
  const statement = {
    first: async () => ({ ok: 1 }),
    all: async () => ({ results: (options.tables ?? []).map((name) => ({ name })) }),
    run: async () => ({ success: true }),
    bind: () => statement,
  };
  return {
    prepare: () => {
      if (options.throws) throw new Error('D1_ERROR: no such table: users: SQLITE_ERROR');
      return statement;
    },
    batch: async () => [],
  } as unknown as WorkerEnv['DB'];
}

function env(options: DbOptions = {}, partial: Partial<WorkerEnv> = {}): WorkerEnv {
  return { DB: fakeDb(options), ASSETS: {} as WorkerEnv['ASSETS'], ...partial };
}

interface HealthBody {
  ok: boolean;
  error?: string;
  missing?: string[];
  warnings: string[];
  schemaVersion: number;
  tables?: Record<string, boolean>;
  config: { botUsername: string };
}

async function health(options: DbOptions, partial: Partial<WorkerEnv> = {}): Promise<{ status: number; body: HealthBody }> {
  const response = await app.fetch(new Request('https://pawn.test/api/health'), env(options, partial));
  return { status: response.status, body: (await response.json()) as HealthBody };
}

const full = [...GAME_TABLES, ...ADMIN_TABLES];
const configured: Partial<WorkerEnv> = {
  WEBAPP_URL: 'https://pawn.test',
  BOT_TOKEN: '123:abc',
  WEBHOOK_SECRET: 'secret',
  ADMIN_PASSWORD: 'pw',
  ADMIN_SECRET: 'secret',
  ADSGRAM_BLOCK_ID: '12345',
  DEV_MODE: 'false',
};

describe('health', () => {
  it('падает, когда база пустая', async () => {
    const { status, body } = await health({ tables: [] });
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('db_not_ready');
    expect(body.missing).toEqual([...GAME_TABLES]);
    expect(body.schemaVersion).toBe(2);
  });

  it('отличает недоступную базу от пустой', async () => {
    const { status, body } = await health({ throws: true });
    expect(status).toBe(503);
    expect(body.error).toBe('db_unavailable');
  });

  it('работает без таблиц админки, но предупреждает', async () => {
    const { status, body } = await health({ tables: GAME_TABLES }, configured);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.missing).toEqual([...ADMIN_TABLES]);
    expect(body.warnings).toContain('admin_tables_missing');
  });

  it('молчит, когда всё настроено', async () => {
    const { status, body } = await health({ tables: full }, configured);
    expect(status).toBe(200);
    expect(body.warnings).toEqual([]);
    expect(body.tables?.users).toBe(true);
  });

  it('перечисляет незаполненные настройки', async () => {
    const { body } = await health({ tables: full });
    expect(body.warnings).toContain('bot_token_missing');
    expect(body.warnings).toContain('webhook_secret_missing');
    expect(body.warnings).toContain('admin_secret_missing');
    expect(body.warnings).toContain('adsgram_block_missing');
    // Пустой WEBAPP_URL в бою не проблема: адрес берётся из заголовка Origin.
    expect(body.warnings).not.toContain('webapp_url_missing');
  });

  it('ругается на localhost в адресе приложения', async () => {
    const { body } = await health({ tables: full }, { WEBAPP_URL: 'http://localhost:8787' });
    expect(body.warnings).toContain('webapp_url_not_https');
  });

  it('ругается на чужой домен', async () => {
    const { body } = await health({ tables: full }, { WEBAPP_URL: 'https://other.example.com' });
    expect(body.warnings).toContain('webapp_url_origin_mismatch');
  });
});

describe('ошибки базы', () => {
  it('сессия отвечает 503 с понятным кодом, а не 500', async () => {
    const response = await app.fetch(
      new Request('https://pawn.test/api/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-guest-id': 'b2d66a3b522c33cca95fb5325813b4f4',
        },
        body: JSON.stringify({ startParam: '' }),
      }),
      env({ throws: true }, { ALLOW_GUESTS: 'true' }),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; hint?: string };
    expect(body.error).toBe('db_not_ready');
    expect(body.hint).toBe('npm run db:remote');
  });
});
