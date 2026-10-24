// «Парковка»: поле забито фигурами двух цветов, и их нужно увести.
//
// Набор фигур: ладья, слон, конь, ферзь, плюс пешка и король. Последних двух держим у
// их же края: они ходят на клетку, и в центре такая фигура тянулась бы к выходу
// половину забега, тогда как задача в пробке - манёвр, а не подсчёт шагов.
//
// Ходит игрок: берёт любую фигуру и гонит её по её правилу. Фигура ушла, если
// её ход встал на её край: белые на нулевой ряд, чёрные на последний. Отдельной
// кнопки для ухода нет, это ровно тот же ход, что и любой другой, просто он
// привёл фигуру домой, и после него фигуры на поле не остаётся. Оба края свои,
// поэтому пробка расходится с двух сторон и не превращается в гонку к одному
// ряду. Взятий нет: чужую фигуру нельзя съесть, можно только обойти.
//
// Решаемость здесь не «собирается из решённой позиции обратными ходами»: уход
// необратим, обратный след построить нельзя. Вместо этого генератор ищет план
// самим решателем (`solveJamExits`), и от него же считаются бюджет ходов и
// подсказка.

import { mix32, Rng } from './rng';
import type { Cell } from './types';

export type JamPieceType = 'rook' | 'bishop' | 'knight' | 'queen' | 'pawn' | 'king';
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
  /**
   * 3: уход по достижению своего края, без клетки за доской. Версия стоит в
   * проверке формы не для красоты: активная партия прежней сборки держит журнал
   * с клетками вне поля, и новый движок их не примет, поэтому такую партию
   * проще закрыть, чем чинить.
   */
  version: 3;
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
  queen: 'Ферзь',
  pawn: 'Пешка',
  king: 'Король',
};

export const JAM_PIECE_GLYPH: Record<JamPieceType, string> = {
  rook: '♜',
  bishop: '♝',
  knight: '♞',
  queen: '♛',
  pawn: '♟',
  king: '♚',
};

// Веса дальнобойных фигур: короткая мелочь (пешка, король) сюда не входит, её
// расставляет генератор отдельно и у своего края. Ферзь весит меньше ладьи: он
// доезжает до края и по диагонали, с ним пробка расходится легче.
const TYPE_WEIGHTS: Array<[JamPieceType, number]> = [
  ['rook', 0.36],
  ['bishop', 0.26],
  ['knight', 0.24],
  ['queen', 0.14],
];

/** Геометрия поля. Ширина растёт медленнее высоты: ряды и есть «пробка». */
export function jamBoard(level: number): { width: number; height: number } {
  // Ширина и высота растут вразнобок: 20-й уровень был тупиком лесенки - на
  // 6x8 оставалось только переставлять фигуры, и 30-й с 40-м играли ту же
  // задачу. Ряды идут впереди колонок: пробка - это именно ряды.
  const width = level <= 10 ? 5 : level <= 26 ? 6 : 7;
  const height = level <= 6 ? 6 : level <= 16 ? 7 : level <= 34 ? 8 : 9;
  return { width, height };
}

/**
 * Доля занятых клеток. Выше 0.66 пробка не расходится по-человечески: фигурам
 * некуда встать, и план превращается в перекладывание. Смещение подаёт
 * лаборатория, когда измеряет, сколько фигур на доску ещё терпит режим, - в
 * боевой игре смещения нет.
 */
export function jamDensity(level: number, bias = 0): number {
  const cap = bias > 0 ? 0.8 : 0.66;
  return Math.min(cap, 0.4 + level * 0.012 + bias);
}

/**
 * Сколько фигур нужно увести с поля на данном уровне. Плотность задаёт натяжение
 * пробки, а этот потолок - длину забега. С 20-го уровня фигур больше не становится:
 * поле выросло до 7x8 и 7x9, и по-прежнему на нём ехало бы 42 фигуры - это план в
 * 90 ходов, который на телефоне не доигрывают. Рост поля теперь покупает свободу
 * манёвра (объезжать стали короче), а не число перестановок.
 */
export const JAM_PIECES_CAP = 20;

export function jamPieces(level: number, bias = 0): number {
  const { width, height } = jamBoard(level);
  const byDensity = Math.round(width * height * jamDensity(level, bias));
  // Смещение подаёт лаборатория, когда мерит, сколько фигур терпит доска: там
  // потолок мешает, и он снимается.
  return Math.max(4, bias > 0 ? byDensity : Math.min(byDensity, JAM_PIECES_CAP));
}

/**
 * Целевая длина решения в ходах: генератор ищет расстановку, которая решается
 * примерно за столько. Линейка - 1.4 хода на фигуру плюс натяжение пробки, но
 * не больше четырнадцати ходов: раньше рост уровня сам по себе добавлял по полхода
 * на каждый номер, и к 40-му уровню это были 24 хода чисто «за номер», поверх
 * перекладывания фигур.
 */
export function jamTargetCost(level: number, bias = 0): number {
  return Math.round(jamPieces(level, bias) * 1.4 + Math.min(14, level * 0.28));
}

/**
 * Ходов дано с запасом: на первых уровнях можно ходить наугад, к тридцатому
 * приходится считать. Основа - длина плана решателя, но игрок обычно решает
 * короче, чем искал жадный перебор, поэтому запас сверху небольшой: 1.9 плана на
 * первом уровне и 1.35 на сороковом. Ниже 1.35 опускаться некуда: сам план жадный,
 * он уже длиннее человеческого, и запас считается от заведомо плохой оценки.
 */
/**
 * Доля длины плана, которую разрешается потратить на ошибку. Лестница
 * договорная: 1.5 на 1-12 (уровни учебные, развязать пробку важнее, чем не
 * оступиться), 1.35 на 13-24, 1.25 после 25-го. Прежняя формула
 * (`1.9 - 0.02 × уровень` плюс 3-6 ходов сверху) на 20-м уровне давала запас в
 * полтора десятка ходов - прощение на ней меряло щедрость лимита, а не свободу
 * игрока, и пена за ход вне плана была меньше единицы.
 */
export function jamBudgetFactor(level: number): number {
  if (level <= 12) return 1.5;
  if (level <= 24) return 1.35;
  return 1.25;
}

export function jamBudget(level: number, cost = jamTargetCost(level)): number {
  return Math.max(4, Math.round(cost * jamBudgetFactor(level)));
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
    candidate.version === 3 &&
    Array.isArray(candidate.pieces) &&
    typeof candidate.removed === 'number'
  );
}

/**
 * Край фигуры: белые уходят с нулевого ряда, чёрные с последнего. Это ряд поля,
 * а не клетка за ним: уход это обычный ход на свой край, и журнал хранит
 * обычную клетку.
 */
export function jamExitRow(state: Pick<JamState, 'height'>, side: JamSide): number {
  return side === 'white' ? 0 : state.height - 1;
}

/** Вел ли ход фигуру на её край: значит фигура уходит с поля. */
export function jamIsExit(state: Pick<JamState, 'height'>, piece: Pick<JamPiece, 'side'>, to: Cell): boolean {
  return to.y === jamExitRow(state, piece.side);
}

/** Готова ли фигура уйти с поля одним ходом. */
export function jamAtEdge(state: JamState, piece: JamPiece): boolean {
  return jamExitMoves(state, piece).length > 0;
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
  if (type === 'queen') {
    // Ферзь = ладья + слон: восемь лучей, и в пробке он доезжает до края там,
    // куда ладье или слону не дотянуться.
    return [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
  }
  return [];
}

/** Король в «Парковке» ходит на любую соседнюю клетку; взятий нет, бить нечего. */
const KING_STEPS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * Шаг пешки: к своему краю, вбок она не сворачивает. Белые уходят на нулевой
 * ряд, поэтому их пешка идёт вниз, чёрные на последний - их вверх.
 */
export function jamPawnStep(side: JamSide): [number, number] {
  return [0, side === 'white' ? -1 : 1];
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
 * конь перепрыгивает. Все ходы внутри поля: уход не отдельное действие, а ход,
 * вставший на край фигуры (`jamExitMoves`).
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

  if (piece.type === 'pawn' || piece.type === 'king') {
    // Оба хода на одну клетку, поэтому проверка одна: встать можно только на
    // свободную клетку, а уход из неё следует из правила края.
    const steps: Array<[number, number]> =
      piece.type === 'pawn' ? [jamPawnStep(piece.side)] : KING_STEPS;
    for (const [dx, dy] of steps) {
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
 * Ходы, которые ведут фигуру с поля: подмножество её обычных ходов, встающее на
 * её край. Отдельных клеток «за доской» нет, поэтому проверка легальности одна
 * на всё, а снятие фигуры следует из того же хода.
 */
export function jamExitMoves(board: Board, piece: JamPiece, at?: Cell): Cell[] {
  return jamPieceMoves(board, piece, at).filter((cell) => jamIsExit(board, piece, cell));
}

/** Все клетки, доступные фигуре за один ход: уход это одна из них, а не отдельный список. */
export function jamPieceTargets(board: Board, piece: JamPiece): Cell[] {
  return jamPieceMoves(board, piece);
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
    const exits = jamExitMoves(board, piece, node);
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
    // Последняя клетка пути стоит на краю фигуры: её снимаем, она больше не стена.
    if (jamIsExit(state, pieceById(pieces, chosen.id) ?? { side: 'white' }, last.to)) pieces.splice(index, 1);
    else {
      pieces[index] = { ...pieces[index], x: last.to.x, y: last.to.y };
    }
  }
  return { ok: true, moves, costs };
}

function pieceById(pieces: JamPiece[], id: string): Pick<JamPiece, 'side'> | undefined {
  return pieces.find((piece) => piece.id === id);
}

function cloneJamBoard(state: Pick<JamState, 'width' | 'height' | 'pieces'>): Board {
  return { width: state.width, height: state.height, pieces: state.pieces.map((piece) => ({ ...piece })) };
}

/**
 * Сколько шагов до своего края у клетки `y`: белым нужен нулевой ряд, чёрным
 * последний. По этому числу генератор решает, какая фигура встанет в клетку.
 */
function jamEdgeDistance(height: number, side: JamSide, y: number): number {
  return side === 'white' ? y : height - 1 - y;
}

/**
 * Сколько «коротких» фигур (пешка и король) кладёт генератор и в скольких рядов
 * от своего края их держать. Доля задаётся долей фигур, а не числом: на 12
 * фигурах это 4 штуки, на 32 - семь, и план от них не раздувается.
 */
export function jamShortShare(level: number): { share: number; reach: number } {
  // После того как число фигур уперли в потолок, длина задачи растёт не числом,
  // а дорогой: пешке и королю отдают всё больше рядов от своего края, и на 40-м
  // уровне мелочь идёт к выходу четыре хода вместо трёх.
  const reach = level <= 6 ? 2 : level <= 22 ? 3 : 4;
  const share = level <= 6 ? 0.34 : level <= 16 ? 0.28 : level <= 28 ? 0.24 : 0.32;
  return { share, reach };
}

/**
 * Расстановка: плотное поле, половина фигур белые, половина чёрные. Цвета не
 * перемешиваем порядам: иначе на первых уровнях обе стороны стоят вперемешку и
 * уходить мешает сосед, а не пробка. Белые занимают нижнюю половину, чёрные
 * верхнюю, уходить каждой стороне нужно к своему краю, и пробка расходится с двух
 * сторон. Крайние ряды пусты на старте: фигура на своём краю ушла бы первым же
 * ходом, и задача превратилась бы в подсчёт фигур, а не в манёвр.
 *
 * Пешка и король ходят на одну клетку. В центре такая фигура шла бы к выходу
 * половину забега, и план рос бы без всякой задачи, поэтому мелочь берёт клетки у
 * СВОЕГО края, даже если по половому правилу эти ряды принадлежат другой стороне.
 * Пешке нужна ещё и свободная колонка до края: вбок она не сворачивает, и зажатая
 * пешка означала бы нерешаемое поле; вместо неё в такую клетку встаёт король.
 */
function buildLayout(args: { width: number; height: number; total: number; level: number; rng: Rng }): JamPiece[] {
  const { width, height, total, level, rng } = args;
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push({ x, y });
  rng.shuffle(cells);
  const taken = cells.filter((cell) => cell.y !== 0 && cell.y !== height - 1).slice(0, total);

  type Slot = { index: number; x: number; y: number; side: JamSide };
  // Белые занимают нижнюю половину, чёрные верхнюю: уходить каждой стороне
  // нужно к своему краю, и пробка расходится с двух сторон.
  const slots: Slot[] = taken.map((cell, index) => ({
    index,
    x: cell.x,
    y: cell.y,
    side: (cell.y < height / 2 ? 'black' : 'white') as JamSide,
  }));

  const { share, reach } = jamShortShare(level);
  const shortTarget = Math.min(slots.length, Math.max(2, Math.round(total * share)));
  // Кандидаты на короткую фигуру: любая занятая клетка в `reach` рядах от края,
  // и сторона у неё своя, краевая, а не та, что делит поле пополам.
  const bySide: Record<JamSide, Array<{ slot: Slot; side: JamSide; distance: number }>> = {
    white: [],
    black: [],
  };
  for (const slot of slots) {
    for (const side of ['white', 'black'] as JamSide[]) {
      const distance = jamEdgeDistance(height, side, slot.y);
      if (distance >= 1 && distance <= reach) bySide[side].push({ slot, side, distance });
    }
  }
  for (const side of ['white', 'black'] as JamSide[]) {
    bySide[side].sort((a, b) => a.distance - b.distance || a.slot.index - b.slot.index);
  }

  const columnToEdgeIsClear = (slot: { index: number; x: number; y: number }, side: JamSide) =>
    slots.every(
      (other) =>
        other.index === slot.index ||
        other.x !== slot.x ||
        (side === 'white' ? other.y > slot.y : other.y < slot.y),
    );

  const assignment = new Map<number, { side: JamSide; type: JamPieceType }>();
  const pawnCap = Math.max(1, Math.round(shortTarget / 2));
  let pawns = 0;
  let turn: JamSide = 'white';
  // Стороны чередуем: иначе вся мелочь липнет к одному краю, и вторая половина
  // поля остаётся сплошь из фигур, которым идти пять рядов.
  for (let step = 0; assignment.size < shortTarget && step < shortTarget * 2 + 4; step++) {
    const side = turn;
    turn = turn === 'white' ? 'black' : 'white';
    const next = bySide[side].find((cand) => !assignment.has(cand.slot.index));
    if (!next) continue;
    const pawn = pawns < pawnCap && columnToEdgeIsClear(next.slot, side);
    assignment.set(next.slot.index, { side, type: pawn ? 'pawn' : 'king' });
    if (pawn) pawns += 1;
  }

  let id = 0;
  return slots.map((slot) => {
    const short = assignment.get(slot.index);
    return {
      id: `p${id++}`,
      type: short?.type ?? weightedType(rng),
      side: short?.side ?? slot.side,
      x: slot.x,
      y: slot.y,
    };
  });
}

/**
 * Генератор уровня: перебираем расстановки, берём ту, чьё решение ближе всего
 * к целевой длине уровня. Слишком короткие отбрасываем: поле, которое
 * расходится за три хода, не задача, а загрузка.
 */
export function createJamPuzzle(level: number, seed: number, attempts = 24, densityBias = 0): JamState {
  const { width, height } = jamBoard(level);
  // `densityBias` - ручка лаборатории: сколько фигур на доску добавляем сверх
  // боевой кривой, чтобы измерить, где пробка перестаёт расходиться.
  const total = Math.min(jamPieces(level, densityBias), width * height - 2);
  const target = jamTargetCost(level, densityBias);
  let best: { pieces: JamPiece[]; plan: JamPlan } | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const rng = new Rng(mix32(seed, attempt, 0x1a9c0de5, level, width, height));
    const pieces = buildLayout({ width, height, total, level, rng });
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
    const pieces = buildLayout({ width, height, total, level, rng });
    const plan = solveJamExits({ width, height, pieces }, { rng });
    return {
      version: 3,
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
    version: 3,
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

  // План привязан к счётчику ходов: пока игрок слушает подсказку, `moves` это и
  // есть индекс следующего шага. Читать план с нуля нельзя - ранний шаг коня
  // через несколько ходов снова легален, подсказка зацикливается на нём, и
  // игрок, который ей доверился, сжигает бюджет на месте.
  const steps = state.plan;
  if (steps && steps.length > state.moves) {
    for (let index = state.moves; index < steps.length; index++) {
      const move = steps[index];
      const piece = positions.get(move.id);
      if (!piece) continue; // фигуру уже увели с поля
      const targets = jamPieceTargets(board, piece);
      if (targets.some((cell) => cell.x === move.to.x && cell.y === move.to.y)) return move;
    }
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

  if (action.to.x < 0 || action.to.x >= state.width || action.to.y < 0 || action.to.y >= state.height) {
    throw new RuleErrorCtor('За границей поля');
  }
  // Проверка одна для всех ходов: уход это ход на свой край, а не отдельное
  // действие, поэтому и отказ один: «так не ходит».
  const legal = jamPieceMoves(state, piece).some((cell) => cell.x === action.to.x && cell.y === action.to.y);
  if (!legal) throw new RuleErrorCtor('Фигура так не ходит');
  const exiting = jamIsExit(state, piece, action.to);

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
