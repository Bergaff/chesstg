export interface AdminStatus {
  configured: boolean;
  authenticated: boolean;
  expiresAt: number | null;
}

export interface DayPoint {
  day: string;
  value: number;
}

export interface RunPoint {
  day: string;
  started: number;
  won: number;
  lost: number;
  quit: number;
}

export interface OverviewResponse {
  generatedAt: number;
  days: number;
  totals: {
    users: number;
    guests: number;
    telegram: number;
    adFree: number;
    coins: number;
    played: number;
    endlessUnlocked: number;
    endlessPlayed: number;
    topLevel: number;
    topEndless: number;
  };
  series: {
    newUsers: DayPoint[];
    activeUsers: DayPoint[];
    runs: RunPoint[];
  };
  retention: {
    cohort: number;
    d1: number;
    d7: number;
    d1Rate: number;
    d7Rate: number;
  };
  runs: {
    total: number;
    ended: number;
    won: number;
    winRate: number;
    campaign: RunGroup[];
    endless: RunGroup[];
  };
  economy: {
    coinsEarned: number;
    coinsSpent: number;
    livesLost: number;
    purchases: number;
    starsEarned: number;
    refunds: number;
    bonusesUsed: number;
    adEvents: Array<{ kind: string; n: number }>;
  };
  payments: Array<{ sku: string; status: string; n: number; stars: number }>;
  funnel: Array<{ level: number; n: number }>;
  levels: Array<{ level: number; played: number; won: number; winRate: number }>;
  endlessBuckets: Array<{ bucket: string; n: number }>;
  topPlayers: Array<{
    id: string;
    name: string;
    username: string | null;
    level: number;
    best: number;
    coins: number;
  }>;
  recentUsers: Array<{
    id: string;
    name: string;
    username: string | null;
    isGuest: number;
    level: number;
    best: number;
    createdAt: number;
  }>;
}

export interface RunGroup {
  mode: string;
  status: string;
  n: number;
  moves: number;
  score: number;
}

export interface UserRow {
  id: string;
  name: string;
  username: string | null;
  isGuest: number;
  level: number;
  maxLevel: number;
  coins: number;
  lives: number;
  best: number;
  adFree: number;
  createdAt: number;
  updatedAt: number;
  skin: string;
  runs: number;
  purchases: number;
}

export interface UsersResponse {
  total: number;
  page: number;
  pageSize: number;
  rows: UserRow[];
}

export interface UserDetailResponse {
  user: Record<string, unknown>;
  runs: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}

export interface PaymentsResponse {
  days: number;
  stars: number;
  summary: Array<{ sku: string; status: string; n: number; stars: number }>;
  rows: Array<{
    chargeId: string;
    sku: string;
    stars: number;
    status: string;
    createdAt: number;
    paidAt: number | null;
    userId: string;
    name: string | null;
    username: string | null;
  }>;
}

export interface LevelCheckRow {
  level: number;
  seeds: number;
  total: number;
  solvable: number;
  avg_score: number;
  min_score: number;
  max_score: number;
  avg_pieces: number;
  payload: string;
  checked_at: number;
}

export interface AuditReportRow {
  id: string;
  kind: string;
  spec: string;
  summary: string;
  createdAt: number;
}

export interface LevelsResponse {
  checks: LevelCheckRow[];
  reports: AuditReportRow[];
}

export interface LevelCheckReport {
  level: number;
  size: number;
  band: { target: number; min: number; max: number };
  types: string[];
  targetPieces: number;
  seeds: number;
  total: number;
  solvable: number;
  inBand: number;
  avgScore: number;
  minScore: number;
  maxScore: number;
  avgPieces: number;
  elapsedMs: number;
  results: Array<{
    seed: number;
    solvable: boolean;
    score: number;
    steps: number;
    firstMoves: number;
    pieces: number;
    ms: number;
  }>;
}

export interface BotWebhookInfo {
  url: string;
  pending: number;
  lastError: string;
  lastErrorAt: number | null;
  /** Пусто, если Telegram резолвит домен сам. Непустое значение значит привязку к IP. */
  ipAddress: string;
}

export interface BotStatusResponse {
  configured: boolean;
  expectedUrl: string;
  appUrl: string;
  webappUrl: string;
  webappUrlOk: boolean;
  secretSet: boolean;
  devMode: boolean;
  checkedAt: number;
  username: string;
  /** Есть ли у бота главное веб-приложение, его заводит BotFather командой /newapp. */
  mainWebApp: boolean;
  webhook: BotWebhookInfo | null;
  botError: string;
}

export interface DiagEntry {
  at: number;
  reason: string;
  raw: string;
}

export interface DiagResponse {
  enabled: boolean;
  entries: DiagEntry[];
}

export interface BotStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface BotSetupResponse {
  steps: BotStep[];
  status: BotStatusResponse;
}

export interface HealthResponse {
  ok: boolean;
  error?: string;
  message?: string;
  hint?: string;
  missing?: string[];
  warnings?: string[];
  tables?: Record<string, boolean>;
  schemaVersion?: number;
  origin?: string;
  service?: string;
}
