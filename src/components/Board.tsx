import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  PIECE_GLYPH,
  RACE_WIDTH,
  SKINS,
  endlessViewport,
  enemyAttacksCell,
  rulesFor,
  type Cell,
  type GameState,
  type MoveDx,
  type MoveDy,
  type MoveOption,
  type PieceType,
  type SkinId,
} from '../engine';
import { cn } from '../lib/format';

export interface MovedPiece {
  id: string;
  from: Cell;
  to: Cell;
}

/**
 * Фигура, которую на этом ходу унесло за нижний край. Её уже нет в состоянии,
 * поэтому она рисуется призраком поверх поля и съезжает с доски: без этого ряда
 * конвейер не читается, фигуры просто исчезают.
 */
export interface SweptPiece {
  id: string;
  type: PieceType;
  x: number;
  y: number;
}

interface BoardProps {
  state: GameState;
  moves: MoveOption[];
  hint: Cell[];
  skin: SkinId;
  interactive: boolean;
  onMove: (dx: MoveDx, dy?: MoveDy) => void;
  turn: number;
  /** Куда переставились фигуры последним ходом: нужно для показа хода врага. */
  moved?: MovedPiece[];
  /** Фигуры, унесенные рядом: нужны, чтобы показать уход ряда. */
  swept?: SweptPiece[];
  /**
   * Куда игрок хотел сходить этим ходом. Если клетка не изменилась, значит поле
   * приехало под него (конвейер), и шаг показывается импульсом.
   */
  playerStep?: { moves: number; dx: number; dy: number } | null;
  /** Идёт ход фигур, ввод заблокирован. */
  settling?: boolean;
}

const FRAME_PAD = 8;
const MOVE_GLYPH: Record<MoveDx, string> = { [-1]: '↖', [0]: '↑', [1]: '↗' };
/** Король ходит во все стороны, поэтому знак зависит и от ряда, и от колонки. */
const KING_GLYPH: Record<string, string> = {
  '-1:1': '↖',
  '0:1': '↑',
  '1:1': '↗',
  '-1:0': '←',
  '1:0': '→',
  '-1:-1': '↙',
  '0:-1': '↓',
  '1:-1': '↘',
};

export function Board({
  state,
  moves,
  hint,
  skin,
  interactive,
  onMove,
  turn,
  moved = [],
  swept = [],
  playerStep = null,
  settling = false,
}: BoardProps): ReactNode {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const viewport = useMemo(
    () => (state.mode === 'endless' ? endlessViewport(state) : { from: 0, to: state.height }),
    [state],
  );
  const rules = rulesFor(state.mode);
  /** Игрок королём: вокруг него восемь направлений, и риск считается по клеткам. */
  const king = rules.player === 'king';
  /** Приток есть: новые фигуры должны въезжать на поле, а не проступать. */
  const spawning = rules.spawnPerTurn > 0 || rules.spawnRate !== undefined;
  const seenRef = useRef<Set<string>>(new Set());
  const seen = seenRef.current;
  // Прежнее положение игрока: ход должен читаться как перестановка, а не
  // перескок, иначе на быстром темпе непонятно, откуда ты ушёл.
  const playerBeforeRef = useRef<Cell | null>(null);
  const playerBefore = playerBeforeRef.current;
  useEffect(() => {
    seenRef.current = new Set(state.enemies.map((enemy) => enemy.id));
  }, [state.enemies]);
  useEffect(() => {
    playerBeforeRef.current = { ...state.player };
  }, [state.player]);

  const cols = state.width;
  const rows = viewport.to - viewport.from;
  const gap = 2;
  const availableWidth = Math.max(0, box.width - FRAME_PAD * 2);
  const availableHeight = Math.max(0, box.height - FRAME_PAD * 2);
  // Растущее поле держит размер клетки по полной ширине доски, а не по текущей:
  // иначе каждая добавленная колонка пересчитывала бы клетки, и рост читался бы
  // как «доска съехала», а не как «поле стало шире».
  const sizeCols = rules.grow ? Math.max(cols, RACE_WIDTH) : cols;
  const cell =
    availableWidth > 0 && availableHeight > 0
      ? Math.floor(
          Math.min(
            (availableWidth - gap * (sizeCols - 1)) / sizeCols,
            (availableHeight - gap * (rows - 1)) / rows,
          ),
        )
      : 0;
  const boardWidth = cell > 0 ? cell * cols + gap * (cols - 1) : 0;
  const boardHeight = cell > 0 ? cell * rows + gap * (rows - 1) : 0;

  // Бегущее поле показывается движением, а не линиями: приходящие фигуры
  // въезжают сверху, уходящий ряд съезжает за край. Полосу притока раньше
  // обводили рамкой - игрок читал её как случайные линии поля, и ничего больше.
  const flow = Boolean(rules.scroll) && cell > 0;

  const playerGlyph = king ? '♚' : (SKINS[skin]?.pawn ?? '♟');
  const playerSlide =
    playerBefore !== null && (playerBefore.x !== state.player.x || playerBefore.y !== state.player.y)
      ? playerBefore
      : null;
  // Конвейер: игрок сходил вперёд, поле приехало на ряд ближе, король вернулся на
  // свою клетку. Без импульса такой ход выглядит бездействием.
  const playerPulse =
    flow &&
    playerStep !== null &&
    playerStep.moves === state.moves &&
    playerBefore !== null &&
    playerBefore.x === state.player.x &&
    playerBefore.y === state.player.y;

  return (
    <div className="board-measure" ref={wrapRef}>
      <div
        className={cn('board-frame', state.status === 'lost' && 'board-lost')}
        style={{
          width: boardWidth > 0 ? boardWidth + FRAME_PAD * 2 : undefined,
          height: boardHeight > 0 ? boardHeight + FRAME_PAD * 2 : undefined,
          opacity: cell > 0 ? 1 : 0,
        }}
      >
        <div
          className="board"
          style={{
            width: boardWidth || undefined,
            height: boardHeight || undefined,
            gap,
            position: 'relative',
            fontSize: cell ? Math.round(cell * 0.56) : undefined,
            gridTemplateColumns: `repeat(${cols}, ${cell || 1}px)`,
            gridTemplateRows: `repeat(${rows}, ${cell || 1}px)`,
          }}
          role="grid"
          aria-label="Игровое поле"
        >
          {Array.from({ length: rows }).map((_, rowIndex) =>
            Array.from({ length: cols }).map((__, colIndex) => {
              const y = viewport.to - 1 - rowIndex;
              const x = colIndex;
              const dark = (x + y) % 2 === 0;
              const enemy = state.enemies.find((e) => e.x === x && e.y === y);
              const isPlayer = state.player.x === x && state.player.y === y;
              const move = moves.find((m) => m.x === x && m.y === y);
              const arrived = moved.find((m) => m.to.x === x && m.to.y === y);
              const leftCell = moved.find((m) => m.from.x === x && m.from.y === y);
              const flash = state.lastCapture && state.lastCapture.x === x && state.lastCapture.y === y;
              const hintIndex = hint.findIndex((h) => h.x === x && h.y === y);
              const isFinish = state.mode !== 'endless' && rules.goal === 'top' && y === state.height - 1;
              // Клетка, куда король встанет под бой: подсветка нужна, потому что
              // «безопасно ли» игрок по одним только фигурам не сосчитает.
              const risk =
                king &&
                Boolean(move) &&
                !move?.takes &&
                state.enemies.some((other) => enemyAttacksCell(state, other, x, y));
              const captured = state.status === 'lost' && isPlayer;

              return (
                <button
                  key={`${x}-${y}`}
                  type="button"
                  role="gridcell"
                  className={cn(
                    'cell',
                    dark ? 'cell-dark' : 'cell-light',
                    isFinish && 'cell-finish',
                    move && interactive && 'cell-move',
                    move?.takes && 'cell-take',
                    risk && 'cell-risk',
                    flash && 'cell-flash',
                    leftCell && 'cell-left',
                    hintIndex >= 0 && 'cell-hint',
                    hintIndex === 1 && 'cell-hint-2',
                    captured && 'cell-captured',
                  )}
                  style={{ width: cell || undefined, height: cell || undefined }}
                  onClick={() => {
                    if (move && interactive) onMove(move.dx, move.dy ?? 1);
                  }}
                  disabled={!move || !interactive}
                  aria-label={
                    enemy
                      ? move?.takes
                        ? `Клетка ${x + 1}, ${y + 1}: взять вражескую фигуру`
                        : `Клетка ${x + 1}, ${y + 1}: вражеская фигура`
                      : isPlayer
                        ? `Клетка ${x + 1}, ${y + 1}: ваш король`
                        : move
                          ? `Клетка ${x + 1}, ${y + 1}: ход${risk ? ', под боем' : ''}`
                          : `Клетка ${x + 1}, ${y + 1}`
                  }
                >
                  {hintIndex >= 0 && <span className="hint-no">{hintIndex + 1}</span>}
                  {move && interactive && (
                    <span className="move-glyph" aria-hidden="true">
                      {king ? (KING_GLYPH[`${move.dx}:${move.dy ?? 1}`] ?? MOVE_GLYPH[move.dx]) : MOVE_GLYPH[move.dx]}
                    </span>
                  )}
                  {enemy && (
                    <span
                      key={`${enemy.id}-${turn}`}
                      className={cn(
                        'piece enemy-piece',
                        `enemy-${enemy.type}`,
                        state.freeze > 0 && 'enemy-iced',
                        arrived && 'enemy-moved',
                        spawning && state.moves > 0 && !seen.has(enemy.id) && 'piece-spawn',
                      )}
                      style={
                        arrived
                          ? ({
                              '--from-x': `${(arrived.from.x - arrived.to.x) * (cell + gap)}px`,
                              '--from-y': `${(arrived.from.y - arrived.to.y) * (cell + gap)}px`,
                            } as CSSProperties)
                          : undefined
                      }
                    >
                      <span className="piece-glyph">{PIECE_GLYPH[enemy.type]}</span>
                      {state.freeze > 0 && (
                        <span className="enemy-status" aria-hidden="true">
                          лёд
                        </span>
                      )}
                    </span>
                  )}
                  {isPlayer && (
                    <span
                      key={`player-${x}-${y}-${playerPulse ? state.moves : 0}`}
                      className={cn(
                        'piece player-piece',
                        `skin-${skin}`,
                        playerSlide && 'player-slide',
                        playerPulse && 'player-pulse',
                      )}
                      style={
                        playerPulse
                          ? ({
                              '--to-x': `${(playerStep?.dx ?? 0) * (cell + gap)}px`,
                              '--to-y': `${-(playerStep?.dy ?? 0) * (cell + gap)}px`,
                            } as CSSProperties)
                          : playerSlide
                            ? ({
                                '--from-x': `${(playerSlide.x - state.player.x) * (cell + gap)}px`,
                                '--from-y': `${(playerSlide.y - state.player.y) * (cell + gap)}px`,
                              } as CSSProperties)
                            : undefined
                      }
                    >
                      <span className="player-mark">
                        <span className="player-glyph">{playerGlyph}</span>
                      </span>
                      {state.shield > 0 && (
                        <span className="player-badge" aria-hidden="true">
                          щ{state.shield}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            }),
          )}
        </div>
          {flow && swept.length > 0 && (
            <div className="board-ghosts" aria-hidden="true">
              {swept.map((piece) => (
                <span
                  key={`${piece.id}-${turn}`}
                  className="piece enemy-piece piece-swept"
                  style={{
                    left: piece.x * (cell + gap),
                    top: (viewport.to - 1 - piece.y) * (cell + gap),
                    width: cell,
                    height: cell,
                    fontSize: Math.round(cell * 0.56),
                  }}
                >
                  <span className="piece-glyph">{PIECE_GLYPH[piece.type]}</span>
                </span>
              ))}
            </div>
          )}
      </div>
      {settling && <div className="board-turn-flag">{king ? 'фигуры идут' : 'ход фигур'}</div>}
      {cell === 0 && <div className="board-placeholder" />}
    </div>
  );
}
