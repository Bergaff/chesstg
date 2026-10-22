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
    jam?: RunGroup[];
    race?: RunGroup[];
    endless: RunGroup[];
  };
  /** Сводка по каждому режиму за период: кто во что играет и с каким итогом. */
  modes?: Array<{ mode: string; n: number; players: number; won: number; lost: number; avgMoves: number; winRate: number }>;
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
  /**
   * Прогресс «Парковки» и «Гонок». Null, если колонка mode_levels ещё не
   * применена: тогда это «нет данных», а не «первый уровень».
   */
  jamLevel: number | null;
  jamMax: number | null;
  raceLevel: number | null;
  raceMax: number | null;
}

export interface UsersResponse {
  total: number;
  page: number;
  pageSize: number;
  rows: UserRow[];
  /** Список пришёл без прогресса режимов: в базе нет колонки mode_levels. */
  degraded?: boolean;
}

/** Прогресс одного режима вместе с условием открытия. */
export interface ModeProgressEntry {
  level: number;
  maxLevel: number;
  unlocked: boolean;
  unlockAtLevel: number;
}

export interface UserRunRow {
  id: string;
  mode: string;
  level: number;
  seed: number;
  moves: number;
  score: number;
  status: string;
  createdAt: number;
  updatedAt: number;
  outcome: string;
  capturedBy: string | null;
  /** Причина конца из результата: в «Парковке» это `budget`. */
  reason?: string;
  stuck: boolean;
  /** «Парковка» проиграна, потому что кончился бюджет ходов. */
  budgetOut?: boolean;
  coinsEarned: number;
  levelUp: boolean;
  modeLevel: number;
}

export interface UserHistoryRow {
  mode: string;
  level: number;
  played: number;
  won: number;
  lost: number;
  quit: number;
  avgMoves: number;
  firstAt: number;
  lastAt: number;
}

export interface UserGrantRow {
  kind: string;
  source: string;
  n: number;
  firstAt: number;
  lastAt: number;
}

export interface UserDetailResponse {
  user: Record<string, unknown>;
  /** Прогресс по всем четырём режимам: текущий уровень, лучший, открыт ли. */
  progress?: Record<'campaign' | 'jam' | 'race' | 'endless', ModeProgressEntry>;
  runs: UserRunRow[];
  /** Сколько раз игрок запускал каждый уровень какого режима. */
  history?: UserHistoryRow[];
  grants?: UserGrantRow[];
  ads?: Array<{ kind: string; n: number }>;
  byMode?: Array<{ mode: string; n: number }>;
  payments: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}

export interface LevelStatRow {
  level: number;
  played: number;
  players: number;
  won: number;
  lost: number;
  quit: number;
  active: number;
  /** Поражения в тупике: поле, где сходить некуда, то есть брак генератора. */
  stuck: number;
  winRate: number;
  attemptsPerPlayer: number;
  avgMoves: number;
  avgScore: number;
  /** Лучший счёт уровня: нужен режимам без победы, где меряют рекордом. */
  bestScore?: number;
  hints: number;
  freezes: number;
  undos: number;
  firstAt: number;
  lastAt: number;
}

export interface LevelStatsResponse {
  mode: 'campaign' | 'jam' | 'race';
  days: number;
  rows: LevelStatRow[];
  /** Заголовок колонки провалов: у «Парковки» это бюджет, у остальных тупики. */
  stuckLabel?: string;
  /** Режим без победы: вместо доли побед показываем рекорд и среднюю длину забега. */
  recordMode?: boolean;
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
  height?: number;
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
  signed?: string;
}

export interface DiagResponse {
  enabled: boolean;
  /** Активна ли отладочная переменная AUTH_DEBUG в запущенной версии. */
  authDebug?: boolean;
  /** Ключ подписи initData, который Telegram отдаёт по getWebAppAttachInfo. */
  webApp?: { present: boolean; note: string; checkedAt: number };
  /** Состояние схемы: хватает ли колонки прогресса режимов. */
  schema?: { version: number; usersColumns: string[]; modeLevels: boolean; note: string };
  runs?: { active: number; stale: number; byMode: Record<string, number>; oldestAt: number | null; note: string };
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
  /** Номер сборки воркера, см. version.json. */
  build?: number;
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
