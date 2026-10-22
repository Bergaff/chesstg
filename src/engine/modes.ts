import type { AnyMode, GameMode } from './types';

/**
 * Правила режима.
 *
 * Ядро одно, режимы отличаются пятью переключателями. Это сознательный выбор:
 * каждый новый режим, собранный из этих флагов, автоматически получает разбор
 * (`auditState`), генератор и лабораторию, а не копию движка.
 */
export interface ModeRules {
  /** Пешка бьёт фигуры по диагонали вперёд. */
  captures: boolean;
  /** Первый ход можно сделать на две клетки, как в шахматах. */
  doubleStep: boolean;
  /** Сколько раз за забег игрок вправе пропустить ход сам. Вынужденный пропуск не считается. */
  skipQuota: number;
  /** Как ходят фигуры: greedily к пешке, рядом вниз конвейером, или стоят. */
  motion: 'greedy' | 'down' | 'static';
  /** Плотная стена фигур вместо разреженной доски: режим «Парковка». */
  wall: boolean;
  /** Сколько фигур за забег можно взять. 0 значит без ограничения. */
  captureQuota: number;
  /** Число рядов поля как функция от номера уровня. */
  rows: (level: number) => number;
  /** Число фигур. */
  pieces: (level: number) => number;
}

export type ModeId = AnyMode;

export interface ModeDef {
  id: ModeId;
  name: string;
  /** Короткое описание для админки и экрана режима. */
  note: string;
  /** Идёт ли режим в бою через /api/run, или пока только лаборатория. */
  playable: boolean;
  rules: ModeRules;
}

/** Кампания и бесконечный режим делят одни правила, чтобы прогресс был сопоставим. */
const CORE: ModeRules = {
  captures: true,
  doubleStep: true,
  skipQuota: 2,
  motion: 'greedy',
  wall: false,
  captureQuota: 0,
  rows: (level) => (level <= 5 ? 4 : level <= 15 ? 6 : level <= 30 ? 8 : 9),
  pieces: (level) => (level <= 1 ? 1 : level <= 4 ? 2 : level <= 7 ? 3 : level <= 12 ? 4 : level <= 18 ? 5 : level <= 25 ? 6 : 7),
};

export const MODE_RULES: Record<ModeId, ModeRules> = {
  campaign: CORE,
  endless: CORE,
  // «Парковка»: фигуры забивают поле и не ходят, дорога прочищается взятиями.
  jam: {
    captures: true,
    doubleStep: false,
    skipQuota: 0,
    motion: 'static',
    wall: true,
    // Без лимита «Парковка» решается в лоб: фигуры стоят, идёшь и ешь всех подряд.
    // Квота превращает поле в задачу: выбирать, кого снять, а кого обойти.
    captureQuota: 3,
    rows: (level) => Math.min(9, 5 + Math.floor(level / 4)),
    pieces: (level) => Math.min(12, 3 + Math.floor(level / 2)),
  },
  // «Гонки»: фигуры едут рядом вниз, пешка бежит навстречу, ушедшие за край исчезают.
  race: {
    captures: true,
    doubleStep: true,
    skipQuota: 1,
    motion: 'down',
    wall: false,
    captureQuota: 0,
    rows: (level) => Math.min(10, 6 + Math.floor(level / 5)),
    pieces: (level) => Math.min(8, 2 + Math.floor(level / 3)),
  },
};

export const MODE_ORDER: ModeId[] = ['campaign', 'endless', 'jam', 'race'];

/** Режимы, которые принимаются боевым API. Остальные живут в лаборатории. */
export const PLAYABLE_MODES: GameMode[] = ['campaign', 'endless'];

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && value in MODE_RULES;
}

/** Ширина поля: режимы отличаются и ней, иначе «Парковка» на трёх колонках не помещается. */
export function colsFor(mode: ModeId, level: number): number {
  if (mode === 'jam') return Math.min(6, 4 + Math.floor(level / 10));
  if (mode === 'race') return 6;
  if (level <= 5) return 3;
  if (level <= 15) return 4;
  if (level <= 30) return 5;
  return 6;
}

export function boardForMode(mode: ModeId, level: number): { width: number; height: number } {
  return { width: colsFor(mode, level), height: MODE_RULES[mode].rows(level) };
}

export function piecesFor(mode: ModeId, level: number): number {
  return MODE_RULES[mode].pieces(level);
}

export function rulesFor(mode: AnyMode | undefined): ModeRules {
  return MODE_RULES[mode && isModeId(mode) ? mode : 'campaign'];
}

export function modeDef(mode: ModeId): ModeDef {
  const rules = MODE_RULES[mode];
  const meta: Record<ModeId, { name: string; note: string; playable: boolean }> = {
    campaign: {
      name: 'Кампания',
      note: 'Фигуры ходят по классическим правилам и идут на пешку, победа в верхнем ряду.',
      playable: true,
    },
    endless: {
      name: 'Бесконечный',
      note: 'Поле достраивается, сложность растёт каждые пять ходов.',
      playable: true,
    },
    jam: {
      name: 'Парковка',
      note: 'Поле забито фигурами, они не ходят, дорога прочищается взятиями по диагонали.',
      playable: false,
    },
    race: {
      name: 'Гонки',
      note: 'Фигуры едут рядом вниз, пешка навстречу: кто первый разминётся.',
      playable: false,
    },
  };
  return { id: mode, rules, ...meta[mode] };
}
