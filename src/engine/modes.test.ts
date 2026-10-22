import { describe, expect, it } from 'vitest';
import {
  MODE_RULES,
  anyEnemyAttacksPlayer,
  applyAction,
  auditState,
  boardForMode,
  capturesLeft,
  createJamLevel,
  createRaceLevel,
  createSpecialLevel,
  difficultyBand,
  enumeratePlacements,
  heightForLevel,
  legalMoves,
  modeDef,
  piecesFor,
  placementSpace,
  sizeForLevel,
  type GameState,
  type PieceType,
} from './index';

function base(partial: Partial<GameState>): GameState {
  return {
    version: 1,
    mode: 'campaign',
    width: 4,
    height: 6,
    player: { x: 1, y: 0 },
    enemies: [],
    status: 'playing',
    moves: 0,
    score: 0,
    level: 1,
    tier: 1,
    freeze: 0,
    shield: 0,
    rng: 7,
    seed: 7,
    ...partial,
  };
}

describe('правила режимов', () => {
  it('у кампании включены взятие, двойной ход и два пропуска', () => {
    expect(MODE_RULES.campaign.captures).toBe(true);
    expect(MODE_RULES.campaign.doubleStep).toBe(true);
    expect(MODE_RULES.campaign.skipQuota).toBe(2);
    expect(MODE_RULES.jam.motion).toBe('static');
    expect(MODE_RULES.race.motion).toBe('down');
  });

  it('геометрия кампании идёт из режима', () => {
    for (const level of [1, 6, 16, 31, 60]) {
      expect(boardForMode('campaign', level)).toEqual({
        width: sizeForLevel(level),
        height: heightForLevel(level),
      });
      expect(piecesFor('campaign', level)).toBeGreaterThan(0);
    }
  });

  it('в «Парковке» фигуры стоят', () => {
    const state = base({ mode: 'jam', enemies: [{ id: 'e0', type: 'rook', x: 1, y: 2 }] });
    const next = applyAction(state, { type: 'move', dx: 0 });
    expect(next.enemies[0]).toMatchObject({ x: 1, y: 2 });
  });

  it('в «Гонках» фигура едет рядом вниз и уходит за край', () => {
    const moving = base({ mode: 'race', enemies: [{ id: 'e0', type: 'rook', x: 3, y: 3 }] });
    const after = applyAction(moving, { type: 'move', dx: 0 });
    expect(after.enemies.some((e) => e.id === 'e0' && e.y === 2)).toBe(true);

    const escaping = base({ mode: 'race', player: { x: 1, y: 0 }, enemies: [{ id: 'e0', type: 'rook', x: 3, y: 0 }] });
    const cleared = applyAction(escaping, { type: 'move', dx: 0 });
    expect(cleared.enemies.some((e) => e.id === 'e0')).toBe(false);
    expect(cleared.lastEvent).toBe('escaped');
  });

  it('двойной ход перекрывается фигурой в промежуточной клетке', () => {
    const open = base({ enemies: [{ id: 'e0', type: 'knight', x: 3, y: 4 }] });
    expect(legalMoves(open).some((m) => m.dy === 2)).toBe(true);
    const blocked = base({ enemies: [{ id: 'e0', type: 'pawn', x: 1, y: 1 }] });
    expect(legalMoves(blocked).some((m) => m.dy === 2)).toBe(false);
  });
});

describe('генераторы лабораторных режимов', () => {
  it('«Парковка» плотная и решает дорогу взятиями', () => {
    for (const level of [2, 6, 12]) {
      const state = createJamLevel(level, 4242 + level);
      const capacity = (state.height - 2) * state.width;
      expect(state.enemies.length).toBeGreaterThan(0);
      expect(state.enemies.length).toBeLessThanOrEqual(capacity);
      expect(legalMoves(state).length).toBeGreaterThan(0);
      const audit = auditState(state, { maxNodes: 80_000 });
      // Стена плотная, решаемость не гарантируем: важно, что разбор обрывается
      // честно и не уходит в бесконечность.
      expect(Number.isFinite(audit.score)).toBe(true);
    }
  });

  it('«Гонки» стартуют без боя на старте и выше середины', () => {
    for (const level of [3, 9, 20]) {
      const state = createRaceLevel(level, 909 + level);
      expect(state.enemies.length).toBeGreaterThan(0);
      for (const enemy of state.enemies) expect(enemy.y).toBeGreaterThanOrEqual(2);
    }
  });

  it('createSpecialLevel отдаёт решаемое поле или последний просмотренный', () => {
    for (const mode of ['jam', 'race'] as const) {
      const state = createSpecialLevel(mode, 5, 1234);
      expect(anyEnemyAttacksPlayer(state)).toBe(false);
      expect(legalMoves(state).length).toBeGreaterThan(0);
    }
  });
});

describe('квота взятий', () => {
  // Лестница из пешек по диагонали: каждая следующая берётся с шага 1 на 1.
  // В «Парковке» фигуры стоят, поэтому ход игрока зависит только от квоты.
  function wall(mode: GameState['mode']): GameState {
    return base({
      mode,
      width: 3,
      height: 7,
      player: { x: 1, y: 0 },
      captures: 0,
      enemies: [
        { id: 'e1', type: 'pawn', x: 0, y: 1 },
        { id: 'e2', type: 'pawn', x: 1, y: 2 },
        { id: 'e3', type: 'pawn', x: 0, y: 3 },
        { id: 'e4', type: 'pawn', x: 1, y: 4 },
      ],
    });
  }

  it('в «Парковке» можно взять не больше трёх фигур', () => {
    let state = wall('jam');
    expect(legalMoves(state).filter((move) => move.takes).length).toBe(1);
    for (let i = 0; i < 3; i++) {
      const take = legalMoves(state).find((move) => move.takes)!;
      state = applyAction(state, { type: 'move', dx: take.dx, dy: 1 });
      expect(state.captures).toBe(i + 1);
      expect(state.status).toBe('playing');
    }
    expect(capturesLeft(state)).toBe(0);
    expect(legalMoves(state).some((move) => Boolean(move.takes))).toBe(false);
    // Обычный ход квота не запрещает.
    state = applyAction(state, { type: 'move', dx: 0, dy: 1 });
    expect(state.player.y).toBe(4);
  });

  it('в кампании и «Гонках» взятия не лимитированы', () => {
    for (const mode of ['campaign', 'race'] as const) {
      const state = wall(mode);
      expect(capturesLeft(base({ mode, captures: 40 }))).toBe(Number.POSITIVE_INFINITY);
      expect(legalMoves(state).some((move) => Boolean(move.takes))).toBe(true);
    }
  });
});

describe('полоса сложности по режимам', () => {
  it('для лабораторных режимов считается своя цель', () => {
    // Плотность у «Парковки» и «Гонок» выше уже на малых уровнях, поэтому
    // их нельзя мерить линейкой кампании.
    for (const level of [1, 5, 20, 40]) {
      expect(difficultyBand(level, 'jam').target).toBeGreaterThan(difficultyBand(level).target);
      expect(difficultyBand(level, 'race').target).toBeGreaterThan(difficultyBand(level).target);
      expect(difficultyBand(level, 'jam').min).toBeLessThan(difficultyBand(level, 'jam').max);
    }
    for (const mode of ['campaign', 'jam', 'race'] as const) {
      let previous = 0;
      for (const level of [1, 5, 10, 20, 30, 40]) {
        const target = difficultyBand(level, mode).target;
        expect(target).toBeGreaterThanOrEqual(previous);
        previous = target;
      }
    }
  });

  it('генератор выбирает уровень из своей полосы', () => {
    for (const mode of ['jam', 'race'] as const) {
      const band = difficultyBand(10, mode);
      const state = createSpecialLevel(mode, 10, 4242);
      const report = auditState(state, { maxDepth: state.height + 4, maxNodes: 60_000 });
      expect(report.solvable).toBe(true);
      expect(report.score).toBeGreaterThanOrEqual(band.min);
      expect(report.score).toBeLessThanOrEqual(band.max);
    }
  });
});

describe('пространство расстановок по режимам', () => {
  it('пересчитывается под геометрию режима', () => {
    const types: PieceType[] = ['pawn', 'rook', 'bishop', 'knight', 'queen'];
    for (const mode of ['campaign', 'jam', 'race'] as const) {
      const { width, height } = boardForMode(mode, 10);
      const count = piecesFor(mode, 10);
      const spec = { width, height, count, types, mode };
      const space = placementSpace(spec);
      expect(space.total).toBeGreaterThan(0);
      const { plans, exhaustive } = enumeratePlacements(spec, { limit: 50, seed: 5 });
      expect(plans.length).toBeGreaterThan(0);
      expect(plans[0].state.mode).toBe(mode);
      if (!exhaustive) expect(plans.length).toBeLessThanOrEqual(50);
    }
  });

  it('описания режимов готовы к показу в админке', () => {
    expect(modeDef('jam').playable).toBe(false);
    expect(modeDef('campaign').playable).toBe(true);
    expect(modeDef('race').note.length).toBeGreaterThan(10);
  });
});
