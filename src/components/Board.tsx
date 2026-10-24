import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ENDLESS_VIEW_ROWS,
  PIECE_GLYPH,
  RACE_WIDTH,
  endlessViewport,
  enemyAttacksCell,
  rulesFor,
  type Cell,
  type GameState,
  type MoveDx,
  type MoveDy,
  type MoveOption,
  type PieceType,
  type ResolvedSkin,
} from '../engine';
import { cn } from '../lib/format';

/**
 * Размер клетки держится с гистерезисом. Строка статуса и подпись цели
 * переставляют себя на букву-другую при каждом ходе («волна через 9» -> «10»,
 * «рекорд 3» -> «рекорд 12»), часть уезжает на вторую строку - и поле вместе с
 * ней сжимается на пиксель-два. На телефоне это выглядит как дрожание экрана на
 * каждый тап, хотя правилам высота поля не менялась ни на йоту. Новое значение
 * принимаем, только когда разница заметна (3 px на клетку - это полстроки
 * реального перероста) или когда изменилась ширина: на ширине держатся и рост
 * поля, и поворот экрана, и появление клавиатуры.
 */
export function stableCell(prev: { cell: number; width: number }, fit: number, width: number): number {
  // Первый кадр верится измерению целиком: поля ещё нет, прятать нечего.
  if (prev.cell <= 0) return fit;
  // Контейнер схлопнулся на миг (строка статуса разъехалась, открылась модалка):
  // прежнее поле лучше, чем пустота на полсекунды.
  if (fit <= 0) return prev.cell;
  if (Math.abs(width - prev.width) >= 1) return fit;
  return Math.abs(fit - prev.cell) >= 3 ? fit : prev.cell;
}

export interface MovedPiece {
  id: string;
  from: Cell;
  to: Cell;
}

/**
 * Фигура, которую на этом ходу унесло за нижний край. Её уже нет в состоянии,
 * поэтому она рисуется призраком поверх поля и съезжает с доски: без этого ряда
 * сход фигуры с поля не читается, фигура просто исчезает.
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
  /** Тема поля: цвета уже разложены на CSS-переменные экраном, здесь глиф и контур. */
  skin: ResolvedSkin;
  interactive: boolean;
  onMove: (dx: MoveDx, dy?: MoveDy) => void;
  turn: number;
  /** Куда переставились фигуры последним ходом: нужно для показа хода врага. */
  moved?: MovedPiece[];
  /** Фигуры, сошедшие с поля этим ходом: нужны, чтобы показать их уход. */
  swept?: SweptPiece[];
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
  /** Прежняя клетка и ширина: см. `stableCell`. */
  const sizeRef = useRef({ cell: 0, width: 0 });
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
  // Поле бесконечного режима поначалу короче окна, и если считать клетку по
  // текущим рядам, каждые пять клеток фигуры чуть подпрыгивают размером, а доска
  // вздрагивает. Размер держим по полному окну: рост читается как «поле стало
  // выше», а не как «всё увеличилось».
  const sizeRows = state.mode === 'endless' ? Math.max(rows, ENDLESS_VIEW_ROWS) : rows;
  const fit =
    availableWidth > 0 && availableHeight > 0
      ? Math.floor(
          Math.min(
            (availableWidth - gap * (sizeCols - 1)) / sizeCols,
            (availableHeight - gap * (sizeRows - 1)) / sizeRows,
          ),
        )
      : 0;
  const cell = stableCell(sizeRef.current, fit, box.width);
  sizeRef.current = { cell, width: box.width };
  const boardWidth = cell > 0 ? cell * cols + gap * (cols - 1) : 0;
  const boardHeight = cell > 0 ? cell * rows + gap * (rows - 1) : 0;

  // Уход фигуры с поля показывается движением, а не линиями: пришедшая фигура
  // въезжает сверху, сошедшая съезжает за нижний край. Полосу притока раньше
  // обводили рамкой - игрок читал её как случайные линии поля, и ничего больше.
  const ghosts = cell > 0;

  // Короля своей фигурой не заменяем: и в «Гонках», и в бесконечном режиме он
  // читается по силуэту, и чужой контур вместо него ломает правило «я король».
  const playerGlyph = king ? '♚' : skin.glyph || '♟';
  const playerPath = king ? undefined : skin.path;
  const playerSlide =
    playerBefore !== null && (playerBefore.x !== state.player.x || playerBefore.y !== state.player.y)
      ? playerBefore
      : null;

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
                    // Выпад через линию: клетка бьётся, но король на неё не встаёт.
                    move?.strike && 'cell-strike',
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
                      ? move?.strike
                        ? `Клетка ${x + 1}, ${y + 1}: выпад через линию, взять фигуру и остаться на месте`
                        : move?.takes
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
                  {move && interactive && !move.strike && (
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
                      key={`player-${x}-${y}`}
                      className={cn('piece player-piece', `skin-${skin}`, playerSlide && 'player-slide')}
                      style={
                        playerSlide
                          ? ({
                              '--from-x': `${(playerSlide.x - state.player.x) * (cell + gap)}px`,
                              '--from-y': `${(playerSlide.y - state.player.y) * (cell + gap)}px`,
                            } as CSSProperties)
                          : undefined
                      }
                    >
                      <span className={cn('player-mark', playerPath && 'player-mark-shape')}>
                        {playerPath ? (
                          <svg className="player-shape" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                            <path d={playerPath} />
                          </svg>
                        ) : (
                          <span className="player-glyph">{playerGlyph}</span>
                        )}
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
          {/* Граница полосы игрока: за неё король не выходит. Линия именно
              правило, а не декор, поэтому она тонкая, красная и пунктирная. */}
          {rules.kingRows > 0 && cell > 0 && viewport.from < rules.kingRows ? (
            <div
              className="board-bandline"
              aria-hidden="true"
              style={{
                bottom:
                  (rules.kingRows - viewport.from) * cell + (rules.kingRows - 1 - viewport.from) * gap,
              }}
            />
          ) : null}
        </div>
          {ghosts && swept.length > 0 && (
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
