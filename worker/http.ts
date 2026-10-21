import type { Context } from 'hono';
import type { GameAction } from '../src/engine';
import type { AppEnv } from './types';

export class HttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function fail(status: number, code: string, message?: string, details?: Record<string, unknown>): never {
  throw new HttpError(status, code, message, details);
}

export async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const data = await c.req.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      fail(400, 'bad_request', 'Ожидается JSON-объект');
    }
    return data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, 'bad_request', 'Некорректный JSON');
  }
}

export function parseActions(value: unknown): GameAction[] {
  if (!Array.isArray(value)) fail(400, 'bad_request', 'actions должен быть массивом');
  if (value.length > 5000) fail(413, 'too_many_actions', 'Слишком длинная партия');

  const actions: GameAction[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') fail(400, 'bad_request', 'Некорректное действие');
    const action = item as Record<string, unknown>;
    if (action.type === 'move') {
      const dx = action.dx;
      if (dx !== -1 && dx !== 0 && dx !== 1) fail(400, 'bad_request', 'Некорректный dx');
      // dy принимаем только 1 или 2: двойной ход возможен с начальной позиции,
      // остальное сервер всё равно отвергнет правилами, но лучше отказать сразу.
      const dy = action.dy === undefined || action.dy === 1 ? 1 : action.dy === 2 ? 2 : fail(400, 'bad_request', 'Некорректный dy');
      actions.push(dy === 2 ? { type: 'move', dx, dy: 2 } : { type: 'move', dx });
    } else if (action.type === 'skip') {
      actions.push({ type: 'skip' });
    } else if (action.type === 'buff') {
      if (action.buff !== 'freeze' && action.buff !== 'shield') {
        fail(400, 'bad_request', 'Некорректный бонус');
      }
      actions.push({ type: 'buff', buff: action.buff });
    } else {
      fail(400, 'bad_request', 'Неизвестное действие');
    }
  }
  return actions;
}

export function jsonAction(action: GameAction): string {
  if (action.type === 'move') {
    // Канонический вид: отсутствие dy и dy=1 это одно и то же действие, иначе
    // сверка клиентской последовательности с серверной падала бы на двойном ходе.
    return action.dy === 2
      ? `{"type":"move","dx":${action.dx},"dy":2}`
      : `{"type":"move","dx":${action.dx}}`;
  }
  if (action.type === 'skip') return '{"type":"skip"}';
  return `{"type":"buff","buff":"${action.buff}"}`;
}

export function actionsEqual(a: GameAction, b: GameAction): boolean {
  return jsonAction(a) === jsonAction(b);
}

export function isPrefix(prefix: GameAction[], all: GameAction[]): boolean {
  if (prefix.length > all.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (!actionsEqual(prefix[i], all[i])) return false;
  }
  return true;
}

export function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

export function nowMs(): number {
  return Date.now();
}
