import { anyEnemyAttacksPlayer, enemyAttacksCell, legalMoves } from './board';
import { applyAction } from './rules';
import { Rng, mix32 } from './rng';
import type { GameAction, GameState, MoveDx, PieceType } from './types';

/**
 * Разбор уровней.
 *
 * Модуль отвечает на два вопроса:
 * 1. Проходима ли конкретная расстановка и насколько она требовательна.
 * 2. Сколько таких расстановок в пространстве уровня и какая доля проходит отбор.
 *
 * Враг в игре детерминирован, поэтому из любого состояния на каждое действие
 * игрока есть ровно одно продолжение. Это делает полный перебор дерева
 * дешёвым: для кампании глубина не больше высоты поля.
 */

export interface AuditResult {
  solvable: boolean;
  /** Короткое решение в действиях игрока (move и skip). */
  solution: GameAction[];
  /** Длина кратчайшего решения. */
  steps: number;
  /** Сколько первых ходов ведут к победе. */
  firstMoves: number;
  /** Сколько ходов на кратчайшем пути были единственным спасением. */
  forced: number;
  /** Сколько шагов кратчайшего пути оставляют не менее двух победных продолжений. */
  choiceSteps: number;
  /** Сколько фигур пешка берёт на кратчайшем победном пути. */
  captures: number;
  /** Доля шагов решения, на которых пешка стояла под боем. */
  pressure: number;
  /** Среднее расстояние до ближайшей фигуры на пути. */
  nearest: number;
  /** Доля клеток средних рядов, которые держат под боем фигуры. */
  coverage: number;
  /** Число полных победных линий, с потолком. */
  paths: number;
  pathsCapped: boolean;
  /** Оценка требовательности от 0 до 100. */
  score: number;
  nodes: number;
  truncated: boolean;
}

export interface AuditOptions {
  maxDepth?: number;
  maxNodes?: number;
  /** Потолок подсчёта победных линий. */
  pathCap?: number;
}

const DEFAULT_PATH_CAP = 512;

/**
 * Ходы, которые перебирает разбор. Добровольный пропуск в дерево не добавляем:
 * он тратит квоту и ведёт к позиции, которую пешка могла бы занять обычным ходом,
 * а вот вынужденный пропуск обязателен, иначе тупик будет выглядеть нерешаемым.
 */
function actionsFrom(state: GameState): GameAction[] {
  const moves = legalMoves(state);
  if (moves.length === 0) return [{ type: 'skip' }];
  return moves.map((move) => ({ type: 'move' as const, dx: move.dx, dy: move.dy ?? 1 }));
}

function positionKey(state: GameState): string {
  const enemies = state.enemies
    .map((e) => `${e.type[0]}${e.x},${e.y}`)
    .join(';');
  return [state.width, state.height, state.player.x, state.player.y, state.moves, enemies].join('|');
}

/**
 * Полный разбор расстановки: есть ли решение, какое оно короткое,
 * сколько альтернатив и сколько шагов требуют единственного хода.
 */
export function auditState(start: GameState, options: AuditOptions = {}): AuditResult {
  const maxDepth = options.maxDepth ?? start.height + 3;
  const maxNodes = options.maxNodes ?? 40_000;
  const pathCap = options.pathCap ?? DEFAULT_PATH_CAP;

  let nodes = 0;
  let truncated = false;
  const winMemo = new Map<string, boolean>();
  const countMemo = new Map<string, number>();
  let paths = 0;
  let pathsCapped = false;

  if (start.status === 'won') {
    return {
      solvable: true,
      solution: [],
      steps: 0,
      firstMoves: 0,
      forced: 0,
      choiceSteps: 0,
      captures: 0,
      paths: 1,
      pathsCapped: false,
      pressure: 0,
      nearest: 0,
      coverage: 0,
      score: 0,
      nodes: 0,
      truncated: false,
    };
  }

  if (start.status !== 'playing') {
    return {
      solvable: false,
      solution: [],
      steps: 0,
      firstMoves: 0,
      forced: 0,
      choiceSteps: 0,
      captures: 0,
      paths: 0,
      pathsCapped: false,
      pressure: 0,
      nearest: 0,
      coverage: 0,
      score: 0,
      nodes: 0,
      truncated: false,
    };
  }

  /** Есть ли победа за оставшиеся depth действий. */
  const canWin = (state: GameState, depth: number): boolean => {
    if (state.status === 'won') return true;
    if (state.status === 'lost' || depth <= 0) return false;
    if (nodes > maxNodes) {
      truncated = true;
      return false;
    }
    const key = `${positionKey(state)}|${depth}`;
    const cached = winMemo.get(key);
    if (cached !== undefined) return cached;

    nodes += 1;
    let found = false;
    for (const action of actionsFrom(state)) {
      const next = applyAction(state, action);
      if (canWin(next, depth - 1)) {
        found = true;
        break;
      }
      if (truncated) break;
    }
    winMemo.set(key, found);
    return found;
  };

  /** Сколько победных продолжений из состояния, с ограничением. */
  const countWins = (state: GameState, depth: number): number => {
    if (state.status === 'won') return 1;
    if (state.status === 'lost' || depth <= 0) return 0;
    if (nodes > maxNodes || pathsCapped) return 0;
    const key = `${positionKey(state)}|${depth}`;
    const cached = countMemo.get(key);
    if (cached !== undefined) return cached;

    nodes += 1;
    let total = 0;
    for (const action of actionsFrom(state)) {
      total += countWins(applyAction(state, action), depth - 1);
      if (total > pathCap) {
        pathsCapped = true;
        total = pathCap;
        break;
      }
      if (truncated) break;
    }
    countMemo.set(key, total);
    return total;
  };

  let steps = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (canWin(start, depth)) {
      steps = depth;
      break;
    }
    if (truncated) break;
  }

  const solution: GameAction[] = [];
  let cursor = start;
  let remaining = steps;
  let choiceSteps = 0;
  let captures = 0;
  while (remaining > 0 && cursor.status === 'playing') {
    // Все продолжения считаем от одного и того же состояния: двигать cursor внутри
    // перебора нельзя, иначе следующие ходы проверялись бы уже из новой позиции.
    const winning: Array<{ action: GameAction; next: GameState; takes: boolean }> = [];
    for (const action of actionsFrom(cursor)) {
      const next = applyAction(cursor, action);
      if (canWin(next, remaining - 1)) {
        const takes =
          action.type === 'move' &&
          legalMoves(cursor).some(
            (m) => m.takes && m.dx === action.dx && (m.dy ?? 1) === (action.dy ?? 1),
          );
        winning.push({ action, next, takes });
      }
    }
    if (winning.length === 0) break;
    if (winning.length >= 2) choiceSteps += 1;
    if (winning[0].takes) captures += 1;
    solution.push(winning[0].action);
    cursor = winning[0].next;
    remaining -= 1;
  }

  const solvable = steps > 0 && solution.length === steps;

  let firstMoves = 0;
  let forced = 0;
  let underFire = 0;
  let distanceSum = 0;
  let distanceSteps = 0;
  if (solvable) {
    for (const action of actionsFrom(start)) {
      if (canWin(applyAction(start, action), steps - 1)) firstMoves += 1;
    }

    // Сколько шагов короткого решения были безальтернативными.
    let walk = start;
    let depthLeft = steps;
    for (const action of solution) {
      let winningActions = 0;
      for (const option of actionsFrom(walk)) {
        if (canWin(applyAction(walk, option), depthLeft - 1)) winningActions += 1;
      }
      if (winningActions === 1) forced += 1;
      if (anyEnemyAttacksPlayer(walk)) underFire += 1;
      if (walk.enemies.length > 0) {
        let best = Number.POSITIVE_INFINITY;
        for (const enemy of walk.enemies) {
          const distance = Math.abs(enemy.x - walk.player.x) + Math.abs(enemy.y - walk.player.y);
          if (distance < best) best = distance;
        }
        distanceSum += best;
        distanceSteps += 1;
      }
      walk = applyAction(walk, action);
      depthLeft -= 1;
    }

    paths = countWins(start, steps);
  }

  const pressure = steps > 0 ? underFire / steps : 0;
  const nearest = distanceSteps > 0 ? distanceSum / distanceSteps : 0;
  let covered = 0;
  let middle = 0;
  for (let y = 1; y <= start.height - 2; y++) {
    for (let x = 0; x < start.width; x++) {
      middle += 1;
      if (start.enemies.some((enemy) => enemyAttacksCell(start, enemy, x, y))) covered += 1;
    }
  }
  const coverage = middle > 0 ? covered / middle : 0;

  return {
    solvable,
    solution,
    steps,
    firstMoves,
    forced,
    choiceSteps,
    captures,
    paths,
    pathsCapped,
    pressure,
    nearest,
    coverage,
    score: solvable
      ? difficultyScore(start, { solvable, steps, firstMoves, forced, choiceSteps, captures, paths, pressure, nearest, coverage })
      : 0,
    nodes,
    truncated,
  };
}

interface ScoreInput {
  solvable: boolean;
  steps: number;
  firstMoves: number;
  forced: number;
  choiceSteps?: number;
  captures?: number;
  paths: number;
  pressure: number;
  nearest: number;
  coverage: number;
}

/**
 * Оценка требовательности 0..100.
 *
 * Слагаемые: размер поля, плотность фигур, узость первого хода, редкость
 * победных линий, доля безальтернативных шагов и обходной путь. Последний член
 * появился вместе с полем выше ширины: забег из `height - 1` ходов это гонка по
 * прямой, а настоящая задача начинается там, где кратчайшее решение длиннее
 * прямой и пешке приходится уходить в сторону или ждать.
 */
export function difficultyScore(state: GameState, input: ScoreInput): number {
  if (!input.solvable) return 0;

  const board = Math.min(11, state.width * 1.2 + state.height * 0.6);
  const density = Math.min(12, state.enemies.length * 2);
  const fire = input.pressure * 30;
  const cover = input.coverage * 15;
  const narrow = input.firstMoves <= 1 ? 10 : input.firstMoves === 2 ? 5 : 0;
  const rarity = input.paths <= 1 ? 10 : input.paths <= 3 ? 6 : input.paths <= 8 ? 3 : 0;
  const forcedShare = input.steps > 0 ? input.forced / input.steps : 0;
  const forced = forcedShare * 8;
  // Шаг с двумя и более победными продолжениями это и есть выбор: такой уровень
  // решает игрок, а не угадывает. Поэтому выбор добавляет оценку, а не отнимает.
  const choice = Math.min(10, (input.choiceSteps ?? 0) * 2.5);
  // Взятие на пути это отдельный вкус: уровень, где нужно бить, читают иначе.
  const eat = Math.min(6, (input.captures ?? 0) * 3);
  const close = Math.max(0, 6 - input.nearest) * 1.5;
  const detour = Math.min(10, Math.max(0, input.steps - (state.height - 1)) * 3);

  return Math.max(
    0,
    Math.min(100, Math.round(board + density + fire + cover + narrow + rarity + forced + close + detour + choice + eat)),
  );
}

export interface DifficultyBand {
  target: number;
  min: number;
  max: number;
}

/**
 * Целевая сложность уровня кампании.
 *
 * Первые уровни остаются мягкими, дальше требования растут быстрее:
 * к десятому уровню нужен реальный выбор, к тридцатому плотная доска.
 */
export function difficultyTarget(level: number): number {
  if (level <= 5) return 26 + level * 2;
  if (level <= 15) return Math.round(36 + (level - 5) * 2.4);
  if (level <= 30) return Math.round(60 + (level - 15) * 0.9);
  return Math.round(Math.min(80, 74 + (level - 30) * 0.35));
}

/**
 * Полоса отбора: ниже min уровень считается слишком простым,
 * выше max слишком жёстким для текущего прогресса.
 */
export function difficultyBand(level: number): DifficultyBand {
  const target = difficultyTarget(level);
  return {
    target,
    min: Math.max(6, target - 10),
    max: Math.min(96, target + 14),
  };
}

/* ─────────────── пространство расстановок ─────────────── */

export interface PlacementSpec {
  width: number;
  height: number;
  count: number;
  types: PieceType[];
}

export interface Placement {
  /** Уникальный ключ расстановки, не зависит от порядка перебора. */
  key: string;
  state: GameState;
}

export interface PlacementSpace {
  cells: number;
  starts: number;
  combinations: number;
  typeTuples: number;
  total: number;
  pawnCap: number;
}

export interface EnumerationResult {
  plans: Placement[];
  space: PlacementSpace;
  exhaustive: boolean;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i;
  }
  return Math.round(result);
}

/** Пешки в генераторе не превышают половину состава. */
function pawnCapFor(spec: PlacementSpec): number {
  if (spec.types.length <= 1) return spec.count;
  return Math.max(1, Math.ceil(spec.count / 2));
}

/** Число допустимых наборов типов с учётом лимита пешек. */
function countTypeTuples(spec: PlacementSpec): number {
  const others = spec.types.length - 1;
  const cap = pawnCapFor(spec);
  if (others === 0) return 1;
  let total = 0;
  for (let pawns = 0; pawns <= Math.min(cap, spec.count); pawns++) {
    total += binomial(spec.count, pawns) * Math.pow(others, spec.count - pawns);
  }
  return total;
}

export function placementSpace(spec: PlacementSpec): PlacementSpace {
  const cells = Math.max(0, (spec.height - 2) * spec.width);
  const combinations = binomial(cells, spec.count);
  const typeTuples = countTypeTuples(spec);
  return {
    cells,
    starts: spec.width,
    combinations,
    typeTuples,
    total: combinations * typeTuples * spec.width,
    pawnCap: pawnCapFor(spec),
  };
}

function cellList(spec: PlacementSpec): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 1; y <= spec.height - 2; y++) {
    for (let x = 0; x < spec.width; x++) cells.push({ x, y });
  }
  return cells;
}

/** Распаковка сочетания по его номеру (лексикографический порядок). */
function unrankCombination(n: number, k: number, index: number): number[] {
  const picked: number[] = [];
  let start = 0;
  let rest = index;
  for (let slot = 0; slot < k; slot++) {
    for (let candidate = start; candidate <= n - (k - slot); candidate++) {
      const block = binomial(n - candidate - 1, k - slot - 1);
      if (rest < block) {
        picked.push(candidate);
        start = candidate + 1;
        break;
      }
      rest -= block;
    }
  }
  return picked;
}

/** Все допустимые наборы типов, только для полного перебора. */
function typeTupleList(spec: PlacementSpec): PieceType[][] {
  const cap = pawnCapFor(spec);
  const list: PieceType[][] = [];
  const build = (acc: PieceType[], pawns: number) => {
    if (acc.length === spec.count) {
      list.push(acc.slice());
      return;
    }
    for (const type of spec.types) {
      const nextPawns = pawns + (type === 'pawn' ? 1 : 0);
      if (type === 'pawn' && nextPawns > cap) continue;
      acc.push(type);
      build(acc, nextPawns);
      acc.pop();
    }
  };
  build([], 0);
  return list;
}

function makePlacement(
  spec: PlacementSpec,
  cells: Array<{ x: number; y: number }>,
  comboIndex: number,
  startX: number,
  types: PieceType[],
  tag: number,
): Placement {
  const picked = unrankCombination(cells.length, spec.count, comboIndex);
  const seed = mix32(0xa11d17, spec.width * 31 + spec.height, comboIndex, startX * 7919 + tag);
  const state: GameState = {
    version: 1,
    mode: 'campaign',
    width: spec.width,
    height: spec.height,
    player: { x: startX, y: 0 },
    enemies: picked.map((cellIndex, order) => ({
      id: `e${order}`,
      type: types[order],
      x: cells[cellIndex].x,
      y: cells[cellIndex].y,
    })),
    status: 'playing',
    moves: 0,
    score: 0,
    level: 0,
    tier: 1,
    freeze: 0,
    shield: 0,
    rng: seed,
    seed,
  };
  return {
    key: `${startX}:${comboIndex}:${types.join('')}`,
    state,
  };
}

/**
 * Перебирает расстановки уровня. Если пространство укладывается в limit,
 * проходит его целиком, иначе берёт детерминированную выборку.
 */
export function enumeratePlacements(
  spec: PlacementSpec,
  options: { limit?: number; seed?: number } = {},
): EnumerationResult {
  const limit = Math.max(1, options.limit ?? 4000);
  const seed = options.seed ?? 1;
  const space = placementSpace(spec);
  const cells = cellList(spec);
  const plans: Placement[] = [];

  if (space.combinations === 0 || spec.count <= 0 || spec.types.length === 0) {
    return { plans, space, exhaustive: true };
  }

  const exhaustive = space.total <= limit;

  if (exhaustive) {
    const tuples = typeTupleList(spec);
    for (let startX = 0; startX < spec.width; startX++) {
      for (let comboIndex = 0; comboIndex < space.combinations; comboIndex++) {
        for (let tupleIndex = 0; tupleIndex < tuples.length; tupleIndex++) {
          plans.push(makePlacement(spec, cells, comboIndex, startX, tuples[tupleIndex], tupleIndex));
        }
      }
    }
    return { plans, space, exhaustive: true };
  }

  const rng = new Rng(mix32(seed, spec.width, spec.height, spec.count, spec.types.length));
  const seen = new Set<string>();
  const attempts = limit * 12;
  for (let attempt = 0; attempt < attempts && plans.length < limit; attempt++) {
    const startX = rng.int(spec.width);
    const comboIndex = rng.int(space.combinations);
    const types: PieceType[] = [];
    let pawns = 0;
    for (let slot = 0; slot < spec.count; slot++) {
      for (let retry = 0; retry < 8; retry++) {
        const type = rng.pick(spec.types);
        if (type === 'pawn' && pawns + 1 > space.pawnCap) continue;
        types.push(type);
        if (type === 'pawn') pawns += 1;
        break;
      }
      if (types.length !== slot + 1) {
        types.push(spec.types.find((t) => t !== 'pawn') ?? spec.types[0]);
      }
    }
    const placement = makePlacement(spec, cells, comboIndex, startX, types, attempt);
    if (seen.has(placement.key)) continue;
    seen.add(placement.key);
    plans.push(placement);
  }

  return { plans, space, exhaustive: false };
}

/* ─────────────── пакетная проверка ─────────────── */

export interface PlacementReport {
  placement: Placement;
  audit: AuditResult;
}

export interface BatchReport {
  space: PlacementSpace;
  exhaustive: boolean;
  limit: number;
  checked: number;
  solvable: number;
  unsolvable: number;
  simple: number;
  fair: number;
  brutal: number;
  averageScore: number;
  medianScore: number;
  best: PlacementReport[];
  worst: PlacementReport[];
  /** Средняя доля решаемых расстановок, 0..1. */
  solveRate: number;
}

export interface BatchOptions extends AuditOptions {
  limit?: number;
  seed?: number;
  band?: DifficultyBand;
  /** Прогресс проверки: сколько расстановок уже разобрано. */
  onProgress?: (checked: number, total: number) => void;
}

/**
 * Проверяет пакет расстановок и делит их на три группы:
 * простые, в целевой полосе и слишком тяжёлые.
 */
export function auditPlacements(spec: PlacementSpec, options: BatchOptions = {}): BatchReport {
  const limit = Math.max(1, options.limit ?? 4000);
  const band = options.band ?? difficultyBand(0);
  const { plans, space, exhaustive } = enumeratePlacements(spec, {
    limit,
    seed: options.seed,
  });

  const reports: PlacementReport[] = [];
  let solvable = 0;
  let simple = 0;
  let fair = 0;
  let brutal = 0;
  const scores: number[] = [];

  for (const placement of plans) {
    const audit = auditState(placement.state, options);
    if (options.onProgress && reports.length % 100 === 0) {
      options.onProgress(reports.length, plans.length);
    }
    reports.push({ placement, audit });
    if (!audit.solvable) continue;
    solvable += 1;
    scores.push(audit.score);
    if (audit.score < band.min) simple += 1;
    else if (audit.score > band.max) brutal += 1;
    else fair += 1;
  }

  scores.sort((a, b) => a - b);
  const averageScore = scores.length
    ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
    : 0;
  const medianScore = scores.length ? scores[Math.floor(scores.length / 2)] : 0;

  const ranked = reports
    .filter((item) => item.audit.solvable)
    .sort((a, b) => b.audit.score - a.audit.score || a.placement.key.localeCompare(b.placement.key));

  return {
    space,
    exhaustive,
    limit,
    checked: reports.length,
    solvable,
    unsolvable: reports.length - solvable,
    simple,
    fair,
    brutal,
    averageScore,
    medianScore,
    best: ranked.slice(0, 6),
    worst: ranked.slice(-6).reverse(),
    solveRate: reports.length ? solvable / reports.length : 0,
  };
}

/** Читаемое решение: направления и пропуски. */
export function describeSolution(solution: GameAction[]): string[] {
  const names: Record<MoveDx, string> = { [-1]: 'влево-вперёд', 0: 'вперёд', 1: 'вправо-вперёд' };
  return solution.map((action, index) =>
    action.type === 'move'
      ? `${index + 1}. ${names[action.dx]}`
      : `${index + 1}. пропуск`,
  );
}
