import { describe, expect, it } from 'vitest';
import { RACE_KING_ROWS, RACE_SPAWN_ROWS } from './race';
import {
  MODE_RULES,
  analyzeVariant,
  anyEnemyAttacksPlayer,
  applyAction,
  auditState,
  boardForMode,
  capturesLeft,
  createJamLevel,
  createRaceLevel,
  enemyMoves,
  createSpecialLevel,
  difficultyBand,
  enumeratePlacements,
  heightForLevel,
  isLevelMode,
  legalMoves,
  modeDef,
  modeFamily,
  modeGate,
  modeUnlocked,
  PLAYABLE_MODES,
  piecesFor,
  placementSpace,
  sizeForLevel,
  type GameState,
  type PieceType,
} from './index';
import { RuleError } from './types';

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
    expect(MODE_RULES.race.motion).toBe('greedy');
    expect(MODE_RULES.race.player).toBe('king');
    expect(MODE_RULES.race.goal).toBe('survive');
    // Взятия королю не лимитируем: снимать фигуры это единственный способ дышать.
    expect(MODE_RULES.race.captureQuota).toBe(0);
    // Поле «Гонок» растёт вширь, и доска сверяется с этим флагом: без него рост
    // выглядел бы как смена масштаба поля.
    expect(MODE_RULES.race.grow).toBe(true);
    expect(MODE_RULES.campaign.grow ?? false).toBe(false);
    expect(MODE_RULES.jam.grow ?? false).toBe(false);
    // Вариант на уклонение сравнивает правила на статичной ширине.
    expect(MODE_RULES.raceDodge.grow).toBe(false);
    expect(MODE_RULES.raceDodge.scroll).toBe(false);
    // Полоса игрока: флаг `kingRows` = сколько нижних рядов доступно королю.
    expect(MODE_RULES.race.kingRows).toBe(RACE_KING_ROWS);
    expect(MODE_RULES.campaign.kingRows).toBe(0);
    expect(MODE_RULES.endless.kingRows).toBe(0);
    expect(MODE_RULES.jam.kingRows).toBe(0);
    // Вариант «на уклонение» - тот же король, поэтому полоса наследуется.
    expect(MODE_RULES.raceDodge.kingRows).toBe(RACE_KING_ROWS);
  });

  it('полоса режет ходы короля, но не чужие фигуры', () => {
    const rules = MODE_RULES.race;
    // Полоса не может быть шире поля и обязана оставлять ряд под фигуры.
    expect(rules.kingRows).toBeGreaterThan(0);
    expect(rules.kingRows).toBeLessThan(MODE_RULES.race.rows(1));
    // У игрока ровно те восемь соседей, что помещаются в полосу.
    const state = base({ mode: 'race', width: 5, height: 8, player: { x: 2, y: rules.kingRows - 1 } });
    const options = legalMoves(state);
    expect(options).toHaveLength(5);
    expect(options.every((move) => move.y < rules.kingRows)).toBe(true);
    // А фигуры в полосу ходят все: правило про игрока, а не про ряды доски.
    // Дальность у них своя (`slideCap`), поэтому ферзя ставим в двух шагах.
    const at = { id: 'q', type: 'queen' as const, x: 2, y: 3 };
    const enemy = enemyMoves({ ...state, enemies: [at] }, at);
    expect(enemy.some((cell) => cell.y === rules.kingRows - 1)).toBe(true);
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

  it('в «Гонках» фигура бьёт по своей линии, а с линии можно уйти', () => {
    // Полоса в два нижних ряда: линия атаки читается по колонке, потому что
    // ладья едет вниз вместе с полем и в любой момент встанет на ряд короля.
    const lined = base({ mode: 'race', width: 5, height: 8, player: { x: 1, y: 1 }, enemies: [{ id: 'e0', type: 'rook', x: 1, y: 3 }] });
    // Шаг вниз оставляет короля на колонке ладьи: сдвиг подвозит ладью и бьёт.
    expect(applyAction(lined, { type: 'move', dx: 0, dy: -1 }).status).toBe('lost');
    // Тот же шаг в сторону - ладье нужен ход на перестроение.
    expect(applyAction(lined, { type: 'move', dx: 1, dy: 0 }).status).toBe('playing');

    // Дальность скользящего хода в «Гонках» ограничена двумя клетками (`slideCap`),
    // поэтому ладья с трёх клеток не долетает: у игрока есть ход, чтобы уйти с
    // линии, и он видит прилёт заранее, а не получает смерть за ход.
    const outOfReach = base({ mode: 'race', width: 5, height: 8, player: { x: 1, y: 1 }, enemies: [{ id: 'e0', type: 'rook', x: 4, y: 1 }] });
    expect(enemyMoves(outOfReach, outOfReach.enemies[0]).some((cell) => cell.x === 1 && cell.y === 1)).toBe(false);
    expect(applyAction(outOfReach, { type: 'move', dx: 0, dy: -1 }).status).toBe('playing');
    // Та же ладья на клетку ближе долетает: шаг вниз её не обманывает, потому что
    // сдвиг ряда не меняет дистанцию между королём и фигурами.
    const inReach = base({ mode: 'race', width: 5, height: 8, player: { x: 1, y: 1 }, enemies: [{ id: 'e0', type: 'rook', x: 3, y: 1 }] });
    expect(applyAction(inReach, { type: 'move', dx: 0, dy: -1 }).status).toBe('lost');

    // Никакого «рядового падения» нет: после сдвига фигура тратит ровно свой ход.
    const far = base({ mode: 'race', width: 5, height: 8, player: { x: 0, y: 1 }, enemies: [{ id: 'e0', type: 'knight', x: 4, y: 5 }] });
    const step = applyAction(far, { type: 'move', dx: 1, dy: 0 });
    const horse = step.enemies.find((e) => e.id === 'e0')!;
    // Ряд уехал на клетку вниз (с 5 на 4), остальное - ход коня: |dx| + |dy| = 3.
    expect(Math.abs(horse.x - 4) + Math.abs(horse.y - 4)).toBe(3);
    expect(step.status).toBe('playing');
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

  it('«Гонки» стартуют без боя: фигуры занимают верхние ряды притока', () => {
    for (const level of [3, 9, 20]) {
      const state = createRaceLevel(level, 909 + level);
      expect(state.enemies.length).toBeGreaterThan(0);
      for (const enemy of state.enemies) {
        expect(enemy.y).toBeGreaterThanOrEqual(state.height - RACE_SPAWN_ROWS);
      }
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

  it('в кампании взятия не лимитированы, в «Гонках» вместо них рубка ряда', () => {
    const state = wall('campaign');
    expect(capturesLeft(base({ mode: 'campaign', captures: 40 }))).toBe(Number.POSITIVE_INFINITY);
    expect(legalMoves(state).some((move) => Boolean(move.takes))).toBe(true);
    // Король бьёт во все стороны и без квоты: иначе забег превращается в ожидание.
    const race = base({ mode: 'race', width: 5, height: 8, player: { x: 1, y: 1 }, enemies: [{ id: 'e0', type: 'pawn', x: 2, y: 0 }] });
    expect(legalMoves(race).some((move) => move.dy === -1 && Boolean(move.takes))).toBe(true);
    expect(capturesLeft(race)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('тупик в «Парковке»', () => {
  it('закрытая дорога это поражение, а не вечное ожидание', () => {
    // Карман: единственный ход ведёт в клетку, из которой дальше некуда,
    // а взятий не осталось. Фигуры стоят, позиция не изменится сама.
    const pocket = base({
      mode: 'jam',
      width: 3,
      height: 5,
      player: { x: 0, y: 0 },
      captures: 3,
      enemies: [
        { id: 'e1', type: 'pawn', x: 1, y: 1 },
        { id: 'e2', type: 'pawn', x: 0, y: 2 },
        { id: 'e3', type: 'pawn', x: 1, y: 2 },
      ],
    });
    expect(legalMoves(pocket).length).toBe(1);
    const stuckState = applyAction(pocket, { type: 'move', dx: 0, dy: 1 });
    expect(stuckState.status).toBe('lost');
    expect(stuckState.lastEvent).toBe('stuck');
    expect(() => applyAction(stuckState, { type: 'skip' })).toThrow(RuleError);
  });

  it('пропуск в статичном режиме не считается вынужденным', () => {
    const blocked = base({
      mode: 'jam',
      width: 3,
      height: 5,
      player: { x: 0, y: 0 },
      captures: 3,
      enemies: [
        { id: 'e1', type: 'pawn', x: 0, y: 1 },
        { id: 'e2', type: 'pawn', x: 1, y: 1 },
      ],
    });
    expect(legalMoves(blocked).length).toBe(0);
    expect(() => applyAction(blocked, { type: 'skip' })).toThrow(RuleError);
  });

  it('в кампании и «Гонках» вынужденный пропуск остаётся бесплатным', () => {
    for (const mode of ['campaign', 'race'] as const) {
      const state = base({
        mode,
        width: 3,
        height: 4,
        player: { x: 1, y: 0 },
        skips: 0,
        captures: 0,
        enemies: [
          { id: 'e1', type: 'rook', x: 0, y: 1 },
          { id: 'e2', type: 'rook', x: 1, y: 1 },
          { id: 'e3', type: 'rook', x: 2, y: 1 },
        ],
      });
      if (legalMoves(state).length > 0) continue;
      const after = applyAction(state, { type: 'skip' });
      expect(after.skips ?? 0).toBe(0);
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
    // Полоса нужна лабораторным генераторам стены: боевая «Парковка» это
    // головоломка, а «Гонки» без финиша, их меряют длиной забега, не решаемостью.
    for (const mode of ['jam', 'jamExit2'] as const) {
      const band = difficultyBand(10, mode);
      const state = createSpecialLevel(mode, 10, 4242);
      const report = auditState(state, { maxDepth: state.height + 4, maxNodes: 60_000 });
      expect(report.solvable).toBe(true);
      expect(report.score).toBeGreaterThanOrEqual(band.min);
      expect(report.score).toBeLessThanOrEqual(band.max);
    }
  });
});

describe('переключатели вариантов', () => {
  it('свободная диагональ включена в кампании и выключена в строгом варианте', () => {
    const state = (mode: GameState['mode']) =>
      base({ mode, width: 4, height: 6, player: { x: 1, y: 1 }, enemies: [{ id: 'e1', type: 'rook', x: 3, y: 4 }] });
    expect(legalMoves(state('campaign')).some((m) => m.dx === 1 && !m.takes)).toBe(true);
    expect(legalMoves(state('campaignFreeDiag')).some((m) => m.dx === 1 && !m.takes)).toBe(true);
    expect(legalMoves(state('campaignStrictDiag')).some((m) => m.dx === 1 && !m.takes)).toBe(false);
    // Прямо вверх ходят оба варианта.
    expect(legalMoves(state('campaignStrictDiag')).some((m) => m.dx === 0)).toBe(true);
    // Взятие по диагонали остаётся: занятая клетка это уже не «свободная диагональ».
    const capture = base({
      mode: 'campaignStrictDiag',
      width: 4,
      height: 6,
      player: { x: 1, y: 1 },
      enemies: [{ id: 'e1', type: 'pawn', x: 2, y: 2 }],
    });
    expect(legalMoves(capture).some((m) => m.dx === 1 && m.takes === 'pawn')).toBe(true);
  });

  it('уход с площадки: вбок и в четыре стороны', () => {
    const blocked = {
      width: 4,
      height: 6,
      player: { x: 3, y: 0 },
      enemies: [
        { id: 'e1', type: 'rook' as const, x: 1, y: 1 },
        { id: 'e2', type: 'rook' as const, x: 0, y: 1 },
      ],
    };
    // Слева край в одном шаге: ладья уходит с поля целиком.
    const escape = applyAction(base({ mode: 'jamExit2', ...blocked, enemies: [{ id: 'e1', type: 'rook', x: 0, y: 3 }] }), {
      type: 'move',
      dx: 0,
      dy: 1,
    });
    expect(escape.enemies.find((e) => e.id === 'e1')).toBeUndefined();
    expect(escape.lastEvent).toBe('escaped');

    // Левый путь перекрыт своей же фигурой: вариант в две стороны смещается
    // вправо, вариант в четыре стороны выбирает ближайший край и уходит вверх.
    const two = applyAction(base({ mode: 'jamExit2', ...blocked }), { type: 'move', dx: 0, dy: 1 });
    const four = applyAction(base({ mode: 'jamExit4', ...blocked }), { type: 'move', dx: 0, dy: 1 });
    expect(two.enemies.find((e) => e.id === 'e1')).toMatchObject({ x: 2, y: 1 });
    expect(four.enemies.find((e) => e.id === 'e1')).toMatchObject({ x: 1, y: 0 });
  });

  it('в режиме на уклонение верхний ряд переливает пешку вниз, а не даёт победу', () => {
    const near = base({
      mode: 'raceDodge',
      width: 4,
      height: 6,
      player: { x: 1, y: 4 },
      enemies: [{ id: 'e1', type: 'pawn', x: 3, y: 2 }],
      status: 'playing',
    });
    const state = applyAction(near, { type: 'move', dx: 0, dy: 1 });
    expect(state.status).toBe('playing');
    expect(state.player.y).toBe(0);
    expect(state.lastEvent).toBe('wrap');
    // Боевые «Гонки» перелива не дают: там король, а король живёт в полосе из
    // двух нижних рядов и шаг вверх оставляет его на месте, пока поле едет.
    const kingTurn = applyAction({ ...near, mode: 'race', height: 8, player: { x: 1, y: 0 } }, { type: 'move', dx: 0, dy: 1 });
    expect(kingTurn.player).toEqual({ x: 1, y: 1 });
    expect(kingTurn.lastEvent).not.toBe('wrap');
  });

  it('геометрия варианта совпадает с базовым режимом', () => {
    expect(boardForMode('campaignStrictDiag', 12)).toEqual(boardForMode('campaign', 12));
    expect(boardForMode('jamExit4', 12)).toEqual(boardForMode('jam', 12));
    expect(piecesFor('jamExit2', 12)).toBe(piecesFor('jam', 12));
    expect(modeDef('raceDodge').playable).toBe(false);
    expect(modeFamily('campaignStrictDiag')).toBe('campaign');
  });

  it('анализ варианта детерминирован и различает режимы', () => {
    const a = analyzeVariant({ mode: 'jam', level: 8, samples: 4, seed: 11 });
    const b = analyzeVariant({ mode: 'jam', level: 8, samples: 4, seed: 11 });
    const { ms: msA, ...restA } = a;
    const { ms: msB, ...restB } = b;
    expect(restA).toEqual(restB);
    expect(typeof msA).toBe('number');
    expect(msB).toBeGreaterThanOrEqual(0);
    const exit = analyzeVariant({ mode: 'jamExit2', level: 8, samples: 4, seed: 11 });
    expect(exit.avgEscapes).toBeGreaterThan(0);
    expect(a.avgEscapes).toBe(0);
    expect(a.replayIndex).toBeGreaterThan(0);
    expect(a.replayIndex).toBeLessThanOrEqual(100);
    expect(a.uniqueLayouts).toBeLessThanOrEqual(a.samples);
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
    expect(modeDef('jam').playable).toBe(true);
    expect(modeDef('campaign').playable).toBe(true);
    expect(modeDef('race').note.length).toBeGreaterThan(10);
  });

  it('боевые режимы открываются по уровням кампании', () => {
    expect([...PLAYABLE_MODES]).toEqual(['campaign', 'jam', 'race', 'endless']);
    expect(modeGate('campaign')).toBe(1);
    expect(modeGate('jam')).toBe(3);
    expect(modeGate('race')).toBe(5);
    expect(modeGate('endless')).toBe(11);
    expect(modeUnlocked('jam', 2)).toBe(false);
    expect(modeUnlocked('jam', 3)).toBe(true);
    expect(modeUnlocked('race', 4)).toBe(false);
    expect(modeUnlocked('race', 5)).toBe(true);
    expect(modeUnlocked('endless', 10)).toBe(false);
    // Лабораторные варианты не играются: их нет в списке боевых режимов,
    // а старт на сервере отсекает их до проверки гейта.
    expect(PLAYABLE_MODES).not.toContain('jamDiag');
    expect(isLevelMode('race')).toBe(true);
    expect(isLevelMode('endless')).toBe(false);
  });
});
