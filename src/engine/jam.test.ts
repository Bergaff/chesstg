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
  jamExitMoves,
  jamExitRow,
  jamIsExit,
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
    version: 3,
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
      // На своём краю фигура ушла бы первым ходом, поэтому генератор крайние
      // ряды держит пустыми: задача начинается с манёвра, а не с подсчёта.
      expect(state.pieces.filter((entry) => entry.side === 'white' && entry.y === 0).length).toBe(0);
      expect(state.pieces.filter((entry) => entry.side === 'black' && entry.y === state.height - 1).length).toBe(0);
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

  it('уход это ход на свой край, отдельного действия для него нет', () => {
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
        { id: 'w', type: 'rook', side: 'white', x: 1, y: 1 },
        { id: 'b', type: 'rook', side: 'black', x: 3, y: 4 },
      ],
    });
    expect(jamExitMoves(exit, exit.pieces[0])).toEqual([{ x: 1, y: 0 }]);
    expect(jamExitMoves(exit, exit.pieces[1])).toEqual([{ x: 3, y: 5 }]);
    expect(jamIsExit(exit, exit.pieces[0], { x: 1, y: 0 })).toBe(true);
    expect(jamIsExit(exit, exit.pieces[0], { x: 1, y: 2 })).toBe(false);
    const gone = apply(exit, { type: 'piece', id: 'w', to: { x: 1, y: 0 } });
    expect(gone.pieces.length).toBe(1);
    expect(gone.removed).toBe(1);
    expect(gone.score).toBe(1);
    expect(jamRemovedCount(gone)).toBe(1);
    expect(gone.lastEvent).toBe('exit');
    const won = apply(gone, { type: 'piece', id: 'b', to: { x: 3, y: 5 } });
    expect(won.status).toBe('won');
    expect(won.pieces.length).toBe(0);
  });

  it('чужая фигура на пути закрывает выход, а конь перепрыгивает', () => {
    const clear = board({
      pieces: [{ id: 'w', type: 'rook', side: 'white', x: 2, y: 3 }],
      total: 1,
    });
    expect(jamExitMoves(clear, clear.pieces[0])).toEqual([{ x: 2, y: 0 }]);

    const blocked = board({
      pieces: [
        { id: 'w', type: 'rook', side: 'white', x: 2, y: 3 },
        { id: 'b', type: 'rook', side: 'black', x: 2, y: 1 },
      ],
      total: 2,
    });
    expect(jamExitMoves(blocked, blocked.pieces[0])).toEqual([]);
    expect(jamPieceMoves(blocked, blocked.pieces[0]).some((cell) => cell.x === 2 && cell.y === 2)).toBe(true);
    expect(jamPieceMoves(blocked, blocked.pieces[0]).some((cell) => cell.x === 2 && cell.y === 0)).toBe(false);

    // Конь с row 1 спрыгивает на нулевой ряд ходом (±2, -1), с row 3 не дотянется.
    const near = board({ pieces: [{ id: 'k', type: 'knight', side: 'white', x: 2, y: 1 }], total: 1 });
    expect(jamExitMoves(near, near.pieces[0])).toEqual([
      { x: 4, y: 0 },
      { x: 0, y: 0 },
    ]);
    const far = board({ pieces: [{ id: 'k', type: 'knight', side: 'white', x: 2, y: 3 }], total: 1 });
    expect(jamExitMoves(far, far.pieces[0])).toEqual([]);
    expect(jamAtEdge(near, near.pieces[0])).toBe(true);
    expect(jamAtEdge(far, far.pieces[0])).toBe(false);

    // Слон встаёт на край по диагонали, и только туда, куда доезжает по клеткам
    // поля: через боковую стенку путь не считается.
    const bishop = board({ pieces: [{ id: 's', type: 'bishop', side: 'white', x: 3, y: 2 }], total: 1 });
    expect(jamExitMoves(bishop, bishop.pieces[0])).toEqual([{ x: 1, y: 0 }]);
    const wall = board({ pieces: [{ id: 's', type: 'bishop', side: 'white', x: 0, y: 1 }], total: 1 });
    expect(jamExitMoves(wall, wall.pieces[0])).toEqual([{ x: 1, y: 0 }]);
  });

  it('направление ухода зависит от цвета: свои края, а не один на всех', () => {
    const state = board({
      height: 6,
      pieces: [
        { id: 'w', type: 'rook', side: 'white', x: 0, y: 0 },
        { id: 'b', type: 'rook', side: 'black', x: 1, y: 5 },
      ],
      total: 2,
    });
    expect(jamExitRow(state, 'white')).toBe(0);
    expect(jamExitRow(state, 'black')).toBe(5);
    // Белая ладья стоит на своём краю: любой ход вдоль ряда её и снимает.
    expect(jamExitMoves(state, state.pieces[0]).length).toBeGreaterThan(0);
    expect(jamExitMoves(state, state.pieces[1]).length).toBeGreaterThan(0);
    // Чёрной нулевой ряд не дом: она встанет туда как на обычную клетку.
    const visit = apply(state, { type: 'piece', id: 'b', to: { x: 1, y: 0 } });
    expect(visit.pieces.length).toBe(2);
    expect(visit.removed).toBe(0);
    expect(visit.pieces[1]).toMatchObject({ x: 1, y: 0 });
    // А назад на свой ряд она уходит: это тот же ход, просто край её цвета.
    expect(apply(visit, { type: 'piece', id: 'b', to: { x: 1, y: 5 } }).removed).toBe(1);
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
    // Клетка вне поля не принимается: журнал живёт внутри доски, уход это ход
    // на край, а не шаг в несуществующую клетку.
    const empty = board({ pieces: [{ id: 'x', type: 'rook', side: 'white', x: 0, y: 1 }], total: 1 });
    expect(() => apply(empty, { type: 'piece', id: 'x', to: { x: 1, y: 2 } })).toThrowError('Фигура так не ходит');
    expect(() => apply(empty, { type: 'piece', id: 'x', to: { x: 0, y: -1 } })).toThrowError('За границей поля');
    expect(() => apply(empty, { type: 'piece', id: 'x', to: { x: 0, y: 6 } })).toThrowError('За границей поля');
    expect(apply(empty, { type: 'piece', id: 'x', to: { x: 0, y: 0 } }).removed).toBe(1);
  });

  it('подсказка доводит поле до победы: она ведёт план, а не первый легальный ход', () => {
    // Regression: подсказка читала план с нулевого шага, ранний ход коня через
    // несколько ходов снова становился легальным, и игрок зацикливался на нём,
    // сжигая бюджет. Теперь план привязан к счётчику ходов.
    for (const level of [1, 8, 20]) {
      for (const seed of [7, 4242]) {
        let state = createJamPuzzle(level, seed);
        let guard = 0;
        while (state.status === 'playing' && guard++ < 400) {
          const hint = jamHint(state);
          if (!hint) break;
          state = apply(state, hint);
        }
        expect(state.status, `L${level} seed ${seed}`).toBe('won');
        expect(state.removed).toBe(state.total);
        expect(state.moves).toBeLessThanOrEqual(state.budget);
      }
    }
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

  it('состояние прежних сборок не принимается', () => {
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
    // Сборка 19 успела пожить с полосами ухода: полей у неё тех достаточно, но
    // журнал лежит вне доски, поэтому решает именно версия.
    const lanes = { ...legacy, version: 2, mid: undefined, removed: 0 };
    expect(isJamState(legacy)).toBe(false);
    expect(isJamState(lanes)).toBe(false);
    expect(isJamState(createJamPuzzle(2, 5))).toBe(true);
  });

  it('один и тот же seed даёт тот же бюджет: запас считается от плана, а не от уровня', () => {
    const state = createJamPuzzle(9, 4321);
    expect(state.budget).toBe(jamBudget(9, state.plan?.length ?? jamTargetCost(9)));
    expect(state.budget).toBeGreaterThan(state.plan!.length);
  });
});
