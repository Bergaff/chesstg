import { describe, expect, it } from 'vitest';
import { RuleError } from './types';
import {
  applyJamAction,
  createJamPuzzle,
  jamSolution,
  jamBoard,
  jamBudget,
  jamDensity,
  jamHint,
  jamLegalActions,
  jamParkedCount,
  jamPieceMoves,
  jamScramble,
  jamSolved,
  type JamAction,
  type JamState,
} from './jam';

describe('парковка как головоломка', () => {
  it('собирает пробку на обоих половинах и не готовую', () => {
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
      expect(state.budget).toBe(jamBudget(level));
      expect(state.score).toBe(jamParkedCount(state.pieces, state.mid));
    }
  });

  it('плотность и поле растут с уровнем, но не бесконечно', () => {
    const small = jamBoard(1);
    const big = jamBoard(40);
    expect(small.width).toBe(5);
    expect(big.width).toBe(6);
    expect(big.height).toBeGreaterThan(small.height);
    expect(jamDensity(1)).toBeLessThan(jamDensity(30));
    expect(jamDensity(90)).toBeLessThanOrEqual(0.66);
    expect(jamScramble(1)).toBeLessThan(jamScramble(20));
  });

  it('решаема: разворот пути перемешивания приводит поле в порядок', () => {
    for (const level of [1, 3, 7, 12, 21, 33, 50]) {
      const state = createJamPuzzle(level, 4242 + level * 7);
      const solution = jamSolution(state);
      expect(solution.length).toBeGreaterThan(0);
      let current = state;
      for (const action of solution) {
        current = applyJamAction(current, action, RuleError);
        // Откат перемешивания может расставить всё раньше: последние шаги тогда
        // просто не нужны, и мы останавливаемся.
        if (current.status !== 'playing') break;
      }
      expect(jamSolved(current)).toBe(true);
      // Бюджет щедрее перемешивания, иначе гарантированное решение было бы запретным.
      expect(current.moves).toBeLessThanOrEqual(state.budget);
      expect(current.status).toBe('won');
    }
  });

  it('детерминирована по зерну', () => {
    const a = createJamPuzzle(8, 99);
    const b = createJamPuzzle(8, 99);
    expect(JSON.stringify(a.pieces)).toBe(JSON.stringify(b.pieces));
    expect(JSON.stringify(a.scramble)).toBe(JSON.stringify(b.scramble));
    const c = createJamPuzzle(8, 100);
    expect(JSON.stringify(c.pieces)).not.toBe(JSON.stringify(a.pieces));
  });

  it('взятий нет: число фигур не меняется', () => {
    const state = createJamPuzzle(6, 1234);
    const action = jamLegalActions(state)[0];
    const next = applyJamAction(state, action, RuleError);
    expect(next.pieces.length).toBe(state.pieces.length);
    // Поля взятий у парковки нет вообще: бить нечего и некем.
    expect((next as unknown as { captures?: number }).captures).toBeUndefined();
  });

  it('правила запрещают невозможные ходы', () => {
    const state = createJamPuzzle(5, 555);
    const piece = state.pieces[0];

    expect(() => applyJamAction(state, { type: 'piece', id: 'нет-такой', to: { x: 0, y: 0 } }, RuleError)).toThrowError(
      'Фигуры с таким id нет',
    );
    expect(() => applyJamAction(state, { type: 'piece', id: piece.id, to: { x: -1, y: 0 } }, RuleError)).toThrowError(
      'За границей поля',
    );
    const occupied = state.pieces.find((other) => other.id !== piece.id);
    expect(() => applyJamAction(state, { type: 'piece', id: piece.id, to: { x: occupied!.x, y: occupied!.y } }, RuleError)).toThrowError(
      'Клетка занята',
    );
    // Слон по прямой не ездит, ладья по диагонали тоже.
    const bishop = state.pieces.find((entry) => entry.type === 'bishop');
    const rook = state.pieces.find((entry) => entry.type === 'rook');
    if (bishop) {
      expect(() => applyJamAction(state, { type: 'piece', id: bishop.id, to: { x: bishop.x + 1, y: bishop.y } }, RuleError)).toThrowError(
        /Фигура так не ходит|Клетка занята/,
      );
    }
    if (rook) {
      expect(() => applyJamAction(state, { type: 'piece', id: rook.id, to: { x: rook.x + 1, y: rook.y + 1 } }, RuleError)).toThrowError(
        /Фигура так не ходит|Клетка занята|За границей поля/,
      );
    }
  });

  it('ладья и слон не проходят сквозь фигуры, конь перепрыгивает', () => {
    const state = createJamPuzzle(2, 31337);
    const empty: JamState = {
      version: 1,
      mode: 'jam',
      width: 5,
      height: 6,
      mid: 3,
      pieces: [{ id: 'a', type: 'rook', side: 'white', x: 0, y: 0 }],
      moves: 0,
      budget: 10,
      score: 0,
      status: 'playing',
      level: 2,
      seed: 1,
    };
    // 5 колонок и 6 рядов: вправо 4 клетки, вверх 5.
    expect(jamPieceMoves(empty, empty.pieces[0]).length).toBe(9);

    const blocked: JamState = {
      ...empty,
      pieces: [
        { id: 'a', type: 'rook', side: 'white', x: 0, y: 0 },
        { id: 'b', type: 'rook', side: 'black', x: 0, y: 2 },
      ],
    };
    const rookMoves = jamPieceMoves(blocked, blocked.pieces[0]);
    expect(rookMoves.some((cell) => cell.x === 0 && cell.y === 1)).toBe(true);
    expect(rookMoves.some((cell) => cell.x === 0 && cell.y === 3)).toBe(false);

    const knight: JamState = {
      ...empty,
      pieces: [
        { id: 'k', type: 'knight', side: 'white', x: 1, y: 1 },
        { id: 'b', type: 'rook', side: 'black', x: 1, y: 2 },
        { id: 'c', type: 'rook', side: 'black', x: 2, y: 1 },
      ],
    };
    expect(jamPieceMoves(knight, knight.pieces[0]).some((cell) => cell.x === 3 && cell.y === 2)).toBe(true);
  });

  it('бюджет кончается поражением, подсказка отдаёт легальный ход', () => {
    const state = createJamPuzzle(3, 8080);
    const tight: JamState = { ...state, budget: 1 };
    const first = jamLegalActions(tight)[0];
    const after = applyJamAction(tight, first, RuleError);
    expect(after.moves).toBe(1);
    expect(['lost', 'won']).toContain(after.status);
    if (after.status === 'lost') expect(after.lastEvent).toBe('budget');

    const hint = jamHint(state);
    expect(hint).not.toBeNull();
    const legal = jamLegalActions(state);
    expect(legal.some((action) => action.id === hint!.id && action.to.x === hint!.to.x && action.to.y === hint!.to.y)).toBe(true);
  });

  it('ход на чужую половину увеличивает счёт', () => {
    // Собираемposition, где у белой ладьи есть прямой ход вверх за mid.
    const state: JamState = {
      version: 1,
      mode: 'jam',
      width: 5,
      height: 6,
      mid: 3,
      pieces: [
        { id: 'w', type: 'rook', side: 'white', x: 0, y: 2 },
        { id: 'b', type: 'rook', side: 'black', x: 4, y: 4 },
      ],
      moves: 0,
      budget: 10,
      score: 0,
      status: 'playing',
      level: 1,
      seed: 3,
    };
    expect(jamParkedCount(state.pieces, state.mid)).toBe(0);
    const next = applyJamAction(state, { type: 'piece', id: 'w', to: { x: 0, y: 3 } }, RuleError);
    expect(next.score).toBe(1);
    const last = applyJamAction(next, { type: 'piece', id: 'b', to: { x: 4, y: 2 } }, RuleError);
    expect(jamSolved(last)).toBe(true);
    expect(last.status).toBe('won');
    expect(last.lastEvent).toBe('won');
  });
});
