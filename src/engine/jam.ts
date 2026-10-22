// «Парковка»: поле забито фигурами двух цветов, и их нужно увести.
//
// Ходит игрок: берёт любую фигуру и гонит её по её правилу. Шаг за край поля
// фигуру снимает навсегда, и тогда к этому краю можно подвести другую. Белые
// уходят за нижний край, чёрные за верхний: обе стороны едут от чужой половины,
// поэтому пробка расходится с двух сторон и не превращается в гонку к одному
// ряду. Взятий нет: чужую фигуру нельзя съесть, можно только обойти.
//
// Решаемость здесь не «собирается из решённой позиции обратными ходами», как
// это было у задачи «разойтись половинами»: уход с поля необратим, поэтому
// обратный след построить нельзя. Вместо него генератор ищет план самим
// решателем (`solveJamExits`), и от него же считаются бюджет ходов и подсказка.

import { mix32, Rng } from './rng';
import type { Cell } from './types';

export type JamPieceType = 'rook' | 'bishop' | 'knight';
export type JamSide = 'white' | 'black';

export interface JamPiece {
  id: string;
  type: JamPieceType;
  side: JamSide;
  x: number;
  y: number;
}

export interface JamAction {
  type: 'piece';
  id: string;
  to: Cell;
}

export interface JamState {
  version: 2;
  mode: 'jam';
  width: number;
  height: number;
  pieces: JamPiece[];
  moves: number;
  /** Сколько перестановок дано: кончилось - партия проиграна. */
  budget: number;
  /** Сколько фигур было на поле. */
  total: number;
  /** Сколько фигур уже увело с поля: это счёт забега. */
  removed: number;
  /** То же, что `removed`: поле нужно общим местам, где счёт читают по `score`. */
  score: number;
  status: 'playing' | 'won' | 'lost';
  level: number;
  seed: number;
  lastMove?: { id: string; from: Cell; to: Cell };
  lastEvent?: string;
  /**
   * План, найденный генератором: им же строится подсказка. Клиенту не
   * отдаётся (`serializeRun` вырезает поле), иначе подсказка была бы бесплатной.
   */
  plan?: JamAction[];
}

export const JAM_PIECE_NAME: Record<JamPieceType, string> = {
  rook: 'Ладья',
  bishop: 'Слон',
  knight: 'Конь',
};

export const JAM_PIECE_GLYPH: Record<JamPieceType, string> = {
  rook: '♜',
  bishop: '♝',
  knight: '♞',
};

const TYPE_WEIGHTS: Array<[JamPieceType, number]> = [
  ['rook', 0.45],
  ['bishop', 0.3],
  ['knight', 0.25],
];

/** Геометрия поля. Ширина растёт медленнее высоты: ряды и есть «пробка». */
export function jamBoard(level: number): { width: number; height: number } {
  const width = level <= 10 ? 5 : 6;
  const height = level <= 6 ? 6 : level <= 16 ? 7 : 8;
  return { width, height };
}

/** Доля занятых клеток. Выше 0.66 пробка не расходится по-человечески. */
export function jamDensity(level: number): number {
  return Math.min(0.66, 0.4 + level * 0.012);
}

/** Сколько фигур нужно увести с поля на данном уровне. */
export function jamPieces(level: number): number {
  const { width, height } = jamBoard(level);
  return Math.max(4, Math.round(width * height * jamDensity(level)));
}

/**
 * Целевая длина решения в ходах: генератор ищет расстановку, которая решается
 * примерно за столько. Числа сняты с замера решателя (40 полей на уровень),
 * линейка - 1.6 хода на фигуру плюс один ход на уровень как натяжение пробки.
 */
export function jamTargetCost(level: number): number {
  return Math.round(jamPieces(level) * 1.6 + level * 0.6);
}

/**
 * Ходов дано с запасом: на первых уровнях можно ходить наугад, к тридцатому
 * приходится считать. Основа - длина плана решателя, но игрок обычно решает
 * короче, чем искал жадный перебор, поэтому запас сверху небольшой: 1.9 плана на
 * первом уровне и 1.35 на сороковом. Ниже 1.35 опускаться некуда: сам план жадный,
 * он уже длиннее человеческого, и запас считается от заведомо плохой оценки.
 */
export function jamBudget(level: number, cost = jamTargetCost(level)): number {
  const factor = Math.max(1.35, 1.9 - level * 0.02);
  const slack = Math.max(3, 6 - Math.floor(level / 6));
  return Math.round(cost * factor) + slack;
}

/**
 * Форма состояния-головоломки. Проверяем не только `mode`: у старой песочницы
 * состояние тоже помечено как `jam`, а у прежней «разойдись половинами» нет
 * счётчика уведённых фигур. Ложное срабатывание роняет экран, поэтому версия
 * входит в проверку.
 */
export function isJamState(state: unknown): state is JamState {
  if (!state || typeof state !== 'object') return false;
  const candidate = state as { mode?: unknown; pieces?: unknown; removed?: unknown; version?: unknown };
  return (
    candidate.mode === 'jam' &&
    candidate.version === 2 &&
    Array.isArray(candidate.pieces) &&
    typeof candidate.removed === 'number'
  );
}

/** За какой край уходит фигура: белые за нижний, чёрные за верхний. */
export function jamExitRow(state: Pick<JamState, 'height'>, side: JamSide): number {
  return side === 'white' ? -1 : state.height;
}

/** Ряд, где фигура уже у края и может сойти с поля прямым шагом. */
export function jamAtEdge(state: Pick<JamState, 'height'>, piece: JamPiece): boolean {
  const edge = jamExitRow(state, piece.side);
  return piece.side === 'white' ? piece.y <= 1 : piece.y >= state.height - 2;
}

export function jamSolved(state: Pick<JamState, 'pieces'>): boolean {
  return state.pieces.length === 0;
}

function pieceAt(pieces: JamPiece[], x: number, y: number, exceptId?: string): JamPiece | undefined {
  return pieces.find((piece) => piece.x === x && piece.y === y && piece.id !== exceptId);
}

export function jamPieceById(state: JamState, id: string): JamPiece | undefined {
  return state.pieces.find((piece) => piece.id === id);
}

interface Board {
  width: number;
  height: number;
  pieces: JamPiece[];
}

function linesFor(type: JamPieceType): Array<[number, number]> {
  if (type === 'rook') {
    return [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
  }
  if (type === 'bishop') {
    return [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
  }
  return [];
}

const KNIGHT_OFFSETS: Array<[number, number]> = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
];

/**
 * Куда может уехать фигура. Ладья и слон скользят до первой занятой клетки,
 * конь перепрыгивает. Все ходы внутри поля, уход за край считается отдельно
 * (`jamExitCells`), чтобы у клетки выхода был свой адрес в журнале.
 */
export function jamPieceMoves(board: Board, piece: JamPiece, at?: Cell): Cell[] {
  const from = at ?? piece;
  const out: Cell[] = [];
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < board.width && y < board.height;
  const free = (x: number, y: number) => inside(x, y) && pieceAt(board.pieces, x, y, piece.id) === undefined;

  if (piece.type === 'knight') {
    for (const [dx, dy] of KNIGHT_OFFSETS) {
      if (free(from.x + dx, from.y + dy)) out.push({ x: from.x + dx, y: from.y + dy });
    }
    return out;
  }

  const reach = Math.max(board.width, board.height);
  for (const [dx, dy] of linesFor(piece.type)) {
    for (let step = 1; step < reach; step++) {
      const x = from.x + dx * step;
      const y = from.y + dy * step;
      if (!inside(x, y)) break;
      if (pieceAt(board.pieces, x, y, piece.id)) break;
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * Клетки ухода: куда фигура staje, чтобы покинуть поле. Считаем по тому же
 * правилу движения, что и обычные ходы, но стоп-клеткой считаем выход за
 * горизонталь края. Угол поля слон проходит по диагонали, конь перепрыгивает
 * строку, ладья съезжает по колонке.
 */
export function jamExitCells(board: Board, piece: JamPiece, at?: Cell): Cell[] {
  const from = at ?? piece;
  const edge = jamExitRow(board, piece.side);
  const toward = piece.side === 'white' ? -1 : 1;
  const insideColumn = (x: number) => x >= 0 && x < board.width;
  const blocked = (x: number, y: number) => pieceAt(board.pieces, x, y, piece.id) !== undefined;
  const out: Cell[] = [];

  if (piece.type === 'knight') {
    for (const [dx, dy] of KNIGHT_OFFSETS) {
      if (Math.sign(dy) !== toward) continue;
      const x = from.x + dx;
      const y = from.y + dy;
      // Прыжок считается уходом, только если конь пересекает горизонталь края,
      // а не сваливается за боковую стенку.
      if (!insideColumn(x)) continue;
      if (toward < 0 ? y > edge : y < edge) continue;
      out.push({ x, y: edge });
    }
    return out;
  }

  for (const [dx, dy] of linesFor(piece.type)) {
    if (Math.sign(dy) !== toward) continue;
    const reach = Math.max(board.width, board.height) + 2;
    for (let step = 1; step < reach; step++) {
      const x = from.x + dx * step;
      const y = from.y + dy * step;
      // За боковую стенку уходить нельзя: край для нас горизонталь.
      if (!insideColumn(x)) break;
      if (y === edge) {
        out.push({ x, y: edge });
        break;
      }
      if (blocked(x, y)) break;
    }
  }
  return out;
}

/** Все клетки, доступные фигуре за один ход: и внутрь поля, и на выход. */
export function jamPieceTargets(board: Board, piece: JamPiece): Cell[] {
  return [...jamPieceMoves(board, piece), ...jamExitCells(board, piece)];
}

export function jamLegalActions(state: JamState): JamAction[] {
  if (state.status !== 'playing') return [];
  const actions: JamAction[] = [];
  for (const piece of state.pieces) {
    for (const cell of jamPieceTargets(state, piece)) actions.push({ type: 'piece', id: piece.id, to: cell });
  }
  return actions;
}

/** Все ходы фигур: нужен списку подсказок и таблице ходов. */
export function jamMoveTable(board: Board): Array<{ id: string; moves: Cell[] }> {
  return board.pieces.map((piece) => ({ id: piece.id, moves: jamPieceTargets(board, piece) }));
}

function weightedType(rng: Rng): JamPieceType {
  const total = TYPE_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [type, weight] of TYPE_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return 'rook';
}

/**
 * Решатель: порядок, в котором фигуры уходят с поля, и число ходов на это.
 *
 * Жадность здесь честная: для каждой оставшейся фигуры ищем кратчайший путь к
 * её краю по тем же правилам, что и игра (остальные фигуры - стены), и берём
 * фигуру с минимальной ценой. Так поле не «решается» потому, что мы его так
 * собрали: если план найден, он план именно для этой расстановки. Если не найден,
 * расстановка в уровень не идёт.
 */
export interface JamPlan {
  ok: boolean;
  moves: JamAction[];
  /** Сколько ходов ушло на каждую фигуру, в порядке ухода. */
  costs: number[];
}

interface PathNode {
  x: number;
  y: number;
  parent: PathNode | null;
}

/** Кратчайший путь фигуры к клетке ухода. Возвращает список ходов, включая сам уход. */
function jamPathToExit(board: Board, piece: JamPiece, maxNodes = 4000): JamAction[] | null {
  const start: PathNode = { x: piece.x, y: piece.y, parent: null };
  const queue: PathNode[] = [start];
  const seen = new Set<string>([`${piece.x},${piece.y}`]);
  let nodes = 0;

  while (queue.length > 0 && nodes++ < maxNodes) {
    const node = queue.shift() as PathNode;
    const exits = jamExitCells(board, piece, node);
    if (exits.length > 0) {
      const moves: JamAction[] = [{ type: 'piece', id: piece.id, to: exits[0] }];
      for (let step = node; step.parent; step = step.parent) {
        moves.push({ type: 'piece', id: piece.id, to: { x: step.x, y: step.y } });
      }
      return moves.reverse();
    }
    for (const cell of jamPieceMoves(board, piece, node)) {
      const key = `${cell.x},${cell.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: cell.x, y: cell.y, parent: node });
    }
  }
  return null;
}

/** Цена фигуры в ходах: путь до края плюс сам уход, либо null, если не дойти. */
function jamPieceCost(board: Board, piece: JamPiece): JamAction[] | null {
  return jamPathToExit(board, piece);
}

export function solveJamExits(
  state: Pick<JamState, 'width' | 'height' | 'pieces'>,
  options: { rng?: Rng } = {},
): JamPlan {
  const pieces = state.pieces.map((piece) => ({ ...piece }));
  const board: Board = { width: state.width, height: state.height, pieces };
  const moves: JamAction[] = [];
  const costs: number[] = [];
  const rng = options.rng;

  while (pieces.length > 0) {
    const paths: Array<{ id: string; path: JamAction[] }> = [];
    for (const piece of pieces) {
      const path = jamPieceCost(board, piece);
      if (path) paths.push({ id: piece.id, path });
    }
    if (paths.length === 0) return { ok: false, moves: [], costs };
    // Среди одинаково дешёвых фигуру выбираем случайно: иначе генератор каждый
    // раз снимал бы одну и ту же, и расстановки отличались бы только на глаз.
    paths.sort((a, b) => a.path.length - b.path.length || (a.id < b.id ? -1 : 1));
    const floor = paths.filter((entry) => entry.path.length === paths[0].path.length);
    const chosen = rng && floor.length > 1 ? floor[rng.int(floor.length)] : floor[0];

    for (const move of chosen.path) moves.push(move);
    costs.push(chosen.path.length);
    const index = pieces.findIndex((piece) => piece.id === chosen.id);
    const last = chosen.path[chosen.path.length - 1];
    // Последняя клетка пути за краем: фигуру снимаем, она больше не стена.
    if (last.to.y < 0 || last.to.y >= state.height) pieces.splice(index, 1);
    else {
      pieces[index] = { ...pieces[index], x: last.to.x, y: last.to.y };
    }
  }
  return { ok: true, moves, costs };
}

function cloneJamBoard(state: Pick<JamState, 'width' | 'height' | 'pieces'>): Board {
  return { width: state.width, height: state.height, pieces: state.pieces.map((piece) => ({ ...piece })) };
}

/**
 * Расстановка: плотное поле, половина фигур белые, половина чёрные. Цвета не
 * перемешиваем порядам: иначе на первых уровнях обе стороны стоят вперемешку и
 * уходить мешает сосед, а не пробка.
 */
function buildLayout(args: { width: number; height: number; total: number; rng: Rng }): JamPiece[] {
  const { width, height, total, rng } = args;
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push({ x, y });
  rng.shuffle(cells);
  const taken = cells.slice(0, Math.min(total, cells.length));
  const pieces: JamPiece[] = [];
  let id = 0;
  for (const cell of taken) {
    // Белые занимают нижнюю половину, чёрные верхнюю: уходить каждой стороне
    // нужно к своему краю, и пробка расходится с двух сторон.
    const side: JamSide = cell.y < height / 2 ? 'black' : 'white';
    pieces.push({ id: `p${id++}`, type: weightedType(rng), side, x: cell.x, y: cell.y });
  }
  return pieces;
}

/**
 * Генератор уровня: перебираем расстановки, берём ту, чьё решение ближе всего
 * к целевой длине уровня. Слишком короткие отбрасываем: поле, которое
 * расходится за три хода, не задача, а загрузка.
 */
export function createJamPuzzle(level: number, seed: number, attempts = 24): JamState {
  const { width, height } = jamBoard(level);
  const total = Math.min(jamPieces(level), width * height - 2);
  const target = jamTargetCost(level);
  let best: { pieces: JamPiece[]; plan: JamPlan } | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const rng = new Rng(mix32(seed, attempt, 0x1a9c0de5, level, width, height));
    const pieces = buildLayout({ width, height, total, rng });
    const plan = solveJamExits({ width, height, pieces }, { rng });
    if (!plan.ok || plan.moves.length < 3) continue;
    const quality = -Math.abs(plan.moves.length - target);
    if (!best || quality > -Math.abs(best.plan.moves.length - target)) best = { pieces, plan };
    // Попали в полосу - дальше не ищем: генератор вызывается на каждый старт.
    if (Math.abs(plan.moves.length - target) <= 2) break;
  }

  if (!best) {
    // Ни одна расстановка не решилась: отдаём последнюю просмотренную и просим
    // 3 хода запаса, а админке по `lastEvent` видно, на каких уровнях генератор
    // откатился.
    const rng = new Rng(mix32(seed, attempts, 0x1a9c0de5, level, width, height));
    const pieces = buildLayout({ width, height, total, rng });
    const plan = solveJamExits({ width, height, pieces }, { rng });
    return {
      version: 2,
      mode: 'jam',
      width,
      height,
      pieces,
      moves: 0,
      budget: jamBudget(level, Math.max(4, plan.moves.length)),
      total: pieces.length,
      removed: 0,
      score: 0,
      status: 'playing',
      level,
      seed,
      lastEvent: 'fallback',
      plan: plan.ok ? plan.moves : undefined,
    };
  }

  const cost = best.plan.moves.length;
  return {
    version: 2,
    mode: 'jam',
    width,
    height,
    pieces: best.pieces,
    moves: 0,
    budget: jamBudget(level, cost),
    total: best.pieces.length,
    removed: 0,
    score: 0,
    status: 'playing',
    level,
    seed,
    lastEvent: 'level',
    plan: best.plan.moves,
  };
}

/**
 * Подсказка: первый шаг плана, если он сейчас легален. Игрок мог сходить не по
 * плану, тогда план пересобираем на текущей позиции: решатель дешёвый, и
 * пересборка стоит меньше, чем держать игрока в тупике.
 */
export function jamHint(state: JamState): JamAction | null {
  if (state.status !== 'playing') return null;
  const board = cloneJamBoard(state);
  const positions = new Map(state.pieces.map((piece) => [piece.id, piece]));

  for (const move of state.plan ?? []) {
    const piece = positions.get(move.id);
    if (!piece) continue;
    const targets = jamPieceTargets(board, piece);
    if (targets.some((cell) => cell.x === move.to.x && cell.y === move.to.y)) return move;
    // План разошёлся с позицией: дальше пробуем пересобрать, а не угадывать.
    break;
  }

  const plan = solveJamExits(board);
  if (plan.ok && plan.moves.length > 0) return plan.moves[0];
  const actions = jamLegalActions(state);
  return actions.length > 0 ? actions[0] : null;
}

/** Сколько фигур уже уведено: нужно и экрану, и счёт. */
export function jamRemovedCount(state: Pick<JamState, 'total' | 'pieces'>): number {
  return Math.max(0, state.total - state.pieces.length);
}

export function cloneJamState(state: JamState): JamState {
  return { ...state, pieces: state.pieces.map((piece) => ({ ...piece })), plan: state.plan ? [...state.plan] : undefined };
}

/** Применить действие. Ошибки правил - то же RuleError, что и у пешечных режимов. */
export function applyJamAction(previous: JamState, action: JamAction, RuleErrorCtor: new (message: string) => Error): JamState {
  if (previous.status !== 'playing') throw new RuleErrorCtor('Партия уже завершена');
  if (action.type !== 'piece') throw new RuleErrorCtor('Неизвестное действие');
  const state = cloneJamState(previous);
  const piece = state.pieces.find((entry) => entry.id === action.id);
  if (!piece) throw new RuleErrorCtor('Фигуры с таким id нет');

  const exiting = action.to.y < 0 || action.to.y >= state.height;
  if (action.to.x < 0 || action.to.x >= state.width) throw new RuleErrorCtor('За границей поля');
  const legal = exiting
    ? jamExitCells(state, piece).some((cell) => cell.x === action.to.x && cell.y === action.to.y)
    : jamPieceMoves(state, piece).some((cell) => cell.x === action.to.x && cell.y === action.to.y);
  if (!legal) throw new RuleErrorCtor(exiting ? 'Фигура не может уйти с этого поля' : 'Фигура так не ходит');

  const from = { x: piece.x, y: piece.y };
  if (exiting) {
    state.pieces = state.pieces.filter((entry) => entry.id !== piece.id);
    state.removed += 1;
    state.lastEvent = 'exit';
  } else {
    if (pieceAt(state.pieces, action.to.x, action.to.y, piece.id)) throw new RuleErrorCtor('Клетка занята');
    piece.x = action.to.x;
    piece.y = action.to.y;
    state.lastEvent = 'move';
  }
  state.moves += 1;
  state.score = jamRemovedCount(state);
  state.lastMove = { id: piece.id, from, to: { ...action.to } };

  if (jamSolved(state)) {
    state.status = 'won';
    state.lastEvent = 'won';
    return state;
  }
  if (state.moves >= state.budget) {
    state.status = 'lost';
    state.lastEvent = 'budget';
  }
  return state;
}

export function applyJamActions(initial: JamState, actions: JamAction[], RuleErrorCtor: new (message: string) => Error): JamState {
  let state = initial;
  for (const action of actions) state = applyJamAction(state, action, RuleErrorCtor);
  return state;
}
