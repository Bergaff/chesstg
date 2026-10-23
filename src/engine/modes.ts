import {
  RACE_KING_ROWS,
  RACE_MIN_WIDTH,
  RACE_ROWS,
  RACE_SPAWN_ROWS,
  RACE_STRIKE_ROWS,
  racePrefillFor,
  raceSpawnEvery,
  raceSpawnPerTurn,
} from './race';
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
   * Сколько рядов над полосой доступно выпаду игрока (0 значит выпада нет).
   * Выпад это взятие без перемещения: король снимает фигуру, вставшую впритык к
   * границе полосы, и возвращается на свою клетку. Правило нужно, чтобы полоса
   * не превращалась в «сиди и уворачивайся»: фигуру у линии можно убрать, но цена
   * - целый ход, ленты-компенсации больше нет.
   */
  strike: number;
  /**
   * Фигура, дошедшая до нижнего ряда и не сумевшая взять игрока, сходит с поля.
   * Нужно там, где поле не бежит само: без ухода доска забивается за пару
   * десятков ходов, и счёт мерил бы терпение, а не чтение позиции.
   */
  exitAtBottom: boolean;
  /**
   * Вскрытое взятие запрещено: снять игрока в этом такту может только та фигура,
   * которая била его клетку уже в НАЧАЛЕ ответа фигур. Без флага темп «все сразу»
   * порождает несправедливые смерти: игрок идёт на небитую клетку, первая фигура
   * отходит, вскрывает линию второй - и ход, который по подсказке поля был
   * безопасен, заканчивает партию. Правило ничего не добавляет игроку: оно
   * оставляет ему ровно то, что он мог посчитать, глядя на доску.
   */
  noDiscoveryCapture: boolean;
  /**
   * Темп ответа фигур: `all` за такт двигаются все, `one` одна (чья ход ближе
   * всего подводит её к игроку), `cycle` по кругу, по одной за такт. Цикл
   * считается по числу ходов, поэтому приток сдвигает очередь. Флаг
   * держит темп режима целиком: при `all` король в полосе получает сразу несколько
   * угроз за ход, при `one` угроза одна, зато она самая неудобная. Клиренс
   * нижнего ряда (`exitAtBottom`) очереди не ждёт: поле не должно забиваться
   * фигурами, которые просто не успели походить.
   */
  enemyTempo: 'all' | 'one' | 'cycle';
  /**
   * Поле растёт вширь прямо в забеге (у «Гонок» колонка примерно каждые пять
   * пришедших фигур). Флаг нужен доске: размер клетки держится по полной ширине,
   * иначе рост выглядел бы как смена масштаба поля.
   */
  grow?: boolean;
  /**
   * Сколько нижних рядов доступно игроку (0 значит без ограничения). У «Гонок»
   * это два ряда: король живёт в своей полосе, а поле течёт мимо него. Границу
   * полосы доска рисует красной пунктирной линией - правило надо видеть, а не
   * запоминать. Вне полосы хода нет: `legalMoves` такие клетки не отдаёт, а
   * явная попытка шагнуть выше получает `RuleError`.
   */
  kingRows: number;
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
  strike: 0,
  exitAtBottom: false,
  enemyTempo: 'all',
  // Кампания на этом правиле: пешка обязана умирать от того, что видно на доске,
  // а не от вскрытой линии ладьи, которая открылась уже после её хода.
  noDiscoveryCapture: true,
  // Пешка ходит по всему полю: полосу задавать не нужно.
  kingRows: 0,
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
  strike: 0,
  exitAtBottom: false,
  // Фигуры в «Парковке» стоят, темп ответа им не нужен.
  enemyTempo: 'all',
  // Стоячим фигурам взятие не нужно: они его не делают вовсе.
  noDiscoveryCapture: false,
  kingRows: 0,
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
  // Фигуры ходят СВОИМИ ходами и только ими: поля как конвейера больше нет,
  // иначе конь за такт делал прыжок плюс сдвиг, и это читалось как «три клетки
  // вперёд» вместо буквы Г.
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
  // Раз лента не уносит, уходят сами: нижний ряд для фигуры это край поля.
  exitAtBottom: true,
  // В бою за такт отвечают все фигуры: вариант с темпом меряется в лаборатории
  // (`raceTempoOne`, `raceTempoCycle`) и в бой пойдёт только вместе с цифрами.
  enemyTempo: 'all',
  // Полоса из пяти клеток: без запрета вскрытого взятия игрок проигрывает ходам,
  // которых не было ни в одной подсветке.
  noDiscoveryCapture: true,
  // Выпад через линию: бьём то, что встало впритык к границе полосы.
  strike: RACE_STRIKE_ROWS,
  grow: true,
  // Король живёт в двух нижних рядах: выше ему нельзя, кроме выпада (`strike`).
  // Полоса и есть поле игры, всё остальное - коридор, по которому фигуры приезжают.
  kingRows: RACE_KING_ROWS,
  slideCap: 2,
  player: 'king',
  wrapOnTop: false,
  rows: () => RACE_ROWS,
  pieces: () => racePrefillFor(RACE_MIN_WIDTH),
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
    // Пешке полоса и выпад не нужны: у неё восемь направлений не бывает, а
    // рост поля добавил бы варианту другую геометрию, и сравнивать стало бы
    // нечего.
    kingRows: 0,
    strike: 0,
    grow: false,
    spawnRate: undefined,
    // Один бесплатный пропуск оставляем как в базе: без него пешка обязана
    // ходить в любую сторону, и уклонение вырождается в «первый ход решает».
    spawnPerTurn: 1,
    rows: () => 9,
    pieces: (level) => Math.min(10, 3 + Math.floor(level / 4)),
  },
  // Те же «Гонки» без права бить через линию: на этой паре меряется, сколько
  // добавляет выпад. Всё остальное - приток, полоса, рост поля - совпадает.
  raceNoStrike: { ...RACE, strike: 0 },
  // Те же доски, но за такт ходит одна фигура: «гонки» замедляются ровно во
  // столько раз, сколько фигур на поле, и вопрос в том, что при этом происходит
  // с выбором и с наградой, а не только с длиной партии.
  raceTempoOne: { ...RACE, enemyTempo: 'one' },
  // Прежнее поведение «Гонок»: вскрытые взятия разрешены. Нужен как база
  // сравнения - на этой паре меряется, сколько честность правила стоит в длине
  // партии и в числа смертей «ниоткуда».
  raceDiscovery: { ...RACE, noDiscoveryCapture: false },
  // Тот же темп, но фигуры ходят по кругу: слабая ладья не превращается в
  // единственную угрозу, и каждая фигура успевает съесть короля по очереди.
  raceTempoCycle: { ...RACE, enemyTempo: 'cycle' },
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
  'raceNoStrike',
  'raceTempoOne',
  'raceTempoCycle',
  'raceDiscovery',
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
  // Гонка стартует узким полем и растёт вширь по ходу забега: для лаборатории и
  // стартового состояния важна именно начальная ширина.
  if (family === 'race') return RACE_MIN_WIDTH;
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
      note: 'Король в полосе двух нижних рядов против фигур, которые приходят сверху и спускаются своими ходами. По фигуре у линии можно бить на месте: король снимает её и возвращается. Счёт это пережитые ходы, каждые восемь режим поднимает уровень.',
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
    raceNoStrike: {
      name: 'Гонки без выпадата',
      note: 'Те же «Гонки», но бить можно только внутри полосы: права на удар через линию нет.',
      playable: false,
    },
    raceTempoOne: {
      name: 'Гонки: одна фигура за такт',
      note: 'Те же доски и приток, но за такт отвечает лучшая фигура: угроза одна, зато самая неудобная.',
      playable: false,
    },
    raceTempoCycle: {
      name: 'Гонки: фигуры по кругу',
      note: 'Фигуры ходят по очереди, по одной за такт: никто не становится единственной угрозой.',
      playable: false,
    },
    raceDiscovery: {
      name: 'Гонки: вскрытые взятия разрешены',
      note: 'Прежнее поле: фигура может снять короля линией, которая открылась её же ходом в этом такту.',
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
