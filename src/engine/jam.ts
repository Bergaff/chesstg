// «Парковка»: поле забито припаркованными фигурами двух цветов. Взятий нет,
// фигуры не ходят сами. Ходит игрок: берёт любую фигуру и перегоняет её по
// её же правилу на свободную клетку. Цель - разойтись половинами: все белые
// фигуры на верхнюю (чёрную) половину, все чёрные на нижнюю (белую).
//
// Такая постановка даёт две вещи. Во-первых, задача гарантированно решаема:
// расстановка собирается из решённой позиции обратными ходами, поэтому решение
// длиной не больше числа перестановок существует всегда. Во-вторых, разбор не
// нужен для проверки решаемости, он нужен только для подсказок и замеров.

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
  version: 1;
  mode: 'jam';
  width: number;
  height: number;
  /** Ряд, с которого начинается верхняя половина: туда идут белые. */
  mid: number;
  pieces: JamPiece[];
  moves: number;
  /** Сколько перестановок дано: кончилось - партия проиграна. */
  budget: number;
  /** Сколько фигур уже на чужой половине: это прогресс-бар и счёт забега. */
  score: number;
  status: 'playing' | 'won' | 'lost';
  level: number;
  seed: number;
  lastMove?: { id: string; from: Cell; to: Cell };
  lastEvent?: string;
  /**
   * След перемешивания: чем именно расставляли решённое поле. Из него по
   * обратной ссылке собирается гарантированное решение (jamSolution), поэтому
   * решаемость не нужно искать перебором. Клиенту не отдаётся: serializeRun
   * вырезает поле, иначе подсказка бесплатно решала бы уровень.
   */
  scramble?: Array<{ id: string; from: Cell; to: Cell }>;
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

/** Доля занятых клеток. Выше 0.66 пробка становится нерешаемой по-человечески. */
export function jamDensity(level: number): number {
  return Math.min(0.66, 0.4 + level * 0.012);
}

/** Число перестановок, которыми перемешано решённое поле. */
export function jamScramble(level: number): number {
  return Math.min(60, 7 + Math.round(level * 1.6));
}

/**
 * Ходов дано. Запас тает с уровнем: на первых уровнях можно ходить наугад, к
 * тридцатому приходится считать. Основа - длина перемешивания, но игрок обычно
 * решает короче, чем перемешивали, поэтому запас сверху небольшой.
 */
export function jamBudget(level: number): number {
  const factor = Math.max(1.15, 1.9 - level * 0.03);
  const slack = Math.max(2, 6 - Math.floor(level / 6));
  return Math.round(jamScramble(level) * factor) + slack;
}

/**
 * Форма состояния-головоломки. Проверяем не только `mode`: у старой песочницы
 * (`createJamLevel`) состояние тоже помечено как `jam`, но фигур `pieces` у него
 * нет, и ложное срабатывание роняет экран.
 */
export function isJamState(state: unknown): state is JamState {
  if (!state || typeof state !== 'object') return false;
  const candidate = state as { mode?: unknown; pieces?: unknown; mid?: unknown };
  return candidate.mode === 'jam' && Array.isArray(candidate.pieces) && typeof candidate.mid === 'number';
}

/** Половина, куда должна попасть фигура: белые вверх, чёрные вниз. */
export function jamTargetRow(state: Pick<JamState, 'mid'>, side: JamSide): (y: number) => boolean {
  return side === 'white' ? (y: number) => y >= state.mid : (y: number) => y < state.mid;
}

export function jamIsParked(piece: JamPiece, mid: number): boolean {
  return piece.side === 'white' ? piece.y >= mid : piece.y < mid;
}

export function jamParkedCount(pieces: JamPiece[], mid: number): number {
  return pieces.reduce((sum, piece) => sum + (jamIsParked(piece, mid) ? 1 : 0), 0);
}

export function jamSolved(state: Pick<JamState, 'pieces' | 'mid'>): boolean {
  return state.pieces.length > 0 && jamParkedCount(state.pieces, state.mid) === state.pieces.length;
}

function pieceAt(pieces: JamPiece[], x: number, y: number, exceptId?: string): JamPiece | undefined {
  return pieces.find((piece) => piece.x === x && piece.y === y && piece.id !== exceptId);
}

export function jamPieceById(state: JamState, id: string): JamPiece | undefined {
  return state.pieces.find((piece) => piece.id === id);
}

/**
 * Куда может уехать фигура. Ладья и слон скользят до первой занятой клетки,
 * конь перепрыгивает. Все три хода обратимы, поэтому перемешивание из решённой
 * позиции всегда оставляет путь обратно: это и есть гарантия решаемости.
 */
export function jamPieceMoves(state: Pick<JamState, 'width' | 'height' | 'pieces'>, piece: JamPiece): Cell[] {
  const out: Cell[] = [];
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < state.width && y < state.height;
  const free = (x: number, y: number) => inside(x, y) && pieceAt(state.pieces, x, y, piece.id) === undefined;

  const lines: Array<[number, number]> =
    piece.type === 'rook'
      ? [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]
      : piece.type === 'bishop'
        ? [
            [1, 1],
            [-1, 1],
            [1, -1],
            [-1, -1],
          ]
        : [];

  if (piece.type === 'knight') {
    for (const [dx, dy] of [
      [1, 2],
      [2, 1],
      [-1, 2],
      [-2, 1],
      [1, -2],
      [2, -1],
      [-1, -2],
      [-2, -1],
    ]) {
      if (free(piece.x + dx, piece.y + dy)) out.push({ x: piece.x + dx, y: piece.y + dy });
    }
    return out;
  }

  const reach = Math.max(state.width, state.height);
  for (const [dx, dy] of lines) {
    for (let step = 1; step < reach; step++) {
      const x = piece.x + dx * step;
      const y = piece.y + dy * step;
      if (!inside(x, y)) break;
      if (pieceAt(state.pieces, x, y, piece.id)) break;
      out.push({ x, y });
    }
  }
  return out;
}

export function jamLegalActions(state: JamState): JamAction[] {
  if (state.status !== 'playing') return [];
  const actions: JamAction[] = [];
  for (const piece of state.pieces) {
    for (const cell of jamPieceMoves(state, piece)) actions.push({ type: 'piece', id: piece.id, to: cell });
  }
  return actions;
}

/** Все ходы фигур: нужен списку подсказок и таблице ходов. */
export function jamMoveTable(state: Pick<JamState, 'width' | 'height' | 'pieces'>): Array<{ id: string; moves: Cell[] }> {
  return state.pieces.map((piece) => ({ id: piece.id, moves: jamPieceMoves(state, piece) }));
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

function layout(state: Omit<JamState, 'score' | 'status'>): JamState {
  return { ...state, score: jamParkedCount(state.pieces, state.mid), status: 'playing' };
}

/**
 * Собрать решённую позицию и перемешать её обратимыми ходами.
 * `attempts` - сколько расстановок перебрать, пока перемешивание не даст
 * неготовую пробку с ходом хотя бы у одной фигуры.
 */
export function createJamPuzzle(level: number, seed: number, attempts = 12): JamState {
  const { width, height } = jamBoard(level);
  const mid = Math.ceil(height / 2);
  const scramble = jamScramble(level);
  const budget = jamBudget(level);
  const density = jamDensity(level);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const rng = new Rng(mix32(seed, attempt, 0x1a9c0de5));
    const base = buildSolved({ width, height, mid, density, level, seed });
    const mixed = scrambleState({ width, height, mid, pieces: base.pieces, rng, steps: scramble });
    // Короткое перемешивание значит, что пробка слишком тесная и фигуры стоят
    // друг у друга: берём другую расстановку, иначе уровень решается за ход.
    if (mixed.moves.length < Math.max(3, Math.round(scramble * 0.5))) continue;
    const result = layout({ ...base, pieces: mixed.pieces, scramble: mixed.moves, budget });
    if (jamSolved(result)) continue;
    if (jamLegalActions(result).length === 0) continue;
    return result;
  }

  // Фолбэк: минимальная пробка в три хода. Помечается последним событием, чтобы
  // админка видела, на каких уровнях генератор откатился.
  const rng = new Rng(mix32(seed, attempts, 0x1a9c0de5));
  const base = buildSolved({ width, height, mid, density: 0.42, level, seed });
  const mixed = scrambleState({ width, height, mid, pieces: base.pieces, rng, steps: 3 });
  return { ...layout({ ...base, pieces: mixed.pieces, scramble: mixed.moves, budget }), lastEvent: 'fallback' };
}

function buildSolved(args: {
  width: number;
  height: number;
  mid: number;
  density: number;
  level: number;
  seed: number;
}): Omit<JamState, 'score' | 'status'> {
  const { width, height, mid, density } = args;
  const rng = new Rng(mix32(args.seed, args.level, 0x51ed270b));
  const total = Math.max(4, Math.round(width * height * density));
  // Половины могут быть разного размера (нечётное число рядов), поэтому считаем
  // не «пополам от total», а заполняем каждую долю своим числом.
  const bottomCells = width * mid;
  const topCells = width * (height - mid);
  const bottomCount = Math.max(2, Math.min(bottomCells - 1, Math.round((total * bottomCells) / (bottomCells + topCells))));
  const topCount = Math.max(2, Math.min(topCells - 1, total - bottomCount));

  const pick = (rows: number[], count: number) => {
    const cells: Array<{ x: number; y: number }> = [];
    for (const y of rows) for (let x = 0; x < width; x++) cells.push({ x, y });
    rng.shuffle(cells);
    return cells.slice(0, count);
  };

  const bottomRows: number[] = [];
  for (let y = 0; y < mid; y++) bottomRows.push(y);
  const topRows: number[] = [];
  for (let y = mid; y < height; y++) topRows.push(y);

  // В решённой позиции белые сверху, чёрные снизу: отсюда и перемешиваем.
  const whites = pick(topRows, topCount);
  const blacks = pick(bottomRows, bottomCount);

  const pieces: JamPiece[] = [];
  let id = 0;
  for (const cell of whites) pieces.push({ id: `p${id++}`, type: weightedType(rng), side: 'white', x: cell.x, y: cell.y });
  for (const cell of blacks) pieces.push({ id: `p${id++}`, type: weightedType(rng), side: 'black', x: cell.x, y: cell.y });

  return {
    version: 1,
    mode: 'jam',
    width,
    height,
    mid,
    pieces,
    moves: 0,
    budget: 0,
    level: args.level,
    seed: args.seed,
  };
}

/**
 * Перемешивание: случайные легальные ходы без немедленного отката назад
 * (иначе половина перестановок расходится впустую). Все ходы обратимы, поэтому
 * получившаяся пробка решаема за то же число ходов: отсюда гарантия решаемости.
 */
function scrambleState(args: {
  width: number;
  height: number;
  mid: number;
  pieces: JamPiece[];
  rng: Rng;
  steps: number;
}): { pieces: JamPiece[]; moves: Array<{ id: string; from: Cell; to: Cell }> } {
  const pieces = args.pieces.map((piece) => ({ ...piece }));
  const board = { width: args.width, height: args.height, pieces };
  const moves: Array<{ id: string; from: Cell; to: Cell }> = [];

  for (let step = 0; step < args.steps; step++) {
    const candidates: Array<{ id: string; to: Cell }> = [];
    for (const piece of pieces) {
      for (const cell of jamPieceMoves(board, piece)) candidates.push({ id: piece.id, to: cell });
    }
    if (candidates.length === 0) break;

    const prev = moves[moves.length - 1];
    const isUndo = (candidate: { id: string; to: Cell }) =>
      Boolean(prev) && candidate.id === prev.id && sameCell(candidate.to, prev.from);

    let chosen = candidates[args.rng.int(candidates.length)];
    if (candidates.length > 1) {
      for (let attempt = 0; attempt < 8 && isUndo(chosen); attempt++) {
        chosen = candidates[args.rng.int(candidates.length)];
      }
    }

    const piece = pieces.find((entry) => entry.id === chosen.id);
    if (!piece || isUndo(chosen)) break;
    const from = { x: piece.x, y: piece.y };
    piece.x = chosen.to.x;
    piece.y = chosen.to.y;
    moves.push({ id: chosen.id, from, to: chosen.to });
  }

  return { pieces, moves };
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Гарантированное решение: отменять перемешивание строго в обратном порядке.
 * Каждый откат легален, потому что в этот момент поле ровно такое, каким оно
 * было сразу после хода - больше никто между этими ходами не двигался.
 */
export function jamSolution(state: JamState): JamAction[] {
  const steps = state.scramble ?? [];
  // Позиции обновляем по ходу разбора: пропускать можно только те шаги, где
  // фигура уже стоит нужным местом, иначе следующий откат упрётся в чужую клетку.
  const positions = new Map(state.pieces.map((piece) => [piece.id, { x: piece.x, y: piece.y }]));
  const out: JamAction[] = [];
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    const at = positions.get(step.id);
    if (!at) continue;
    if (at.x === step.from.x && at.y === step.from.y) continue;
    out.push({ type: 'piece', id: step.id, to: { x: step.from.x, y: step.from.y } });
    positions.set(step.id, { x: step.from.x, y: step.from.y });
  }
  return out;
}

/** Подсказка: первый шаг обратного пути, если он сейчас легален. */
export function jamSolutionHint(state: JamState): JamAction | null {
  const [first] = jamSolution(state);
  if (!first) return null;
  const piece = state.pieces.find((entry) => entry.id === first.id);
  if (!piece) return null;
  const legal = jamPieceMoves(state, piece).some((cell) => cell.x === first.to.x && cell.y === first.to.y);
  return legal ? first : null;
}

export function cloneJamState(state: JamState): JamState {
  return { ...state, pieces: state.pieces.map((piece) => ({ ...piece })), scramble: state.scramble ? [...state.scramble] : undefined };
}

/** Применить действие. Ошибки правил - то же RuleError, что и у пешечных режимов. */
export function applyJamAction(previous: JamState, action: JamAction, RuleErrorCtor: new (message: string) => Error): JamState {
  if (previous.status !== 'playing') throw new RuleErrorCtor('Партия уже завершена');
  if (action.type !== 'piece') throw new RuleErrorCtor('Неизвестное действие');
  const state = cloneJamState(previous);
  const piece = state.pieces.find((entry) => entry.id === action.id);
  if (!piece) throw new RuleErrorCtor('Фигуры с таким id нет');
  if (action.to.x < 0 || action.to.y < 0 || action.to.x >= state.width || action.to.y >= state.height) {
    throw new RuleErrorCtor('За границей поля');
  }
  if (pieceAt(state.pieces, action.to.x, action.to.y, piece.id)) throw new RuleErrorCtor('Клетка занята');
  const legal = jamPieceMoves(state, piece).some((cell) => cell.x === action.to.x && cell.y === action.to.y);
  if (!legal) throw new RuleErrorCtor('Фигура так не ходит');

  const from = { x: piece.x, y: piece.y };
  piece.x = action.to.x;
  piece.y = action.to.y;
  state.moves += 1;
  state.score = jamParkedCount(state.pieces, state.mid);
  state.lastMove = { id: piece.id, from, to: { ...action.to } };
  state.lastEvent = 'move';

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

/**
 * Подсказка: жадный выбор. Берём фигуру, которой ближе всего встать на чужую
 * половину, и ход, который увеличивает число расставленных фигур либо
 * освобождает проход. Полный перебор здесь не нужен: он экспоненциален по
 * числу фигур, а игроку достаточно одного разумного хода.
 */
export function jamHint(state: JamState): JamAction | null {
  if (state.status !== 'playing') return null;
  // След перемешивания есть не всегда (игрок мог отменить ходы), поэтому сначала
  // пробуем его, а уже потом жадный перебор.
  const fromPath = jamSolutionHint(state);
  if (fromPath) return fromPath;
  let best: { action: JamAction; value: number } | null = null;
  for (const piece of state.pieces) {
    const parkedBefore = jamIsParked(piece, state.mid);
    for (const cell of jamPieceMoves(state, piece)) {
      const after: JamPiece = { ...piece, x: cell.x, y: cell.y };
      const gain = jamIsParked(after, state.mid) && !parkedBefore ? 3 : 0;
      // Линия к цели важнее случайного съезда вбок.
      const toward = Math.abs(cell.y - (piece.side === 'white' ? state.mid : state.mid - 1)) <
        Math.abs(piece.y - (piece.side === 'white' ? state.mid : state.mid - 1))
        ? 2
        : 0;
      const undo = state.lastMove && state.lastMove.id === piece.id && sameCell(cell, state.lastMove.from) ? -4 : 0;
      const openCells = jamPieceMoves(state, after).length;
      const value = gain + toward + undo + Math.min(1, openCells * 0.05);
      if (!best || value > best.value) best = { action: { type: 'piece', id: piece.id, to: cell }, value };
    }
  }
  return best?.action ?? null;
}
