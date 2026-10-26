import { describe, expect, it } from 'vitest';
import {
  auditPlacements,
  auditState,
  createCampaignLevel,
  difficultyBand,
  difficultyTarget,
  enumeratePlacements,
  placementSpace,
  pluralRu,
  summarizeRange,
  heightForLevel,
  sizeForLevel,
  availablePieceTypes,
  pieceCountForLevel,
  type BatchReport,
  type GameState,
} from './index';

function board(partial: Partial<GameState> = {}): GameState {
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
    rng: 7,
    seed: 7,
    ...partial,
  };
}

describe('разбор одной расстановки', () => {
  it('находит короткое решение', () => {
    const state = board({ enemies: [{ id: 'e0', type: 'pawn', x: 1, y: 1 }] });
    const audit = auditState(state);
    expect(audit.solvable).toBe(true);
    expect(audit.steps).toBe(2);
    expect(audit.firstMoves).toBe(2);
    expect(audit.solution.length).toBe(2);
    expect(audit.score).toBeGreaterThan(0);
  });

  it('видит тупик, когда средний ряд перекрыт', () => {
    const state = board({
      enemies: [
        { id: 'e0', type: 'rook', x: 0, y: 1 },
        { id: 'e1', type: 'rook', x: 1, y: 1 },
        { id: 'e2', type: 'rook', x: 2, y: 1 },
      ],
    });
    const audit = auditState(state);
    expect(audit.solvable).toBe(false);
    expect(audit.score).toBe(0);
    expect(audit.solution).toEqual([]);
  });

  it('стену из пешек в первом ряду берут взятиями', () => {
    const state = board({
      enemies: [
        { id: 'e0', type: 'pawn', x: 0, y: 1 },
        { id: 'e1', type: 'pawn', x: 1, y: 1 },
        { id: 'e2', type: 'pawn', x: 2, y: 1 },
      ],
    });
    const audit = auditState(state);
    // Раньше единственный способ пережить такой ряд, пропустить ход. Теперь
    // пешка бьёт по диагонали, поэтому решение существует и включает взятие.
    expect(audit.solvable).toBe(true);
    expect(audit.captures).toBeGreaterThan(0);
  });

  it('поздний уровень оценивается выше первого', () => {
    const first = auditState(createCampaignLevel(1, 101));
    const late = auditState(createCampaignLevel(30, 101));
    expect(late.score).toBeGreaterThan(first.score);
    expect(late.score).toBeLessThanOrEqual(100);
  });
});

describe('пространство расстановок', () => {
  it('считает все варианты для 3×3', () => {
    const space = placementSpace({ width: 3, height: 3, count: 1, types: ['pawn'] });
    expect(space.cells).toBe(3);
    expect(space.combinations).toBe(3);
    expect(space.typeTuples).toBe(1);
    expect(space.starts).toBe(3);
    expect(space.total).toBe(9);
  });

  it('учитывает лимит пешек в наборе фигур', () => {
    const spec = { width: 4, height: 4, count: 4, types: ['pawn', 'rook'] as const };
    const space = placementSpace({ ...spec, types: [...spec.types] });
    // k = 4, пешек не больше двух: 1 + 4 + 6 = 11 наборов типов.
    expect(space.pawnCap).toBe(2);
    expect(space.typeTuples).toBe(11);
  });

  it('полный перебор покрывает пространство целиком', () => {
    const spec = { width: 3, height: 3, count: 1, types: ['pawn' as const] };
    const { plans, space, exhaustive } = enumeratePlacements(spec, { limit: 100 });
    expect(exhaustive).toBe(true);
    expect(plans).toHaveLength(space.total);
    expect(new Set(plans.map((plan) => plan.key)).size).toBe(space.total);
  });

  it('выборка детерминирована и не повторяет ключи', () => {
    const spec = {
      width: 4,
      height: 4,
      count: 3,
      types: availablePieceTypes(8),
    };
    const first = enumeratePlacements(spec, { limit: 200, seed: 42 });
    const second = enumeratePlacements(spec, { limit: 200, seed: 42 });
    expect(first.exhaustive).toBe(false);
    expect(first.plans).toHaveLength(200);
    expect(first.plans.map((plan) => plan.key)).toEqual(second.plans.map((plan) => plan.key));
    expect(new Set(first.plans.map((plan) => plan.key)).size).toBe(200);
  });
});

describe('пакетная проверка', () => {
  it('делит расстановки на группы без потерь', () => {
    const report = auditPlacements(
      { width: 4, height: 4, count: 3, types: availablePieceTypes(8) },
      { limit: 600, seed: 3, band: difficultyBand(8) },
    );
    expect(report.checked).toBe(report.solvable + report.unsolvable);
    expect(report.solvable).toBe(report.fair + report.simple + report.brutal);
    expect(report.best.length).toBeLessThanOrEqual(6);
    expect(report.averageScore).toBeGreaterThan(0);
    expect(report.averageScore).toBeLessThanOrEqual(100);
  });

  it('на 3×3 перебирает всё поле и находит решения', () => {
    const report = auditPlacements(
      { width: 3, height: 3, count: 1, types: ['pawn'] },
      { limit: 100, seed: 1, band: difficultyBand(1) },
    );
    expect(report.exhaustive).toBe(true);
    expect(report.checked).toBe(9);
    expect(report.solveRate).toBeGreaterThan(0);
  });
});

describe('отбор уровней кампании', () => {
  it('цель сложности растёт и упирается в потолок', () => {
    let previous = 0;
    for (let level = 1; level <= 60; level++) {
      const target = difficultyTarget(level);
      expect(target).toBeGreaterThanOrEqual(previous);
      expect(target).toBeLessThanOrEqual(84);
      previous = target;
    }
    expect(difficultyBand(30).min).toBeLessThan(difficultyBand(30).max);
  });

  it('сгенерированные уровни решаемы и набрали оценку', () => {
    for (const level of [1, 2, 5, 8, 12, 15, 16, 20, 26, 30, 31, 40]) {
      for (const seed of [300 + level, 9100 + level]) {
        const state = createCampaignLevel(level, seed);
        expect(state.width).toBe(sizeForLevel(level));
        expect(state.height).toBe(heightForLevel(level));
        expect(state.height).toBeGreaterThan(state.width);
        const audit = auditState(state);
        expect(audit.solvable, `level ${level} seed ${seed}`).toBe(true);
        expect(audit.firstMoves).toBeGreaterThan(0);
        expect(audit.score).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('держит планку сложности на поздних уровнях', () => {
    const scores = [31, 33, 35, 37, 39, 41].map((level) => auditState(createCampaignLevel(level, 500 + level)).score);
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    // Планка 64, не 70: доля безальтернативных шагов весит меньше, чем раньше,
    // потому что выбор на ходу теперь добавляет к оценке, а не отнимается.
    expect(average).toBeGreaterThanOrEqual(64);
    expect(Math.max(...scores)).toBeLessThanOrEqual(100);
  });

  it('не превышает лимит фигур поля', () => {
    for (const level of [1, 5, 6, 15, 16, 30, 31, 60]) {
      const state = createCampaignLevel(level, 77);
      expect(state.enemies.length).toBeLessThanOrEqual(pieceCountForLevel(level));
      expect(state.enemies.length).toBeLessThanOrEqual((state.height - 2) * state.width - 1);
    }
  });
});

describe('прогон диапазона', () => {
  const space = placementSpace({ width: 3, height: 3, count: 1, types: ['pawn'] });

  /** Отчёт уровня с ручной оценкой: полоса и решаемость важнее содержания. */
  function fakeReport(over: Partial<BatchReport> = {}): BatchReport {
    return {
      space,
      exhaustive: true,
      limit: 150,
      checked: 9,
      solvable: 8,
      unsolvable: 1,
      simple: 2,
      fair: 5,
      brutal: 1,
      averageScore: 50,
      medianScore: 50,
      best: [],
      worst: [],
      solveRate: 8 / 9,
      ...over,
    };
  }

  function row(level: number, over: Partial<BatchReport> = {}) {
    const band = difficultyBand(level);
    return { level, width: 3, height: 3, pieces: 1, band, report: fakeReport(over) };
  }

  it('суммирует уровни и не теряет строк', () => {
    const report = summarizeRange({
      mode: 'campaign',
      from: 1,
      to: 3,
      perLevelLimit: 150,
      rows: [row(1, { checked: 9, solvable: 8 }), row(2, { checked: 20, solvable: 10 }), row(3, { checked: 1, solvable: 1 })],
    });
    expect(report.rows.map((entry) => entry.level)).toEqual([1, 2, 3]);
    expect(report.checked).toBe(30);
    expect(report.solved).toBe(19);
    expect(report.solveRate).toBeCloseTo(19 / 30, 4);
    expect(report.exhaustiveLevels).toBe(3);
  });

  it('считает уход от полосы долями её ширины и сортирует по нему', () => {
    const band = difficultyBand(5);
    const width = band.max - band.min;
    const report = summarizeRange({
      from: 5,
      to: 6,
      perLevelLimit: 150,
      rows: [
        row(5, { averageScore: band.max + 2 * width }),
        row(6, { averageScore: difficultyBand(6).min - 0.5 * (difficultyBand(6).max - difficultyBand(6).min) }),
      ],
    });
    expect(report.rows[0].offBand).toBeCloseTo(2, 3);
    expect(report.rows[1].offBand).toBeCloseTo(0.5, 3);
    expect(report.offBand).toEqual([5, 6]);
    const joined = report.verdicts.join(' ');
    expect(joined).toContain('Сильнее всех L5');
    expect(joined).toContain('выше цели');
    expect(joined).not.toMatch(/NaN|undefined|\[object/);
  });

  it('не считает провалом уровень, который не успели разобрать', () => {
    const band = difficultyBand(9);
    const report = summarizeRange({
      from: 9,
      to: 10,
      perLevelLimit: 150,
      rows: [
        row(9, { checked: 0, solvable: 0, solveRate: 0, averageScore: band.min - 40 }),
        row(10, { solveRate: 0.2, solvable: 2, checked: 10 }),
      ],
    });
    expect(report.thin).toEqual([10]);
    expect(report.offBand).toEqual([]);
  });

  it('на пустом прогоне говорит, что делать, а не делит на ноль', () => {
    const report = summarizeRange({ from: 1, to: 60, perLevelLimit: 400, rows: [] });
    expect(report.checked).toBe(0);
    expect(report.solveRate).toBe(0);
    expect(report.verdicts).toEqual(['Прогон пуст: ни один уровень не разобран.']);
  });

  it('на живых отчётах формулировки собираются без мусора', () => {
    const rows = [1, 2, 3].map((level) => ({
      level,
      ...(() => {
        const built = difficultyBand(level);
        return { width: 3, height: 3, pieces: 1, band: built };
      })(),
      report: auditPlacements({ width: 3, height: 3, count: 2, types: ['pawn', 'rook'] }, { limit: 120, seed: level, band: difficultyBand(level) }),
    }));
    const report = summarizeRange({ mode: 'campaign', from: 1, to: 3, perLevelLimit: 120, rows });
    expect(report.rows.length).toBe(3);
    expect(report.checked).toBeGreaterThan(0);
    expect(report.verdicts.length).toBeGreaterThanOrEqual(4);
    for (const line of report.verdicts) {
      expect(line.trim().length).toBeGreaterThan(10);
      expect(line).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('числительная в вердиктах', () => {
  it('склоняет существительное по числу', () => {
    const forms = ['уровень', 'уровня', 'уровней'] as const;
    expect([1, 21, 101].map((n) => pluralRu(n, forms))).toEqual(['уровень', 'уровень', 'уровень']);
    expect([2, 5, 24, 100].map((n) => pluralRu(n, forms))).toEqual([
      'уровня',
      'уровней',
      'уровня',
      'уровней',
    ]);
    expect([11, 12, 14, 111].map((n) => pluralRu(n, forms))).toEqual([
      'уровней',
      'уровней',
      'уровней',
      'уровней',
    ]);
  });
});
