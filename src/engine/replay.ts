import { auditState, difficultyBand, SURVIVAL_DEPTH, type AuditResult } from './audit';
import { legalMoves } from './board';
import { isSurvivalGoal, rulesFor } from './modes';
import { applyAction } from './rules';
import { createJamPuzzle } from './jam';
import { createSpecialLevel } from './specials';
import type { ModeId } from './modes';
import type { GameState } from './types';

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
    const rank =
      next.enemies.length * 6 -
      legalMoves(next).length * 1.5 -
      nearestDistance(next) * 2 +
      (next.player.y <= 1 ? 0.5 : 0) +
      (next.player.y >= next.height - 3 ? 1.5 : 0);
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
}

export function measureJamLevels(levels: number[], samples = 20, seed = 20261022): JamMeasure[] {
  return levels.map((level) => {
    const costs: number[] = [];
    let solved = 0;
    let over = 0;
    let pieces = 0;
    let width = 0;
    let height = 0;
    for (let index = 0; index < samples; index++) {
      const state = createJamPuzzle(level, seed + index * 7919);
      width = state.width;
      height = state.height;
      pieces += state.total;
      const plan = state.plan ?? [];
      if (plan.length > 0) solved += 1;
      costs.push(plan.length);
      if (plan.length > state.budget) over += 1;
    }
    const sorted = [...costs].sort((a, b) => a - b);
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
    };
  });
}

export const JAM_VARIANTS: ModeId[] = ['jam', 'jamExit2', 'jamExit4'];
export const RACE_VARIANTS: ModeId[] = ['race', 'raceDodge'];
export const DIAGONAL_VARIANTS: ModeId[] = ['campaign', 'campaignStrictDiag', 'jam', 'jamStrictDiag'];

/** Прогон нескольких вариантов на одном уровне. Возвращает отчёты в том же порядке. */
export function compareVariants(modes: ModeId[], level: number, samples = 20, seed?: number): VariantReport[] {
  return modes.map((mode) => analyzeVariant({ mode, level, samples, seed }));
}
