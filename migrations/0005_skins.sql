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
