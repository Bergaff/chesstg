import { describe, expect, it } from 'vitest';
import {
  RACE_PIN_ROW,
  RACE_ROWS,
  RACE_WIDTH,
  applyAction,
  createRaceLevel,
  legalMoves,
  raceCoinReward,
  raceLevelForRows,
  rulesFor,
  type GameState,
} from '../engine';

function move(state: GameState, dx: -1 | 0 | 1): GameState {
  return applyAction(state, { type: 'move', dx, dy: 0 });
}

describe('Гонки: конвейер', () => {
  it('режим собран на приколотом ряду и постоянном поле', () => {
    const rules = rulesFor('race');
    expect(rules).toMatchObject({ motion: 'conveyor', goal: 'scroll', pinned: true, ram: true });
    const state = createRaceLevel(1, 12345);
    expect(state.width).toBe(RACE_WIDTH);
    expect(state.height).toBe(RACE_ROWS);
    expect(state.player.y).toBe(RACE_PIN_ROW);
    expect(state.status).toBe('playing');
    // Стартовая пробка не должна съедать пешку до первого хода.
    expect(state.enemies.length).toBeGreaterThan(0);
    for (const enemy of state.enemies) {
      expect(enemy.x === state.player.x && enemy.y <= state.player.y + 1).toBe(false);
    }
  });

  it('пешка ходит только в своём ряду, вперёд нельзя', () => {
    const state = createRaceLevel(1, 999);
    const options = legalMoves(state);
    expect(options.every((option) => option.dy === 0)).toBe(true);
    expect(() => applyAction(state, { type: 'move', dx: 0, dy: 1 })).toThrow(/Некорректная длина хода/);
  });

  it('фигуры падают рядом, а ушедшие за нижний край исчезают', () => {
    const state = createRaceLevel(1, 4242);
    const lone: GameState = { ...state, enemies: [{ id: 'x1', type: 'pawn', x: state.player.x + 2, y: state.player.y + 3 }] };
    const after = move(lone, 0);
    expect(after.enemies[0]?.y).toBe(lone.enemies[0].y - 1);

    const edge: GameState = { ...state, enemies: [{ id: 'x1', type: 'pawn', x: state.player.x + 2, y: 0 }] };
    expect(move(edge, 0).enemies.length).toBe(0);
  });

  it('ладья бьёт вдоль ряда пешки, слон и конь нет', () => {
    const base = createRaceLevel(1, 777);
    const row = base.player.y;
    const rookInRow: GameState = {
      ...base,
      enemies: [{ id: 'r', type: 'rook', x: Math.max(0, base.player.x - 2), y: row }],
    };
    const caught = move(rookInRow, 0);
    expect(caught.status).toBe('lost');
    expect(caught.capturedBy).toBe('rook');

    const pawnInRow: GameState = {
      ...base,
      enemies: [{ id: 'p', type: 'pawn', x: Math.max(0, base.player.x - 2), y: row }],
    };
    expect(move(pawnInRow, 0).status).toBe('playing');
  });

  it('щит переживает ряд ладьи, рубка снимает фигуру своего ряда', () => {
    const base = { ...createRaceLevel(1, 31337), player: { x: 3, y: RACE_PIN_ROW } };
    const rookInRow: GameState = {
      ...base,
      enemies: [{ id: 'r', type: 'rook', x: 1, y: base.player.y }],
    };
    const shielded = move({ ...rookInRow, shield: 1 }, 0);
    expect(shielded.status).toBe('playing');

    // Встать на фигуру своего ряда можно: это единственный способ расчистить колонку.
    const adjacent: GameState = { ...base, enemies: [{ id: 'r', type: 'rook', x: 4, y: base.player.y }] };
    const ram = applyAction(adjacent, { type: 'move', dx: 1, dy: 0 });
    expect(ram.enemies.length).toBe(0);
    expect(ram.player.x).toBe(4);
    expect(ram.captures).toBe(1);
  });

  it('выживающий бот не умирает в первые ряды и доживает до среднего забега', () => {
    // Смысл проверки притока: конвейер не имеет права складываться раньше, чем
    // игрок успел сделать три хода. Дальше смерть честная - приток только
    // сужает поле, но не решает за игрока.
    const lives: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      let state = createRaceLevel(1, 1000 + seed * 7919);
      let turns = 0;
      while (state.status === 'playing' && turns < 200) {
        const option = legalMoves(state).find((entry) => move(state, entry.dx).status !== 'lost');
        if (!option) break;
        state = move(state, option.dx);
        turns += 1;
      }
      expect(state.moves).toBeGreaterThan(3);
      lives.push(state.score);
    }
    const median = [...lives].sort((a, b) => a - b)[20];
    expect(median).toBeGreaterThanOrEqual(12);
  });

  it('один и тот же журнал воспроизводится байт в байт', () => {
    const first = createRaceLevel(2, 4242);
    let a = first;
    let b = first;
    const journal = [-1, 1, 1, 0, -1, 0, 1, -1, -1, 0, 1, 0];
    for (const dx of journal) {
      if (a.status !== 'playing' || b.status !== 'playing') break;
      a = move(a, dx as -1 | 0 | 1);
      b = move(b, dx as -1 | 0 | 1);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.tier).toBe(raceLevelForRows(a.score));
  });

  it('уровень режима растёт от рядов, награда ограничена сверху', () => {
    expect(raceLevelForRows(0)).toBe(1);
    expect(raceLevelForRows(9)).toBe(1);
    expect(raceLevelForRows(10)).toBe(2);
    expect(raceLevelForRows(45)).toBe(5);
    expect(raceCoinReward(0)).toBeLessThanOrEqual(50);
    expect(raceCoinReward(10)).toBeLessThan(raceCoinReward(40));
    expect(raceCoinReward(1000)).toBe(50);
  });

  it('счёт это прокрученные ряды, а не высота пешки', () => {
    let state = createRaceLevel(1, 555);
    for (let turn = 0; turn < 5 && state.status === 'playing'; turn++) state = move(state, 0);
    expect(state.score).toBe(state.moves);
    expect(state.player.y).toBe(RACE_PIN_ROW);
  });
});
