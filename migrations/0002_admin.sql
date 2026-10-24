-- Админка: попытки входа, журнал событий, история проверок уровней и отчётов.

-- Попытки входа в админку (защита от перебора пароля)
CREATE TABLE IF NOT EXISTS admin_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_attempts_ip ON admin_attempts (ip, created_at DESC);

-- События экономики: начисление и трата монет, потеря жизни, реклама, покупки
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  meta TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_kind ON events (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user ON events (user_id, created_at DESC);

-- Результаты проверки генератора по уровням (кэш для админки)
CREATE TABLE IF NOT EXISTS level_checks (
  level INTEGER PRIMARY KEY,
  seeds INTEGER NOT NULL,
  total INTEGER NOT NULL,
  solvable INTEGER NOT NULL,
  avg_score INTEGER NOT NULL,
  min_score INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  avg_pieces REAL NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);

-- Сохранённые отчёты лаборатории
CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  spec TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_runs_created ON audit_runs (created_at DESC);
