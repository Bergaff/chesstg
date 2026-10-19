export const MAX_LIVES = 5;
export const LIFE_REGEN_MS = 30 * 60 * 1000;
export const ENDLESS_UNLOCK_LEVEL = 10;
export const AD_COINS_REWARD = 30;

export type BonusId = 'hint' | 'freeze' | 'undo';

export interface BonusDef {
  id: BonusId;
  name: string;
  icon: string;
  price: number;
  description: string;
}

export const BONUSES: Record<BonusId, BonusDef> = {
  hint: {
    id: 'hint',
    name: 'Подсказка',
    icon: '💡',
    price: 20,
    description: 'Подсветит безопасный путь на 2 хода',
  },
  freeze: {
    id: 'freeze',
    name: 'Заморозка',
    icon: '❄️',
    price: 30,
    description: 'Враги не двигаются 2 хода',
  },
  undo: {
    id: 'undo',
    name: 'Отмена хода',
    icon: '↩️',
    price: 15,
    description: 'Откатит последний ход и ответ врагов',
  },
};

export const BONUS_ORDER: BonusId[] = ['hint', 'freeze', 'undo'];

export type ProductSku = 'lives' | 'noads' | 'skins';

export interface ProductDef {
  sku: ProductSku;
  title: string;
  icon: string;
  stars: number;
  description: string;
  badge?: string;
}

export const PRODUCTS: Record<ProductSku, ProductDef> = {
  lives: {
    sku: 'lives',
    title: '+5 жизней',
    icon: '❤️',
    stars: 25,
    description: 'Мгновенно восстановит все жизни',
  },
  noads: {
    sku: 'noads',
    title: 'Без рекламы',
    icon: '🚫',
    stars: 150,
    description: 'Навсегда отключает рекламные показы',
    badge: 'Навсегда',
  },
  skins: {
    sku: 'skins',
    title: 'Набор скинов',
    icon: '👑',
    stars: 50,
    description: 'Три образа пешки: золото, неон и корона',
    badge: '3 скина',
  },
};

export const PRODUCT_ORDER: ProductSku[] = ['lives', 'skins', 'noads'];

export type SkinId = 'classic' | 'gold' | 'neon' | 'royal';

export interface SkinDef {
  id: SkinId;
  name: string;
  description: string;
  pawn: string;
  free?: boolean;
}

export const SKINS: Record<SkinId, SkinDef> = {
  classic: { id: 'classic', name: 'Классика', description: 'Строгая белая пешка', pawn: '♟', free: true },
  gold: { id: 'gold', name: 'Золото', description: 'Пешка из чистого золота', pawn: '♟' },
  neon: { id: 'neon', name: 'Неон', description: 'Киберпанк-подсветка', pawn: '♟' },
  royal: { id: 'royal', name: 'Корона', description: 'Пешка с королевским титулом', pawn: '⚜' },
};

export const SKIN_ORDER: SkinId[] = ['classic', 'gold', 'neon', 'royal'];
export const PAID_SKINS: SkinId[] = ['gold', 'neon', 'royal'];

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string' && value in SKINS;
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
 * livesAt — момент, от которого идёт текущий 30-минутный таймер.
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
