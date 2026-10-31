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
