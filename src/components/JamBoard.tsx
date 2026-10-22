import { useEffect, useRef, useState, type ReactNode } from 'react';
import { JAM_PIECE_GLYPH, jamPieceMoves, type Cell, type JamState } from '../engine';
import { cn } from '../lib/format';

interface JamBoardProps {
  state: JamState;
  /** Фигура, у которой показываем клетки назначения. */
  selected: string | null;
  /** Клетка и фигура из подсказки: показываем отдельно от выбора. */
  hint: { id: string; to: Cell } | null;
  interactive: boolean;
  onPick: (id: string) => void;
  onPlace: (cell: Cell) => void;
}

const FRAME_PAD = 8;
const GAP = 2;

/**
 * Доска «Парковки»: те же клетки, что и в пешечных режимах, но фигур много,
 * и у них есть цвет. Белые идут наверх, чёрные вниз, свои не бьются.
 */
export function JamBoard({ state, selected, hint, interactive, onPick, onPlace }: JamBoardProps): ReactNode {
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

  const cols = state.width;
  const rows = state.height;
  const availableWidth = Math.max(0, box.width - FRAME_PAD * 2);
  const availableHeight = Math.max(0, box.height - FRAME_PAD * 2);
  const cell =
    availableWidth > 0 && availableHeight > 0
      ? Math.floor(Math.min((availableWidth - GAP * (cols - 1)) / cols, (availableHeight - GAP * (rows - 1)) / rows))
      : 0;
  const boardWidth = cell > 0 ? cell * cols + GAP * (cols - 1) : 0;
  const boardHeight = cell > 0 ? cell * rows + GAP * (rows - 1) : 0;

  const active = state.pieces.find((piece) => piece.id === selected);
  const targets = active && interactive ? jamPieceMoves(state, active) : [];
  const isTarget = (x: number, y: number) => targets.some((target) => target.x === x && target.y === y);

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
          className="board jam-board"
          style={{
            width: boardWidth || undefined,
            height: boardHeight || undefined,
            gap: GAP,
            fontSize: cell ? Math.round(cell * 0.62) : undefined,
            gridTemplateColumns: `repeat(${cols}, ${cell || 1}px)`,
            gridTemplateRows: `repeat(${rows}, ${cell || 1}px)`,
          }}
          role="grid"
          aria-label="Поле парковки"
        >
          {Array.from({ length: rows }).map((_, rowIndex) =>
            Array.from({ length: cols }).map((__, colIndex) => {
              const y = rows - 1 - rowIndex;
              const x = colIndex;
              const dark = (x + y) % 2 === 0;
              const piece = state.pieces.find((entry) => entry.x === x && entry.y === y);
              const target = isTarget(x, y);
              const parked = piece ? (piece.side === 'white' ? y >= state.mid : y < state.mid) : false;
              const hintHere = hint && hint.to.x === x && hint.to.y === y;
              const hintPiece = hint && piece && hint.id === piece.id;
              const fromLast = state.lastMove && state.lastMove.to.x === x && state.lastMove.to.y === y;

              return (
                <button
                  key={`${x}-${y}`}
                  type="button"
                  role="gridcell"
                  className={cn(
                    'cell',
                    dark ? 'cell-dark' : 'cell-light',
                    y >= state.mid ? 'cell-half-top' : 'cell-half-bottom',
                    target && interactive && 'cell-move',
                    parked && 'cell-parked',
                    fromLast && 'cell-flash',
                    hintHere && 'cell-hint',
                    hintPiece && 'cell-hint-source',
                  )}
                  style={{ width: cell || undefined, height: cell || undefined }}
                  disabled={!interactive || (!piece && !target)}
                  aria-label={
                    piece
                      ? `${piece.side === 'white' ? 'белая' : 'чёрная'} ${JAM_PIECE_GLYPH[piece.type]} ${piece.type === 'rook' ? 'ладья' : piece.type === 'bishop' ? 'слон' : 'конь'}, клетка ${x + 1}, ${y + 1}${parked ? ', на своей половине' : ', не на своей половине'}`
                      : target
                        ? `клетка ${x + 1}, ${y + 1}: сюда можно поставить фигуру`
                        : `клетка ${x + 1}, ${y + 1}`
                  }
                  onClick={() => {
                    if (!interactive) return;
                    if (target) {
                      onPlace({ x, y });
                      return;
                    }
                    if (piece) onPick(piece.id);
                  }}
                >
                  {hintHere && <span className="hint-no">1</span>}
                  {piece && (
                    <span
                      className={cn(
                        'piece',
                        'jam-piece',
                        piece.side === 'white' ? 'jam-white' : 'jam-black',
                        selected === piece.id && 'jam-selected',
                        parked && 'jam-parked',
                      )}
                    >
                      <span className="piece-glyph">{JAM_PIECE_GLYPH[piece.type]}</span>
                    </span>
                  )}
                </button>
              );
            }),
          )}
        </div>
      </div>
      {cell === 0 && <div className="board-placeholder" />}
    </div>
  );
}
