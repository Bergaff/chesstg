import type { BonusId, GameAction, GameMode, GameState, PieceType, SkinId } from '../engine';

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
  nextLifeAt: number | null;
  nextLifeInMs: number;
  serverNow: number;
  endlessBest: number;
  endlessBestTier: number;
  endlessBestMoves: number;
  endlessUnlocked: boolean;
  adFree: boolean;
  skins: SkinId[];
  skin: SkinId;
  inventory: Record<'hint' | 'freeze' | 'undo', number>;
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

export interface ActiveRuns {
  campaign?: RunSummary;
  endless?: RunSummary;
}

export interface RunPayload {
  id: string;
  mode: GameMode;
  level: number;
  seed: number;
  initial: GameState;
  actions: GameAction[];
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
}

export interface LeaderboardResponse {
  metric: 'endless' | 'campaign';
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
