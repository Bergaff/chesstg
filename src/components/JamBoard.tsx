import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  JAM_PIECE_GLYPH,
  jamExitCells,
  jamExitRow,
  jamPieceMoves,
  type Cell,
  type JamState,
} from '../engine';
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
/** Полоса ухода: столько же клеток, сколько рядов поля, но ниже. */
const LANE_HEIGHT = 22;

/**
 * Доска «Парковки»: те же клетки, что и в пешечных режимах, но фигур много,
 * и у них есть цвет. Сверху и снизу поля - полосы ухода: чёрные уходят за
 * верхний край, белые за нижний. Полосы рисуются всегда, иначе поле прыгало бы
 * при каждом выборе фигуры.
 */
export function JamBoard({ state, selected, hint, interactive, onPick, onPlace }: JamBoardProps): ReactNode {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height - LANE_HEIGHT * 2 });
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
  const exits = active && interactive ? jamExitCells(state, active) : [];
  const ready = new Set(
    interactive ? state.pieces.filter((piece) => jamExitCells(state, piece).length > 0).map((piece) => piece.id) : [],
  );
  const isTarget = (x: number, y: number) => targets.some((target) => target.x === x && target.y === y);
  const laneOpen = (side: 'white' | 'black', x: number) =>
    exits.some((exit) => exit.x === x && exit.y === jamExitRow(state, side));

  const lane = (side: 'white' | 'black') => {
    const y = jamExitRow(state, side);
    return (
      <div className="jam-lane" style={{ height: LANE_HEIGHT, gap: GAP }}>
        {Array.from({ length: cols }).map((_, colIndex) => {
          const open = laneOpen(side, colIndex);
          // Подсказка вполне может сказать «уводи»: тогда отметка стоит на
          // полосе, а не на клетке поля.
          const hintHere = hint !== null && hint.to.y === y && hint.to.x === colIndex;
          return (
            <button
              key={`${side}-${colIndex}`}
              type="button"
              className={cn('jam-lane-cell', open && 'is-open', hintHere && 'cell-hint')}
              style={{ width: cell || undefined, height: LANE_HEIGHT }}
              disabled={!open}
              aria-label={
                open
                  ? `увести фигуру ${side === 'white' ? 'за нижний' : 'за верхний'} край, колонка ${colIndex + 1}`
                  : `полоса ухода, колонка ${colIndex + 1}: сейчас здесь уходить нечему`
              }
              onClick={() => {
                if (open && active) onPlace({ x: colIndex, y });
              }}
            >
              {hintHere && <span className="hint-no">1</span>}
              <span className="jam-lane-mark" aria-hidden="true">
                {side === 'white' ? '↓' : '↑'}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="board-measure" ref={wrapRef}>
      <div
        className={cn('board-frame', 'jam-frame', state.status === 'lost' && 'board-lost')}
        style={{
          width: boardWidth > 0 ? boardWidth + FRAME_PAD * 2 : undefined,
          height: boardHeight > 0 ? boardHeight + FRAME_PAD * 2 + LANE_HEIGHT * 2 : undefined,
          opacity: cell > 0 ? 1 : 0,
        }}
      >
        {lane('black')}
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
              const canExit = piece ? ready.has(piece.id) : false;
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
                    piece?.side === 'white' ? 'cell-half-bottom' : 'cell-half-top',
                    target && interactive && 'cell-move',
                    fromLast && 'cell-flash',
                    hintHere && 'cell-hint',
                    hintPiece && 'cell-hint-source',
                  )}
                  style={{ width: cell || undefined, height: cell || undefined }}
                  disabled={!interactive || (!piece && !target)}
                  aria-label={
                    piece
                      ? `${piece.side === 'white' ? 'белая' : 'чёрная'} ${
                          piece.type === 'rook' ? 'ладья' : piece.type === 'bishop' ? 'слон' : 'конь'
                        }, клетка ${x + 1}, ${y + 1}${canExit ? ', может уйти с поля' : ''}`
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
                        canExit && 'jam-ready',
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
        {lane('white')}
      </div>
      {cell === 0 && <div className="board-placeholder" />}
    </div>
  );
}
