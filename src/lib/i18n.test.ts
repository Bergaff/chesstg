// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EN } from './i18n.en';
import {
  LANG_STORAGE_KEY,
  detectLang,
  either,
  initLang,
  isEnglish,
  langFromTelegram,
  resetLang,
  setLang,
  tr,
  trf,
} from './i18n';

/**
 * Тест держит две вещи: как язык выбирается и весь ли интерфейс переведён.
 * Второе важнее, чем кажется: словарь живой, строки в экранах правятся чаще,
 * чем в словаре, и без сверки английский клиент медленно сползает в русский -
 * по одной подписи за коммит, каждая из которых выглядит как норма.
 */

const UI_FILES = [
  'src/App.tsx',
  'src/lib/format.ts',
  'src/screens/MenuScreen.tsx',
  'src/screens/GameScreen.tsx',
  'src/screens/ShopScreen.tsx',
  'src/screens/RecordsScreen.tsx',
  'src/screens/JamScreen.tsx',
  'src/screens/LegalScreen.tsx',
  'src/components/Hud.tsx',
  'src/components/Modal.tsx',
  'src/components/Toast.tsx',
  'src/components/RulesModal.tsx',
  'src/components/NoLivesModal.tsx',
  'src/components/SkinStudio.tsx',
  'src/components/SkinPreview.tsx',
  'src/components/Board.tsx',
  'src/components/JamBoard.tsx',
  'src/components/TelegramLink.tsx',
  'src/components/ChallengeBanner.tsx',
  'src/components/DemoAd.tsx',
];

const CYRILLIC = '[\u0400-\u04FF]';
const KEYS = new RegExp(`trf?\\(\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'g');
const LITERALS = new RegExp(`'((?:[^'\\\\]|\\\\.)*)'`, 'g');

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Символы исходника в рантаймовые: `\n` в строке - это перевод строки, а JSX
 * склеивает его с соседним текстом в один пробел, поэтому и ключ словаря
 * обязан собираться после распаковки, иначе он никогда не совпадёт.
 */
function unescape(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

/** Ровно та же нормализация, что делает `tr`: переносы JSX не должны ломать ключ. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function uiKeys(): string[] {
  const found: string[] = [];
  for (const rel of UI_FILES) {
    const source = withoutComments(readFileSync(resolve(process.cwd(), rel), 'utf8'));
    for (const match of source.matchAll(KEYS)) {
      const key = normalize(unescape(match[1]));
      if (new RegExp(CYRILLIC).test(key)) found.push(key);
    }
  }
  return [...new Set(found)];
}

function legalKeys(): string[] {
  const source = withoutComments(readFileSync(resolve(process.cwd(), 'src/legal/content.ts'), 'utf8'));
  const found: string[] = [];
  for (const match of source.matchAll(LITERALS)) {
    const key = normalize(unescape(match[1]));
    // Контакт и дата уходят в текст как есть; таблица для бота пишется по-русски.
    if (new RegExp(CYRILLIC).test(key) && !key.startsWith('|') && !key.includes('@')) found.push(key);
  }
  return [...new Set(found)];
}

describe('выбор языка', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    resetLang();
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    resetLang();
  });

  it('русский клиент Telegram говорит по-русски, любой другой - по-английски', () => {
    expect(langFromTelegram('ru')).toBe('ru');
    expect(langFromTelegram('RU')).toBe('ru');
    expect(langFromTelegram('ru-RU')).toBe('ru');
    expect(langFromTelegram('en')).toBe('en');
    expect(langFromTelegram('de')).toBe('en');
    expect(langFromTelegram(undefined)).toBe('en');
  });

  it('явный ?lang= перекрывает и браузер, и сохранённый выбор', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    window.history.replaceState({}, '', '/?lang=ru');
    expect(detectLang()).toBe('ru');
    window.history.replaceState({}, '', '/');
    expect(detectLang()).toBe('en');
  });

  it('язык Telegram берётся из initData, если его не переопределили', () => {
    Object.defineProperty(window, 'Telegram', {
      value: { WebApp: { initDataUnsafe: { user: { language_code: 'ru' } } } },
      configurable: true,
    });
    expect(detectLang()).toBe('ru');
    Object.defineProperty(window, 'Telegram', {
      value: { WebApp: { initDataUnsafe: { user: { language_code: 'es' } } } },
      configurable: true,
    });
    expect(detectLang()).toBe('en');
    delete (window as unknown as { Telegram?: unknown }).Telegram;
  });

  it('без подсказки решает браузер, а сохранённый выбор перекрывает его', () => {
    // Тестовый браузер объявлен русским (tests/setup.lang.ts): его язык тут и есть «родной».
    expect(detectLang()).toBe('ru');
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    expect(detectLang()).toBe('en');
  });
});

describe('tr', () => {
  beforeEach(() => setLang('en'));
  afterEach(() => resetLang());

  it('на русском словарь не читается вовсе', () => {
    setLang('ru');
    expect(tr('Магазин')).toBe('Магазин');
    expect(trf('Уровень {0}', [7])).toBe('Уровень 7');
    expect(either('Shop', 'Магазин')).toBe('Магазин');
  });

  it('подменяет подпись и не трогает то, чего в словаре нет', () => {
    expect(tr('Магазин')).toBe(EN['Магазин']);
    expect(tr('Строка, которой в словаре нет')).toBe('Строка, которой в словаре нет');
    expect(either('Shop', 'Магазин')).toBe('Shop');
  });

  it('ключ собирается из нескольких строк исходника', () => {
    // JSX склеивает переносы в один пробел - `tr` обязан думать так же.
    expect(tr('  Мировая таблица   и друзья,\n  пришедшие по ссылке ')).toBe(
      EN['Мировая таблица и друзья, пришедшие по ссылке'],
    );
  });

  it('числа в чужом тексте подставляются в перевод', () => {
    expect(tr('Не хватает монет: нужно 1200')).toBe('Not enough coins: you need 1200');
    expect(tr('Не хватает монет: нужно 4 770')).toBe('Not enough coins: you need 4 770');
    expect(tr('Свою тему надеют за 80 звёзд или 4800 монет')).toBe(
      'Wearing a custom theme costs 80 stars or 4800 coins',
    );
  });

  it('trf раскладывает шаблон по аргументам', () => {
    expect(trf('Уровень {0}, {1}', [3, '12 cleared'])).toBe('Level 3, 12 cleared');
    expect(trf('Нет ключа: {0}', ['X'])).toBe('Нет ключа: X');
    expect(trf('Пустое место: {0}', [null])).toBe('Пустое место: ');
  });

  it('на русском шаблон остаётся русским', () => {
    setLang('ru');
    expect(trf('Уровень {0}, {1}', [3, 'пройдено 12'])).toBe('Уровень 3, пройдено 12');
  });
});

describe('initLang', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    resetLang();
    document.title = 'Край доски';
  });

  it('ставит язык и заголовок вкладки до первого рендера', () => {
    window.history.replaceState({}, '', '/?lang=en');
    expect(initLang()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Board Edge');
    window.history.replaceState({}, '', '/?lang=ru');
    expect(initLang()).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(document.title).toBe('Край доски');
  });
});

describe('полнота словаря', () => {
  it('каждая строка интерфейса переведена', () => {
    const missing = uiKeys().filter((key) => !EN[key]);
    expect(missing).toEqual([]);
  });

  it('каждый абзац юридического документа переведён', () => {
    const missing = legalKeys().filter((key) => !EN[key]);
    expect(missing).toEqual([]);
  });

  it('переведены подписи, которые приходят из движка', async () => {
    const { SKINS } = await import('../engine/skins');
    const { MODE_ORDER, modeDef } = await import('../engine/modes');
    const { BONUSES, PRODUCTS } = await import('../engine/balance');
    const { PIECE_NAME } = await import('../engine/board');
    const { JAM_PIECE_NAME } = await import('../engine/jam');
    const missing: string[] = [];
    for (const skin of Object.values(SKINS)) {
      if (!EN[skin.name]) missing.push(`skin ${skin.name}`);
      if (!EN[skin.description]) missing.push(`skin desc ${skin.name}`);
    }
    for (const mode of MODE_ORDER) {
      const def = modeDef(mode);
      if (!EN[def.name]) missing.push(`mode ${def.name}`);
      if (def.note && !EN[def.note]) missing.push(`mode note ${def.name}`);
    }
    for (const bonus of Object.values(BONUSES)) {
      if (!EN[bonus.name]) missing.push(`bonus ${bonus.name}`);
      if (bonus.description && !EN[bonus.description]) missing.push(`bonus desc ${bonus.name}`);
    }
    for (const product of Object.values(PRODUCTS)) {
      if (!EN[product.title]) missing.push(`product ${product.title}`);
    }
    for (const name of Object.values(PIECE_NAME)) {
      if (!EN[name]) missing.push(`piece ${name}`);
    }
    for (const name of Object.values(JAM_PIECE_NAME)) {
      // В a11y-подписи имя приводится к строчным: ключ словаря обязан совпадать.
      if (!EN[name.toLowerCase()]) missing.push(`jam piece ${name}`);
    }
    expect(missing).toEqual([]);
  });

  it('в переводе не осталось русских слов и потерянных placeholder-ов', () => {
    const cyrillic = new RegExp(CYRILLIC);
    const leftovers: string[] = [];
    for (const [key, value] of Object.entries(EN)) {
      if (cyrillic.test(value)) leftovers.push(`cyrillic in ${key}`);
      const wanted = new Set([...key.matchAll(/\{(\d+)\}/g)].map((m) => m[1]));
      const given = [...value.matchAll(/\{(\d+)\}/g)].map((m) => m[1]);
      for (const index of given) {
        if (wanted.size && !wanted.has(index)) leftovers.push(`placeholder {${index}} in ${key}`);
      }
      if (wanted.size && given.length < wanted.size && !key.startsWith('Не хватает монет')) {
        leftovers.push(`lost placeholder in ${key}`);
      }
    }
    expect(leftovers).toEqual([]);
  });
});
