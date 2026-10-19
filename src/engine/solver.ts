import { legalMoves } from './board';
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
      ? moves.map((move) => ({ type: 'move' as const, dx: move.dx }))
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
