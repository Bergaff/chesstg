import { auditState, difficultyBand, SURVIVAL_DEPTH, type AuditResult } from './audit';
import { rulesFor } from './modes';
import { applyAction } from './rules';
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

  for (let index = 0; index < samples; index++) {
    const state = createSpecialLevel(mode, level, seed + index * 7919);
    const survivalMode = rulesFor(mode).goal === 'survive';
    const report = auditState(state, {
      // Для режима на уклонение глубина нужна заметно больше высоты поля:
      // только так видно, уклонение кончается или продолжается до упора.
      maxDepth: options.maxDepth ?? (survivalMode ? SURVIVAL_DEPTH : state.height + 4),
      maxNodes: 60_000,
    });
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
    captures.push(report.captures ?? 0);
    forced.push(report.steps > 0 ? report.forced / report.steps : 0);
    options.onProgress?.(index + 1, samples);
    if (report.survival) {
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

export const JAM_VARIANTS: ModeId[] = ['jam', 'jamExit2', 'jamExit4'];
export const RACE_VARIANTS: ModeId[] = ['race', 'raceDodge'];
export const DIAGONAL_VARIANTS: ModeId[] = ['campaign', 'campaignStrictDiag', 'jam', 'jamStrictDiag'];

/** Прогон нескольких вариантов на одном уровне. Возвращает отчёты в том же порядке. */
export function compareVariants(modes: ModeId[], level: number, samples = 20, seed?: number): VariantReport[] {
  return modes.map((mode) => analyzeVariant({ mode, level, samples, seed }));
}
