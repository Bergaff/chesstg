import type { Cell, Enemy, GameState, MoveDx, MoveOption, PieceType } from './types';
import { rulesFor } from './modes';

export const PIECE_GLYPH: Record<PieceType, string> = {
  pawn: '♟',
  rook: '♜',
  bishop: '♝',
  knight: '♞',
  queen: '♛',
};

export const PIECE_NAME: Record<PieceType, string> = {
  pawn: 'Пешка',
  rook: 'Ладья',
  bishop: 'Слон',
  knight: 'Конь',
  queen: 'Ферзь',
};

export function inside(state: Pick<GameState, 'width' | 'height'>, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

export function enemyAt(state: GameState, x: number, y: number, exceptId?: string): Enemy | undefined {
  return state.enemies.find((e) => e.x === x && e.y === y && e.id !== exceptId);
}

export function isPlayerAt(state: GameState, x: number, y: number): boolean {
  return state.player.x === x && state.player.y === y;
}

/**
 * Ходы пешки: один ряд вперёд (прямо или по диагонали) плюс, по правилам режима,
 * взятие по диагонали и двойной шаг с начальной позиции.
 */
export function legalMoves(state: GameState): MoveOption[] {
  if (state.status !== 'playing') return [];
  const rules = rulesFor(state.mode);
  const result: MoveOption[] = [];
  const directions: MoveDx[] = [-1, 0, 1];
  for (const dx of directions) {
    const x = state.player.x + dx;
    const y = state.player.y + 1;
    if (!inside(state, x, y)) continue;
    const occupant = enemyAt(state, x, y);
    if (!occupant) {
      result.push({ x, y, dx, dy: 1 });
      continue;
    }
    // Пешка бьёт только по диагонали вперёд, прямо фигуру ставить нельзя.
    if (rules.captures && dx !== 0 && (rules.captureQuota <= 0 || (state.captures ?? 0) < rules.captureQuota)) {
      result.push({ x, y, dx, dy: 1, takes: occupant.type });
    }
  }

  if (rules.doubleStep && state.player.y === 0 && (state.moves ?? 0) === 0) {
    const x = state.player.x;
    const y = state.player.y + 2;
    if (inside(state, x, y) && !enemyAt(state, x, y) && !enemyAt(state, x, y - 1)) {
      result.push({ x, y, dx: 0, dy: 2 });
    }
  }

  return result;
}

export function isMoveLegal(state: GameState, dx: MoveDx, dy: 1 | 2 = 1): boolean {
  return legalMoves(state).some((m) => m.dx === dx && (m.dy ?? 1) === dy);
}

/** Сколько фигур ещё можно взять в режиме. */
export function capturesLeft(state: GameState): number {
  const quota = rulesFor(state.mode).captureQuota;
  return quota <= 0 ? Number.POSITIVE_INFINITY : Math.max(0, quota - (state.captures ?? 0));
}

/** Сколько добровольных пропусков ещё доступно в режиме. */
export function skipsLeft(state: GameState): number {
  return Math.max(0, rulesFor(state.mode).skipQuota - (state.skips ?? 0));
}

/** Может ли игрок пропустить ход: если ходов нет, пропуск обязателен, иначе нужна квота. */
export function canSkip(state: GameState): boolean {
  if (state.status !== 'playing') return false;
  return legalMoves(state).length === 0 || skipsLeft(state) > 0;
}

/**
 * Клетки, куда вражеская фигура может пойти по классическим правилам.
 * Игрок, единственная фигура, которую враг может «съесть»; враги друг друга
 * не бьют и не проходят сквозь друг друга.
 */
export function enemyMoves(state: GameState, enemy: Enemy): Cell[] {
  const moves: Cell[] = [];
  const tryAdd = (x: number, y: number) => {
    if (!inside(state, x, y)) return false;
    if (enemyAt(state, x, y, enemy.id)) return false;
    moves.push({ x, y });
    return true;
  };

  switch (enemy.type) {
    case 'pawn': {
      // Вражеская пешка идёт на 1 клетку вниз (к игроку) и бьёт по диагонали вниз.
      // На клетку игрока вперёд пешка не встаёт, только бьёт диагонально.
      if (inside(state, enemy.x, enemy.y - 1)) {
        if (!isPlayerAt(state, enemy.x, enemy.y - 1) && !enemyAt(state, enemy.x, enemy.y - 1, enemy.id)) {
          moves.push({ x: enemy.x, y: enemy.y - 1 });
        }
      }
      for (const dx of [-1, 1]) {
        const x = enemy.x + dx;
        const y = enemy.y - 1;
        if (isPlayerAt(state, x, y) && inside(state, x, y)) {
          moves.push({ x, y });
        }
      }
      break;
    }
    case 'rook': {
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dx, dy] of dirs) {
        for (let step = 1; step < Math.max(state.width, state.height); step++) {
          const x = enemy.x + dx * step;
          const y = enemy.y + dy * step;
          if (!inside(state, x, y)) break;
          if (isPlayerAt(state, x, y)) {
            moves.push({ x, y });
            break;
          }
          if (enemyAt(state, x, y, enemy.id)) break;
          moves.push({ x, y });
        }
      }
      break;
    }
    case 'bishop': {
      const dirs = [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ];
      for (const [dx, dy] of dirs) {
        for (let step = 1; step < Math.max(state.width, state.height); step++) {
          const x = enemy.x + dx * step;
          const y = enemy.y + dy * step;
          if (!inside(state, x, y)) break;
          if (isPlayerAt(state, x, y)) {
            moves.push({ x, y });
            break;
          }
          if (enemyAt(state, x, y, enemy.id)) break;
          moves.push({ x, y });
        }
      }
      break;
    }
    case 'queen': {
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ];
      for (const [dx, dy] of dirs) {
        for (let step = 1; step < Math.max(state.width, state.height); step++) {
          const x = enemy.x + dx * step;
          const y = enemy.y + dy * step;
          if (!inside(state, x, y)) break;
          if (isPlayerAt(state, x, y)) {
            moves.push({ x, y });
            break;
          }
          if (enemyAt(state, x, y, enemy.id)) break;
          moves.push({ x, y });
        }
      }
      break;
    }
    case 'knight': {
      const offsets = [
        [1, 2],
        [2, 1],
        [-1, 2],
        [-2, 1],
        [1, -2],
        [2, -1],
        [-1, -2],
        [-2, -1],
      ];
      for (const [dx, dy] of offsets) tryAdd(enemy.x + dx, enemy.y + dy);
      break;
    }
  }

  return moves;
}

/** Атакует ли фигура клетку (с учётом блокировок другими фигурами). */
export function enemyAttacksCell(state: GameState, enemy: Enemy, x: number, y: number): boolean {
  return enemyMoves(state, enemy).some((m) => m.x === x && m.y === y);
}

export function anyEnemyAttacksPlayer(state: GameState): boolean {
  return state.enemies.some((e) => enemyAttacksCell(state, e, state.player.x, state.player.y));
}

interface ScoredCell extends Cell {
  distance: number;
  chebyshev: number;
  alignment: number;
}

/**
 * Ход фигуры по конвейеру режима «Гонки»: ряд вниз; если клетка занята, обход по
 * диагонали, за нижним краем фигура уходит с поля (отдаём null со снятием).
 */
export function downStep(state: GameState, enemy: Enemy): Cell | 'escape' | null {
  const y = enemy.y - 1;
  if (y < 0) return 'escape';
  const blocked = (x: number) => enemyAt(state, x, y, enemy.id) !== undefined;
  if (!blocked(enemy.x)) return { x: enemy.x, y };
  const sides = [-1, 1].map((dx) => ({ x: enemy.x + dx, y })).filter((c) => inside(state, c.x, c.y) && !blocked(c.x));
  return sides.length ? sides[0] : null;
}

/** Цель хода фигуры с учётом способа движения режима. */
export function enemyTarget(state: GameState, enemy: Enemy): Cell | 'escape' | null {
  const motion = rulesFor(state.mode).motion;
  if (motion === 'static') return null;
  if (motion === 'down') return downStep(state, enemy);
  return chooseEnemyMove(state, enemy);
}

/**
 * Жадный ИИ: минимизируем манхэттенское расстояние до пешки.
 * Тай-брейки детерминированы, чтобы клиент и сервер считали одинаково.
 */
export function chooseEnemyMove(state: GameState, enemy: Enemy): Cell | null {
  let moves = enemyMoves(state, enemy);
  if (state.shield > 0) {
    moves = moves.filter((m) => !isPlayerAt(state, m.x, m.y));
  }
  if (moves.length === 0) return null;

  const p = state.player;
  const scored: ScoredCell[] = moves.map((m) => {
    const dx = Math.abs(m.x - p.x);
    const dy = Math.abs(m.y - p.y);
    return {
      ...m,
      distance: dx + dy,
      chebyshev: Math.max(dx, dy),
      alignment: (m.x === p.x ? 1 : 0) + (m.y === p.y ? 1 : 0),
    };
  });

  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.chebyshev !== b.chebyshev) return a.chebyshev - b.chebyshev;
    if (a.alignment !== b.alignment) return b.alignment - a.alignment;
    // Из двух равных вариантов предпочитаем тот, что выше к финишу,
    // затем левее, так поведение остаётся воспроизводимым.
    if (a.y !== b.y) return b.y - a.y;
    return a.x - b.x;
  });

  const best = scored[0];
  return { x: best.x, y: best.y };
}

/** Безопасное клонирование состояния. */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    player: { ...state.player },
    enemies: state.enemies.map((e) => ({ ...e })),
  };
}
