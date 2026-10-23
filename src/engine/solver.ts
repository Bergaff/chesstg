import { enemyAttacksCell, legalMoves } from './board';
import { rulesFor } from './modes';
import { applyAction } from './rules';
import type { Cell, GameAction, GameState } from './types';

export interface AnalysisOptions {
  maxDepth?: number;
  maxNodes?: number;
}

export interface Analysis {
  solvable: boolean;
  path: GameAction[];
  finalScore: number;
  nodes: number;
  truncated: boolean;
}

function stateKey(state: GameState): string {
  const enemies = state.enemies.map((e) => `${e.type[0]}${e.x},${e.y}`).join(';');
  return [
    state.width,
    state.height,
    state.player.x,
    state.player.y,
    state.moves,
    state.freeze,
    state.shield,
    state.rng,
    state.status,
    enemies,
  ].join('|');
}

/**
 * Перебор вариантов ходов. Враг детерминирован, поэтому из каждого состояния
 * получается ровно одно продолжение на каждое действие игрока.
 *
 * Для кампании ищет путь до верхнего ряда. Если пути нет, возвращает
 * максимально далёкий безопасный путь (используется подсказкой).
 */
export function analyzeState(start: GameState, options: AnalysisOptions = {}): Analysis {
  const maxDepth = options.maxDepth ?? start.height + 2;
  const maxNodes = options.maxNodes ?? 4000;

  let nodes = 0;
  let truncated = false;
  let bestScore = start.score;
  let bestPath: GameAction[] = [];
  const memo = new Set<string>();

  const dfs = (state: GameState, path: GameAction[], depth: number): GameAction[] | null => {
    nodes++;
    if (nodes > maxNodes) {
      truncated = true;
      return null;
    }

    if (state.status === 'won') return [];
    if (state.status === 'lost' || depth <= 0) {
      if (state.score > bestScore) {
        bestScore = state.score;
        bestPath = path.slice();
      }
      return null;
    }

    const key = `${stateKey(state)}|d${depth}`;
    if (memo.has(key)) return null;

    const moves = legalMoves(state);
    const actions: GameAction[] = moves.length
      ? moves.map((move) => ({ type: 'move' as const, dx: move.dx, dy: move.dy ?? 1 }))
      : [{ type: 'skip' as const }];

    for (const action of actions) {
      const next = applyAction(state, action);
      const tail = dfs(next, [...path, action], depth - 1);
      if (tail) return [action, ...tail];
      if (truncated) return null;
    }

    memo.add(key);
    return null;
  };

  const winPath = dfs(start, [], maxDepth);

  return {
    solvable: winPath !== null,
    path: winPath ?? bestPath,
    finalScore: winPath ? start.height - 1 : bestScore,
    nodes,
    truncated,
  };
}

/** Насколько далеко от короля стоит ближайшая фигура. 99 значит поле пусто. */
function nearestThreat(state: GameState): number {
  let best = 99;
  for (const enemy of state.enemies) {
    const distance = Math.max(Math.abs(enemy.x - state.player.x), Math.abs(enemy.y - state.player.y));
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * Оценка хода в режимах на выживание. Финиша там нет, поэтому искать путь не к
 * чему: важно пережить следующий ход и оставить себе куда уходить дальше.
 * Взятие стоит дороже свободы манёвра, свободные клетки дороже дистанции, а
 * линия рождения фигур штрафует сильнее, чем близость края.
 */
function rankSurvival(state: GameState, next: GameState): number {
  if (next.status === 'won') return 1000;
  if (next.status !== 'playing') return -1000;
  let score = 0;
  if ((next.captures ?? 0) > (state.captures ?? 0)) score += 14;
  const options = legalMoves(next);
  score += options.length * 1.2;
  const safe = options.filter(
    (option) => !next.enemies.some((enemy) => enemyAttacksCell(next, enemy, option.x, option.y)),
  ).length;
  score += safe * 2.5;
  score += Math.min(5, nearestThreat(next)) * 1.5;
  // Строки, где рождается приток: вставать туда невыгодно, оттуда фигура
  // приходит на голову уже в следующем ходу.
  const top = next.height - (rulesFor(next.mode).spawnRows ?? 1);
  if (next.player.y >= top) score -= (next.player.y - top + 1) * 4;
  return score;
}

function bestSurvivalStep(state: GameState): GameState | null {
  let best: GameState | null = null;
  let bestRank = -Infinity;
  for (const move of legalMoves(state)) {
    const action: GameAction = { type: 'move', dx: move.dx, dy: move.dy ?? 1 };
    let next: GameState;
    try {
      next = applyAction(state, action);
    } catch {
      continue;
    }
    const rank = rankSurvival(state, next);
    if (rank > bestRank) {
      bestRank = rank;
      best = next;
    }
  }
  return best;
}

/**
 * Подсказка режимов на выживание: одно-два уклонения, выбранные той же
 * эвристикой, чем пользуется бот в лаборатории. Перебор `analyzeState` здесь
 * не работает: ветвление короля восемь вариантов, и на глубине шесть он упирается
 * в лимит узлов, возвращая пустой путь, то есть «безопасного пути не видно».
 */
export function survivalHint(state: GameState, steps = 2): Cell[] {
  const cells: Cell[] = [];
  let current = state;
  for (let step = 0; step < steps; step++) {
    const next = bestSurvivalStep(current);
    if (!next) break;
    cells.push({ ...next.player });
    current = next;
    if (current.status !== 'playing') break;
  }
  return cells;
}

/**
 * Превращает путь из действий в клетки, которые нужно подсветить.
 * Показывает только ходы игрока (не больше steps).
 */
export function projectHint(state: GameState, path: GameAction[], steps = 2): Cell[] {
  const cells: Cell[] = [];
  let current = state;
  for (const action of path) {
    if (cells.length >= steps) break;
    if (action.type === 'buff') continue;
    try {
      current = applyAction(current, action);
    } catch {
      break;
    }
    if (action.type === 'move') cells.push({ ...current.player });
    if (current.status !== 'playing') break;
  }
  return cells;
}
