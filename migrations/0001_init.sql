-- Пользователи
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tg_id INTEGER UNIQUE,
  first_name TEXT NOT NULL DEFAULT '',
  username TEXT,
  is_guest INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  max_level INTEGER NOT NULL DEFAULT 1,
  coins INTEGER NOT NULL DEFAULT 0,
  lives INTEGER NOT NULL DEFAULT 5,
  lives_at INTEGER NOT NULL,
  endless_best INTEGER NOT NULL DEFAULT 0,
  endless_best_tier INTEGER NOT NULL DEFAULT 1,
  endless_best_moves INTEGER NOT NULL DEFAULT 0,
  ad_free INTEGER NOT NULL DEFAULT 0,
  skins TEXT NOT NULL DEFAULT 'classic',
  skin TEXT NOT NULL DEFAULT 'classic',
  inv_hint INTEGER NOT NULL DEFAULT 0,
  inv_freeze INTEGER NOT NULL DEFAULT 0,
  inv_undo INTEGER NOT NULL DEFAULT 0,
  invite_code TEXT NOT NULL,
  referred_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users (invite_code);
CREATE INDEX IF NOT EXISTS idx_users_endless_best ON users (endless_best DESC);
CREATE INDEX IF NOT EXISTS idx_users_max_level ON users (max_level DESC);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by);

-- Забеги (один активный на режим)
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  seed INTEGER NOT NULL,
  initial_state TEXT NOT NULL,
  actions TEXT NOT NULL DEFAULT '[]',
  moves INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  result TEXT,
  finish_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_runs_user_mode ON runs (user_id, mode, status, created_at DESC);

-- Выданные бонусы (привязка к позиции в логе действий)
CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  action_index INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_grants_run ON grants (run_id);

-- Реклама: отметки для кулдаунов и аудита
CREATE TABLE IF NOT EXISTS ad_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_events_user ON ad_events (user_id, kind, created_at DESC);

-- Платежи в Telegram Stars
CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  stars INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  telegram_charge_id TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id, created_at DESC);
