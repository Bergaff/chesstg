import type { Context } from 'hono';
import { PLAYABLE_MODES, type GameMode, type JamAction, type RunAction } from '../src/engine';
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

/**
 * Параметры старта забега. `repeat: true` значит «дай ту же расстановку уровня»,
 * а не новую: после поражения игрок выбирает, переигрывать поле или получить
 * сгенерированное заново.
 */
export function parseStartOptions(value: unknown): { repeat: boolean } {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return { repeat: body.repeat === true || body.repeat === 'true' };
}

/**
 * Режим забега. Принимается только боевой список: лабораторные варианты правил
 * (диагональ, уход фигур, уклонение) сюда не проходят, иначе игрок мог бы
 * попросить у сервера расстановку с чужими правилами.
 */
export function parseRunMode(value: unknown): GameMode | null {
  if (typeof value !== 'string') return null;
  return (PLAYABLE_MODES as readonly string[]).includes(value) ? (value as GameMode) : null;
}

/**
 * Журнал действий. Для «Парковки» это перестановки фигур, для всех остальных
 * режимов - ходы пешки, пропуски и бонусы. Режим передаётся явно, иначе игрок
 * мог бы подсунуть головоломке чужие действия и наоборот.
 */
export function parseActions(value: unknown, mode: GameMode): RunAction[] {
  if (!Array.isArray(value)) fail(400, 'bad_request', 'actions должен быть массивом');
  if (value.length > 5000) fail(413, 'too_many_actions', 'Слишком длинная партия');

  const actions: RunAction[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') fail(400, 'bad_request', 'Некорректное действие');
    const action = item as Record<string, unknown>;
    if (mode === 'jam') {
      if (action.type !== 'piece') fail(400, 'bad_request', 'В «Парковке» только перестановки фигур');
      const id = typeof action.id === 'string' ? action.id.slice(0, 24) : '';
      if (!id) fail(400, 'bad_request', 'Не указан id фигуры');
      const to = action.to as Record<string, unknown> | undefined;
      const x = Number(to?.x);
      const y = Number(to?.y);
      // y = -1 и y = height - клетки ухода за край: они вне поля по определению,
      // поэтому рамка проверки на единицу шире с каждой стороны. Легальность
      // всё равно считает движок.
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 40 || y < -1 || y > 41) {
        fail(400, 'bad_request', 'Некорректная клетка');
      }
      actions.push({ type: 'piece', id, to: { x, y } } as JamAction);
      continue;
    }
    if (action.type === 'move') {
      const dx = action.dx;
      if (dx !== -1 && dx !== 0 && dx !== 1) fail(400, 'bad_request', 'Некорректный dx');
      // dy: 1 обычный ход, 2 двойной шаг с начальной позиции, 0 шаг в своём ряду
      // и -1 ход назад (король в «Гонках»). Остальное сервер всё равно отвергнет
      // правилами, но лучше отказать сразу.
      const dy =
        action.dy === undefined || action.dy === 1
          ? 1
          : action.dy === -1 || action.dy === 0 || action.dy === 2
            ? action.dy
            : fail(400, 'bad_request', 'Некорректный dy');
      actions.push(dy === 1 ? { type: 'move', dx } : { type: 'move', dx, dy });
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

/** Прежний разбор для тестов и мест, где режим заведомо пешечный. */
export function parsePawnActions(value: unknown): RunAction[] {
  return parseActions(value, 'campaign');
}

export function jsonAction(action: RunAction): string {
  // Канонический вид важен для сверки истории: отсутствие dy и dy=1 это одно и
  // то же действие, иначе проверка префикса падала бы на двойном ходе.
  if (action.type === 'piece') {
    return `{"type":"piece","id":"${action.id}","to":{"x":${action.to.x},"y":${action.to.y}}}`;
  }
  if (action.type === 'move') {
    // dy=1 не пишем: это значение по умолчанию, а dy=0 и dy=2 значимы и должны
    // отличаться в канонической строке, иначе сверка журнала перепутает ходы.
    return action.dy === undefined || action.dy === 1
      ? `{"type":"move","dx":${action.dx}}`
      : `{"type":"move","dx":${action.dx},"dy":${action.dy}}`;
  }
  if (action.type === 'skip') return '{"type":"skip"}';
  return `{"type":"buff","buff":"${action.buff}"}`;
}

export function actionsEqual(a: RunAction, b: RunAction): boolean {
  return jsonAction(a) === jsonAction(b);
}

export function isPrefix(prefix: RunAction[], all: RunAction[]): boolean {
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
