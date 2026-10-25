import type { WorkerEnv } from './types';

/**
 * Схема D1 и её проверка.
 *
 * `/api/health` раньше делал только `SELECT 1`: пустая база отвечала «всё
 * хорошо», а первый же запрос сессии падал с 500. Теперь health смотрит
 * реальные таблицы и говорит, чего не хватает.
 */

/** Таблицы без которых не работает игра. */
export const GAME_TABLES = ['users', 'runs', 'grants', 'ad_events', 'payments'] as const;

/** Таблицы админки и статистики (миграция 0002). */
export const ADMIN_TABLES = ['admin_attempts', 'events', 'level_checks', 'audit_runs'] as const;

/** Привязка сайта к Telegram (миграция 0003). Без неё игра работает, входа на сайте нет. */
export const AUTH_TABLES = ['auth_links'] as const;

/** Свои темы поля (миграция 0005). Без них игра играет, но галереи и студии нет. */
export const SKIN_TABLES = ['skin_shares'] as const;

export const REQUIRED_TABLES = [...GAME_TABLES, ...ADMIN_TABLES, ...AUTH_TABLES, ...SKIN_TABLES] as const;

/**
 * Номер последней миграции, на которую рассчитан код: 0006 добавила
 * `users.custom_paid` - право носить свою тему, купленное отдельно от тем
 * готовых. 0005 добавила `users.skin_custom` и очередь публикаций. Колонка
 * `users.mode_levels` из 0004 проверяется в диагностике админки
 * (`GET /api/admin/diag` раздел «Схема базы»): без неё игра работает, но
 * прогресс «Парковки» и «Гонок» не сохраняется.
 */
export const SCHEMA_VERSION = 6;

export interface SchemaState {
  tables: Record<string, boolean>;
  /** Нет ни одной таблицы игры: приложение не запустится. */
  missingGame: string[];
  /** Игра работает, статистика и защита входа нет. */
  missingAdmin: string[];
  /** Нет таблицы привязки сайта: вход на сайте не работает, игра работает. */
  missingAuth: string[];
  /** Нет очереди публикаций: своя тема работает, галерея - нет. */
  missingSkins: string[];
  /** Всего таблиц в базе, включая служебные. */
  total: number;
}

interface TableRow {
  name: string;
}

export async function readSchema(env: WorkerEnv): Promise<SchemaState> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all<TableRow>();

  const names = new Set((results ?? []).map((row) => String(row.name)));
  const tables: Record<string, boolean> = {};
  for (const table of REQUIRED_TABLES) tables[table] = names.has(table);

  return {
    tables,
    missingGame: GAME_TABLES.filter((table) => !names.has(table)),
    missingAdmin: ADMIN_TABLES.filter((table) => !names.has(table)),
    missingAuth: AUTH_TABLES.filter((table) => !names.has(table)),
    missingSkins: SKIN_TABLES.filter((table) => !names.has(table)),
    total: names.size,
  };
}

/** Ошибка D1, а не логическая ошибка кода. */
export function isDatabaseError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /D1_ERROR|no such table|no such column|SQLITE_ERROR|database is locked|Failed to prepare SQL/i.test(text);
}
