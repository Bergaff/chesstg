import {
  PAID_SKINS,
  SKINS,
  SKIN_CUSTOM_STARS,
  SKIN_STARS,
  type PaidSkinId,
  type SkinId,
  SKIN_SET_STARS,
} from './skins';

/**
 * Сколько слотов своей темы можно купить. Один слот - одна тема: правки в ней
 * бесплатны, код уходит в чат бесплатно, показ в галерее тоже, а второй рисунок
 * стоит ещё один слот. Потолок держим маленьким: три темы - это витрина, а не
 * склад, и цену набора из трёх тем он не съедает.
 */
export const SKIN_CUSTOM_SLOTS_MAX = 3;

export const MAX_LIVES = 5;
export const LIFE_REGEN_MS = 30 * 60 * 1000;
export const ENDLESS_UNLOCK_LEVEL = 10;
export const AD_COINS_REWARD = 30;

export type BonusId = 'hint' | 'freeze' | 'undo';

export interface BonusDef {
  id: BonusId;
  name: string;
  price: number;
  description: string;
}

export const BONUSES: Record<BonusId, BonusDef> = {
  hint: {
    id: 'hint',
    name: 'Подсказка',
    price: 20,
    description: 'Подсветит безопасный путь на 2 хода',
  },
  freeze: {
    id: 'freeze',
    name: 'Заморозка',
    price: 30,
    description: 'Враги не двигаются 2 хода',
  },
  undo: {
    id: 'undo',
    name: 'Отмена хода',
    price: 15,
    description: 'Откатит последний ход и ответ врагов. Ещё по одному за каждые пять пройденных уровней, держать можно до двух',
  },
};

export const BONUS_ORDER: BonusId[] = ['hint', 'freeze', 'undo'];

export type ProductSku = 'lives' | 'noads' | 'skins' | 'custom' | `skin:${PaidSkinId}`;

export interface ProductDef {
  sku: ProductSku;
  title: string;
  stars: number;
  description: string;
  badge?: string;
  /** Что именно выдаёт платёж: тема, набор, отключение рекламы. */
  kind: 'lives' | 'ads' | 'skin' | 'fee';
}

/**
 * Темы продаются и по одной, и набором. Штучная цена нужна затем, чтобы игрок
 * купил хоть что-то: «всё или ничего» за 50 звёзд отталкивает того, кому
 * нравится одна тема, а 20 звёзд он отдаёт легко. Набор при этом остаётся
 * выгоднее - за него и цепляет того, кто выбирает между «одной» и «тремя».
 */
export const PRODUCTS: Record<ProductSku, ProductDef> = {
  lives: {
    sku: 'lives',
    title: '+5 жизней',
    stars: 25,
    description: 'Мгновенно восстановит все жизни',
    kind: 'lives',
  },
  noads: {
    sku: 'noads',
    title: 'Без рекламы',
    stars: 150,
    description: 'Навсегда отключает рекламные показы',
    badge: 'Навсегда',
    kind: 'ads',
  },
  skins: {
    sku: 'skins',
    title: 'Все темы поля',
    stars: SKIN_SET_STARS,
    description: PAID_SKINS.map((id) => SKINS[id].name).join(', ') + ' - навсегда',
    badge: `${PAID_SKINS.length} темы`,
    kind: 'skin',
  },
  // Слот своей темы: платит не автор, а тот, кто носит. Пока своей темой можно
  // пользоваться бесплатно, полка из трёх тем не продаётся - кто купит «Корону»
  // за 20 звёзд, если те же восемь цветов доступны в студии даром. Товар
  // повторяемый: вторая и третья тема докупаются по той же цене, а не «один раз
  // на аккаунт» - право нарисовать ещё одну тему и есть второй слот.
  custom: {
    sku: 'custom',
    title: 'Слот своей темы',
    stars: SKIN_CUSTOM_STARS,
    description: 'Мастерская и одно место под свою тему: свои цвета и свой контур. Правки бесплатны, до трёх мест на аккаунт',
    badge: 'Навсегда',
    kind: 'fee',
  },
  ...Object.fromEntries(
    PAID_SKINS.map((id) => [
      `skin:${id}`,
      {
        sku: `skin:${id}`,
        title: `Тема «${SKINS[id].name}»`,
        stars: SKINS[id].stars,
        description: SKINS[id].description,
        kind: 'skin',
      },
    ]),
  ) as Record<`skin:${PaidSkinId}`, ProductDef>,
};

export const PRODUCT_ORDER: ProductSku[] = [
  'lives',
  'skins',
  ...PAID_SKINS.map((id): ProductSku => `skin:${id}`),
  'custom',
  'noads',
];

export function productSkuForSkin(id: PaidSkinId): ProductSku {
  return `skin:${id}`;
}

export function isProductSku(value: unknown): value is ProductSku {
  return typeof value === 'string' && value in PRODUCTS;
}

/**
 * Тема открыта навсегда, если за неё заплатили. Сезонных витрин, где тема
 * жила бы у всех до конца квартала, в модели нет: платная тема открывается
 * счётом на звёзды, монетами или льготой `QA_LIVES_IDS` - третьего не дано.
 */
export function skinProductOwned(sku: ProductSku, owned: readonly SkinId[]): boolean {
  if (sku === 'skins') return PAID_SKINS.every((id) => owned.includes(id));
  return typeof sku === 'string' && sku.startsWith('skin:') && owned.includes(sku.slice(5) as SkinId);
}


export function isBonusId(value: unknown): value is BonusId {
  return typeof value === 'string' && value in BONUSES;
}

// ───────────────────── Монеты как валюта тем ─────────────────────

/**
 * Курс, по которому монеты пускают в витрину тем: 60 монет за звезду. Чистая
 * арифметика выбрана специально - две цены одной вещи обязаны сходиться в
 * голове игрока, а не жить в двух таблицах.
 *
 * Монетами продаётся только то, что не стоит живых денег: темы поля. Жизни,
 * отключение рекламы и взнос за публикацию остаются за звёздами - монеты за
 * них означали бы, что игрок может оплатить модератора и хостинг тем, что
 * накликал рекламу в меню.
 */
export const COINS_PER_STAR = 60;
/** Цена всегда кратна 50: «1 180» читается как ошибка, «1 200» - как цель. */
export const COINS_PRICE_STEP = 50;

export function skinCoinPrice(stars: number): number {
  if (stars <= 0) return 0;
  const raw = stars * COINS_PER_STAR;
  return Math.max(COINS_PRICE_STEP, Math.round(raw / COINS_PRICE_STEP) * COINS_PRICE_STEP);
}

/** Тема поштучно, набор и мастерская: те же 20, 50 и 80 звёзд, пересчитанные курсом. */
export const SKIN_COINS = skinCoinPrice(SKIN_STARS);
export const SKIN_SET_COINS = skinCoinPrice(SKIN_SET_STARS);
export const SKIN_CUSTOM_COINS = skinCoinPrice(SKIN_CUSTOM_STARS);

/**
 * Потолок наград за рекламу в сутки - только для монет, жизни и щит им не
 * измеряются. Без него монетный магазин ломается в одну кнопку: кулдаун ролика
 * минута, значит 1 440 монет в день с телефона, который забыли на столе, - это
 * тема за обед и обнулённая продажа за звёзды. Пять показов - полторы минуты
 * тапания, обычный игрок смотрит два-три, а ферма упирается в потолок.
 */
export const AD_COINS_DAILY_LIMIT = 5;

// ─────────────────────── Бесплатный откат ───────────────────────

/** Каждые столько пройденных уровней кампании дают один откат. */
export const UNDO_EVERY_LEVELS = 5;
/** Больше двух откатов держать нельзя: склад из восьми убивает и цену, и смысл. */
export const UNDO_MAX_HELD = 2;

/** Сколько откатов игрок имел право получить, дойдя до `levelsCleared`. */
export function undoTokensFor(levelsCleared: number): number {
  return Math.floor(Math.max(0, levelsCleared) / UNDO_EVERY_LEVELS);
}

/**
 * Сколько откатов долить в инвентарь. Право считаем от достигнутого уровня, а
 * не от факта победы: пропустил игрок пять уровней разом - получит один, и
 * только до потолка. Покупные откаты потолок не трогает, - за них заплачено,
 * и уменьшать их никто не вправе; но и бесплатные поверх них не капают.
 */
export function undoTopUp(held: number, due: number): number {
  const current = Math.max(0, Math.floor(held));
  return Math.max(0, Math.min(UNDO_MAX_HELD, current + Math.max(0, Math.floor(due))) - current);
}

/**
 * Экономика монетного магазина: за сколько дней тема копится у игрока данного
 * уровня. Нужна не для красоты, а чтобы цену нельзя было поставить так, чтобы
 * один режим кормил другой: считаем доход от побед, от «Парковки» и от
 * рекламного потолка и сравниваем с ценой.
 */
export interface CoinIncomeRow {
  level: number;
  /** Монет в день при двух победах в кампании и одной в «Парковке». */
  perDay: number;
  /** С учётом рекламного потолка: худший случай для баланса. */
  perDayWithAds: number;
  daysForSkin: number;
  daysForSet: number;
}

/**
 * Дни до темы. Уровень победы и уровень «Парковки» берутся одинаковыми - грубо,
 * но в плюс игроку: режимы он закрывает медленнее кампании. Реклама идёт своим
 * потоком: два показа в день у обычного игрока и максимум суточного потолка у
 * того, кто сидит в игре весь день.
 */
export function coinEconomy(options?: {
  levelsPerDay?: number;
  jamLevelsPerDay?: number;
  adViewsPerDay?: number;
}): CoinIncomeRow[] {
  const levels = options?.levelsPerDay ?? 2;
  const jam = options?.jamLevelsPerDay ?? 1;
  const ads = options?.adViewsPerDay ?? 2;
  return [3, 5, 10, 15, 20, 25, 30].map((level) => {
    const perLevel = campaignCoinReward(level);
    const perDay = Math.max(0, Math.round(levels * perLevel + jam * campaignCoinReward(Math.max(1, level - 2))));
    const perDayWithAds = perDay + Math.min(ads, AD_COINS_DAILY_LIMIT) * AD_COINS_REWARD;
    const days = (price: number, income: number): number => (income <= 0 ? Infinity : Math.ceil(price / income));
    return {
      level,
      perDay,
      perDayWithAds,
      daysForSkin: days(SKIN_COINS, perDayWithAds),
      daysForSet: days(SKIN_SET_COINS, perDayWithAds),
    };
  });
}

/** Таблица для README и разговора о ценах: те же строки, что считает `coinEconomy`. */
export function coinEconomyMarkdown(rows = coinEconomy()): string {
  const head = '| Уровень | Монет в день | С рекламой | Тема за монеты | Набор |\n| --- | --- | --- | --- | --- |';
  const body = rows.map(
    (row) =>
      `| ${row.level} | ${row.perDay} | ${row.perDayWithAds} | ${row.daysForSkin} дн. | ${row.daysForSet} дн. |`,
  );
  return [head, ...body].join('\n');
}

export function campaignCoinReward(level: number): number {
  return Math.min(50, 10 + Math.max(0, level - 1) * 2);
}

export function endlessCoinReward(score: number): number {
  return Math.min(40, 2 + Math.max(0, Math.floor(score / 2)));
}

export function levelBoardSize(level: number): number {
  if (level <= 5) return 3;
  if (level <= 15) return 4;
  if (level <= 30) return 5;
  return 6;
}

export interface LivesState {
  lives: number;
  livesAt: number;
}

/**
 * Начисляет восстановленные жизни по времени.
 * livesAt, момент, от которого идёт текущий 30-минутный таймер.
 */
export function materializeLives(lives: number, livesAt: number, now: number): LivesState {
  const safeLives = Math.max(0, Math.min(MAX_LIVES, Math.floor(lives)));
  if (safeLives >= MAX_LIVES) return { lives: MAX_LIVES, livesAt: now };
  const elapsed = Math.max(0, now - livesAt);
  const gained = Math.floor(elapsed / LIFE_REGEN_MS);
  if (gained <= 0) return { lives: safeLives, livesAt };
  const nextLives = Math.min(MAX_LIVES, safeLives + gained);
  const nextAt = nextLives >= MAX_LIVES ? now : livesAt + gained * LIFE_REGEN_MS;
  return { lives: nextLives, livesAt: nextAt };
}

export function loseLife(lives: number, livesAt: number, now: number): LivesState {
  const current = materializeLives(lives, livesAt, now);
  if (current.lives <= 0) return current;
  const wasFull = current.lives >= MAX_LIVES;
  return {
    lives: current.lives - 1,
    livesAt: wasFull ? now : current.livesAt,
  };
}

export function addLife(lives: number, livesAt: number, now: number, amount = 1): LivesState {
  const current = materializeLives(lives, livesAt, now);
  const next = Math.min(MAX_LIVES, current.lives + amount);
  if (next >= MAX_LIVES) return { lives: MAX_LIVES, livesAt: now };
  return { lives: next, livesAt: current.livesAt };
}

export function fillLives(now: number): LivesState {
  return { lives: MAX_LIVES, livesAt: now };
}

export function msUntilNextLife(lives: number, livesAt: number, now: number): number {
  if (lives >= MAX_LIVES) return 0;
  return Math.max(0, livesAt + LIFE_REGEN_MS - now);
}
