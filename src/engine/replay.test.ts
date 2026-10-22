import { describe, expect, it } from 'vitest';
import {
  DIAGONAL_VARIANTS,
  JAM_VARIANTS,
  RACE_VARIANTS,
  analyzeVariant,
  compareVariants,
  measureJamLevels,
} from './replay';
import { SURVIVAL_DEPTH, auditState, survivalTargetFor } from './audit';
import { MODE_RULES, rulesFor } from './modes';
import { createSpecialLevel } from './specials';
import type { ModeId } from './modes';

/**
 * Проверки прогона сравнений: варианты правил действительно отличаются
 * конфигом, генератор с тем же зерном выдаёт те же доски, а режим на
 * уклонение измеряется длиной жизни, а не победой.
 */

const cells = (mode: ModeId, level: number, seed: number): string => {
  const state = createSpecialLevel(mode, level, seed);
  if (!state) return '';
  return state.enemies.map((enemy) => `${enemy.type[0]}${enemy.x},${enemy.y}`).sort().join(';');
};

describe('прогон сравнений', () => {
  it('варианты правил отличаются от базовых режимов', () => {
    expect(rulesFor('jamExit2')).toMatchObject({ motion: 'exit', exitDirections: 2, freeDiagonal: true });
    expect(rulesFor('jamExit4').exitDirections).toBe(4);
    expect(rulesFor('raceDodge')).toMatchObject({ goal: 'survive', motion: 'greedy', spawnPerTurn: 1 });
    expect(rulesFor('campaignStrictDiag').freeDiagonal).toBe(false);
    expect(rulesFor('jamStrictDiag')).toMatchObject({ freeDiagonal: false, motion: 'static' });
    // Варианты живут в том же словаре, значит генератор и лаборатория видят их наравне.
    for (const mode of [...JAM_VARIANTS, ...RACE_VARIANTS, ...DIAGONAL_VARIANTS]) {
      expect(MODE_RULES[mode]).toBeDefined();
    }
  });

  it('генератор детерминирован по зерну, разные зёрна дают разные доски', () => {
    expect(cells('raceDodge', 8, 4242)).toBe(cells('raceDodge', 8, 4242));
    expect(cells('jamExit2', 12, 11)).not.toBe(cells('jamExit2', 12, 12));
  });

  it('в режиме на уклонение разбор возвращает жизнь, а не победу', () => {
    const state = createSpecialLevel('raceDodge', 8, 4242);
    expect(state).not.toBeNull();
    const report = auditState(state!, { maxDepth: 10, maxNodes: 60_000 });
    expect(report.survival).toBe(true);
    expect(report.solvable).toBe(true);
    expect(report.solution).toHaveLength(report.steps);
    expect(report.steps).toBeGreaterThan(0);
    // Глубина для выживания это потолок, а не путь к финишу: чем больше глубина,
    // тем длиннее зафиксированная жизнь.
    expect(auditState(state!, { maxDepth: 14, maxNodes: 60_000 }).steps).toBeGreaterThanOrEqual(report.steps);
    // Боевые «Гонки» теперь тоже без финиша: у них тот же замер жизни.
    expect(auditState(createSpecialLevel('race', 8, 4242)!, { maxDepth: 10 }).survival).toBe(true);
  });

  it('отчёт показывает откаты генератора', () => {
    const campaign = analyzeVariant({ mode: 'campaign', level: 8, samples: 4, seed: 909 });
    expect(campaign.fallbacks).toBe(0);
    expect(campaign.uniqueLayouts).toBeLessThanOrEqual(campaign.samples);
    // Строгая диагональ на том же уровне попадает в полосу не всегда: часть досок
    // генератор сдаёт без отбора, и это должно быть видно в отчёте.
    const strict = analyzeVariant({ mode: 'campaignStrictDiag', level: 10, samples: 64, seed: 20261022 });
    expect(strict.fallbacks).toBeGreaterThanOrEqual(5);
    expect(strict.solvableShare).toBeLessThan(1);
  });

  it('цель по жизни убывает с уровнем и не выходит за границы', () => {
    expect(survivalTargetFor(1)).toBe(11);
    expect(survivalTargetFor(8)).toBe(9);
    expect(survivalTargetFor(16)).toBe(7);
    expect(survivalTargetFor(60)).toBe(4);
  });

  it('генератор не выдаёт досок с бесконечным уклонением', () => {
    const dodge = analyzeVariant({ mode: 'raceDodge', level: 12, samples: 5, seed: 77 });
    expect(dodge.survival!.capped).toBe(0);
    expect(dodge.survival!.max).toBeLessThan(SURVIVAL_DEPTH);
  });

  // Разбор двух режимов без финиша самый дорогой в файле: у пешки перебор идёт
  // по трём ходам на глубину, у короля длину считает прогон, поэтому тесту нужен
  // свой потолок времени.
  it('отчёт по уклонению и отчёт по королю измеряют жизнь', () => {
    const dodge = analyzeVariant({ mode: 'raceDodge', level: 6, samples: 2, seed: 500, maxDepth: 8 });
    expect(dodge.survival).toBeDefined();
    expect(dodge.survival!.avg).toBeGreaterThan(0);
    expect(dodge.survival!.min).toBeGreaterThan(0);

    const race = analyzeVariant({ mode: 'race', level: 6, samples: 4, seed: 500 });
    expect(race.survival).toBeDefined();
    // Длина забега короля измеряется прогоном: бот живёт десятки ходов, а не
    // один-два, и в потолок прогона забег упираться не должен.
    expect(race.survival!.avg).toBeGreaterThan(5);
    expect(race.survival!.capped).toBe(0);
    expect(race.survival!.max).toBeLessThan(240);
    expect(race.inBandShare).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('замер генератора парковки считает план, а не долю побед', () => {
    const rows = measureJamLevels([1, 12], 6, 909);
    expect(rows.map((row) => row.level)).toEqual([1, 12]);
    for (const row of rows) {
      expect(row.solvedShare).toBe(1);
      expect(row.overBudget).toBe(0);
      expect(row.avgPieces).toBeGreaterThanOrEqual(4);
      expect(row.avgCost).toBeGreaterThan(0);
    }
    // Пробка обязана усложняться: план на 12-м уровне длиннее, чем на первом.
    expect(rows[1].avgCost).toBeGreaterThan(rows[0].avgCost);
  }, 60_000);

  it('сравнение возвращает отчёты по порядку и без расхождений на равных правилах', () => {
    const reports = compareVariants(['jam', 'campaignFreeDiag'], 6, 4, 909);
    expect(reports.map((report) => report.mode)).toEqual(['jam', 'campaignFreeDiag']);
    // Кампания и «диагональ свободна» это один и тот же конфиг: цифры обязаны совпасть.
    const twin = compareVariants(['campaign', 'campaignFreeDiag'], 6, 4, 909);
    const { mode: _a, ms: _b, ...first } = twin[0];
    const { mode: _c, ms: _d, ...second } = twin[1];
    void _a;
    void _b;
    void _c;
    void _d;
    expect(first).toEqual(second);
  });
});
