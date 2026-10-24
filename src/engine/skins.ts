/**
 * Темы поля.
 *
 * Тема - это не картинка, а восемь цветов и один глиф. Рендер берёт их из
 * CSS-переменных, которые Board вешает на доску, поэтому новая тема - это
 * запись в словаре, а не новый ассет и не правка стилей.
 *
 * Плата здесь за читаемость, а не за вкус. Поле тёмное, фигура светлая - и
 * «белая тема» на светлых клетках, и «чёрная» без плашки невидимы (1.2-1.3:1).
 * Поэтому тема обязана держать два контраста: глиф читается на своей подложке,
 * а подложка отделена от клетки либо заливкой, либо каймой. Проверка живёт в
 * `skinReadability`, её проходят и встроенные темы, и самодельные, и те, что
 * пришли из галереи: магазин не может продавать то, что не видно на доске.
 */

import { isSafePath } from './skinpath';

export type SkinId = 'classic' | 'graphite' | 'gold' | 'neon' | 'royal' | 'ash' | 'custom';

export const SKIN_ORDER: SkinId[] = ['classic', 'graphite', 'gold', 'neon', 'royal', 'ash'];

/** Тема, за которую просят звёзды. Только она и попадает в `ProductSku`. */
export type PaidSkinId = 'gold' | 'neon' | 'royal';

/** Темы, которые продаются поштучно. Набор открывает их все разом. */
export const PAID_SKINS: PaidSkinId[] = ['gold', 'neon', 'royal'];

/** Цена одной темы, звёзд. Набор дешевле трёх поштучно ровно на четверть. */
export const SKIN_STARS = 20;
export const SKIN_SET_STARS = 50;

/** «Пепел» не продаётся: его выигрывают, пережив сто ходов в «Гонках». */
export const ASH_RECORD_MOVES = 100;

/**
 * Витрина сезона: одна из платных тем открыта всем на текущий квартал.
 * Скинутая в магазин тема без витрины продаётся один раз тому, кто её уже
 * хотел; витрина же возвращает игрока в магазин после смены сезона.
 */
export const SHOWCASE_ROTATION: PaidSkinId[] = ['gold', 'neon', 'royal'];

export interface SkinTokens {
  /** Фигура игрока. */
  piece: string;
  /** Плашка под фигурой. Пустая строка - фигура стоит прямо на клетке. */
  plate: string;
  /** Кайма плашки, рамки поля и отметок хода. */
  edge: string;
  cellLight: string;
  cellDark: string;
  /** Поле вокруг доски. */
  frame: string;
  /** Фон экрана за доской. */
  backdrop: string;
  /** Подложка клетки, в которую можно ходить, и финишный ряд. */
  wash: string;
  /** Глиф пешки: тема обязана быть узнаваемой на клетке в 36 пикселей. */
  glyph: string;
  /** Контур своей фигуры, если игрок нарисовал его вместо глифа. */
  path?: string;
}

export interface SkinDef extends SkinTokens {
  id: SkinId;
  name: string;
  description: string;
  /** 0 - бесплатно и навсегда. */
  stars: number;
  /** Выдаётся за достижение, а не покупается. */
  reward?: boolean;
}

/** Глифы, из которых можно собрать свою тему: всё остальное на 36 пикселях сливается. */
export const GLYPH_CHOICES = ['♟', '♙', '⛟', '♜', '♞', '⚘', '✜', '❖', '◈', '●'] as const;

export const SKINS: Record<SkinId, SkinDef> = {
  classic: {
    id: 'classic',
    name: 'Латунь',
    description: 'Латунная фигура на костяной плашке - как выглядит сейчас',
    stars: 0,
    piece: '#e8c274',
    plate: '#241f12',
    edge: '#c6a45e',
    cellLight: '#292619',
    cellDark: '#201e16',
    frame: '#12110b',
    backdrop: '#17160f',
    wash: '#2a2517',
    glyph: '♟',
  },
  graphite: {
    id: 'graphite',
    name: 'Графит',
    description: 'Белая доска наоборот: светлая плашка, тёмная фигура',
    stars: 0,
    piece: '#17160f',
    plate: '#ded4bd',
    edge: '#a69e8c',
    cellLight: '#2b2820',
    cellDark: '#22201a',
    frame: '#16150f',
    backdrop: '#1b1a14',
    wash: '#c9bfa6',
    glyph: '♟',
  },
  gold: {
    id: 'gold',
    name: 'Черно-золотой',
    description: 'Латунь по чернёной стали, золотой край поля',
    stars: SKIN_STARS,
    piece: '#e8c274',
    plate: '#121109',
    edge: '#c6a45e',
    cellLight: '#221b0b',
    cellDark: '#171305',
    frame: '#2a2210',
    backdrop: '#100d07',
    wash: '#3a2e14',
    glyph: '♟',
  },
  neon: {
    id: 'neon',
    name: 'Полночь',
    description: 'Холодный синий металл на почти чёрном',
    stars: SKIN_STARS,
    piece: '#bfe3ea',
    plate: '#0b1416',
    edge: '#4c8a93',
    cellLight: '#101d21',
    cellDark: '#0b1417',
    frame: '#0d1a1e',
    backdrop: '#081014',
    wash: '#17323a',
    glyph: '♟',
  },
  royal: {
    id: 'royal',
    name: 'Корона',
    description: 'Пергамент, лилия и чернильная плашка',
    stars: SKIN_STARS,
    piece: '#2a1c3f',
    plate: '#e7dcc0',
    edge: '#8a6cb0',
    cellLight: '#efe6cf',
    cellDark: '#ddd0b4',
    frame: '#f6efdd',
    backdrop: '#e4d9bd',
    wash: '#cbb2e6',
    glyph: '⚜',
  },
  ash: {
    id: 'ash',
    name: 'Пепел',
    description: 'Дымчатая фигура: знак того, что выжил сто ходов в «Гонках»',
    stars: 0,
    reward: true,
    piece: '#e0dedb',
    plate: '#2b2b2e',
    edge: '#77757f',
    cellLight: '#232326',
    cellDark: '#1c1c1f',
    frame: '#191919',
    backdrop: '#131315',
    wash: '#3a3a41',
    glyph: '♟',
  },
  custom: {
    id: 'custom',
    name: 'Своя тема',
    description: 'Цвета и фигура, которые вы собрали сами',
    stars: 0,
    piece: '#ded4bd',
    plate: '',
    edge: '#c6a45e',
    cellLight: '#292619',
    cellDark: '#201e16',
    frame: '#12110b',
    backdrop: '#17160f',
    wash: '#2a2517',
    glyph: '♟',
  },
};

export const TOKEN_KEYS = [
  'piece',
  'plate',
  'edge',
  'cellLight',
  'cellDark',
  'frame',
  'backdrop',
  'wash',
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];

export const TOKEN_LABELS: Record<TokenKey, string> = {
  piece: 'Фигура',
  plate: 'Плашка фигуры',
  edge: 'Кайма и рамки',
  cellLight: 'Светлая клетка',
  cellDark: 'Тёмная клетка',
  frame: 'Поле вокруг доски',
  backdrop: 'Задний фон',
  wash: 'Клетка хода',
};

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string' && value in SKINS;
}

export function skinById(value: unknown): SkinDef | null {
  return isSkinId(value) ? SKINS[value] : null;
}

/** Все цвета темы, кроме глифа и контура: то, что красит доску. */
export function skinTokens(skin: SkinTokens): Record<TokenKey, string> {
  const out = {} as Record<TokenKey, string>;
  for (const key of TOKEN_KEYS) out[key] = skin[key] ?? '';
  return out;
}

/**
 * Тема открыта, если она куплена, бесплатна, является текущей самодельной или
 * стоит на витрине этого сезона.
 */
export function skinUnlocked(
  id: SkinId,
  owned: readonly SkinId[],
  now: number = Date.now(),
  hasCustom = false,
): boolean {
  if (id === 'custom') return hasCustom;
  // Награда не покупается и не выдаётся витриной: её нужно заработать, и
  // «бесплатная по цене» для неё не аргумент.
  if (SKINS[id].reward) return owned.includes(id);
  if (SKINS[id].stars <= 0) return true;
  if (owned.includes(id)) return true;
  return showcaseSkin(now) === id;
}

/** Тема текущего квартала: ротация по номеру квартала, а не по случайному зерну. */
export function showcaseSkin(now: number = Date.now()): PaidSkinId {
  const date = new Date(now);
  const quarter = Math.floor(date.getUTCMonth() / 3) + (date.getUTCFullYear() % 8) * 4;
  return SHOWCASE_ROTATION[quarter % SHOWCASE_ROTATION.length];
}

/** Как подписать витрину, чтобы игрок понял, что срок ограничен. */
/**
 * Сколько тема остаётся открытой для всех. Отдельная строка потому, что магазин
 * вставляет её в середину предложения, а не показывает как заголовок.
 */
export function showcaseRemaining(now: number = Date.now()): string {
  const ends = showcaseEndsAt(now);
  const days = Math.max(1, Math.ceil((ends - now) / 86_400_000));
  return `в витрине до конца сезона, ещё ${days} дн.`;
}

export function showcaseEndsAt(now: number = Date.now()): number {
  const date = new Date(now);
  const lastMonth = 3 * (Math.floor(date.getUTCMonth() / 3) + 1) - 1;
  return Date.UTC(date.getUTCFullYear(), lastMonth + 1, 0, 23, 59, 59);
}

/**
 * Переменные темы. Доска и экран красятся одним объектом: CSS читает их с
 * фолбэком на обычные цвета, поэтому сломанная или отсутствующая тема означает
 * «Кость», а не серый прямоугольник.
 */
export function skinVars(skin: SkinTokens): Record<string, string> {
  return {
    '--skin-piece': skin.piece,
    '--skin-plate': skin.plate || 'transparent',
    '--skin-edge': skin.edge,
    '--skin-cell-light': skin.cellLight,
    '--skin-cell-dark': skin.cellDark,
    '--skin-frame': skin.frame,
    '--skin-backdrop': skin.backdrop,
    '--skin-wash': skin.wash,
  };
}

// ─────────────────────────── Контраст ───────────────────────────

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** #abc и #aabbcc в три числа; всё остальное - null, чтобы не притворяться цветом. */
export function parseHex(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!HEX.test(text)) return null;
  const body = text.slice(1);
  const hex = body.length === 3 ? body[0] + body[0] + body[1] + body[1] + body[2] + body[2] : body;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function luminance(hex: string): number | null {
  const parts = parseHex(hex);
  if (!parts) return null;
  const [r, g, b] = parts;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Контраст по формуле WCAG. Возвращает null для мусора, а не 1: тема с
 * неполным цветом не должна проходить проверку «вот, типа 1 к 1».
 */
export function contrastRatio(a: string, b: string): number | null {
  const one = luminance(a);
  const two = luminance(b);
  if (one === null || two === null) return null;
  const [high, low] = one >= two ? [one, two] : [two, one];
  return (high + 0.05) / (low + 0.05);
}

/** Глиф обязан читаться на подложке, а подложка - отделяться от клетки. */
export const MIN_GLYPH_CONTRAST = 4.5;
export const MIN_BOARD_CONTRAST = 2;

/** Для проверки читаемости нужны только пять цветов доски: глиф и фон не в счёт. */
export type ReadabilityInput = Pick<SkinTokens, 'piece' | 'plate' | 'edge' | 'cellLight' | 'cellDark'>;

export interface Readability {
  /** Фигура против того, на чём стоит. */
  glyph: number;
  /** Подложка (или сама фигура, если подложки нет) против клеток. */
  board: number;
  ok: boolean;
  why: string;
}

export function skinReadability(skin: ReadabilityInput): Readability {
  const bad = 'цвет задан некорректно';
  const cells = [skin.cellLight, skin.cellDark];
  const plate = skin.plate.trim();
  const base = plate
    ? contrastRatio(skin.piece, plate)
    : Math.min(...cells.map((cell) => contrastRatio(skin.piece, cell) ?? 0));
  if (base === null || Number.isNaN(base)) return { glyph: 0, board: 0, ok: false, why: bad };
  let board = base;
  if (plate) {
    const separations = [
      ...cells.map((cell) => contrastRatio(plate, cell)),
      ...cells.map((cell) => contrastRatio(skin.edge, cell)),
    ].filter((value): value is number => value !== null);
    board = separations.length ? Math.max(...separations) : 0;
  }
  const ok = base >= MIN_GLYPH_CONTRAST && board >= MIN_BOARD_CONTRAST;
  const why = !ok
    ? base < MIN_GLYPH_CONTRAST
      ? `фигура сливается с подложкой: ${base.toFixed(1)}:1 вместо ${MIN_GLYPH_CONTRAST}:1`
      : `плашка не отделена от клетки: ${board.toFixed(1)}:1 вместо ${MIN_BOARD_CONTRAST}:1`
    : '';
  return { glyph: Number(base.toFixed(2)), board: Number(board.toFixed(2)), ok, why };
}

// ──────────────────────── Проверка самодельной ────────────────────────

export interface CustomSkin {
  name: string;
  tokens: Record<TokenKey, string>;
  glyph: string;
  path?: string;
  /** Кого указать автором, если тема установлена из галереи. */
  sharedBy?: string | null;
}

export interface SkinCheck {
  ok: boolean;
  skin: CustomSkin;
  readability: Readability;
  error?: string;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_NAME = 24;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim());
}

/**
 * Приводит присланную тему к безопасному виду: только шесть известных ключей,
 * только hex, один символ глифа, путь из литералов SVG. Ничего из этого не
 * попадает в DOM как разметка - контур рисуется одним `<path d>`, поэтому
 * чужой скин не может принести ни скрипт, ни ссылку на чужой хост.
 */
export function checkSkin(raw: unknown): SkinCheck {
  const fallback = skinReadability(SKINS.classic);
  if (!raw || typeof raw !== 'object') {
    return { ok: false, skin: emptySkin(), readability: fallback, error: 'тема не задана' };
  }
  const input = raw as Record<string, unknown>;
  const source = (input.tokens && typeof input.tokens === 'object' ? input.tokens : input) as Record<
    string,
    unknown
  >;
  const tokens = {} as Record<TokenKey, string>;
  for (const key of TOKEN_KEYS) {
    const value = source[key];
    if (key === 'plate') {
      tokens[key] = isHexColor(value) ? String(value).trim().toLowerCase() : '';
      continue;
    }
    if (!isHexColor(value)) {
      return {
        ok: false,
        skin: emptySkin(),
        readability: fallback,
        error: `${TOKEN_LABELS[key]}: нужен цвет вида #rrggbb`,
      };
    }
    tokens[key] = String(value).trim().toLowerCase();
  }
  const name = cleanName(input.name);
  const glyph = typeof input.glyph === 'string' && input.glyph.trim() ? [...input.glyph.trim()][0] : SKINS.classic.glyph;
  // Контур проверяет тот же страж, что и студия: два правила на один формат
  // всегда расходятся, и первым умирает клиент.
  const path = isSafePath(input.path) ? String(input.path).trim() : undefined;
  const skin: CustomSkin = {
    name,
    tokens,
    glyph: GLYPH_CHOICES.includes(glyph as (typeof GLYPH_CHOICES)[number]) ? glyph : SKINS.classic.glyph,
    ...(path ? { path } : {}),
    sharedBy: typeof input.sharedBy === 'string' ? cleanName(input.sharedBy) : null,
  };
  const readability = skinReadability(tokens);
  if (!readability.ok) {
    return { ok: false, skin, readability, error: `тему не видно на доске: ${readability.why}` };
  }
  return { ok: true, skin, readability };
}

export const MAX_SKIN_JSON = 12_000;

function cleanName(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  // Управляющие символы и переводы строк в имени испортят и подпись, и JSON.
  const trimmed = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_NAME);
  return trimmed || 'Своя тема';
}

function emptySkin(): CustomSkin {
  return { name: 'Своя тема', tokens: skinTokens(SKINS.classic), glyph: SKINS.classic.glyph };
}

// ─────────────────────────── Код темы ───────────────────────────

const CODE_PREFIX = 'kd1:';

/**
 * Тема, которую можно пересказать текстом: скопировал, переслал другу, вставил.
 * Это бесплатный способ поделиться - без очереди на проверку, без звёзд и без
 * витрины. Публичная галерея за это и не отвечает: там тема увидят чужие.
 */
export function encodeSkinCode(skin: CustomSkin): string {
  const payload: Record<string, unknown> = { n: skin.name, g: skin.glyph, t: skin.tokens };
  if (skin.path) payload.p = skin.path;
  return CODE_PREFIX + toBase64(JSON.stringify(payload));
}

export function decodeSkinCode(code: string): CustomSkin | null {
  const text = code.trim();
  if (!text.startsWith(CODE_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64(text.slice(CODE_PREFIX.length)));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed as Record<string, unknown>;
  const merged = {
    name: raw.n,
    glyph: raw.g,
    tokens: raw.t,
    path: raw.p,
  };
  const check = checkSkin(merged);
  return check.ok ? check.skin : null;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    out += b === undefined ? '' : ALPHABET[(triple >> 6) & 63];
    out += c === undefined ? '' : ALPHABET[triple & 63];
  }
  return out;
}

function fromBase64(text: string): string {
  const lookup = new Map(ALPHABET.split('').map((char, index) => [char, index]));
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = lookup.get(char);
    if (value === undefined) throw new Error('bad base64');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// ─────────────────────────── Разрешение темы ───────────────────────────

export interface ResolvedSkin extends SkinTokens {
  id: SkinId;
  name: string;
  /** Тема собрана игроком (или взята из галереи), а не лежит в словаре. */
  custom: boolean;
}

/**
 * Что реально надеть на доску. Если выбран самодельный слот, а его нет,
 * возвращаем «Кость» - профиль мог прийти из старой сборки, где слота не было.
 */
export function resolveSkin(id: unknown, custom: CustomSkin | null): ResolvedSkin {
  if (id === 'custom') {
    if (!custom) return { ...skinTokens(SKINS.classic), glyph: SKINS.classic.glyph, id: 'classic', name: SKINS.classic.name, custom: false };
    return {
      ...custom.tokens,
      glyph: custom.glyph,
      path: custom.path,
      id: 'custom',
      name: custom.name,
      custom: true,
    };
  }
  const def = skinById(id) ?? SKINS.classic;
  return { ...skinTokens(def), glyph: def.glyph, id: def.id, name: def.name, custom: false };
}
