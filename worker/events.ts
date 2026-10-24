import type { WorkerEnv } from './types';

/**
 * Журнал событий для админки. Запись не должна ломать основной запрос,
 * поэтому ошибки глушатся: статистика вторична по отношению к игре.
 */

export type EventKind =
  | 'coins_earned'
  | 'coins_spent'
  | 'life_lost'
  | 'ad_reward'
  | 'purchase'
  | 'refund'
  | 'bonus_used'
  /** Витрину открыли: без этого числа доля покупателей считается неоткуда. */
  | 'shop_open';

export interface EventMeta {
  [key: string]: string | number | boolean | null;
}

export async function logEvent(
  env: WorkerEnv,
  userId: string,
  kind: EventKind,
  value = 0,
  meta?: EventMeta,
): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO events (user_id, kind, value, meta, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(userId, kind, value, meta ? JSON.stringify(meta) : null, Date.now())
      .run();
  } catch (error) {
    console.warn('event_log_failed', kind, error instanceof Error ? error.message : String(error));
  }
}

/** Запись события без ожидания: воркер не должен ждать журнал. */
export function logEventInBackground(
  env: WorkerEnv,
  ctx: { waitUntil: (task: Promise<unknown>) => void } | undefined,
  userId: string,
  kind: EventKind,
  value = 0,
  meta?: EventMeta,
): void {
  const task = logEvent(env, userId, kind, value, meta);
  try {
    if (ctx) {
      ctx.waitUntil(task);
      return;
    }
  } catch {
    // Контекст выполнения доступен не всегда (тесты, локальные вызовы).
  }
  void task;
}
