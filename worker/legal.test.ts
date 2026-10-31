import { afterEach, describe, expect, it, vi } from 'vitest';
import app from './app';
import {
  LEGAL_CHUNK_LIMIT,
  legalBlocks,
  legalChunks,
  legalDocument,
  paySupportText,
  supportText,
} from './legal';
import { BOT_COMMANDS, BOT_COMMANDS_EN, sendLegal } from './telegram';
import { LEGAL_CONTACT } from '../src/legal/content';
import type { WorkerEnv } from './types';

type Sent = { method: string; payload: Record<string, unknown> };

function capture(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      sent.push({ method: url.split('/').pop() ?? '', payload });
      return new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return sent;
}

const env = (partial: Partial<WorkerEnv> = {}): WorkerEnv =>
  ({
    DB: {} as WorkerEnv['DB'],
    ASSETS: {} as WorkerEnv['ASSETS'],
    BOT_TOKEN: '123:abc',
    WEBAPP_URL: 'https://pawn.test',
    ...partial,
  }) as WorkerEnv;

async function send(text: string, languageCode = 'ru'): Promise<Sent[]> {
  const sent = capture();
  const response = await app.fetch(
    new Request('https://pawn.test/api/telegram/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 1,
        message: { message_id: 1, chat: { id: 42 }, from: { id: 42, language_code: languageCode }, text },
      }),
    }),
    env({ WEBHOOK_SECRET: 'secret' }),
  );
  expect(response.status).toBe(200);
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('документы в чате бота', () => {
  it('укладывает документ в лимит Telegram, не разрывая разделы', () => {
    for (const kind of ['terms', 'privacy'] as const) {
      const doc = legalDocument(kind);
      const chunks = legalChunks(doc);
      // Документ заведомо длиннее одного сообщения: иначе тест ничего не проверяет.
      expect(chunks.length, kind).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length, `${kind}: ${chunk.slice(0, 40)}`).toBeLessThanOrEqual(LEGAL_CHUNK_LIMIT);
        expect(chunk.trim().length).toBeGreaterThan(0);
        // Незакрытый <b> означал бы, что разметку разрезали пополам.
        expect((chunk.match(/<b>/g) ?? []).length).toBe((chunk.match(/<\/b>/g) ?? []).length);
      }
      // Ни один заголовок раздела не теряется и не дублируется.
      const titles = doc.sections.map((section) => section.title);
      const joined = chunks.join('\n\n');
      for (const title of titles) {
        expect(joined.split(title).length - 1, `${kind}: ${title}`).toBe(1);
      }
    }
  });

  it('печатает блоки с заголовками и пунктами без потерь', () => {
    const doc = legalDocument('terms');
    const blocks = legalBlocks(doc);
    expect(blocks[0]).toContain('<b>');
    expect(blocks.length).toBe(doc.sections.length + 1);
    const items = blocks.reduce((sum, block) => sum + (block.match(/^— /gm) ?? []).length, 0);
    expect(items).toBe(doc.sections.reduce((sum, section) => sum + (section.items?.length ?? 0), 0));
  });

  it('обязательства продающего бота названы по-русски и по-английски', () => {
    const ru = paySupportText('ru');
    expect(ru).toContain('Возвращаем');
    expect(ru).toContain('Не возвращаем');
    expect(ru).toContain('/terms');
    const en = paySupportText('en');
    expect(en).toContain('We refund');
    expect(en).toContain('We do not refund');
    for (const text of [ru, en, supportText('ru'), supportText('en')]) {
      expect(text).toContain(LEGAL_CONTACT);
      expect(text.length).toBeLessThanOrEqual(4096);
    }
  });
});

describe('публичные страницы документов', () => {
  async function page(path: string): Promise<Response> {
    return app.fetch(new Request(`https://pawn.test${path}`), env());
  }

  it('отдаёт условия и политику HTML без сессии и без Telegram', async () => {
    for (const [path, kind] of [['/terms', 'terms'], ['/privacy', 'privacy']] as const) {
      const response = await page(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      const html = await response.text();
      const doc = legalDocument(kind);
      expect(html).toContain('<!doctype html>');
      expect(html).toContain(doc.title);
      expect(html).toContain(LEGAL_CONTACT);
      for (const section of doc.sections) {
        expect(html, `${path}: ${section.title}`).toContain(`<h2>${section.title}</h2>`);
      }
      // Ни одного куска клиентского бандла и ни одного тега, который Telegram
      // счёл бы попыткой встроиться: страница должна читаться как документ.
      expect(html).not.toContain('<script');
      expect(html).not.toContain('telegram-web-app');
    }
  });

  it('ссылается на приложение, когда адрес настроен', async () => {
    const html = await (await page('/terms')).text();
    expect(html).toContain('href="https://pawn.test/"');
    // Без https-адреса приложения ссылка не появляется: ссылаясь на http или на
    // пустоту, страница вела бы в никуда, а это ровно то, за что модерация
    // возвращает заявку.
    const bare = await app.fetch(new Request('http://localhost:8787/terms'), env({ WEBAPP_URL: '' }));
    expect(await bare.text()).not.toContain('открыть игру');
  });
});

describe('команды бота', () => {
  it('держит один состав в обеих языковых копиях', () => {
    expect(BOT_COMMANDS_EN.map((entry) => entry.command)).toEqual(BOT_COMMANDS.map((entry) => entry.command));
    // Без этих трёх Telegram не считает бота usable: start и help обязательны,
    // paysupport/support - обязанность продающего Stars бота.
    expect(BOT_COMMANDS.map((entry) => entry.command)).toEqual([
      'start',
      'play',
      'help',
      'terms',
      'privacy',
      'paysupport',
      'support',
    ]);
  });

  it('уложит команды в лимиты Bot API', () => {
    for (const entry of [...BOT_COMMANDS, ...BOT_COMMANDS_EN]) {
      expect(entry.command).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
      expect(entry.description.trim().length).toBeGreaterThan(0);
      expect(entry.description.length).toBeLessThanOrEqual(256);
    }
    expect(BOT_COMMANDS.length).toBeLessThanOrEqual(100);
    expect(new Set(BOT_COMMANDS.map((entry) => entry.command)).size).toBe(BOT_COMMANDS.length);
  });
});

describe('вебхук отвечает на команды', () => {
  it('отдаёт условия с кнопкой «открыть в игре»', async () => {
    const sent = await send('/terms');
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((entry) => entry.method === 'sendMessage')).toBe(true);
    expect(sent[0].payload.chat_id).toBe(42);
    const last = sent[sent.length - 1].payload;
    const keyboard = last.reply_markup as { inline_keyboard: Array<Array<{ web_app?: { url: string } }>> };
    expect(keyboard.inline_keyboard[0][0].web_app?.url).toBe('https://pawn.test/?startapp=terms');
  });

  it('разводит /privacy и /terms по ссылке', async () => {
    const sent = await send('/privacy');
    const keyboard = sent[sent.length - 1].payload.reply_markup as {
      inline_keyboard: Array<Array<{ web_app: { url: string } }>>;
    };
    expect(keyboard.inline_keyboard[0][0].web_app.url).toContain('startapp=privacy');
  });

  it('отвечает на /paysupport и /support, в том числе по-английски', async () => {
    const ru = await send('/paysupport');
    expect(String(ru[0].payload.text)).toContain('Возвращаем');
    const en = await send('/support', 'en');
    expect(String(en[0].payload.text)).toContain('Support');
    expect(String(en[0].payload.text)).toContain(LEGAL_CONTACT);
  });

  it('перечисляет в /help ровно те команды, что ставит в меню', async () => {
    const sent = await send('/help');
    const text = sent.map((entry) => String(entry.payload.text)).join('\n');
    for (const entry of BOT_COMMANDS) {
      expect(text, entry.command).toContain(`/${entry.command}`);
    }
  });

  it('без адреса приложения дописывает, что документ целиком уже прислан', async () => {
    const sent = capture();
    await sendLegal(env({ WEBAPP_URL: '' }), 7, 'privacy');
    const text = sent.map((entry) => String(entry.payload.text)).join('\n');
    expect(text).toContain('Это весь документ');
    expect(sent.some((entry) => entry.payload.reply_markup !== undefined)).toBe(false);
  });
});
