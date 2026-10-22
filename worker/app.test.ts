import { describe, expect, it } from 'vitest';
import app from './app';
import { ADMIN_TABLES, AUTH_TABLES, GAME_TABLES } from './schema';
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

const full = [...GAME_TABLES, ...ADMIN_TABLES, ...AUTH_TABLES];
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
    expect(body.schemaVersion).toBe(4);
  });

  it('отличает недоступную базу от пустой', async () => {
    const { status, body } = await health({ throws: true });
    expect(status).toBe(503);
    expect(body.error).toBe('db_unavailable');
  });

  it('игра работает без таблицы привязки, но предупреждает', async () => {
    const { status, body } = await health({ tables: [...GAME_TABLES, ...ADMIN_TABLES] }, configured);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.warnings).toContain('auth_tables_missing');
    expect(body.tables?.auth_links).toBe(false);
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

interface StartProbe {
  status: number;
  body: { resumed?: boolean; run?: { level?: number; seed?: number } };
  seed: number | null;
  queries: string[];
}

/**
 * Старт забега через гостевой доступ:_fake_база запоминает, что именно
 * отправилось в `runs`, чтобы видно было выбранное зерно.
 */
async function startRun(body: Record<string, unknown>, storedSeed: number | null): Promise<StartProbe> {
  const queries: string[] = [];
  let inserted: unknown[] = [];
  const statement = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: async () => {
        if (sql.startsWith('SELECT * FROM users')) {
          const now = Date.now();
          return {
            id: 'guest:b2d66a3b522c33cca95fb5325813b4f4',
            tg_id: null,
            first_name: 'Гость',
            username: null,
            is_guest: 1,
            level: 12,
            max_level: 12,
            coins: 100,
            lives: 5,
            lives_at: now,
            endless_best: 0,
            endless_best_tier: 1,
            endless_best_moves: 0,
            ad_free: 0,
            skins: 'classic',
            skin: 'classic',
            inv_hint: 0,
            inv_freeze: 0,
            inv_undo: 0,
            invite_code: 'GUEST12',
            referred_by: null,
            created_at: now,
            updated_at: now,
          };
        }
        if (sql.startsWith('SELECT 1 FROM users WHERE invite_code')) return null;
        if (sql.startsWith('SELECT seed FROM runs')) return storedSeed === null ? null : { seed: storedSeed };
        if (sql.startsWith('SELECT * FROM runs WHERE id = ?')) {
          return {
            id: String(args[0]),
            user_id: inserted[1],
            mode: 'campaign',
            level: inserted[3],
            seed: inserted[4],
            initial_state: String(inserted[5] ?? '{}'),
            actions: '[]',
            moves: 0,
            score: 0,
            status: 'active',
            result: null,
            finish_id: null,
            created_at: 0,
            updated_at: 0,
            finished_at: null,
          };
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (sql.startsWith('INSERT INTO runs')) inserted = args;
        return { success: true, meta: { changes: 1, last_row_id: 1 } };
      },
      batch: async () => [],
    }),
  });
  const db = {
    prepare: (sql: string) => {
      queries.push(sql);
      return statement(sql);
    },
    batch: async () => [],
  } as unknown as WorkerEnv['DB'];

  const response = await app.fetch(
    new Request('https://pawn.test/api/run/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guest-id': 'b2d66a3b522c33cca95fb5325813b4f4' },
      body: JSON.stringify(body),
    }),
    env({}, { ...configured, ALLOW_GUESTS: 'true', DB: db }),
  );
  return {
    status: response.status,
    body: (await response.json()) as StartProbe['body'],
    seed: inserted.length ? Number(inserted[4]) : null,
    queries,
  };
}

describe('старт забега', () => {
  it('repeat берёт зерно последнего забега этого уровня', async () => {
    const probe = await startRun({ mode: 'campaign', repeat: true }, 4242);
    expect(probe.status).toBe(200);
    expect(probe.body.resumed).toBe(false);
    expect(probe.seed).toBe(4242);
    expect(probe.queries.some((sql) => sql.startsWith('SELECT seed FROM runs'))).toBe(true);
  });

  it('без repeat зерно новое, и прошлое не читается', async () => {
    const probe = await startRun({ mode: 'campaign' }, 4242);
    expect(probe.status).toBe(200);
    expect(probe.seed).not.toBe(4242);
    expect(probe.queries.some((sql) => sql.startsWith('SELECT seed FROM runs'))).toBe(false);
  });

  it('в бесконечном режиме повтор не имеет смысла и зерно не подглядывается', async () => {
    const probe = await startRun({ mode: 'endless', repeat: true }, 4242);
    expect(probe.status).toBe(200);
    expect(probe.queries.some((sql) => sql.startsWith('SELECT seed FROM runs'))).toBe(false);
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

describe('данные Telegram', () => {
  it('401 содержит причину отказа', async () => {
    const response = await app.fetch(
      new Request('https://pawn.test/api/session', {
        method: 'POST',
        headers: { Authorization: 'tma auth_date=1792560000&user=%7B%22id%22%3A1%2C%22first_name%22%3A%22A%22%7D&hash=deadbeef' },
        body: JSON.stringify({ startParam: '' }),
      }),
      env({}, { BOT_TOKEN: '1:abc' }),
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string; message: string; reason?: string };
    expect(body.error).toBe('invalid_init_data');
    expect(body.reason).toBe('bad_signature');
    expect(body.message).toContain('BOT_TOKEN');
  });

  it('без токена отвечает 503, а не 401', async () => {
    const response = await app.fetch(
      new Request('https://pawn.test/api/session', {
        method: 'POST',
        headers: { Authorization: 'tma hash=deadbeef' },
        body: JSON.stringify({}),
      }),
      env({}),
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toBe('auth_not_configured');
  });
});
