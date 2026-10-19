/** Типы игрового состояния. Модуль используется и клиентом, и Worker'ом. */

export type PieceType = 'pawn' | 'rook' | 'bishop' | 'knight' | 'queen';

export type GameMode = 'campaign' | 'endless';

export type GameStatus = 'playing' | 'won' | 'lost';

/** -1 — влево-вперёд, 0 — вперёд, 1 — вправо-вперёд. */
export type MoveDx = -1 | 0 | 1;

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
  mode: GameMode;
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
  /** Мutable-состояние ГПСЧ (нужно для достройки бесконечного поля). */
  rng: number;
  seed: number;
  /** Кем была съедена пешка (для экрана проигрыша). */
  capturedBy?: PieceType;
  /** Служебная метка последнего события для анимаций. */
  lastEvent?: string;
}

export type GameAction =
  | { type: 'move'; dx: MoveDx }
  | { type: 'skip' }
  | { type: 'buff'; buff: BuffKind };

export interface Cell {
  x: number;
  y: number;
}

export interface MoveOption extends Cell {
  dx: MoveDx;
}

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}
