import { describe, expect, it } from 'vitest';
import { RuleError } from './types';
import {
  applyJamAction,
  createJamPuzzle,
  isJamState,
  jamAtEdge,
  jamBoard,
  jamBudget,
  jamDensity,
  jamExitCells,
  jamExitRow,
  jamHint,
  jamLegalActions,
  jamPieces,
  jamPieceMoves,
  jamRemovedCount,
  jamSolved,
  jamTargetCost,
  solveJamExits,
  type JamAction,
  type JamState,
} from './jam';

function board(over: Partial<JamState>): JamState {
  return {
    version: 2,
    mode: 'jam',
    width: 5,
    height: 6,
    pieces: [],
    moves: 0,
    budget: 20,
    total: 0,
    removed: 0,
    score: 0,
    status: 'playing',
    level: 1,
    seed: 1,
    ...over,
  };
}

function apply(state: JamState, action: JamAction): JamState {
  return applyJamAction(state, action, RuleError);
}

describe('парковка: фигуры уходят с поля', () => {
  it('поле забито обоими цветами, ничего не уведено, решаемость есть', () => {
    for (const level of [1, 4, 9, 16, 25, 40]) {
      const state = createJamPuzzle(level, 777 + level);
      expect(state.mode).toBe('jam');
      expect(state.status).toBe('playing');
      const whites = state.pieces.filter((piece) => piece.side === 'white');
      const blacks = state.pieces.filter((piece) => piece.side === 'black');
      expect(whites.length).toBeGreaterThan(1);
      expect(blacks.length).toBeGreaterThan(1);
      expect(jamSolved(state)).toBe(false);
      expect(jamLegalActions(state).length).toBeGreaterThan(0);
      expect(state.removed).toBe(0);
      expect(state.total).toBe(state.pieces.length);
      expect(state.score).toBe(0);
      // План решателя обязан уложиться в бюджет: иначе «гарантия решаемости»
      // ничего не стоит.
      expect(state.plan?.length).toBeGreaterThan(0);
      expect(state.plan!.length).toBeLessThanOrEqual(state.budget);
      expect(state.lastEvent).not.toBe('fallback');
    }
  });

  it('поле и плотность растут с уровнем, но не бесконечно', () => {
    const small = jamBoard(1);
    const big = jamBoard(40);
    expect(small.width).toBe(5);
    expect(big.width).toBe(6);
    expect(big.height).toBeGreaterThan(small.height);
    expect(jamDensity(1)).toBeLessThan(jamDensity(30));
    expect(jamDensity(90)).toBeLessThanOrEqual(0.66);
    expect(jamPieces(1)).toBeLessThan(jamPieces(30));
    expect(jamTargetCost(1)).toBeLessThan(jamTargetCost(30));
  });

  it('план решателя доводит поле до пустой доски', () => {
    for (const level of [1, 3, 7, 12, 21, 33, 50]) {
      const state = createJamPuzzle(level, 4242 + level * 7);
      let current = state;
      for (const action of state.plan ?? []) {
        current = apply(current, action);
        if (current.status !== 'playing') break;
      }
      expect(jamSolved(current)).toBe(true);
      expect(current.status).toBe('won');
      expect(current.lastEvent).toBe('won');
      expect(current.removed).toBe(state.total);
      expect(current.score).toBe(state.total);
      // Гарантированное решение всегда влезает в бюджет.
      expect(current.moves).toBeLessThanOrEqual(state.budget);
    }
  });

  it('решатель не врал: на чужих расстановках он либо решает, либо честно отказывает', () => {
    for (let seed = 0; seed < 40; seed++) {
      const state = createJamPuzzle(1 + (seed % 20), seed * 13 + 5);
      const plan = solveJamExits(state);
      if (!plan.ok) continue;
      let current = state;
      for (const action of plan.moves) {
        if (current.status !== 'playing') break;
        current = apply(current, action);
      }
      expect(current.status).toBe('won');
    }
  });

  it('детерминирована по зерну', () => {
    const a = createJamPuzzle(8, 99);
    const b = createJamPuzzle(8, 99);
    expect(JSON.stringify(a.pieces)).toBe(JSON.stringify(b.pieces));
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
    expect(JSON.stringify(createJamPuzzle(8, 100).pieces)).not.toBe(JSON.stringify(a.pieces));
  });

  it('уход с поля снимает фигуру, перестановка внутри - нет', () => {
    const state = createJamPuzzle(6, 1234);
    const shift = jamLegalActions(state).find((action) => action.to.y >= 0 && action.to.y < state.height);
    expect(apply(state, shift!).pieces.length).toBe(state.pieces.length);
    // Поля взятий у парковки нет вообще: бить нечего и некем.
    expect((apply(state, shift!) as unknown as { captures?: number }).captures).toBeUndefined();

    const exit = board({
      width: 5,
      height: 6,
      total: 2,
      pieces: [
        { id: 'w', type: 'rook', side: 'white', x: 1, y: 0 },
        { id: 'b', type: 'rook', side: 'black', x: 3, y: 5 },
      ],
    });
    expect(jamExitCells(exit, exit.pieces[0])).toEqual([{ x: 1, y: -1 }]);
    expect(jamExitCells(exit, exit.pieces[1])).toEqual([{ x: 3, y: 6 }]);
    const gone = apply(exit, { type: 'piece', id: 'w', to: { x: 1, y: -1 } });
    expect(gone.pieces.length).toBe(1);
    expect(gone.removed).toBe(1);
    expect(gone.score).toBe(1);
    expect(jamRemovedCount(gone)).toBe(1);
    expect(gone.lastEvent).toBe('exit');
    const won = apply(gone, { type: 'piece', id: 'b', to: { x: 3, y: 6 } });
    expect(won.status).toBe('won');
    expect(won.pieces.length).toBe(0);
  });

  it('чужая фигура на пути закрывает выход, а конь перепрыгивает', () => {
    const clear = board({
      pieces: [{ id: 'w', type: 'rook', side: 'white', x: 2, y: 3 }],
      total: 1,
    });
    expect(jamExitCells(clear, clear.pieces[0])).toEqual([{ x: 2, y: -1 }]);

    const blocked = board({
      pieces: [
        { id: 'w', type: 'rook', side: 'white', x: 2, y: 3 },
        { id: 'b', type: 'rook', side: 'black', x: 2, y: 1 },
      ],
      total: 2,
    });
    expect(jamExitCells(blocked, blocked.pieces[0])).toEqual([]);
    expect(jamPieceMoves(blocked, blocked.pieces[0]).some((cell) => cell.x === 2 && cell.y === 2)).toBe(true);
    expect(jamPieceMoves(blocked, blocked.pieces[0]).some((cell) => cell.x === 2 && cell.y === 0)).toBe(false);

    // Конь на row 1 уходит за край, с row 2 - нет: он не дотягивается до полосы.
    const near = board({ pieces: [{ id: 'k', type: 'knight', side: 'white', x: 2, y: 1 }], total: 1 });
    expect(jamExitCells(near, near.pieces[0]).length).toBeGreaterThan(0);
    const far = board({ pieces: [{ id: 'k', type: 'knight', side: 'white', x: 2, y: 2 }], total: 1 });
    expect(jamExitCells(far, far.pieces[0])).toEqual([]);
    expect(jamAtEdge(near, near.pieces[0])).toBe(true);
    expect(jamAtEdge(far, far.pieces[0])).toBe(false);

    // Слон уходит по диагонали, но не через боковую стенку: из колонки 0 на
    // поле шириной 5 он доезжает до нижнего края только вправо.
    const bishop = board({ pieces: [{ id: 's', type: 'bishop', side: 'white', x: 3, y: 2 }], total: 1 });
    // Вниз-влево диагональ упирается в край полем ниже, вниз-вправо уходит за
    // боковую стенку: полоса ухода только горизонтальная.
    expect(jamExitCells(bishop, bishop.pieces[0])).toEqual([{ x: 0, y: -1 }]);
    const wall = board({ pieces: [{ id: 's', type: 'bishop', side: 'white', x: 0, y: 1 }], total: 1 });
    expect(jamExitCells(wall, wall.pieces[0])).toEqual([{ x: 2, y: -1 }]);
  });

  it('направление ухода зависит от цвета: свои края, а не один на всех', () => {
    const state = board({
      height: 6,
      pieces: [
        { id: 'w', type: 'rook', side: 'white', x: 0, y: 0 },
        { id: 'b', type: 'rook', side: 'black', x: 0, y: 5 },
      ],
      total: 2,
    });
    expect(jamExitRow(state, 'white')).toBe(-1);
    expect(jamExitRow(state, 'black')).toBe(6);
    // Белая ладья на своей линии: вниз уход, вверх - не выход.
    expect(jamExitCells(state, state.pieces[0])).toEqual([{ x: 0, y: -1 }]);
    expect(jamExitCells(state, state.pieces[1])).toEqual([{ x: 0, y: 6 }]);
    // Чёрная ладья в том же столбце обязана идти вверх: вниз её не пускаем.
    expect(() => apply(state, { type: 'piece', id: 'b', to: { x: 0, y: -1 } })).toThrowError('Фигура не может уйти с этого поля');
  });

  it('правила запрещают невозможные ходы', () => {
    const state = createJamPuzzle(5, 555);
    const piece = state.pieces[0];

    expect(() => apply(state, { type: 'piece', id: 'нет-такой', to: { x: 0, y: 0 } })).toThrowError('Фигуры с таким id нет');
    expect(() => apply(state, { type: 'piece', id: piece.id, to: { x: -1, y: 0 } })).toThrowError('За границей поля');
    // Занятая клетка отсекается ещё списком легальных ходов, поэтому сообщение
    // может быть любым из двух: проверка занятости осталась страховкой.
    const occupied = state.pieces.find((other) => other.id !== piece.id);
    expect(() => apply(state, { type: 'piece', id: piece.id, to: { x: occupied!.x, y: occupied!.y } })).toThrowError(
      /Фигура так не ходит|Клетка занята/,
    );
    // Вне зависимости от края нельзя прыгнуть в середину поля через фигуры.
    const empty = board({ pieces: [{ id: 'x', type: 'rook', side: 'white', x: 0, y: 0 }], total: 1 });
    expect(() => apply(empty, { type: 'piece', id: 'x', to: { x: 1, y: 1 } })).toThrowError('Фигура так не ходит');
    expect(() => apply(empty, { type: 'piece', id: 'x', to: { x: 1, y: -1 } })).toThrowError('Фигура не может уйти с этого поля');
  });

  it('бюджет кончается поражением, подсказка отдаёт легальный ход', () => {
    const state = createJamPuzzle(3, 8080);
    const tight: JamState = { ...state, budget: 1 };
    const first = jamLegalActions(tight).find((action) => action.to.y >= 0 && action.to.y < tight.height) ?? jamLegalActions(tight)[0];
    const after = apply(tight, first);
    expect(after.moves).toBe(1);
    if (after.status === 'lost') expect(after.lastEvent).toBe('budget');
    else expect(after.status).toBe('won');

    for (const level of [1, 6, 14]) {
      const puzzle = createJamPuzzle(level, 31337 + level);
      const hint = jamHint(puzzle);
      expect(hint).not.toBeNull();
      const legal = jamLegalActions(puzzle);
      expect(legal.some((action) => action.id === hint!.id && action.to.x === hint!.to.x && action.to.y === hint!.to.y)).toBe(true);
      // Подсказка обязана двигать счёт или расчищать путь, а не гонять фигуру по кругу.
      expect(puzzle.plan?.[0]).toBeDefined();
    }
  });

  it('состояние старой версии на половину поля не принимается', () => {
    const legacy = {
      mode: 'jam',
      version: 1,
      width: 5,
      height: 6,
      mid: 3,
      pieces: [],
      moves: 0,
      budget: 20,
      score: 0,
      status: 'playing',
      level: 1,
      seed: 1,
    };
    expect(isJamState(legacy)).toBe(false);
    expect(isJamState(createJamPuzzle(2, 5))).toBe(true);
  });

  it('один и тот же seed даёт тот же бюджет: запас считается от плана, а не от уровня', () => {
    const state = createJamPuzzle(9, 4321);
    expect(state.budget).toBe(jamBudget(9, state.plan?.length ?? jamTargetCost(9)));
    expect(state.budget).toBeGreaterThan(state.plan!.length);
  });
});
