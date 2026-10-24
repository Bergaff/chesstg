-- Край доски: полная схема боевой базы.
-- Файл собран из migrations/*.sql скриптом npm run db:sql, руками его не правят.
--
-- Как применять: панель Cloudflare -> Workers & Pages -> D1 -> выбрать базу
-- -> Console -> вставить этот текст -> Run. Запросов много, это нормально.
-- Повторный запуск безопасен: все CREATE идут с IF NOT EXISTS.
-- ── 0001_init.sql ───────────────────────────────────────────────
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

-- ── 0002_admin.sql ──────────────────────────────────────────────
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

-- ── 0003_auth_link.sql ──────────────────────────────────────────
-- Привязка сайта к Telegram через бота.
--
-- Сайт не знает, кто перед ним: есть только гостевой идентификатор в
-- localStorage. Игрок нажимает «Привязать Telegram», получает одноразовый код,
-- открывается чат бота с кнопками «Да» и «Нет». Подтверждение живёт несколько
-- минут и используется один раз: по нему воркер выдаёт токен сеанса.
CREATE TABLE IF NOT EXISTS auth_links (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  user_id TEXT,
  first_name TEXT NOT NULL DEFAULT '',
  username TEXT,
  tg_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_links_guest ON auth_links (guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_links_status ON auth_links (status, created_at DESC);

-- ── 0004_mode_levels.sql ────────────────────────────────────────
-- Прогресс режимов, где есть номер уровня, кроме кампании: «Парковка» и «Гонки».
--
-- Отдельные колонки на режим означали бы миграцию каждый раз, когда в лаборатории
-- появляется новый режим с уровнем, поэтому прогресс живёт в одном JSON-поле.
-- Кампания по-прежнему в users.level и users.max_level: их меняет только её
-- победа, на них смотрят разблокировки фигур и бесконечного режима.
ALTER TABLE users ADD COLUMN mode_levels TEXT NOT NULL DEFAULT '{}';

-- Статистика прохождений в админке группирует забеги по режиму и уровню.
CREATE INDEX IF NOT EXISTS idx_runs_level_mode ON runs (mode, level, created_at DESC);

-- ── 0005_skins.sql ──────────────────────────────────────────────
-- Темы поля: своя тема бесплатна, публикация стоит звёзд.
--
-- `skin_custom` - JSON темы, которую игрок собрал сам (или установил из
-- галереи). Она живёт отдельной колонкой, а не в CSV `skins`: список купленных
-- тем - ключ выплат и возвратов, и примешивать к нему произвольный JSON значит
-- однажды потерять чужую покупку при парсе. Сюда же кладётся контур фигуры,
-- нарисованный пальцем: путь SVG, а не растр, - на клетке в 36 пикселей важен
-- край, а не пиксели.
ALTER TABLE users ADD COLUMN skin_custom TEXT NOT NULL DEFAULT '';

-- Очередь публикаций. Тема попадает сюда черновиком на время платежа, затем
-- ждёт проверки, и только потом её видят чужие. Черновик обязателен: платёж
-- приходит асинхронно, и между «деньги списаны» и «тема в очереди» база не
-- должна делать вид, что заявки нет.
CREATE TABLE IF NOT EXISTS skin_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  charge_id TEXT,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  note TEXT NOT NULL DEFAULT '',
  installs INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_skin_shares_status ON skin_shares (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skin_shares_user ON skin_shares (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skin_shares_charge ON skin_shares (charge_id);

-- Служебная таблица, в которую wrangler записывает применённые миграции.
-- Отметки ниже нужны, чтобы `npm run db:remote` позже ничего не повторял.
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_init.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0002_admin.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0003_auth_link.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0004_mode_levels.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0005_skins.sql');

-- Проверка: вернутся все таблицы базы, включая d1_migrations.
-- Число таблиц руками не держим - оно меняется с каждой миграцией.
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
