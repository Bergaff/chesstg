import { auditState, difficultyBand, SURVIVAL_DEPTH, type AuditResult } from './audit';
import { legalMoves } from './board';
import { isSurvivalGoal, rulesFor } from './modes';
import { applyAction } from './rules';
import { createJamPuzzle, isJamState, solveJamExits } from './jam';
import { createRaceLevel } from './specials';
import { RACE_MIN_WIDTH } from './race';
import { createSpecialLevel } from './specials';
import type { ModeId } from './modes';
import type { GameState } from './types';
import { RuleError } from './types';
import { applyJamAction, jamLegalActions, type JamAction, type JamState } from './jam';

/**
 * Анализ реиграбельности и сравнение вариантов правил.
 *
 * Отвечает на два вопроса, которые нельзя задать одиночным уровнем:
 * 1. Насколько разные уровни выдаёт генератор и насколько новый уровень
 *    отличается от того, что игрок уже видел.
 * 2. Что меняет конкретный переключатель правил (диагональ пешки, уход фигур с
 *    поля, приток фигур): решаемость, цена ошибки и число осмысленных выборов.
 */

export interface VariantReport {
  mode: ModeId;
  level: number;
  samples: number;
  /** Доля досок, где найден проход (для выживания: жизнь до конца глубины). */
  solvableShare: number;
  /** Средняя оценка сложности по `difficultyScore`. */
  avgScore: number;
  /** Доля досок, попадающих в полосу режима. */
  inBandShare: number;
  /** Для режимов на выживание: средняя, минимальная и максимальная длина жизни. */
  survival?: { avg: number; min: number; max: number; capped: number };
  /** Средняя длина решения в ходах для обычных режимов. */
  avgSteps: number;
  /** Сколько фигур ушло с поля по пути решения (режимы с `exit` и `down`). */
  avgEscapes: number;
  /** Сколько взятий нужно в решении. */
  avgCaptures: number;
  /** Разнообразие генератора: различных расстановок из `samples`. */
  uniqueLayouts: number;
  /** Сколько досок генератор сдал без отбора: полоса не была достигнута за попытки. */
  fallbacks: number;
  /** Насколько соседние уровни различаются по составу клеток (0..1). */
  layoutDistance: number;
  /** Среднее число победных первых ходов и шагов с выбором. */
  avgFirstMoves: number;
  avgChoiceSteps: number;
  avgPaths: number;
  /** Доля шагов, где был только один ход. */
  forcedShare: number;
  /** Итоговый индекс реиграбельности 0..100. */
  replayIndex: number;
  ms: number;
}

function layoutKey(state: GameState): string {
  return state.enemies
    .map((enemy) => `${enemy.type[0]}${enemy.x},${enemy.y}`)
    .sort()
    .join(';');
}

/** Клетки, занятые фигурами: расстояние между расстановками считается по ним. */
function layoutCells(state: GameState): Set<string> {
  return new Set(state.enemies.map((enemy) => `${enemy.x},${enemy.y}`));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const cell of a) if (b.has(cell)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : 1 - shared / union;
}

/** Сколько фигур ушло с поля, пока шло найденное решение. */
function countEscapes(initial: GameState, report: AuditResult): number {
  let state = initial;
  let escapes = 0;
  for (const action of report.solution) {
    state = applyAction(state, action);
    if (state.lastEvent === 'escaped') escapes += 1;
  }
  return escapes;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * Позиция, из которой игрок уже не спасается: перебраны все его ходы (фигуры
 * отвечают детерминированно), и каждый ответ ведёт к смерти в пределах `depth`
 * полуходов. Это и есть «нерешаемая ситуация» бегущего режима: не мат в один
 * ход, а положение, где полоса закрыта настолько, что исход предрешён.
 *
 * Глубина 3 - компромисс: при 1 метрика превращается в «бьют прямо сейчас», при
 * 5 считает варианты, которые игрок за доской не успевает увидеть. Полоса из
 * `kingRows` рядов даёт максимум восемь клеток, поэтому полный перебор дешёв и
 * его можно включать в каждый ход прогона.
 */
export function isDoomed(state: GameState, depth = 3): boolean {
  if (state.status !== 'playing') return true;
  if (depth <= 0) return false;
  const options = legalMoves(state);
  if (options.length === 0) return true;
  for (const option of options) {
    let next: GameState;
    try {
      next = applyAction(state, { type: 'move', dx: option.dx, dy: option.dy ?? 1 });
    } catch {
      continue;
    }
    // Ход, после которого партия кончилась, спасением не считается.
    if (next.status !== 'playing') continue;
    if (!isDoomed(next, depth - 1)) return false;
  }
  return true;
}

/** Замер «Гонок»: сколько ходов партия остаётся решаемой. */
export interface RaceMeasure {
  level: number;
  /** Какое правило прогонялось: панель сравнивает строки по нему. */
  mode: ModeId;
  samples: number;
  /** Ширина поля на старте и средняя в конце забега: поле растёт вширь. */
  widthStart: number;
  widthEnd: number;
  /** Ходы до нерешаемой позиции. */
  doomAvg: number;
  doomMedian: number;
  doomMin: number;
  doomMax: number;
  /** Доля забегов, где позиция стала нерешаемой раньше конца партии. */
  doomShare: number;
  /** Сколько ходов игрок реально выдержал. */
  lengthAvg: number;
  lengthMedian: number;
  /** Прогоны, упёршиеся в потолок: длина не измерима. */
  capped: number;
  /** Взятия за забег: без них полоса забивается за десять ходов. */
  capturesAvg: number;
  /** Медиана и верхний дециль взятий: на них считается награда за фигуру. */
  capturesMedian: number;
  capturesP90: number;
  /** Выпады через линию за забег: за них награда тоже должна считаться. */
  strikesAvg: number;
  /**
   * Реиграбельность. Смысл один: забег не должен быть той же партией, что и
   * предыдущий. `choiceAvg` - сколько легальных ходов было у игрока на ходу,
   * `safeShare` - какая доля этих ходов не вела к краху, `forcedShare` - доля
   * ходов, где альтернативы не было вовсе.
   */
  choiceAvg: number;
  safeShare: number;
  forcedShare: number;
  /** Сколько фигур сдвигается за такт: 1 = темп «по одной», 3+ = общий темп. */
  moversAvg: number;
  /** Доля сдвигов самого активного типа фигур: 1 = за игроком бегает только она. */
  busiestShare: number;
  /** Какой тип сдвигался чаще всего. */
  busiestType: string;
  /** Доля забегов, стартовавших на разной доске. */
  startVariety: number;
  /** Разброс длины партии: (p90 - p10) / медиана. */
  lengthSpread: number;
  /** Итоговый индекс реиграбельности 0..1: 1 = забеги не похожи друг на друга. */
  replayIndex: number;
  /** Чем кончились забеги: поимка, тупик, потолок. */
  causes: Record<string, number>;
  /**
   * Прогон тех же зёрен на базовом правиле (`compareMode`: по умолчанию «Гонки
   * без выпада»). По разнице видно, что даёт проверяемое правило. Появляется
   * только при `compare: true`.
   */
  comparison?: {
    mode: ModeId;
    doomMedian: number;
    lengthMedian: number;
    capturesAvg: number;
    replayIndex: number;
    samples: number;
  };
}

export interface RaceMeasureOptions {
  samples?: number;
  seed?: number;
  cap?: number;
  depth?: number;
  /**
   * Прогнать те же зёрна на базовом правиле и положить сравнение в строку.
   * Дорого вдвое, поэтому включается только по запросу панели: иначе таблица
   * «Гонок» меряла бы то же самое дважды на каждом прогоне.
   */
  compare?: boolean;
  /** Какое правило меряем. По умолчанию боевые «Гонки». */
  mode?: ModeId;
  /** С чем сравниваем при `compare`. По умолчанию «Гонки без выпада». */
  compareMode?: ModeId;
}

/** Один забег жадным ботом: ровно то, что потом уходит в сводку по уровню. */
interface RaceSampleRun {
  moves: number;
  width: number;
  captures: number;
  /** Номер хода, после которого перебор не оставляет спасения; -1 значит не было. */
  doomedAt: number;
  cause: string;
  capped: boolean;
  /** Выпады через линию: взятия без перемещения, считаются отдельно. */
  strikes: number;
  /** Сумма чисел легальных ходов по всем ходам партии. */
  choices: number;
  /** Ходы, после которых позиция ещё не проиграна и ещё не нерешаема. */
  safe: number;
  /** Ходы с единственным легальным ходом. */
  forced: number;
  /** Сколько сдвигов фигур дал этот забег. */
  movers: number;
  /** Доля сдвигов самого активного типа фигур в этом забеге и сам тип. */
  busiestShare: number;
  busiestType: string;
  /** Подпись стартовой доски: по ней видно, что забег начался с другой позиции. */
  signature: string;
}

/**
 * Забег жадным ботом. `mode` позволяет прогнать те же доски на варианте правил:
 * генератор у «Гонок» один, отличается только конфиг, поэтому сравнение честное.
 */
/** Позиции фигур одной строкой: по ней сравниваем, кто сдвинулся за такт. */
function enemyPositions(state: GameState): Map<string, string> {
  const positions = new Map<string, string>();
  for (const enemy of state.enemies) positions.set(enemy.id, `${enemy.x},${enemy.y}`);
  return positions;
}

function boardSignature(state: GameState): string {
  const pieces = [...enemyPositions(state)]
    .map(([id, at]) => `${id}@${at}`)
    .concat([`king@${state.player.x},${state.player.y}`])
    .join('|');
  return `${state.width}x${state.height}:${pieces}`;
}

function playRaceSample(level: number, seed: number, mode: ModeId, cap: number, depth: number): RaceSampleRun {
  let state = createRaceLevel(level, seed);
  if (mode !== state.mode) state = { ...state, mode };
  const signature = boardSignature(state);
  let doomedAt = -1;
  let strikes = 0;
  let choices = 0;
  let safe = 0;
  let forced = 0;
  let moves = 0;
  let movers = 0;
  // Активность считаем по типам, а не по идентификаторам фигур: в «Гонках» id
  // живут до выхода с поля, и по id вышло бы, что «самая активная фигура» делает
  // один ход из ста.
  const activity = new Map<string, number>();
  while (state.status === 'playing' && state.moves < cap) {
    const doomedNow = isDoomed(state, depth);
    if (doomedAt < 0 && doomedNow) doomedAt = state.moves;
    // «Осмысленный» ход: после него партия жива и перебор ещё видит выход. Проверка
    // съезжает на следующий виток: `isDoomed` - самый дорогой вызов прогона, и
    // второй вызов на тот же такт удвоил бы цену всей таблицы ради одной цифры.
    if (moves > 0 && !doomedNow) safe += 1;
    const options = legalMoves(state);
    choices += options.length;
    if (options.length === 1) forced += 1;
    const before = enemyPositions(state);
    const types = new Map(state.enemies.map((enemy) => [enemy.id, enemy.type]));
    const next = bestSurvivalMove(state) ?? playFirstMove(state);
    if (!next) break;
    state = next;
    moves += 1;
    if (state.lastEvent === 'strike') strikes += 1;
    // Кто сдвинулся за такт. Новых фигур (приток) не считаем: они не ходили.
    for (const [id, at] of enemyPositions(state)) {
      if (!before.has(id)) continue;
      if (before.get(id) === at) continue;
      movers += 1;
      const type = types.get(id) ?? '?';
      activity.set(type, (activity.get(type) ?? 0) + 1);
    }
  }
  const finished = state.status !== 'playing';
  let busiest = 0;
  let busiestType = 'нет';
  for (const [type, value] of activity) {
    if (value > busiest) {
      busiest = value;
      busiestType = type;
    }
  }
  return {
    moves: state.moves,
    width: state.width,
    captures: state.captures ?? 0,
    doomedAt,
    cause: !finished ? 'capped' : (state.lastEvent ?? state.status),
    capped: !finished,
    strikes,
    choices,
    safe,
    forced,
    movers,
    busiestShare: movers > 0 ? busiest / movers : 0,
    busiestType,
    signature,
  };
}

/** Сводка по забегам: те же метрики, что у `RaceMeasure`, но без уровня. */
interface RaceSummary {
  samples: number;
  widthEnd: number;
  capturesMedian: number;
  capturesP90: number;
  strikesAvg: number;
  choiceAvg: number;
  safeShare: number;
  forcedShare: number;
  moversAvg: number;
  busiestShare: number;
  busiestType: string;
  startVariety: number;
  lengthSpread: number;
  replayIndex: number;
  doomAvg: number;
  doomMedian: number;
  doomMin: number;
  doomMax: number;
  doomShare: number;
  lengthAvg: number;
  lengthMedian: number;
  capped: number;
  capturesAvg: number;
  causes: Record<string, number>;
}

function raceSummary(runs: RaceSampleRun[]): RaceSummary {
  const doom = runs.map((run) => run.doomedAt).filter((value) => value >= 0);
  const lengths = runs.map((run) => run.moves);
  const sortedDoom = [...doom].sort((a, b) => a - b);
  const sortedLength = [...lengths].sort((a, b) => a - b);
  const causes: Record<string, number> = {};
  const average = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  const capturesSorted = [...runs.map((run) => run.captures)].sort((a, b) => a - b);
  const at = (sorted: number[], quantile: number): number =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] : 0;
  let widthEnd = 0;
  let captures = 0;
  let capped = 0;
  let strikes = 0;
  let choices = 0;
  let safe = 0;
  let forced = 0;
  let moves = 0;
  let movers = 0;
  let busiestShare = 0;
  const byType = new Map<string, number>();
  for (const run of runs) {
    widthEnd += run.width;
    captures += run.captures;
    strikes += run.strikes;
    choices += run.choices;
    safe += run.safe;
    forced += run.forced;
    moves += run.moves;
    movers += run.movers;
    busiestShare += run.busiestShare;
    byType.set(run.busiestType, (byType.get(run.busiestType) ?? 0) + 1);
    if (run.capped) capped += 1;
    causes[run.cause] = (causes[run.cause] ?? 0) + 1;
  }
  const samples = runs.length || 1;
  const startVariety = runs.length ? new Set(runs.map((run) => run.signature)).size / samples : 0;
  const choiceAvg = moves > 0 ? choices / moves : 0;
  const safeShare = moves > 0 ? safe / moves : 0;
  const forcedShare = moves > 0 ? forced / moves : 0;
  const lengthMedian = sortedLength[Math.floor(sortedLength.length / 2)];
  // Разброс длины normalized медианой: 0.5 значит «верхний дециль выше нижнего
  // на половину партии». Без нормировки цифра росла бы просто с длиной поля.
  const lengthSpread = lengthMedian > 0 ? (at(sortedLength, 0.9) - at(sortedLength, 0.1)) / lengthMedian : 0;
  // Индекс реиграбельности: четыре слагаемых, каждое утоплено в 0..1. Выбор
  // ценим выше всего - без него остальное не имеет значения; разнообразие
  // стартов весит меньше всех, потому что оно свойство генератора, а не правила.
  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
  const replayIndex =
    0.35 * clamp01(choiceAvg / 3) +
    0.25 * clamp01(safeShare / 0.7) +
    0.25 * clamp01(lengthSpread / 0.5) +
    0.15 * clamp01(startVariety);
  return {
    samples: runs.length,
    widthEnd: widthEnd / samples,
    // Если ни один забег не стал нерешаемым (бот умер от другого или упёрся в
    // потолок), берём длину партии: иначе в отчёте ноль выглядит как подарок.
    doomAvg: doom.length > 0 ? average(doom) : average(lengths),
    doomMedian: doom.length > 0 ? sortedDoom[Math.floor(sortedDoom.length / 2)] : sortedLength[Math.floor(sortedLength.length / 2)],
    doomMin: doom.length > 0 ? sortedDoom[0] : sortedLength[0],
    doomMax: doom.length > 0 ? sortedDoom[sortedDoom.length - 1] : sortedLength[sortedLength.length - 1],
    doomShare: doom.length / samples,
    lengthAvg: average(lengths),
    lengthMedian: sortedLength[Math.floor(sortedLength.length / 2)],
    capped,
    capturesAvg: captures / samples,
    capturesMedian: at(capturesSorted, 0.5),
    capturesP90: at(capturesSorted, 0.9),
    strikesAvg: strikes / samples,
    choiceAvg,
    safeShare,
    forcedShare,
    moversAvg: moves > 0 ? movers / moves : 0,
    busiestShare: runs.length ? busiestShare / runs.length : 0,
    busiestType:
      [...byType].reduce((best, entry) => (entry[1] > best[1] ? entry : best), ['нет', 0])[0],
    startVariety,
    lengthSpread,
    replayIndex,
    causes,
  };
}

/**
 * Прогон «Гонок» на правиле полосы: жадный бот (тот же выбор, что у подсказки)
 * играет до конца партии, а мы меряем длину игры до позиции, где исход
 * предрешён. Цифры - верхняя граница того, что читается глазами, а не потолок
 * движка: бот не считает на два темпа вперёд и потому иногда умирает раньше.
 */
export function measureRaceLevels(
  levels: readonly number[],
  options: RaceMeasureOptions = {},
): RaceMeasure[] {
  // Потолок 2000: панель умеет прогон на 1000 досок по явной кнопке, и цифра в
  // отчёте обязана означать ровно столько забегов, сколько прогналось.
  const samples = Math.max(1, Math.min(2_000, options.samples ?? 24));
  const cap = Math.max(8, options.cap ?? 240);
  const depth = Math.max(1, options.depth ?? 3);
  const mode = options.mode ?? ('race' as ModeId);
  const compareMode = options.compareMode ?? ('raceNoStrike' as ModeId);
  const play = (level: number, mode: ModeId): RaceSampleRun[] => {
    const runs: RaceSampleRun[] = [];
    for (let i = 0; i < samples; i += 1) {
      const seed = ((options.seed ?? 4242) ^ (level * 7919) ^ (i * 104729)) >>> 0;
      runs.push(playRaceSample(level, seed, mode, cap, depth));
    }
    return runs;
  };

  return levels.map((level) => {
    const summary = raceSummary(play(level, mode));
    const row: RaceMeasure = { level, mode, widthStart: RACE_MIN_WIDTH, ...summary };
    // Правило не сравнивает само себя: второй прогон тех же зёрен дал бы нули,
    // а панель показывала бы «ровно 0» вместо «это база».
    if (options.compare && compareMode !== mode) {
      const baseline = raceSummary(play(level, compareMode));
      row.comparison = {
        mode: compareMode,
        doomMedian: baseline.doomMedian,
        lengthMedian: baseline.lengthMedian,
        capturesAvg: +baseline.capturesAvg.toFixed(1),
        replayIndex: +baseline.replayIndex.toFixed(3),
        samples: baseline.samples,
      };
    }
    return row;
  });
}

export interface RolloutResult {
  moves: number;
  status: GameState['status'];
  event: string;
  captures: number;
  tier: number;
  /** Прогон упёрся в потолок: длина жизни не измерима, поле не кончается. */
  capped: boolean;
}

/** Ближайшая фигура: по расстоянию до неё бот понимает, насколько тесно. */
function nearestDistance(state: GameState): number {
  let best = 99;
  for (const enemy of state.enemies) {
    const distance = Math.max(Math.abs(enemy.x - state.player.x), Math.abs(enemy.y - state.player.y));
    if (distance < best) best = distance;
  }
  return best;
}

function bestSurvivalMove(state: GameState): GameState | null {
  let best: GameState | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const option of legalMoves(state)) {
    const next = applyAction(state, { type: 'move', dx: option.dx, dy: option.dy ?? 1 });
    if (next.status !== 'playing') continue;
    let rank =
      next.enemies.length * 6 -
      legalMoves(next).length * 1.5 -
      nearestDistance(next) * 2 +
      (next.player.y >= next.height - 3 ? 1.5 : 0);
    // Полоса в два ряда: высота больше не валюта - вверх ходить нельзя, и спорить
    // за ряды боту не за что. А вот угол остаётся ловушкой: из него половина
    // ходов отрезана краем, и приехавшая в полосу фигура закрывает всё.
    if (rulesFor(next.mode).kingRows > 0 && (next.player.x === 0 || next.player.x === next.width - 1)) {
      rank += 1.2;
    }
    if (rank < bestRank) {
      bestRank = rank;
      best = next;
    }
  }
  return best;
}

/** Первый легальный ход: нужен, когда все остальные ведут на клетку под бой. */
function playFirstMove(state: GameState): GameState | null {
  const option = legalMoves(state)[0];
  if (!option) return null;
  return applyAction(state, { type: 'move', dx: option.dx, dy: option.dy ?? 1 });
}

/**
 * Прогон поля жадным ботом до конца забега.
 *
 * Деревом поиска длину выживания не измерить: на восьми направлениях короля
 * поиск обрывается на потолке узлов, и «дожил до границы» стало бы ответом для
 * любой расстановки. Поэтому здесь простой детерминированный бот: он выживает,
 * снимает фигуры и не прижимается к краю. Он слабее человека, и это как нужно:
 * замер снизу, а не обещание. Тот же бот стоит в тестах движка.
 */
export function survivalRollout(start: GameState, cap = 240): RolloutResult {
  let state = start;
  let captures = 0;
  let guard = 0;
  while (state.status === 'playing' && guard++ < cap) {
    const before = state.enemies.length;
    // Безопасного хода может не быть вовсе: тогда играется первый легальный, и
    // забег честно кончается смертью, а не пометкой «упёрся в потолок».
    const next = bestSurvivalMove(state) ?? playFirstMove(state);
    if (!next) break;
    if (next.enemies.length < before) captures += before - next.enemies.length;
    state = next;
  }
  return {
    moves: state.moves,
    status: state.status,
    event: state.lastEvent ?? '',
    captures,
    tier: state.tier,
    capped: state.status === 'playing',
  };
}

export interface AnalyzeOptions {
  mode: ModeId;
  level: number;
  /** Сколько уровней перебрать. 20 достаточно, чтобы доли перестали прыгать. */
  samples?: number;
  seed?: number;
  /** Ограничение глубины разбора, по умолчанию высота поля + 4. */
  maxDepth?: number;
  /** Прогресс прогона: сколько досок разобрано из `samples`. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Прогон по варианту правил: генерирует `samples` уровней и считает метрики.
 * Детерминирован: тот же seed даёт тот же отчёт.
 */
export function analyzeVariant(options: AnalyzeOptions): VariantReport {
  const { mode, level } = options;
  const samples = Math.max(4, Math.min(2_000, options.samples ?? 20));
  const seed = options.seed ?? 20261022;
  const band = difficultyBand(level, mode);
  const startedAt = Date.now();

  const layouts = new Set<string>();
  const scores: number[] = [];
  const steps: number[] = [];
  const escapes: number[] = [];
  const captures: number[] = [];
  const firstMoves: number[] = [];
  const choiceSteps: number[] = [];
  const paths: number[] = [];
  const forced: number[] = [];
  const survivalSteps: number[] = [];
  let solvable = 0;
  let inBand = 0;
  let capped = 0;
  let fallbacks = 0;
  let previousCells: Set<string> | null = null;
  let distanceSum = 0;
  let distancePairs = 0;

  const king = rulesFor(mode).player === 'king';
  for (let index = 0; index < samples; index++) {
    const state = createSpecialLevel(mode, level, seed + index * 7919);
    const survivalMode = isSurvivalGoal(mode);
    const report = auditState(state, {
      // Для режима на уклонение глубина нужна заметно больше высоты поля:
      // только так видно, уклонение кончается или продолжается до упора.
      // Королю глубину режем до четырёх: дерево на восьми направлениях растёт
      // слишком быстро, а метрики выбора (первые ходы, развилки, форсмажор)
      // читаются и на ней; длину забега считает прогон.
      maxDepth: king ? 4 : options.maxDepth ?? (survivalMode ? SURVIVAL_DEPTH : state.height + 4),
      maxNodes: 60_000,
    });
    const rollout = king ? survivalRollout(state) : null;
    if (state.lastEvent === 'fallback') fallbacks += 1;
    layouts.add(layoutKey(state));
    const cells = layoutCells(state);
    if (previousCells) {
      distanceSum += jaccard(previousCells, cells);
      distancePairs += 1;
    }
    previousCells = cells;

    scores.push(report.score);
    steps.push(report.steps);
    firstMoves.push(report.firstMoves);
    choiceSteps.push(report.choiceSteps);
    paths.push(report.paths ?? 0);
    captures.push(rollout ? rollout.captures : report.captures ?? 0);
    forced.push(report.steps > 0 ? report.forced / report.steps : 0);
    options.onProgress?.(index + 1, samples);
    if (rollout) {
      solvable += 1;
      survivalSteps.push(rollout.moves);
      escapes.push(0);
      if (rollout.capped) capped += 1;
    } else if (report.survival) {
      solvable += 1;
      survivalSteps.push(report.steps);
      escapes.push(countEscapes(state, report));
      if (report.survivalCapped) capped += 1;
    } else if (report.solvable) {
      solvable += 1;
      escapes.push(countEscapes(state, report));
      if (report.score >= band.min && report.score <= band.max) inBand += 1;
    }
  }

  const uniqueLayouts = layouts.size;
  const avgChoiceSteps = average(choiceSteps);
  const avgPaths = average(paths);
  const variety = samples ? uniqueLayouts / samples : 0;
  const distance = distancePairs ? distanceSum / distancePairs : 0;
  const choice = Math.min(1, avgChoiceSteps / 2);
  const forks = Math.min(1, Math.log2(Math.max(1, avgPaths) + 1) / 2);
  const fire = Math.min(1, average(forced) * 2);
  // Индекс реиграбельности: генератор выдаёт разные доски (40%), соседи не
  // похожи (25%), на уровне есть куда свернуть (25%), и он не состоит из
  // единственных ходов (10%).
  const replayIndex = Math.round(100 * (0.4 * variety + 0.25 * distance + 0.25 * choice + 0.1 * (1 - fire)));

  return {
    mode,
    level,
    samples,
    solvableShare: +(solvable / samples).toFixed(3),
    avgScore: Math.round(average(scores)),
    inBandShare: +(inBand / samples).toFixed(3),
    survival: survivalSteps.length
      ? {
          avg: +average(survivalSteps).toFixed(1),
          min: Math.min(...survivalSteps),
          max: Math.max(...survivalSteps),
          capped,
        }
      : undefined,
    avgSteps: +average(steps).toFixed(2),
    avgEscapes: +average(escapes).toFixed(2),
    avgCaptures: +average(captures).toFixed(2),
    uniqueLayouts,
    fallbacks,
    layoutDistance: +distance.toFixed(3),
    avgFirstMoves: +average(firstMoves).toFixed(2),
    avgChoiceSteps: +avgChoiceSteps.toFixed(2),
    avgPaths: +avgPaths.toFixed(2),
    forcedShare: +average(forced).toFixed(3),
    replayIndex,
    ms: Date.now() - startedAt,
  };
}

/**
 * Прогон генератора «Парковки»: метрика тут своя, потому что боевой режим это
 * головоломка из `jam.ts`, а не пешечное поле из `rulesFor`. Лаборатория меряет
 * length решения и долю расстановок, которые решатель вообще взял.
 */
export interface JamMeasure {
  level: number;
  samples: number;
  /** Геометрия поля берётся у самого генератора: `jamBoard` и `boardForMode` не одно и то же. */
  width: number;
  height: number;
  /** Среднее число фигур на поле. */
  avgPieces: number;
  /** Средняя длина решения в ходах и её разброс. */
  avgCost: number;
  minCost: number;
  maxCost: number;
  /** Доля расстановок, для которых решатель нашёл план. */
  solvedShare: number;
  /** Сколько планов не влезло в бюджет: на боевом режиме это откат генератора. */
  overBudget: number;
  /** Ветвление на плане: сколько ходов в среднем доступно игроку на шаге. */
  avgChoice: number;
  /**
   * Прощение первого шага: доля ходов вне плана (первые шесть вариантов), после
   * которых задача остаётся решаемой **в пределах бюджета**. Прежняя версия
   * считала просто «решатель довёл до пустой доски» и давала 95-100% на любом
   * уровне: при бюджете в две длины плана это ничего не различало. Теперь ход,
   * после которого план в бюджет не влезает, прощением не считается - метрика
   * начинает спорить с «Запасом», а не кивать ему.
   */
  forgiveness: number;
  /**
   * Пена хода вне плана: (потраченный ход + оставшийся план) / остаток плана на
   * этом шаге. 1.00 - ход встал ровно вместо планового, 1.40 - ошибка стоит
   * сорока процентов остатка. Значение ниже единицы честно и означает другое:
   * решатель на остатке нашёл план короче обещанного, то есть план генератора не
   * минимален. Мерить имеет смысл только превышение над 1.00.
   */
  penaltyAvg: number;
  /** Доля ходов вне плана, после которых поле вообще не решается. */
  doomShare: number;
  /** Бюджет ходов и запас над планом: сколько можно ходить вхолостую. */
  budgetAvg: number;
  slackAvg: number;
  /** Уникальные расстановки в выборке: главный признак реиграбельности. */
  uniqueLayouts: number;
  /** Средняя разница между соседними расстановками, 0..1 (по занятым клеткам). */
  layoutDistance: number;
  /** Сводный индекс сложности 0..1: длина плана, отсутствие прощения и запаса. */
  difficulty: number;
  /** Сводный индекс реиграбельности 0..1: разнообразие генератора и развилки. */
  replayIndex: number;
}

/**
 * Пальцы генератора: расстановки сравниваются по множество занятыми клеток, и
 * расстояние - это Жаккар, а не «совпал ли id фигуры». Две доски с одним
 * набором клеток, но разными родами, всё-таки разные задачи, поэтому род и
 * цвет входят в отпечаток клетки.
 */
function jamLayoutKey(state: JamState): string {
  return state.pieces
    .map((piece) => `${piece.type}${piece.side}${piece.x}${piece.y}`)
    .sort()
    .join('|');
}

function jamLayoutCells(state: JamState): Set<string> {
  return new Set(state.pieces.map((piece) => `${piece.type}${piece.side}${piece.x},${piece.y}`));
}

/**
 * Развилки на готовом плане: на каждом шаге считаем, сколько ходов вообще
 * легально. Плюс прощение: те же развилки на первом шаге, но с проверкой - не
 * убивает ли задача ход вне плана. Считается решателем, потому что «остался ли
 * ответ» - вопрос не числа ходов, а существования плана.
 */
function jamPlanBranching(
  state: JamState,
  plan: readonly JamAction[],
): { choices: number[]; forgiven: number; tried: number; penalty: number[]; doomed: number } {
  const choices: number[] = [];
  const penalty: number[] = [];
  let forgiven = 0;
  let doomed = 0;
  let tried = 0;
  let current = state;
  let step = 0;
  for (const action of plan) {
    // И остаток плана, и остаток бюджета считаются от текущего шага: план уже
    // стоил `step` ходов, а ход вне плана стоит ещё один сверху. Прежний вариант
    // сверялся с полным планом и полным бюджетом, от чего пена выходила меньше
    // единицы («ошибка дешевле плана»), а прощение просто кивало запасу.
    const budgetLeft = Math.max(0, current.budget - current.moves - 1);
    const baseCost = Math.max(1, plan.length - step);
    const options = jamLegalActions(current);
    choices.push(options.length);
    if (step === 0) {
      for (const option of options.slice(0, 6)) {
        if (plan.length > 0 && option.id === plan[0].id && option.to.x === plan[0].to.x && option.to.y === plan[0].to.y) {
          continue;
        }
        try {
          const after = applyJamAction(current, option, RuleError);
          tried += 1;
          const solved = solveJamExits(after);
          if (!solved.ok) {
            doomed += 1;
            continue;
          }
          penalty.push((solved.moves.length + 1) / baseCost);
          // Прощением считается только то, что ещё влезает в бюджет: «решается за
          // 90 ходов из данных 60» игрок не сыграет, и называть это свободой нельзя.
          if (solved.moves.length <= budgetLeft) forgiven += 1;
        } catch {
          /* ход вне плана мог быть запрещён правилами: его не считаем */
        }
      }
    }
    try {
      current = applyJamAction(current, action, RuleError);
    } catch {
      break;
    }
    step += 1;
  }
  return { choices, forgiven, tried, penalty, doomed };
}

/**
 * Замер генератора «Парковки». `densityBias` - лабораторная ручка: на сколько
 * долей занятности добавлять фигур к боевой кривой, чтобы увидеть, где пробка
 * перестаёт расходиться. В боевой игре смещение всегда ноль.
 */
export function measureJamLevels(
  levels: number[],
  samples = 20,
  seed = 20261022,
  densityBias = 0,
): JamMeasure[] {
  return levels.map((level) => {
    const costs: number[] = [];
    const choices: number[] = [];
    let solved = 0;
    let over = 0;
    let pieces = 0;
    let forgiven = 0;
    let tried = 0;
    let doomed = 0;
    const penalties: number[] = [];
    let budget = 0;
    let slack = 0;
    let width = 0;
    let height = 0;
    const keys = new Set<string>();
    const layouts: Array<Set<string>> = [];
    for (let index = 0; index < samples; index++) {
      const state = createJamPuzzle(level, seed + index * 7919, 24, densityBias);
      width = state.width;
      height = state.height;
      pieces += state.total;
      const plan = state.plan ?? [];
      if (plan.length > 0) solved += 1;
      costs.push(plan.length);
      if (plan.length > state.budget) over += 1;
      keys.add(jamLayoutKey(state));
      layouts.push(jamLayoutCells(state));
      const branching = jamPlanBranching(state, plan);
      choices.push(...branching.choices);
      forgiven += branching.forgiven;
      tried += branching.tried;
      doomed += branching.doomed;
      penalties.push(...branching.penalty);
      budget += state.budget;
      slack += Math.max(0, state.budget - plan.length);
    }
    const sorted = [...costs].sort((a, b) => a - b);
    // Расстояние между соседними расстановками: если генератор на новом зерне
    // выдаёт ту же доску, расстояние ноль, и задача протухает за один проход.
    const distance = average(
      layouts.slice(1).map((cells, index) => {
        const previous = layouts[index];
        let shared = 0;
        for (const cell of cells) if (previous.has(cell)) shared += 1;
        const union = previous.size + cells.size - shared;
        return union > 0 ? 1 - shared / union : 0;
      }),
    );
    return {
      level,
      samples,
      width,
      height,
      avgPieces: +(pieces / samples).toFixed(1),
      avgCost: +average(costs).toFixed(1),
      minCost: sorted[0] ?? 0,
      maxCost: sorted[sorted.length - 1] ?? 0,
      solvedShare: +(solved / samples).toFixed(3),
      overBudget: over,
      avgChoice: +(choices.length ? average(choices) : 0).toFixed(2),
      forgiveness: +(tried > 0 ? forgiven / tried : 1).toFixed(3),
      penaltyAvg: +(penalties.length ? average(penalties) : 1).toFixed(2),
      doomShare: +(tried > 0 ? doomed / tried : 0).toFixed(3),
      budgetAvg: +(budget / samples).toFixed(1),
      slackAvg: +(slack / samples).toFixed(1),
      uniqueLayouts: keys.size,
      layoutDistance: +distance.toFixed(3),
      // Реиграбельность - про генератор, а не про длину плана: та же доска с
      // другим планом остаётся той же задачей. 6 развилок на шаге считается
      // достаточно, чтобы второй проход не был заучиванием.
      replayIndex: +(
        0.45 * Math.min(1, keys.size / samples) +
        0.3 * Math.min(1, distance) +
        0.25 * Math.min(1, (choices.length ? average(choices) : 0) / 6)
      ).toFixed(3),
      // Сложность - про игрока: длинный план, отсутствие прощения и тонкий
      // запас бюджета. 90 ходов - потолок лестницы после того, как поле стало
      // расти и за 20-м уровнем (на 40-м план 84-95): на прежних 60 индекс
      // упирался в единицу уже к 25-му уровню и переставал различать задачи.
      // 12 ходов запаса - порог, выше которого можно ходить наугад.
      difficulty: +(
        0.45 * Math.min(1, average(costs) / 90) +
        0.3 * (1 - Math.min(1, tried > 0 ? forgiven / tried : 1)) +
        0.25 * Math.max(0, 1 - Math.min(1, slack / samples / 12))
      ).toFixed(3),
    };
  });
}

export const JAM_VARIANTS: ModeId[] = ['jam', 'jamExit2', 'jamExit4'];
// «Уклонение» - прежний лабораторный режим, `raceNoStrike` - тот же бой без
// права на выпад: на этой паре правило проверяется цифрами.
export const RACE_VARIANTS: ModeId[] = ['race', 'raceDodge', 'raceNoStrike'];
/** Варианты, которые сравнение обязано уметь прогонять: движение и темп в кампании, диагональ в «Парковке». */
export const SUITE_VARIANTS: ModeId[] = ['campaign', 'campaignForwardOne', 'jam', 'jamStrictDiag'];

/** Прогон нескольких вариантов на одном уровне. Возвращает отчёты в том же порядке. */
export function compareVariants(modes: ModeId[], level: number, samples = 20, seed?: number): VariantReport[] {
  return modes.map((mode) => analyzeVariant({ mode, level, samples, seed }));
}
