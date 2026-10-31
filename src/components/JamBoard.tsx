import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  JAM_PIECE_GLYPH,
  JAM_PIECE_NAME,
  jamAtEdge,
  jamExitMoves,
  jamIsExit,
  jamPieceMoves,
  type Cell,
  type JamState,
} from '../engine';
import { cn } from '../lib/format';
import { tr, trf } from '../lib/i18n';

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

/** См. `Board.tsx`: поле и рамка - один размер, пиксель держим под линию рамки. */
const FRAME_PAD = 1;
const GAP = 2;

/**
 * Доска «Парковки»: те же клетки, что и в пешечных режимах, но фигур много, и у
 * них есть цвет. Отдельных полос ухода нет: фигура уходит тем же ходом, каким
 * просто встала бы на свой край, поэтому крайние ряды подкрашены, а клетки
 * выхода помечены стрелкой.
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
  const exits = active && interactive ? jamExitMoves(state, active) : [];
  const ready = new Set(
    interactive ? state.pieces.filter((piece) => jamAtEdge(state, piece)).map((piece) => piece.id) : [],
  );
  const isTarget = (x: number, y: number) => targets.some((target) => target.x === x && target.y === y);
  const isExit = (x: number, y: number) => exits.some((exit) => exit.x === x && exit.y === y);
  const exitRow = (y: number) => (y === 0 ? 'white' : y === rows - 1 ? 'black' : null);

  return (
    <div className="board-measure" ref={wrapRef}>
      <div
        className={cn('board-frame', 'jam-frame', state.status === 'lost' && 'board-lost')}
        style={{
          width: boardWidth > 0 ? boardWidth + FRAME_PAD * 2 : undefined,
          height: boardHeight > 0 ? boardHeight + FRAME_PAD * 2 : undefined,
          opacity: cell > 0 ? 1 : 0,
        }}
      >
        <div
          className="board jam-board"
          style={{
            gap: GAP,
            fontSize: cell ? Math.round(cell * 0.6) : undefined,
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
          role="grid"
          aria-label={tr('Поле парковки')}
        >
          {Array.from({ length: rows }).map((_, rowIndex) =>
            Array.from({ length: cols }).map((__, colIndex) => {
              const y = rows - 1 - rowIndex;
              const x = colIndex;
              const dark = (x + y) % 2 === 0;
              const piece = state.pieces.find((entry) => entry.x === x && entry.y === y);
              const target = isTarget(x, y);
              const exitHere = isExit(x, y);
              const side = exitRow(y);
              const canExit = piece ? ready.has(piece.id) : false;
              const hintHere = hint && hint.to.x === x && hint.to.y === y;
              const hintPiece = hint && piece && hint.id === piece.id;
              const fromLast = state.lastMove && state.lastMove.to.x === x && state.lastMove.to.y === y;
              const leftHere = fromLast && state.lastEvent === 'exit';

              return (
                <button
                  key={`${x}-${y}`}
                  type="button"
                  role="gridcell"
                  className={cn(
                    'cell',
                    dark ? 'cell-dark' : 'cell-light',
                    side === 'white' && 'cell-edge-bottom',
                    side === 'black' && 'cell-edge-top',
                    target && interactive && 'cell-move',
                    exitHere && 'cell-exit',
                    fromLast && 'cell-flash',
                    hintHere && 'cell-hint',
                    hintPiece && 'cell-hint-source',
                  )}
                  disabled={!interactive || (!piece && !target)}
                  aria-label={
                    piece
                      ? trf(
                          tr('{0} {1}, клетка {2}, {3}{4}'),
                          [
                            piece.side === 'white' ? tr('белая') : tr('чёрная'),
                            JAM_PIECE_NAME[piece.type].toLowerCase(),
                            x + 1,
                            y + 1,
                            canExit ? tr(', может уйти с поля') : '',
                          ],
                        )
                      : exitHere
                        ? trf('клетка {0}, {1}: сюда встанет край, фигура уйдёт с поля', [x + 1, y + 1])
                        : target
                          ? trf('клетка {0}, {1}: сюда можно поставить фигуру', [x + 1, y + 1])
                          : leftHere
                            ? trf('клетка {0}, {1}: отсюда фигура ушла', [x + 1, y + 1])
                            : trf('клетка {0}, {1}', [x + 1, y + 1])
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
                  {exitHere && (
                    <span className="exit-mark" aria-hidden="true">
                      {active && jamIsExit(state, active, { x, y }) ? (active.side === 'white' ? '↓' : '↑') : ''}
                    </span>
                  )}
                  {leftHere && (
                    <span className="left-mark" aria-hidden="true">
                      ↧
                    </span>
                  )}
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
                      <span className="jam-side-mark" aria-hidden="true">
                        {piece.side === 'white' ? '↓' : '↑'}
                      </span>
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
