import { describe, expect, it } from 'vitest';
import app from './app';
import type { WorkerEnv } from './types';

function env(partial: Partial<WorkerEnv> = {}): WorkerEnv {
  const DB = {
    prepare: () => ({ first: async () => ({ ok: 1 }) }),
  } as unknown as WorkerEnv['DB'];
  return { DB, ASSETS: {} as WorkerEnv['ASSETS'], ...partial };
}

interface HealthBody {
  ok: boolean;
  warnings: string[];
  config: { botUsername: string; devMode: boolean };
}

async function health(partial: Partial<WorkerEnv>): Promise<HealthBody> {
  const response = await app.fetch(new Request('https://pawn.test/api/health'), env(partial));
  expect(response.status).toBe(200);
  return (await response.json()) as HealthBody;
}

describe('health', () => {
  it('перечисляет незаполненные настройки', async () => {
    const body = await health({});
    expect(body.ok).toBe(true);
    expect(body.warnings).toContain('bot_token_missing');
    expect(body.warnings).toContain('webhook_secret_missing');
    expect(body.warnings).toContain('admin_secret_missing');
    expect(body.warnings).toContain('adsgram_block_missing');
    expect(body.warnings).toContain('webapp_url_missing');
  });

  it('ругается на localhost в адресе приложения', async () => {
    const body = await health({ WEBAPP_URL: 'http://localhost:8787' });
    expect(body.warnings).toContain('webapp_url_not_https');
  });

  it('ругается на чужой домен', async () => {
    const body = await health({ WEBAPP_URL: 'https://other.example.com' });
    expect(body.warnings).toContain('webapp_url_origin_mismatch');
  });

  it('молчит, когда всё настроено', async () => {
    const body = await health({
      WEBAPP_URL: 'https://pawn.test',
      BOT_TOKEN: '123:abc',
      WEBHOOK_SECRET: 'secret',
      ADMIN_PASSWORD: 'pw',
      ADMIN_SECRET: 'secret',
      ADSGRAM_BLOCK_ID: '12345',
      DEV_MODE: 'false',
    });
    expect(body.warnings).toEqual([]);
    expect(body.config.botUsername).toBe('');
  });
});
