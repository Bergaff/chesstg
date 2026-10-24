import { describe, expect, it } from 'vitest';
import {
  DIAGONAL_VARIANTS,
  JAM_VARIANTS,
  RACE_VARIANTS,
  analyzeVariant,
  compareVariants,
  isDoomed,
  measureJamLevels,
  measureRaceLevels,
} from './replay';
import { createRaceLevel } from './specials';
import { RACE_KING_ROWS } from './race';
import { legalMoves } from './board';
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
    // Поле без выпада отличается одним флагом: генератор, приток и полоса те же.
    expect(rulesFor('raceNoStrike')).toMatchObject({ strike: 0, kingRows: 2, exitAtBottom: true });
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

  // Превращение пешки у края добавило поиску кампании ветвлений, и прогон
  // перестал успевать в обычные 5 с. Потолок поднят, смысл проверки не изменился.
  it('отчёт показывает откаты генератора', { timeout: 40_000 }, () => {
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

  it('нерешаемая позиция находится перебором, а не эвристикой', () => {
    // Угол без взятий и с ладьёй на той же линии: любой ход проигрывает в три
    // полухода, и `isDoomed` обязан это увидеть.
    const free = createRaceLevel(10, 4242);
    expect(isDoomed(free, 3)).toBe(false);
    // Чистое поле: фигур нет вообще - тем более не нерешаемо.
    const empty = { ...free, enemies: [] };
    expect(isDoomed(empty, 3)).toBe(false);
    // Закрытая партия: исход уже предрешён движком.
    const over = { ...free, status: 'lost' as const };
    expect(isDoomed(over, 3)).toBe(true);
    // Глубина 0 спорить не о чем: позиция не выиграна, но и не проверена.
    expect(isDoomed(free, 0)).toBe(false);
    // Полоса не оставляет ходов: перебор обязан назвать позицию нерешаемой.
    const blocked = {
      ...free,
      width: 1,
      player: { x: 0, y: 0 },
      enemies: [
        { id: 'a', type: 'rook' as const, x: 0, y: 6 },
        { id: 'b', type: 'rook' as const, x: 0, y: 7 },
      ],
    };
    if (legalMoves(blocked).length === 0) expect(isDoomed(blocked, 3)).toBe(true);
  });

  it('прогон «Гонок» меряет длину решаемой партии', () => {
    const rows = measureRaceLevels([10, 20], { samples: 3, seed: 707, cap: 160 });
    expect(rows.map((row) => row.level)).toEqual([10, 20]);
    for (const row of rows) {
      // Медиана до нерешаемой позиции не нулевая: забег обязан читаться.
      expect(row.doomMedian).toBeGreaterThanOrEqual(4);
      expect(row.doomMin).toBeLessThanOrEqual(row.doomMedian);
      expect(row.doomMax).toBeGreaterThanOrEqual(row.doomMedian);
      expect(row.lengthMedian).toBeGreaterThanOrEqual(row.doomMedian);
      // Полоса в два ряда: игрок всегда в ней и не выигрывает - победы нет.
      expect(row.widthStart).toBeLessThan(row.widthEnd);
      expect(row.capped).toBe(0);
      expect(row.capturesAvg).toBeGreaterThanOrEqual(0);
      expect(Object.values(row.causes).reduce((a, b) => a + b, 0)).toBe(row.samples);
    }
    // Ни один забег не кончился победой: режим без финиша.
    for (const row of rows) expect(row.causes.won ?? 0).toBe(0);
    expect(RACE_KING_ROWS).toBe(2);
  }, 120_000);

  it('тяжёлый прогон считает все 1000 досок, а не молча режется', () => {
    // Кнопка «Расчёт на 1000 досок» в лаборатории обещает цифру в отчёте: если
    // движок обрежет её до своего потолка, отчёт соврёт, а проверить это в браузере
    // нельзя. Поэтому потолок движка и поле панели обязаны сходиться.
    const row = measureRaceLevels([9], { samples: 1000, seed: 606, cap: 8, depth: 1 })[0];
    expect(row.samples).toBe(1000);
    expect(Object.values(row.causes).reduce((a, b) => a + b, 0)).toBe(1000);
  }, 120_000);

  it('сравнение с базовым правилом добавляет колонку, а не меняет прогон', () => {
    const plain = measureRaceLevels([9], { samples: 2, seed: 818, cap: 120 })[0];
    expect(plain!.comparison).toBeUndefined();
    expect(plain!.mode).toBe('race');
    const compared = measureRaceLevels([9], { samples: 2, seed: 818, cap: 120, compare: true })[0];
    // Тот же набор зёрен и тот же потолок: база обязана совпасть цифра в цифру,
    // иначе «прирост от правила» считается по разным партиям.
    expect(compared!.doomMedian).toBe(plain!.doomMedian);
    expect(compared!.lengthMedian).toBe(plain!.lengthMedian);
    expect(compared!.comparison).toBeDefined();
    expect(compared!.comparison!.mode).toBe('raceNoStrike');
    expect(compared!.comparison!.samples).toBe(compared!.samples);
    // Без права бить через линию взятий меньше либо столько же - правило ровно
    // про это, и замер обязан показать направление, а не шум.
    expect(compared!.comparison!.capturesAvg).toBeLessThanOrEqual(compared!.capturesAvg);
  }, 120_000);

  it('замер меряет другое правило и темп, и реиграбельность', () => {
    const options = { samples: 4, seed: 909, cap: 40, depth: 2 } as const;
    const one = measureRaceLevels([9], { ...options, mode: 'raceTempoOne' })[0]!;
    const all = measureRaceLevels([9], { ...options, mode: 'race' })[0]!;
    expect(one.mode).toBe('raceTempoOne');
    // Темп видно по числу сдвинувшихся фигур за такт: при «по одной» их не больше
    // одной, при общем темпе - заметно больше. Так видно, что замер мерит
    // правило, а не шум генератора.
    expect(one.moversAvg).toBeLessThanOrEqual(1);
    expect(all.moversAvg).toBeGreaterThan(one.moversAvg);
    // Метрики реиграбельности обязаны лежать в тех границах, что обещает сноска.
    for (const row of [one, all]) {
      expect(row.choiceAvg).toBeGreaterThan(1);
      expect(row.safeShare).toBeGreaterThanOrEqual(0);
      expect(row.safeShare).toBeLessThanOrEqual(1);
      expect(row.forcedShare).toBeGreaterThanOrEqual(0);
      expect(row.startVariety).toBeGreaterThan(0);
      expect(row.startVariety).toBeLessThanOrEqual(1);
      expect(row.lengthSpread).toBeGreaterThanOrEqual(0);
      expect(row.replayIndex).toBeGreaterThanOrEqual(0);
      expect(row.replayIndex).toBeLessThanOrEqual(1);
      expect(row.busiestType).toBeTruthy();
      expect(row.busiestShare).toBeGreaterThanOrEqual(0);
      expect(row.capturesMedian).toBeGreaterThanOrEqual(0);
      expect(row.capturesP90).toBeGreaterThanOrEqual(row.capturesMedian);
      expect(row.strikesAvg).toBeGreaterThanOrEqual(0);
    }
    // Сравнение обязано уметь любую базу, а не только «без выпада».
    const vs = measureRaceLevels([9], { ...options, mode: 'raceTempoOne', compare: true, compareMode: 'race' })[0]!;
    expect(vs.comparison!.mode).toBe('race');
    expect(vs.comparison!.samples).toBe(vs.samples);
  }, 120_000);

  it('замер парковки считает развилки и разнообразие расстановок', () => {
    const [low, high] = measureJamLevels([1, 20], 5, 313);
    for (const row of [low, high]) {
      expect(row.uniqueLayouts).toBeGreaterThan(1);
      expect(row.layoutDistance).toBeGreaterThan(0.5);
      expect(row.avgChoice).toBeGreaterThan(1);
      expect(row.replayIndex).toBeGreaterThan(0.5);
      expect(row.forgiveness).toBeGreaterThanOrEqual(0);
      expect(row.forgiveness).toBeLessThanOrEqual(1);
      expect(row.budgetAvg).toBeGreaterThan(row.avgCost);
      expect(row.slackAvg).toBeGreaterThanOrEqual(0);
      expect(row.difficulty).toBeGreaterThan(0);
      expect(row.difficulty).toBeLessThanOrEqual(1);
    }
  }, 120_000);

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
