/**
 * Язык интерфейса.
 *
 * Решает Telegram: `language_code` из `initDataUnsafe.user` - язык клиента,
 * который игрок выбрал сам и который приехал вместе с initData. Всё, что не
 * `ru*`, получает английскую витрину: спрашивать игрока «какой язык», там где
 * Telegram уже его знает, значит строить лишний экран.
 *
 * Как устроено. Русская строка остаётся текстом в компоненте - она и есть ключ.
 * Перевод лежит рядом, в `i18n.en.ts`, и `tr()` подменяет текст, когда язык
 * английский. Словарь по исходному строке выбран не из лени: ключи вида
 * `t('menu.play')` однажды расходятся с экранами - подпись правят в
 * компоненте, ключ забывают, и в проде остаётся русский заголовок с английской
 * кнопкой. Здесь расхождение невозможно: непереведённая строка показывается
 * по-русски (плохо, но не сломано), а тест `i18n.test.ts` требует, чтобы все
 * строки интерфейса были в словаре.
 *
 * Числа в ключе живут как `{0}`. Это нужно дважды: шаблоны вида
 * `Уровень ${level}` превращаются в `trf('Уровень {0}', [level])`, а ответы
 * сервера приходят уже с цифрами («Не хватает монет: нужно 1200») - перед
 * поиском цифры сворачиваются в тот же `{0}`, и одна строка словаря закрывает
 * обе ситуации.
 *
 * Пробелы нормализуются: JSX собирает абзац из нескольких строк исходника в
 * один текст через одиночный пробел, и ключ, записанный переносами, никогда бы
 * не совпал с тем, что видит `tr` в рантайме.
 */

import { EN } from './i18n.en';

export type Lang = 'ru' | 'en';

export const LANG_STORAGE_KEY = 'chesstg.lang';
/** Заголовок, с которым клиент говорит серверу, на каком языке ему отвечать. */
export const LANG_HEADER = 'X-Lang';

/**
 * Язык решается один раз и лениво: первые вызовы случаются из рендера, а тестам
 * нужно успеть подготовить `localStorage` до первого перевода.
 */
let current: Lang | null = null;

function lang(): Lang {
  if (current === null) current = detectLang();
  return current;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Число целиком, вместе с разрядами: `4 770` - это одно число, а не два. */
const NUMBERS = /\d{1,3}[\u00a0\u202f ](?:\d{3}[\u00a0\u202f ])*\d{3}|\d+(?:[.,]\d+)?/g;

/**
 * Ключ без чисел и сами числа. Нужен для чужого текста: сообщения сервера
 * приходят уже с суммами («Не хватает 4 770 монет»), и искать их по точной
 * строке бессмысленно - сумма каждый раз другая.
 */
function splitNumbers(key: string): { pattern: string; numbers: string[] } | null {
  if (!NUMBERS.test(key)) {
    NUMBERS.lastIndex = 0;
    return null;
  }
  NUMBERS.lastIndex = 0;
  const numbers: string[] = [];
  const pattern = key.replace(NUMBERS, (value) => {
    numbers.push(value);
    return `{${numbers.length - 1}}`;
  });
  return { pattern, numbers };
}

function fill(text: string, args: unknown[]): string {
  return text.replace(/\{(\d+)\}/g, (whole, index: string) => {
    const value = args[Number(index)];
    // `null` значит «числа нет» (рекорда ещё нет): подставляем пустоту.
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/** Русский - родной язык копии: словарь для него не читается вовсе. */
export function tr(text: string): string {
  if (lang() === 'ru') return text;
  const key = normalize(text);
  const exact = EN[key];
  if (exact) return exact;
  const split = splitNumbers(key);
  if (!split) return text;
  const template = EN[split.pattern];
  return template ? fill(template, split.numbers) : text;
}

/**
 * Перевод с подстановкой: `{0}`, `{1}` по порядку аргументов. Собирать
 * английскую фразу из русских кусков послойно нельзя - порядок слов другой.
 */
export function trf(text: string, args: unknown[] = []): string {
  return fill(tr(text), args);
}

/** Одна из двух строк: для связок, где порядок слов не сходится совсем. */
export function either(en: string, ru: string): string {
  return lang() === 'en' ? en : ru;
}

export function getLang(): Lang {
  return lang();
}

export function isEnglish(): boolean {
  return lang() === 'en';
}

/** Тестам и отладке нужно сбросить решённый язык, не перезагружая модуль. */
export function resetLang(): void {
  current = null;
}

/** Язык Telegram-клиента: `ru`, `ru-RU` -> русский; всё остальное -> английский. */
export function langFromTelegram(languageCode: unknown): Lang {
  return typeof languageCode === 'string' && languageCode.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function langFromBrowser(): Lang {
  if (typeof navigator === 'undefined') return 'ru';
  const tags = [navigator.language, ...(navigator.languages ?? [])].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (tags.length === 0) return 'ru';
  return tags.some((tag) => tag.toLowerCase().startsWith('ru')) ? 'ru' : 'en';
}

/**
 * Порядок такой: явный `?lang=` (им удобно проверять сборку и кидать ссылку в
 * чат), затем сохранённый выбор, затем язык Telegram, затем язык браузера.
 */
export function detectLang(): Lang {
  const forced = readForced();
  if (forced) return forced;
  try {
    const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
    const code = tg?.initDataUnsafe?.user?.language_code;
    if (typeof code === 'string' && code) return langFromTelegram(code);
  } catch {
    /* WebApp без initData: встроенный просмотрщик, десктопная отладка */
  }
  return langFromBrowser();
}

function readForced(): Lang | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('lang');
    if (fromQuery === 'en' || fromQuery === 'ru') return fromQuery;
    const stored = window.localStorage?.getItem(LANG_STORAGE_KEY);
    if (stored === 'en' || stored === 'ru') return stored;
  } catch {
    /* приватный режим без localStorage */
  }
  return null;
}

/** Заголовок вкладки и `<html lang>`: их видит браузер, а не только приложение. */
const APP_TITLE: Record<Lang, string> = { ru: 'Край доски', en: 'Board Edge' };

/** Ставится один раз при старте; переключение языка = перезагрузка вкладки. */
export function initLang(): Lang {
  const value = detectLang();
  current = value;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value === 'en' ? 'en' : 'ru';
    // Статическая заглушка в index.html нарисована до React и по-русски: пока
    // вкладка не переименована, английский игрок читает русское имя игры.
    document.title = APP_TITLE[value];
    for (const node of document.querySelectorAll('.boot-static')) node.textContent = APP_TITLE[value];
  }
  return value;
}

export function setLang(value: Lang): void {
  current = value;
  try {
    window.localStorage?.setItem(LANG_STORAGE_KEY, value);
  } catch {
    /* хранение языка - не критично */
  }
}
