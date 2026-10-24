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

// ─────────────────────── Тема интерфейса ───────────────────────

/**
 * Тема красит не только доску: игроку непонятно, что «Черно-золотой» работает,
 * только пока идёт партия, - меню, магазин и рекорды выглядят сломанными или
 * чужими. Отдельные цвета интерфейса из темы не берутся: их слишком много, и
 * никто не гарантирует, что «лазурная» подложка примет латунную подпись.
 * Палитра экрана выводится из восьми токенов темы теми же смешениями, какими
 * «Латунь» собрана руками: на дефолтной теме цифры расходятся с исходными на
 * единицы, поэтому привычный экран не «уезжает», а светлая «Корона» получает
 * чернила наоборот - иначе костяной текст на пергаменте стал бы невидим.
 */
const APP_LIGHT_INK = '#e9e2d1';
const APP_DARK_INK = '#17160f';
/** Подпись на цветной кнопке: тот же графит, что держит `:root`. */
const APP_DARK_TEXT = '#1a1508';

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

/** Смесь цветов: t=0 отдаёт a, t=1 - b. Мусорный цвет не смешиваем, он и так ни на что не годится. */
function mix(a: string, b: string, t: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  if (!from || !to) return a;
  return toHex([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]);
}

/**
 * Цвет, подправленный до контрапта `min` против фона: подмешиваем чернила, пока
 * не хватит. Нужно для «опасного» и «успешного» - они в теме не задаются, а на
 * светлом пергаменте обычный кирпич читается в 1.9:1.
 */
function ensureContrast(color: string, bg: string, ink: string, min: number): string {
  const base = contrastRatio(color, bg);
  if (base === null || base >= min) return color;
  for (let step = 1; step <= 12; step++) {
    const candidate = mix(color, ink, step / 12);
    if ((contrastRatio(candidate, bg) ?? 0) >= min) return candidate;
  }
  return ink;
}

/** Светлая ли тема: чернила на её фоне читаются лучше, чем костяной текст. */
export function skinIsLight(skin: Pick<SkinTokens, 'backdrop'>): boolean {
  const onLight = contrastRatio(APP_LIGHT_INK, skin.backdrop) ?? 0;
  const onDark = contrastRatio(APP_DARK_INK, skin.backdrop) ?? 0;
  return onDark > onLight;
}

/**
 * Переменные экрана из темы. Их вешают на `:root` вместе с `skinVars`: доска
 * читает свои, всё остальное - эти. Контраст подписи на подложке проверяется
 * один раз: не выдержит - подложка становится приглушённым тоном фона, а не
 * цветным пятном, на котором текст пропадает.
 */
/** Экрану нужны восемь цветов темы; глиф и фигура - дело доски. */
export type AppPaletteInput = Pick<
  SkinTokens,
  'piece' | 'plate' | 'edge' | 'cellLight' | 'cellDark' | 'frame' | 'backdrop' | 'wash'
>;

export function skinAppVars(skin: AppPaletteInput): Record<string, string> {
  // Тема может прийти из старого сохранённого состояния, где цвета не прошли ни
  // одну проверку: для экрана это не повод красить интерфейс в «картон».
  const safe = (value: string, fallback: string): string => (parseHex(value) ? value : fallback);
  const base = SKINS.classic;
  const bg = safe(skin.backdrop, base.backdrop);
  const frame = safe(skin.frame, base.frame);
  const cell = safe(skin.cellDark, base.cellDark);
  const edge = safe(skin.edge, base.edge);
  const tone = safe(skin.wash, base.wash);
  const skinSafe = { backdrop: bg };
  const ink = skinIsLight(skinSafe) ? APP_DARK_INK : APP_LIGHT_INK;
  // Акцент - это и подпись над заголовком, и ссылка, и стрелка на кнопке, поэтому
  // планка у него текстовая: 4.5, а не «три для графики». Цвет темы подтягивается
  // к чернилам ровно настолько, чтобы читаться, и остаётся фирменным тоном.
  const accent = ensureContrast(edge, bg, ink, 4.5);
  const danger = ensureContrast('#b46a5c', bg, ink, 3);
  const ok = ensureContrast('#93a07d', bg, ink, 3);
  // Подложка под карточки и вкладки: берём цвет темы, если акцент на ней
  // различим (3:1 - планка графики, текста на ней нет), иначе - приглушённый тон
  // фона: лиловая подложка «Короны» под лиловой стрелкой превращалась в кашу.
  const wash = (contrastRatio(accent, tone) ?? 0) >= 3 ? tone : mix(bg, accent, 0.14);
  // Кнопка «на акценте» - единственное место, где цвет темы становится фоном под
  // текстом. Подпись берём ту, что читается, а сам фон дотягиваем до контраста,
  // иначе лиловый акцент «Короны» съедает тёмную надпись почти в 1.3:1.
  const onAccent =
    (contrastRatio(APP_DARK_TEXT, accent) ?? 0) >= (contrastRatio(APP_LIGHT_INK, accent) ?? 0) ? APP_DARK_TEXT : APP_LIGHT_INK;
  const awayFromText = onAccent === APP_DARK_TEXT ? APP_LIGHT_INK : APP_DARK_INK;
  let accentSolid = accent;
  for (let step = 1; step <= 10 && (contrastRatio(onAccent, accentSolid) ?? 0) < 4.5; step++) {
    accentSolid = mix(accent, awayFromText, (step / 10) * 0.45);
  }
  if ((contrastRatio(onAccent, accentSolid) ?? 0) < 4.5) accentSolid = mix(accent, awayFromText, 0.45);
  return {
    '--accent-solid': accentSolid,
    '--on-accent': onAccent,
    '--bg': bg,
    '--bg-deep': frame,
    '--panel': mix(bg, cell, 0.6),
    '--panel-2': cell,
    '--line': mix(bg, accent, 0.2),
    '--line-strong': mix(bg, accent, 0.34),
    '--ink': ink,
    // Приглушённый текст и подписи - те же чернила, что и основной, но в
    // половинном весе. На светлой теме «половинка» рискует уехать в 2.8:1,
    // поэтому каждую планку дотягиваем отдельно.
    '--muted': ensureContrast(mix(bg, ink, 0.68), bg, ink, 4.5),
    '--dim': ensureContrast(mix(bg, ink, 0.5), bg, ink, 3),
    '--accent': accent,
    '--accent-dim': mix(bg, accent, 0.62),
    '--accent-wash': wash,
    '--danger': danger,
    '--danger-wash': mix(bg, danger, 0.16),
    '--ok': ok,
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
