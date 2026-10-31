import { describe, expect, it } from 'vitest';
import { appLink, botStartLink } from './telegram';
import type { WorkerEnv } from './types';

const env = (partial: Partial<WorkerEnv>): WorkerEnv =>
  ({ DB: {} as WorkerEnv['DB'], ASSETS: {} as WorkerEnv['ASSETS'], ...partial });

describe('ссылки в сообщениях бота', () => {
  it('собирает ссылку на мини-приложение', () => {
    expect(appLink(env({ WEBAPP_URL: 'https://pawn.workers.dev' }))).toBe('https://pawn.workers.dev/');
    expect(appLink(env({ WEBAPP_URL: 'https://pawn.workers.dev/' }), 'ref_abc')).toBe(
      'https://pawn.workers.dev/?startapp=ref_abc',
    );
  });

  it('не отдаёт http и пустой адрес', () => {
    expect(appLink(env({ WEBAPP_URL: 'http://localhost:8787' }), 'x')).toBe('');
    expect(appLink(env({}))).toBe('');
  });

  it('чистит параметр запуска', () => {
    expect(appLink(env({ WEBAPP_URL: 'https://pawn.workers.dev' }), 'a b/../c')).toBe(
      'https://pawn.workers.dev/?startapp=abc',
    );
  });

  it('строит ссылку на бота', () => {
    expect(botStartLink(env({ BOT_USERNAME: '@pawn_vs_all_bot' }), 'ch_3_3')).toBe(
      'https://t.me/pawn_vs_all_bot?startapp=ch_3_3',
    );
    expect(botStartLink(env({}))).toBeNull();
  });
});
