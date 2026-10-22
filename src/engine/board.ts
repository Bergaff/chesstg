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
/**
 * Ходы в приколотом ряду («Гонки»): влево, вправо, на месте, плюс рубка фигуры,
 * если она стоит в том же ряду рядом. Вперёд нельзя: ряд закреплён за пешкой.
 */
function pinnedMoves(state: GameState, rules: { ram?: boolean }): MoveOption[] {
  const result: MoveOption[] = [];
  for (const dx of [-1, 0, 1] as MoveDx[]) {
    const x = state.player.x + dx;
    const y = state.player.y;
    if (!inside(state, x, y)) continue;
    const occupant = enemyAt(state, x, y);
    if (!occupant) {
      result.push({ x, y, dx, dy: 0 });
      continue;
    }
    if (rules.ram) result.push({ x, y, dx, dy: 0, takes: occupant.type });
  }
  return result;
}

export function legalMoves(state: GameState): MoveOption[] {
  if (state.status !== 'playing') return [];
  const rules = rulesFor(state.mode);
  if (rules.pinned) return pinnedMoves(state, rules);
  const result: MoveOption[] = [];
  const directions: MoveDx[] = [-1, 0, 1];
  for (const dx of directions) {
    const x = state.player.x + dx;
    const y = state.player.y + 1;
    if (!inside(state, x, y)) continue;
    const occupant = enemyAt(state, x, y);
    if (!occupant) {
      // Свободная диагональ разрешена не во всех режимах: в строгом варианте
      // диагональный шаг возможен только как взятие.
      if (dx === 0 || rules.freeDiagonal) result.push({ x, y, dx, dy: 1 });
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

export function isMoveLegal(state: GameState, dx: MoveDx, dy: 0 | 1 | 2 = 1): boolean {
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
  const rules = rulesFor(state.mode);
  // Вынужденный пропуск бесплатен, но только там, где ход фигур что-то меняет;
  // в статичном режиме он тратит квоту, и при нулевой квоте правило отказывает.
  if (legalMoves(state).length === 0 && rules.motion !== 'static') return true;
  return skipsLeft(state) > 0;
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

/**
 * «Уход с площадки»: фигура делает шаг в сторону края и покидает доску.
 * При `exitDirections: 2` края боковые, при 4 фигура выбирает ближайший из
 * четырёх. Это не разбег в случайные стороны, а детерминированный отход,
 * поэтому разбор и повтор партии остаются точными.
 */
export function exitStep(state: GameState, enemy: Enemy): Cell | 'escape' | null {
  const { exitDirections } = rulesFor(state.mode);
  const dirs: Array<{ dx: number; dy: number; until: number }> = [
    { dx: -1, dy: 0, until: enemy.x + 1 },
    { dx: 1, dy: 0, until: state.width - enemy.x },
  ];
  if (exitDirections === 4) {
    dirs.push({ dx: 0, dy: -1, until: enemy.y + 1 });
    dirs.push({ dx: 0, dy: 1, until: state.height - enemy.y });
  }

  let best: { target: Cell | 'escape'; until: number } | null = null;
  for (const dir of dirs) {
    const x = enemy.x + dir.dx;
    const y = enemy.y + dir.dy;
    const offBoard = x < 0 || x >= state.width || y < 0 || y >= state.height;
    if (!offBoard && enemyAt(state, x, y, enemy.id)) continue;
    const target: Cell | 'escape' = offBoard ? 'escape' : { x, y };
    if (!best || dir.until < best.until) best = { target, until: dir.until };
  }
  return best ? best.target : null;
}

/** Цель хода фигуры с учётом способа движения режима. */
/** Бьёт ли дальнобойная фигура пешку вдоль их общего ряда. */
function sameRowShot(state: GameState, enemy: Enemy): boolean {
  if (enemy.y !== state.player.y || enemy.x === state.player.x) return false;
  const step = enemy.x < state.player.x ? 1 : -1;
  for (let x = enemy.x + step; x !== state.player.x; x += step) {
    if (enemyAt(state, x, enemy.y, enemy.id)) return false;
  }
  return true;
}

/** Слон спускается по диагонали, отскакивая от бортов: его ряд смещается каждый ход. */
function diagonalStep(state: GameState, enemy: Enemy): Cell | 'escape' | null {
  const y = enemy.y - 1;
  if (y < 0) return 'escape';
  const drift = (enemy.x + enemy.y) % 2 === 0 ? -1 : 1;
  for (const dx of [drift, -drift, 0]) {
    const x = enemy.x + dx;
    if (!inside(state, x, y)) continue;
    if (enemyAt(state, x, y, enemy.id)) continue;
    return { x, y };
  }
  return null;
}

/**
 * Падение без обхода: занята клетка снизу - фигура ждёт. В конвейере это важно:
 * диагональный обход из `downStep` сыпал фигуры в соседние колонки, и пробка
 * доедала пешку с боков независимо от того, куда она уходит.
 */
function strictFall(state: GameState, enemy: Enemy): Cell | 'escape' | null {
  const y = enemy.y - 1;
  if (y < 0) return 'escape';
  if (enemyAt(state, enemy.x, y, enemy.id)) return null;
  return { x: enemy.x, y };
}

/** Конь перепрыгивает пробку: два ряда вниз и ряд в сторону, иначе падает как все. */
function knightDescent(state: GameState, enemy: Enemy): Cell | 'escape' | null {
  const towards = state.player.x > enemy.x ? 1 : -1;
  for (const dx of [towards, -towards, 0]) {
    const x = enemy.x + (dx === 0 ? 1 : dx);
    if (inside(state, x, enemy.y - 2) && !enemyAt(state, x, enemy.y - 2, enemy.id)) {
      return { x, y: enemy.y - 2 };
    }
  }
  return strictFall(state, enemy);
}

/**
 * Шаг фигуры по конвейеру «Гонок». Пешку снимают два случая: падение прямо на
 * неё (это видит проверка позиции) и выстрел ладьи или ферзя вдоль общего ряда.
 * Всё остальное - просто движение вниз, поэтому ряд пешки читаем.
 */
export function conveyorStep(state: GameState, enemy: Enemy): Cell | 'escape' | null {
  if (state.shield <= 0 && (enemy.type === 'rook' || enemy.type === 'queen') && sameRowShot(state, enemy)) {
    return { x: state.player.x, y: state.player.y };
  }
  if (enemy.type === 'bishop') return diagonalStep(state, enemy);
  if (enemy.type === 'knight') return knightDescent(state, enemy);
  return strictFall(state, enemy);
}

export function enemyTarget(state: GameState, enemy: Enemy): Cell | 'escape' | null {
  const rules = rulesFor(state.mode);
  const motion = rules.motion;
  if (motion === 'static') return null;
  if (motion === 'conveyor') return conveyorStep(state, enemy);
  if (motion === 'down') return downStep(state, enemy);
  if (motion === 'exit') return exitStep(state, enemy);
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
