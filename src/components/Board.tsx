import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  PIECE_GLYPH,
  SKINS,
  endlessViewport,
  rulesFor,
  type Cell,
  type GameState,
  type MoveDx,
  type MoveOption,
  type SkinId,
} from '../engine';
import { cn } from '../lib/format';

export interface MovedPiece {
  id: string;
  from: Cell;
  to: Cell;
}

interface BoardProps {
  state: GameState;
  moves: MoveOption[];
  hint: Cell[];
  skin: SkinId;
  interactive: boolean;
  onMove: (dx: MoveDx, dy?: 0 | 1 | 2) => void;
  turn: number;
  /** Куда переставились фигуры последним ходом: нужно для показа хода врага. */
  moved?: MovedPiece[];
  /** Идёт ход фигур, ввод заблокирован. */
  settling?: boolean;
}

const FRAME_PAD = 8;
const MOVE_GLYPH: Record<MoveDx, string> = { [-1]: '↖', [0]: '↑', [1]: '↗' };

export function Board({ state, moves, hint, skin, interactive, onMove, turn, moved = [], settling = false }: BoardProps): ReactNode {
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
  // Приколотый ряд «Гонок»: его подсвечиваем, а верхний ряд тогда не финиш.
  const pinned = rulesFor(state.mode).pinned === true;
  const cols = state.width;
  const rows = viewport.to - viewport.from;
  const gap = 2;
  const availableWidth = Math.max(0, box.width - FRAME_PAD * 2);
  const availableHeight = Math.max(0, box.height - FRAME_PAD * 2);
  const cell =
    availableWidth > 0 && availableHeight > 0
      ? Math.floor(
          Math.min(
            (availableWidth - gap * (cols - 1)) / cols,
            (availableHeight - gap * (rows - 1)) / rows,
          ),
        )
      : 0;
  const boardWidth = cell > 0 ? cell * cols + gap * (cols - 1) : 0;
  const boardHeight = cell > 0 ? cell * rows + gap * (rows - 1) : 0;

  const playerGlyph = SKINS[skin]?.pawn ?? '♟';

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
              const isFinish = !pinned && state.mode !== 'endless' && y === state.height - 1;
              const pinRow = pinned && y === state.player.y;
              const lane = pinned && !isPlayer && state.enemies.some((enemy) => enemy.x === x && enemy.y > y);
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
                    pinRow && 'cell-pin',
                    lane && 'cell-lane',
                    move && interactive && 'cell-move',
                    move?.takes && 'cell-take',
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
                        ? `Клетка ${x + 1}, ${y + 1}: ваша пешка`
                        : `Клетка ${x + 1}, ${y + 1}`
                  }
                >
                  {hintIndex >= 0 && <span className="hint-no">{hintIndex + 1}</span>}
                  {move && interactive && (
                    <span className="move-glyph" aria-hidden="true">
                      {MOVE_GLYPH[move.dx]}
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
                    <span key={`player-${x}-${y}`} className={cn('piece player-piece', `skin-${skin}`)}>
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
      </div>
      {settling && <div className="board-turn-flag">ход фигур</div>}
      {cell === 0 && <div className="board-placeholder" />}
    </div>
  );
}
