import { afterEach, describe, expect, it, vi } from 'vitest';
import { botLang, pick } from './i18n';
import { sendHelp, sendWelcome } from './telegram';
import type { WorkerEnv } from './types';

/**
 * Язык реплик бота проверяется на живом вызове: `language_code` обязан дойти от
 * сообщения до текста, иначе вся ветка превращается в украшение, которое никто не
 * вызывает.
 */

const env = { BOT_TOKEN: '123:abc', BOT_USERNAME: 'pawn_bot', WEBAPP_URL: 'https://app.example' } as WorkerEnv;

function lastPayload(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  return JSON.parse(String(call?.[1]?.body ?? '{}')) as Record<string, unknown>;
}

describe('язык бота', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('русский клиент - русский, всё остальное - английский', () => {
    expect(botLang('ru')).toBe('ru');
    expect(botLang('RU')).toBe('ru');
    expect(botLang('ru-RU')).toBe('ru');
    expect(botLang('en')).toBe('en');
    expect(botLang('it')).toBe('en');
    expect(botLang(undefined)).toBe('en');
    expect(pick('ru', 'Играть', 'Play')).toBe('Играть');
    expect(pick('en', 'Играть', 'Play')).toBe('Play');
  });

  it('приветствие на английском приходит без русской строки', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await sendWelcome(env, 7, 'Sam', undefined, 'en');
    const text = String(lastPayload().text);
    expect(text).toContain('Board Edge');
    expect(text).not.toMatch(/[А-Яа-я]/);
  });

  it('без языка по умолчанию бот говорит по-русски', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await sendHelp(env, 7);
    expect(String(lastPayload().text)).toContain('Как играть');
  });
});
