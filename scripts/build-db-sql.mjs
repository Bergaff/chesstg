/**
 * Собирает migrations/*.sql в один файл docs/db-setup.sql для консоли D1
 * в панели Cloudflare. Нужен тем, кто работает без wrangler CLI.
 *
 * Запуск: npm run db:sql
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'migrations');
const outFile = join(root, 'docs', 'db-setup.sql');

const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
if (files.length === 0) {
  console.error('В migrations/ нет файлов .sql');
  process.exit(1);
}

const header = [
  '-- Край доски: полная схема боевой базы.',
  '-- Файл собран из migrations/*.sql скриптом npm run db:sql, руками его не правят.',
  '--',
  '-- Как применять: панель Cloudflare -> Workers & Pages -> D1 -> выбрать базу',
  '-- -> Console -> вставить этот текст -> Run. Запросов много, это нормально.',
  '-- Повторный запуск безопасен: все CREATE идут с IF NOT EXISTS.',
  '',
].join('\n');

const bookkeeping = [
  '',
  '-- Служебная таблица, в которую wrangler записывает применённые миграции.',
  '-- Отметки ниже нужны, чтобы `npm run db:remote` позже ничего не повторял.',
  'CREATE TABLE IF NOT EXISTS d1_migrations (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  name TEXT UNIQUE,',
  '  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL',
  ');',
  '',
  ...files.flatMap((name) => [`INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${name}');`]),
  '',
  '-- Проверка: должно вернуть 9 имён.',
  "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
  '',
].join('\n');

const body = files
  .map((name) => `-- ── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}\n${readFileSync(join(migrationsDir, name), 'utf8').trim()}\n`)
  .join('\n');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${header}${body}${bookkeeping}`, 'utf8');
console.log(`${outFile}: ${files.join(', ')}`);
