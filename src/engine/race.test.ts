import { describe, expect, it } from 'vitest';
import {
  RACE_KING_ROW,
  RACE_MOVES_PER_LEVEL,
  RACE_ROWS,
  RACE_SPAWN_ROWS,
  RACE_WIDTH,
  applyAction,
  createRaceLevel,
  legalMoves,
  raceCoinReward,
  raceLevelForMoves,
  raceSpawnEvery,
  rulesFor,
  type GameState,
  type MoveDx,
  type MoveDy,
} from '../engine';

function move(state: GameState, dx: MoveDx, dy: MoveDy = 0): GameState {
  return applyAction(state, { type: 'move', dx, dy });
}

/**
 * Жадный бот: выжить, снять фигуру, не вставать под линию и не прижиматься к
 * краю. Нужен не «идеальной игрой», а тем же критерием, которым мерили напряжение
 * притока: если даже такой бот живёт десятки ходов, приток никого не убивает на
 * ровном месте.
 */
function nearest(state: GameState): number {
  let best = 99;
  for (const enemy of state.enemies) {
    const distance = Math.max(Math.abs(enemy.x - state.player.x), Math.abs(enemy.y - state.player.y));
    if (distance < best) best = distance;
  }
  return best;
}

function bestReply(state: GameState): GameState | null {
  let best: GameState | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const option of legalMoves(state)) {
    const next = move(state, option.dx, option.dy ?? 1);
    if (next.status !== 'playing') continue;
    const rank =
      next.enemies.length * 6 -
      legalMoves(next).length * 1.5 -
      nearest(next) * 2 +
      (next.player.y <= 1 ? 0.5 : 0) +
      (next.player.y >= next.height - 3 ? 1.5 : 0);
    if (rank < bestRank) {
      bestRank = rank;
      best = next;
    }
  }
  return best;
}

describe('Гонки: король против фигур сверху', () => {
  it('режим собран на короле и постоянном поле', () => {
    const rules = rulesFor('race');
    expect(rules).toMatchObject({
      motion: 'greedy',
      goal: 'survive',
      player: 'king',
      wrapOnTop: false,
      spawnRows: RACE_SPAWN_ROWS,
    });
    const state = createRaceLevel(1, 12345);
    expect(state.width).toBe(RACE_WIDTH);
    expect(state.height).toBe(RACE_ROWS);
    expect(state.player.y).toBe(RACE_KING_ROW);
    expect(state.status).toBe('playing');
    // Стартовая пробка не должна снимать короля до первого хода.
    expect(state.enemies.length).toBeGreaterThan(0);
    for (const enemy of state.enemies) {
      expect(enemy.y).toBeGreaterThanOrEqual(RACE_ROWS - RACE_SPAWN_ROWS);
    }
  });

  it('король ходит на клетку в любую сторону, назад включительно', () => {
    const open: GameState = { ...createRaceLevel(1, 999), enemies: [] };
    const options = legalMoves(open);
    // В центре поля у короля восемь ходов, у края меньше.
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.some((option) => option.dy === 1)).toBe(true);
    expect(options.some((option) => option.dy === -1)).toBe(open.player.y > 0);
    expect(options.every((option) => Math.abs(option.dx) <= 1 && Math.abs(option.dy ?? 1) <= 1)).toBe(true);
  });

  it('взятие короля работает и вперёд, и назад, фигура уходит с поля', () => {
    const base: GameState = { ...createRaceLevel(1, 4242), player: { x: 3, y: 2 }, enemies: [] };
    const forward = move({ ...base, enemies: [{ id: 'r', type: 'rook', x: 4, y: 3 }] }, 1, 1);
    expect(forward.enemies.length).toBe(0);
    expect(forward.player).toEqual({ x: 4, y: 3 });
    expect(forward.captures).toBe(1);

    const backward = move({ ...base, enemies: [{ id: 'b', type: 'bishop', x: 2, y: 1 }] }, -1, -1);
    expect(backward.enemies.length).toBe(0);
    expect(backward.player).toEqual({ x: 2, y: 1 });
  });

  it('фигура, вставшая на клетку короля, заканчивает забег', () => {
    // Ладья на той же линии, что и король, и путь свободен: король остаётся на
    // линии - его снимают за ход, ничего другого движку не остаётся.
    const lined: GameState = {
      ...createRaceLevel(1, 777),
      player: { x: 3, y: 4 },
      enemies: [{ id: 'r', type: 'rook', x: 0, y: 4 }],
    };
    const stuck = move(lined, 1, 0);
    expect(stuck.status).toBe('lost');
    expect(stuck.capturedBy).toBe('rook');
    // Тот же шаг с линии спасает: ладье нужен ход, чтобы перестроиться.
    expect(move(lined, 1, 1).status).toBe('playing');
  });

  it('приток приходит в верхние ряды, по такту и не подставляет фигуру королю под ногу', () => {
    const state: GameState = { ...createRaceLevel(1, 2024), player: { x: 0, y: 0 }, enemies: [] };
    const every = raceSpawnEvery(state.tier);
    let current = state;
    for (let turn = 0; turn < every; turn++) {
      current = move(current, 0, 1);
    }
    expect(current.enemies.length).toBeGreaterThan(0);
    for (const enemy of current.enemies) {
      expect(enemy.y).toBeGreaterThanOrEqual(RACE_ROWS - RACE_SPAWN_ROWS);
    }
  });

  it('выживающий бот не умирает в первые ходы и доживает до среднего забега', () => {
    const lives: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      let state = createRaceLevel(1, 1000 + seed * 7919);
      let guard = 0;
      while (state.status === 'playing' && guard++ < 300) {
        const next = bestReply(state);
        if (!next) break;
        state = next;
      }
      // Первые два хода смерть означает, что приток встал королю под ногу.
      expect(state.moves).toBeGreaterThanOrEqual(3);
      lives.push(state.score);
    }
    const median = [...lives].sort((a, b) => a - b)[20];
    expect(median).toBeGreaterThanOrEqual(15);
  });

  it('один и тот же журнал воспроизводится байт в байт', () => {
    const first = createRaceLevel(2, 4242);
    let a = first;
    let b = first;
    const journal: Array<[MoveDx, MoveDy]> = [
      [0, 1],
      [1, 0],
      [-1, -1],
      [0, 1],
      [1, 1],
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, 1],
      [-1, 1],
    ];
    for (const [dx, dy] of journal) {
      if (a.status !== 'playing' || b.status !== 'playing') break;
      a = move(a, dx, dy);
      b = move(b, dx, dy);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.tier).toBe(raceLevelForMoves(a.score));
  });

  it('уровень режима растёт от пережитых ходов, награда ограничена сверху', () => {
    expect(raceLevelForMoves(0)).toBe(1);
    expect(raceLevelForMoves(RACE_MOVES_PER_LEVEL - 1)).toBe(1);
    expect(raceLevelForMoves(RACE_MOVES_PER_LEVEL)).toBe(2);
    expect(raceLevelForMoves(RACE_MOVES_PER_LEVEL * 4)).toBe(5);
    expect(raceCoinReward(0)).toBeLessThanOrEqual(50);
    expect(raceCoinReward(8)).toBeLessThan(raceCoinReward(32));
    expect(raceCoinReward(1000)).toBe(50);
  });

  it('счёт это пережитые ходы, а не высота короля', () => {
    let state = createRaceLevel(1, 555);
    for (let turn = 0; turn < 5 && state.status === 'playing'; turn++) {
      state = bestReply(state) ?? state;
    }
    expect(state.score).toBe(state.moves);
  });
});
