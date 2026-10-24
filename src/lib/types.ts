import type {
  BonusId,
  GameAction,
  GameMode,
  GameState,
  JamState,
  PieceType,
  RunAction,
  CustomSkin,
  SkinId,
} from '../engine';

export interface ModeProgress {
  /** Текущий уровень режима; для бесконечного всегда 0. */
  level: number;
  maxLevel: number;
  unlocked: boolean;
  /** На каком уровне кампании открывается режим. */
  unlockAtLevel: number;
  /** Рекорд в прокрученных рядах: есть только у «Гонок». */
  best?: number;
  /** Ходов в лучшем забеге. */
  bestMoves?: number;
}

export interface Profile {
  id: string;
  name: string;
  isGuest: boolean;
  level: number;
  maxLevel: number;
  levelsCleared: number;
  coins: number;
  lives: number;
  maxLives: number;
  /**
   * Аккаунт в списке `QA_LIVES_IDS`: сердца не списываются. Приходит только от
   * настроенного воркера, поэтому отсутствие поля значит «обычный аккаунт».
   */
  eternalLives?: boolean;
  /**
   * Тот же льготный список, но про всё остальное: темы поля открыты, публикация
   * без взноса, вход в лабораторию в меню. Держится одним флагом с
   * `eternalLives`, чтобы льготы не разъезжались по кусочкам.
   */
  qa?: boolean;
  nextLifeAt: number | null;
  nextLifeInMs: number;
  serverNow: number;
  endlessBest: number;
  endlessBestTier: number;
  endlessBestMoves: number;
  endlessUnlocked: boolean;
  adFree: boolean;
  skins: SkinId[];
  /** Надетая тема. `'custom'` - своя, её цвета лежат в `customSkin`. */
  skin: SkinId;
  /** Собранная игроком тема (или установленная из галереи): бесплатно и для себя. */
  customSkin: CustomSkin | null;
  /** Тема текущего сезона на витрине: она открыта всем до конца квартала. */
  showcaseSkin?: SkinId;
  /** Сколько ходов в «Гонках» открывают «Пепел». */
  ashRecordMoves?: number;
  inventory: Record<'hint' | 'freeze' | 'undo', number>;
  /**
   * Прогресс по всем режимам сразу: меню рисует карточки и замки из этого,
   * отдельного запроса на режим нет. У бесконечного режима уровня нет.
   */
  modes: Record<GameMode, ModeProgress>;
  inviteCode: string;
  createdAt: number;
  prices: Record<BonusId, number>;
}

export interface AppConfig {
  botUsername: string;
  webappUrl: string;
  allowGuests: boolean;
  devMode: boolean;
  demoAds: boolean;
  /** Реклама включена: задан блок Adsgram или играет демо-ролик локальной сборки. */
  adsEnabled: boolean;
  paymentsEnabled: boolean;
  environment: string;
  adsgram: {
    blockId: string;
    src: string;
  };
}

export interface RunSummary {
  id: string;
  mode: GameMode;
  level: number;
  moves: number;
  score: number;
  status: string;
  updatedAt: number;
}

/** Активные забеги по режимам: один на режим, поэтому ключ это id режима. */
export type ActiveRuns = Partial<Record<GameMode, RunSummary>>;

export interface RunPayload {
  id: string;
  mode: GameMode;
  level: number;
  seed: number;
  /** Форма зависит от режима: у «Парковки» своё состояние головоломки. */
  initial: GameState | JamState;
  actions: RunAction[];
  moves: number;
  score: number;
  status: string;
  result: FinishResult | null;
  createdAt: number;
  updatedAt: number;
}

export interface Challenge {
  level: number;
  score: number;
}

export interface SessionResponse {
  profile: Profile;
  config: AppConfig;
  active: ActiveRuns;
  invitedCount: number;
  challenge: Challenge | null;
  referral: { rewarded: boolean; bonus: number } | null;
}

export interface StartRunResponse {
  resumed: boolean;
  run: RunPayload;
}

export interface FinishResult {
  outcome: 'won' | 'lost' | 'quit';
  /** Причина конца в «Парковке»: `budget` значит «не хватило ходов». */
  reason?: string;
  mode: GameMode;
  level: number;
  score: number;
  moves: number;
  coinsEarned: number;
  levelUp: boolean;
  nextLevel: number;
  maxLevel: number;
  lives: number;
  capturedBy: PieceType | null;
  newBest: boolean;
  bestScore: number | null;
  endlessUnlockedNow: boolean;
  /** Название темы, открытой этой партией («Пепел» за 100 ходов в «Гонках»). */
  skinAward?: string;
  alreadyFinished?: boolean;
}

export interface FinishResponse {
  result: FinishResult;
  profile: Profile;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  isMe: boolean;
  endlessBest: number;
  maxLevel: number;
  level: number;
  /** Уровень в том режиме, по которому сейчас сортируется таблица. */
  modeLevel: number;
  /** Рекорд в рядах: приходит только для «Гонок», где уровня-победы нет. */
  modeBest?: number;
}

export interface LeaderboardResponse {
  metric: 'endless' | 'campaign' | 'jam' | 'race';
  scope: 'global' | 'friends';
  rows: LeaderboardRow[];
  myRank: number;
  invitedCount: number;
  inviteLink: string | null;
}

export interface BonusUseResponse {
  ok: boolean;
  kind: BonusId;
  source: 'inventory' | 'coins';
  price: number;
  coins: number;
  inventory: Record<'hint' | 'freeze' | 'undo', number>;
  grant: { kind: 'freeze'; at: number } | null;
}

export interface AdRewardResponse {
  ok: boolean;
  kind: 'life' | 'coins' | 'shield';
  coins: number;
  lives: number;
  nextLifeAt: number | null;
  grant: { kind: 'shield'; at: number } | null;
  profile: Profile;
}
