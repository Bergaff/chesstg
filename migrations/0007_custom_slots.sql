-- Свои темы живут слотами (итерация 49).
--
-- Раньше была одна тема на аккаунт и отдельный взнос за то, чтобы её показали
-- чужим. Модель поменялась: платят за место под свою тему, правки бесплатны,
-- код темы и показ в галерее тоже бесплатны. Поэтому:
--   `custom_slots`  - сколько мест куплено (1..3),
--   `skin_custom_2` - второй слот, `skin_custom_3` - третий,
--   `custom_active` - какой слот надет (1..3),
--   `custom_blocked` - темы игрока заморожены модератором (см. админку).
--
-- `skin_custom` остаётся первым слотом: данные никто не переносит и не стирает.
-- `custom_paid` (миграция 0006) не убираем: строки, купленные до этого выпуска,
-- читаются как «один слот», и возврат платежа умеет откатывать ровно флаг.

ALTER TABLE users ADD COLUMN custom_slots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN skin_custom_2 TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN skin_custom_3 TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN custom_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN custom_blocked INTEGER NOT NULL DEFAULT 0;

-- Купленная мастерская или уже нарисованная тема - один слот.
UPDATE users SET custom_slots = 1 WHERE custom_paid = 1 OR skin_custom <> '';
