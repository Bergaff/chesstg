/** Типы игрового состояния. Модуль используется и клиентом, и Worker'ом. */

export type PieceType = 'pawn' | 'rook' | 'bishop' | 'knight' | 'queen';

/** Боевые режимы: их принимает `POST /api/run/start` и выбирает игрок в меню. */
export type GameMode = 'campaign' | 'jam' | 'race' | 'endless';

/** Варианты правил: считаются тем же движком, но живут только в лаборатории. */
export type LabMode =
  | 'jamExit2'
  | 'jamExit4'
  | 'raceDodge'
  | 'campaignFreeDiag'
  | 'campaignStrictDiag'
  | 'jamStrictDiag';

export type AnyMode = GameMode | LabMode;

export type GameStatus = 'playing' | 'won' | 'lost';

/** -1, влево-вперёд, 0, вперёд, 1, вправо-вперёд. */
export type MoveDx = -1 | 0 | 1;
/** Рядов, пройденных за ход: -1 отступление короля, 1 обычный ход, 2 двойной шаг. */
export type MoveDy = -1 | 0 | 1 | 2;

export type BuffKind = 'freeze' | 'shield';

export interface Enemy {
  id: string;
  type: PieceType;
  x: number;
  y: number;
}

export interface PlayerCell {
  x: number;
  y: number;
}

export interface GameState {
  version: 1;
  /** Боевой API принимает режимы из `PLAYABLE_MODES`, остальные приходят только из лаборатории. */
  mode: AnyMode;
  width: number;
  height: number;
  player: PlayerCell;
  enemies: Enemy[];
  status: GameStatus;
  /** Число ходов игрока (пропуск тоже считается ходом). */
  moves: number;
  /** Максимально пройденная высота (клеток от старта). */
  score: number;
  /** Номер уровня кампании (0 в бесконечном режиме). */
  level: number;
  /** Уровень сложности бесконечного режима. */
  tier: number;
  /** Сколько ходов враги ещё пропускают. */
  freeze: number;
  /** Сколько ходов действует щит. */
  shield: number;
  /** Сколько добровольных пропусков израсходовано (квота задаёт режим). */
  skips?: number;
  /** Сколько фигур взято пешкой. */
  captures?: number;
  /** Мutable-состояние ГПСЧ (нужно для достройки бесконечного поля). */
  rng: number;
  seed: number;
  /** Кем была съедена пешка (для экрана проигрыша). */
  capturedBy?: PieceType;
  /** Клетка фигуры, взятой последним ходом, для подсветки на доске. */
  lastCapture?: Cell;
  /** Служебная метка последнего события для анимаций. */
  lastEvent?: string;
}

export type GameAction =
  | { type: 'move'; dx: MoveDx; dy?: MoveDy }
  | { type: 'skip' }
  | { type: 'buff'; buff: BuffKind };

export interface Cell {
  x: number;
  y: number;
}

export interface MoveOption extends Cell {
  dx: MoveDx;
  /** Рядов, пройденных за ход: 1, 2 при двойном шаге, 0 и -1 у короля. */
  dy?: MoveDy;
  /** Тип фигуры, которую пешка бьёт на этой клетке. */
  takes?: PieceType;
}

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}
