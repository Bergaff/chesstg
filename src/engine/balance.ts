import { PAID_SKINS, SKINS, type PaidSkinId, type SkinId, SKIN_SET_STARS } from './skins';

/** Взнос за то, чтобы свою тему увидели чужие: одна плата на одну тему. */
export const SHARE_FEE_STARS = 100;

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
    description: 'Откатит последний ход и ответ врагов',
  },
};

export const BONUS_ORDER: BonusId[] = ['hint', 'freeze', 'undo'];

export type ProductSku = 'lives' | 'noads' | 'skins' | 'share' | `skin:${PaidSkinId}`;

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
  // Взнос за публикацию: для себя тема бесплатна всегда, платит тот, кто хочет
  // поставить её в общую галерею. Цена отсекает поток «накидал за минуту» и
  // оплачивает проверку каждой заявки.
  share: {
    sku: 'share',
    title: 'Показать тему всем',
    stars: SHARE_FEE_STARS,
    description: 'Тема попадёт в галерею после проверки, навсегда и без royalties',
    badge: 'Один раз',
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
  'noads',
];

export function productSkuForSkin(id: PaidSkinId): ProductSku {
  return `skin:${id}`;
}

export function isProductSku(value: unknown): value is ProductSku {
  return typeof value === 'string' && value in PRODUCTS;
}

/** Тема открыта навсегда, если за неё заплатили; витрина сезона - отдельная ветка. */
export function skinProductOwned(sku: ProductSku, owned: readonly SkinId[]): boolean {
  if (sku === 'skins') return PAID_SKINS.every((id) => owned.includes(id));
  return typeof sku === 'string' && sku.startsWith('skin:') && owned.includes(sku.slice(5) as SkinId);
}


export function isBonusId(value: unknown): value is BonusId {
  return typeof value === 'string' && value in BONUSES;
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
