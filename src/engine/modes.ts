import { RACE_PREFILL, RACE_ROWS, RACE_SPAWN_ROWS, RACE_WIDTH, raceSpawnEvery, raceSpawnPerTurn } from './race';
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
  /**
   * Как ходят фигуры: `greedy` идут на игрока по своим шахматным правилам,
   * `down` сдвиг на ряд вниз, `static` стоят, `exit` уходят с поля в боковые
   * или все четыре стороны.
   */
  motion: 'greedy' | 'down' | 'static' | 'exit';
  /** Для `motion: 'exit'`: 2 значит только влево-вправо, 4 во все стороны. */
  exitDirections: 2 | 4;
  /** Можно ли вставать на свободную диагональ. false: диагональ только для взятия. */
  freeDiagonal: boolean;
  /** `top` цель побега вверх, `survive` цели нет: считается длина забега. */
  goal: 'top' | 'survive';
  /** Сколько фигур появляется на верхнем ряду за ход (0 значит без притока). */
  spawnPerTurn: number;
  /** Приток как функция волны: фигуры приходят чаще, а не растягиваются по полю. */
  spawnRate?: (level: number) => number;
  /** Такт притока: волна раз в столько-то ходов. */
  spawnEvery?: (level: number) => number;
  /** Кем ходит игрок: `pawn` пешка (три направления вперёд), `king` король (восемь сторон и взятие назад). */
  player: 'pawn' | 'king';
  /** Верхний ряд переливает в нижний: режим без финиша, где побег всё-таки есть. */
  wrapOnTop: boolean;
  /** Сколько верхних рядов занимает приток. */
  spawnRows: number;
  /**
   * Сколько клеток за ход проезжает ладья, слон или ферзь. Без ограничения
   * фигура долетает с края поля до игрока за один ход, и забег кончается раньше,
   * чем игрок успевает сообразить, куда уходить.
   */
  slideCap?: number;
  /**
   * Поле бежит: на такт нижний ряд уходит за край и уносит фигуры, которые на
   * нём стояли. Игрока сдвиг не трогает, поэтому он и «двигается, но остаётся»
   * на своём ряду.
   */
  scroll: boolean;
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
  exitDirections: 2,
  freeDiagonal: true,
  goal: 'top',
  spawnPerTurn: 0,
  player: 'pawn',
  wrapOnTop: false,
  spawnRows: 1,
  scroll: false,
  rows: (level) => (level <= 5 ? 4 : level <= 15 ? 6 : level <= 30 ? 8 : 9),
  pieces: (level) => (level <= 1 ? 1 : level <= 4 ? 2 : level <= 7 ? 3 : level <= 12 ? 4 : level <= 18 ? 5 : level <= 25 ? 6 : 7),
};

const JAM: ModeRules = {
  // «Парковка»: фигуры забивают поле и не ходят, дорога прочищается взятиями.
  captures: true,
  doubleStep: false,
  skipQuota: 0,
  motion: 'static',
  wall: true,
  exitDirections: 2,
  freeDiagonal: true,
  goal: 'top',
  spawnPerTurn: 0,
  player: 'pawn',
  wrapOnTop: false,
  spawnRows: 1,
  scroll: false,
  // Без лимита «Парковка» решается в лоб: фигуры стоят, идёшь и ешь всех подряд.
  // Квота превращает поле в задачу: выбирать, кого снять, а кого обойти.
  captureQuota: 3,
  rows: (level) => Math.min(9, 5 + Math.floor(level / 4)),
  pieces: (level) => Math.min(12, 3 + Math.floor(level / 2)),
};

const RACE: ModeRules = {
  // «Гонки»: король против фигур, приходящих сверху. Игрок ходит и бьёт на
  // клетку в любую сторону, поэтому взятий не ограничиваем: снимать фигуры это
  // единственный способ дышать. Верхний ряд не финиш, а линия рождения фигур.
  captures: false,
  doubleStep: false,
  // Пропуск не нужен: король всегда может отступить, а ждать смысла нет,
  // приток идёт по своему такту.
  skipQuota: 0,
  motion: 'greedy',
  wall: false,
  captureQuota: 0,
  exitDirections: 2,
  freeDiagonal: true,
  goal: 'survive',
  spawnPerTurn: 1,
  spawnRate: raceSpawnPerTurn,
  spawnEvery: raceSpawnEvery,
  spawnRows: RACE_SPAWN_ROWS,
  scroll: true,
  slideCap: 2,
  player: 'king',
  wrapOnTop: false,
  rows: () => RACE_ROWS,
  pieces: () => RACE_PREFILL,
};

/**
 * Варианты для сравнения в лаборатории. Правила собраны из тех же
 * переключателей, поэтому сравнение честное: отличается только конфиг.
 */
const VARIANTS: Partial<Record<ModeId, ModeRules>> = {
  // «Парковка» на уходе фигур: стена редеет на глазах, и решение зависит от
  // того, в какую сторону смотрит каждая фигура. Боевой режим уводит фигуру
  // ходом на свой край, эти два варианта сравнивают другое число направлений.
  jamExit2: { ...JAM, motion: 'exit', exitDirections: 2 },
  jamExit4: { ...JAM, motion: 'exit', exitDirections: 4 },
  // Тот же затор, но без права вставать на пустую диагональ: взятие остаётся
  // единственным способом освободить клетку.
  jamStrictDiag: { ...JAM, freeDiagonal: false },
  // «Гонки на уклонение»: фигуры приходят с верхнего края и дальше ходят по
  // своим правилам. Доходить до верха не нужно, считается только проигрыш.
  raceDodge: {
    ...RACE,
    // Прежняя погоня пешкой: считается та же длина забега, но игрок бегает
    // пешкой, а не королём, и верхний ряд для него переливается в нижний.
    goal: 'survive',
    captures: true,
    doubleStep: true,
    freeDiagonal: true,
    skipQuota: 1,
    player: 'pawn',
    wrapOnTop: true,
    spawnRate: undefined,
    // Один бесплатный пропуск оставляем как в базе: без него пешка обязана
    // ходить в любую сторону, и уклонение вырождается в «первый ход решает».
    spawnPerTurn: 1,
    rows: () => 9,
    pieces: (level) => Math.min(10, 3 + Math.floor(level / 4)),
  },
  // Одна и та же доска, но у пешки разное право на свободную диагональ:
  // на этих двух режимах и меряется реиграбельность.
  campaignFreeDiag: { ...CORE, freeDiagonal: true },
  campaignStrictDiag: { ...CORE, freeDiagonal: false },
};

export const MODE_RULES = {
  campaign: CORE,
  endless: CORE,
  jam: JAM,
  race: RACE,
} as Record<ModeId, ModeRules>;

for (const key of Object.keys(VARIANTS) as ModeId[]) {
  const rules = VARIANTS[key];
  if (rules) MODE_RULES[key] = rules;
}

export const MODE_ORDER: ModeId[] = [
  'campaign',
  'endless',
  'jam',
  'race',
  'jamExit2',
  'jamExit4',
  'raceDodge',
  'campaignFreeDiag',
  'campaignStrictDiag',
  'jamStrictDiag',
];

/** Режимы, которые принимаются боевым API. Остальные живут в лаборатории. */
export const PLAYABLE_MODES: GameMode[] = ['campaign', 'jam', 'race', 'endless'];

/**
 * Когда открывается режим: считаем по пройденной кампании, чтобы «Парковка»
 * приходила вместе с ладьёй, а «Гонки» со слоном. Бесконечный как был: после
 * десятого уровня.
 */
export const MODE_GATES: Record<GameMode, number> = {
  campaign: 1,
  jam: 3,
  race: 5,
  endless: 11,
};

export function modeGate(mode: GameMode): number {
  return MODE_GATES[mode] ?? 1;
}

export function modeUnlocked(mode: GameMode, campaignMaxLevel: number): boolean {
  return campaignMaxLevel >= modeGate(mode);
}

/** Режимы с номером уровня в профиле. Бесконечного здесь нет: у него только рекорд. */
export function isLevelMode(mode: GameMode): boolean {
  return mode === 'campaign' || mode === 'jam' || mode === 'race';
}

/**
 * Режимы, где уровень двигает победа: дошёл до верха - получил следующий.
 * «Гонки» не из них: там конца нет, уровень растёт от пережитых ходов.
 */
export function isWinLadder(mode: GameMode): boolean {
  return mode === 'campaign' || mode === 'jam';
}

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && value in MODE_RULES;
}

/** Ширина поля: режимы отличаются и ней, иначе «Парковка» на трёх колонках не помещается. */
export function modeFamily(mode: ModeId): 'campaign' | 'jam' | 'race' {
  if (mode.startsWith('jam')) return 'jam';
  if (mode.startsWith('race')) return 'race';
  return 'campaign';
}

export function colsFor(mode: ModeId, level: number): number {
  const family = modeFamily(mode);
  if (family === 'jam') return Math.min(6, 4 + Math.floor(level / 10));
  if (family === 'race') return RACE_WIDTH;
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

/**
 * Режим без финиша: исход решает только длина забега. Разбор и генератор в нём
 * меряют не решаемость, а то, сколько игрок продержался.
 */
export function isSurvivalGoal(mode: AnyMode | undefined): boolean {
  return rulesFor(mode).goal === 'survive';
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
      note: 'Пробка из белых и чёрных фигур: каждую нужно увести с поля. Белые уходят за нижний край, чёрные за верхний, бить нельзя.',
      playable: true,
    },
    race: {
      name: 'Гонки',
      note: 'Король против фигур, которые приходят с верхних рядов и ходят по своим правилам. Счёт это пережитые ходы, каждые восемь режим поднимает уровень.',
      playable: true,
    },
    jamExit2: {
      name: 'Парковка + уход вбок',
      note: 'Исследование старого пешечного затора: фигуры шаг за шагом уходят с поля влево и вправо.',
      playable: false,
    },
    jamExit4: {
      name: 'Парковка + уход в 4 стороны',
      note: 'Исследование старого пешечного затора: фигуры уходят в любую из четырёх сторон.',
      playable: false,
    },
    raceDodge: {
      name: 'Гонки на уклонение',
      note: 'Фигуры приходят с верхнего края и ходят по своим правилам. Меряется, сколько продержишься.',
      playable: false,
    },
    campaignFreeDiag: {
      name: 'Кампания, диагональ свободна',
      note: 'Правила кампании: пешка может вставать на пустую диагональ.',
      playable: false,
    },
    campaignStrictDiag: {
      name: 'Кампания, диагональ только для взятия',
      note: 'Те же доски, но на пустую диагональ вставать нельзя: диагональ это только взятие.',
      playable: false,
    },
    jamStrictDiag: {
      name: 'Парковка, диагональ только для взятия',
      note: 'Старый пешечный затор без права вставать на пустую диагональ: остаётся только взятие.',
      playable: false,
    },
  };
  return { id: mode, rules, ...meta[mode] };
}
