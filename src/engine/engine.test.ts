import { describe, expect, it } from 'vitest';
import {
  analyzeState,
  anyEnemyAttacksPlayer,
  applyAction,
  campaignCoinReward,
  chooseEnemyMove,
  createCampaignLevel,
  createEndlessRun,
  enemyMoves,
  legalMoves,
  materializeLives,
  msUntilNextLife,
  projectHint,
  sizeForLevel,
  LIFE_REGEN_MS,
  MAX_LIVES,
  type Enemy,
  type GameState,
  type PieceType,
} from './index';

function state(partial: Partial<GameState> = {}): GameState {
  return {
    version: 1,
    mode: 'campaign',
    width: 3,
    height: 3,
    player: { x: 1, y: 0 },
    enemies: [],
    status: 'playing',
    moves: 0,
    score: 0,
    level: 1,
    tier: 1,
    freeze: 0,
    shield: 0,
    rng: 42,
    seed: 42,
    ...partial,
  };
}

function enemy(type: PieceType, x: number, y: number, id = 'e0'): Enemy {
  return { id, type, x, y };
}

describe('правила хода', () => {
  it('пешка не ходит назад и вбок', () => {
    const s = state({ player: { x: 1, y: 1 } });
    const targets = legalMoves(s).map((m) => `${m.x},${m.y}`);
    expect(targets).toEqual(expect.arrayContaining(['0,2', '1,2', '2,2']));
    expect(targets).not.toContain('0,1');
    expect(targets).not.toContain('1,0');
  });

  it('нельзя встать на фигуру', () => {
    const s = state({ player: { x: 1, y: 0 }, enemies: [enemy('rook', 1, 1)] });
    expect(legalMoves(s).map((m) => m.dx)).toEqual([-1, 1]);
    expect(() => applyAction(s, { type: 'move', dx: 0 })).toThrow();
  });

  it('победа на верхнем ряду до хода врагов', () => {
    const s = state({ player: { x: 1, y: 1 }, enemies: [enemy('rook', 0, 2)] });
    const next = applyAction(s, { type: 'move', dx: 0 });
    expect(next.status).toBe('won');
    expect(next.player.y).toBe(2);
  });

  it('блокировка: пропуск возможен только без ходов', () => {
    const s = state({
      player: { x: 1, y: 0 },
      enemies: [enemy('knight', 0, 1, 'a'), enemy('knight', 1, 1, 'b'), enemy('knight', 2, 1, 'c')],
    });
    expect(legalMoves(s)).toHaveLength(0);
    const next = applyAction(s, { type: 'skip' });
    expect(next.moves).toBe(1);
  });

  it('нельзя пропустить ход, если есть куда идти', () => {
    expect(() => applyAction(state(), { type: 'skip' })).toThrow();
  });
});

describe('вражеские фигуры', () => {
  it('вражеская пешка бьёт по диагонали вниз', () => {
    const s = state({
      width: 4,
      height: 4,
      player: { x: 0, y: 0 },
      enemies: [enemy('pawn', 1, 2)],
    });
    const afterMove = applyAction(s, { type: 'move', dx: 0 });
    expect(afterMove.player).toEqual({ x: 0, y: 1 });
    expect(afterMove.status).toBe('lost');
    expect(afterMove.capturedBy).toBe('pawn');
  });

  it('вражеская пешка не бьёт вперёд', () => {
    const s = state({ player: { x: 1, y: 0 }, enemies: [enemy('pawn', 1, 1)] });
    const moves = enemyMoves(s, s.enemies[0]);
    expect(moves).not.toEqual(expect.arrayContaining([{ x: 1, y: 0 }]));
  });

  it('ладья не проходит сквозь фигуры и бьёт по линии', () => {
    const s = state({
      width: 4,
      height: 4,
      player: { x: 0, y: 0 },
      enemies: [enemy('rook', 3, 0, 'r'), enemy('pawn', 1, 0, 'p')],
    });
    const rookMoves = enemyMoves(s, s.enemies[0]);
    expect(rookMoves).not.toContainEqual({ x: 0, y: 0 });
    expect(rookMoves).toContainEqual({ x: 2, y: 0 });
  });

  it('щит не даёт врагу встать на клетку игрока', () => {
    const s = state({
      width: 4,
      height: 4,
      player: { x: 0, y: 1 },
      enemies: [enemy('rook', 2, 1)],
      shield: 3,
    });
    const choice = chooseEnemyMove(s, s.enemies[0])!;
    expect(choice).not.toEqual({ x: 0, y: 1 });
    const next = applyAction(s, { type: 'move', dx: 0 });
    expect(next.status).toBe('playing');
    expect(next.shield).toBe(2);
  });

  it('заморозка останавливает врагов', () => {
    const s = state({
      width: 4,
      height: 4,
      player: { x: 0, y: 0 },
      enemies: [enemy('rook', 3, 0)],
      freeze: 2,
    });
    const next = applyAction(s, { type: 'move', dx: 1 });
    expect(next.enemies[0]).toEqual({ id: 'e0', type: 'rook', x: 3, y: 0 });
    expect(next.freeze).toBe(1);
    expect(next.status).toBe('playing');
  });
});

describe('генерация кампании', () => {
  const levels = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16, 20, 23, 26, 30, 31, 35];

  it('каждый уровень решаем и не бьёт старт', () => {
    for (const level of levels) {
      for (const seed of [100 + level, 7000 + level]) {
        const board = createCampaignLevel(level, seed);
        expect(board.width).toBe(sizeForLevel(level));
        expect(board.player.y).toBe(0);
        expect(legalMoves(board).length).toBeGreaterThan(0);
        expect(anyEnemyAttacksPlayer(board)).toBe(false);
        for (const e of board.enemies) {
          expect(e.y).toBeGreaterThanOrEqual(1);
          expect(e.y).toBeLessThanOrEqual(board.height - 2);
        }
        const analysis = analyzeState(board, { maxDepth: board.height + 2, maxNodes: 8000 });
        expect(analysis.solvable, `level ${level} seed ${seed}`).toBe(true);
      }
    }
  });

  it('одинаковый seed даёт одинаковое поле', () => {
    const a = createCampaignLevel(12, 123456);
    const b = createCampaignLevel(12, 123456);
    expect(a).toEqual(b);
  });

  it('подсказка возвращает не больше двух клеток и ведёт к победе', () => {
    const board = createCampaignLevel(7, 4321);
    const analysis = analyzeState(board, { maxDepth: 8, maxNodes: 8000 });
    const cells = projectHint(board, analysis.path, 2);
    expect(cells.length).toBe(2);
    expect(cells[0].y).toBe(1);
    expect(cells[1].y).toBeGreaterThanOrEqual(2);
  });
});

describe('бесконечный режим', () => {
  it('стартовое поле безопасно', () => {
    for (let seed = 1; seed < 20; seed++) {
      const run = createEndlessRun(seed);
      expect(run.width).toBe(6);
      expect(run.height).toBe(9);
      expect(run.player.y).toBe(0);
      expect(legalMoves(run).length).toBeGreaterThan(0);
      expect(anyEnemyAttacksPlayer(run)).toBe(false);
    }
  });

  it('поле достраивается вверх и заполняется врагами', () => {
    let run = state({
      mode: 'endless',
      width: 6,
      height: 9,
      player: { x: 2, y: 5 },
      enemies: [],
      moves: 5,
      score: 5,
      tier: 2,
      freeze: 2,
    });
    run = applyAction(run, { type: 'move', dx: 0 });
    expect(run.player.y).toBe(6);
    expect(run.height).toBe(14);
    expect(run.enemies.length).toBeGreaterThan(0);
    for (const e of run.enemies) expect(e.y).toBeGreaterThanOrEqual(9);
    expect(run.score).toBe(6);
  });
});

describe('баланс и жизни', () => {
  it('жизни копятся каждые 30 минут', () => {
    const start = 1_000_000;
    expect(materializeLives(0, start, start + LIFE_REGEN_MS - 1).lives).toBe(0);
    expect(materializeLives(0, start, start + LIFE_REGEN_MS).lives).toBe(1);
    expect(materializeLives(0, start, start + LIFE_REGEN_MS * 3.5).lives).toBe(3);
    const almost = materializeLives(3, start, start + LIFE_REGEN_MS / 2);
    expect(msUntilNextLife(almost.lives, almost.livesAt, start + LIFE_REGEN_MS / 2)).toBe(LIFE_REGEN_MS / 2);
    const full = materializeLives(MAX_LIVES, start, start + 10 * LIFE_REGEN_MS);
    expect(full.lives).toBe(MAX_LIVES);
  });

  it('награда за уровень в пределах 10–50', () => {
    for (let level = 1; level <= 60; level++) {
      const reward = campaignCoinReward(level);
      expect(reward).toBeGreaterThanOrEqual(10);
      expect(reward).toBeLessThanOrEqual(50);
    }
  });
});
