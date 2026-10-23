import type { GameMode } from '../src/engine/types';

export interface WorkerEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  BOT_TOKEN?: string;
  WEBHOOK_SECRET?: string;
  WEBAPP_URL?: string;
  BOT_USERNAME?: string;
  ADSGRAM_BLOCK_ID?: string;
  ADSGRAM_SRC?: string;
  ALLOW_GUESTS?: string;
  DEV_MODE?: string;
  ENVIRONMENT?: string;
  /** true, и при отказе проверки initData в логи пишется исходная строка клиента. */
  AUTH_DEBUG?: string;
  /** Пароль администратора в открытом виде. Только как секрет воркера. */
  ADMIN_PASSWORD?: string;
  /** SHA-256 пароля в hex, альтернатива ADMIN_PASSWORD. */
  ADMIN_PASSWORD_HASH?: string;
  /** Ключ подписи токенов админки. Обязателен для доступа. */
  ADMIN_SECRET?: string;
  /** Секрет подписи сеансовых токенов сайта. По умолчанию берётся ADMIN_SECRET. */
  SESSION_SECRET?: string;
  /**
   * Вечные сердца для проверки: Telegram id через запятую. Аккаунтам из списка
   * жизни не списываются - режим про сердца и только, монеты, цены и реклама
   * остаются обычными, поэтому баланс по такому аккаунту не проверяют.
   */
  QA_LIVES_IDS?: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface UserRow {
  id: string;
  tg_id: number | null;
  first_name: string;
  username: string | null;
  is_guest: number;
  level: number;
  max_level: number;
  coins: number;
  lives: number;
  lives_at: number;
  endless_best: number;
  endless_best_tier: number;
  endless_best_moves: number;
  ad_free: number;
  skins: string;
  skin: string;
  inv_hint: number;
  inv_freeze: number;
  inv_undo: number;
  invite_code: string;
  referred_by: string | null;
  /**
   * Прогресс режимов с уровнем, кроме кампании: JSON вида
   * {"jam":{"level":4,"maxLevel":6}}. Кампания живёт в `level` и `max_level`.
   */
  mode_levels: string | null;
  created_at: number;
  updated_at: number;
}

export interface RunRow {
  id: string;
  user_id: string;
  /** id режима из движка: campaign, jam, race, endless. CHECK-ограничения на колонке нет. */
  mode: GameMode;
  level: number;
  seed: number;
  initial_state: string;
  actions: string;
  moves: number;
  score: number;
  status: 'active' | 'won' | 'lost' | 'quit';
  result: string | null;
  finish_id: string | null;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
}

export interface AuthContext {
  user: UserRow;
  kind: 'telegram' | 'guest' | 'session';
  fresh: boolean;
  tgUser?: TelegramUser;
}

export type AppEnv = {
  Bindings: WorkerEnv;
  Variables: {
    auth: AuthContext;
    adminExpiresAt: number;
  };
};
