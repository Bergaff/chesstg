import {
  chooseEnemyMove,
  cloneState,
  enemyAt,
  legalMoves,
} from './board';
import { ensureEndlessSpace } from './endless';
import type { BuffKind, GameAction, GameState, MoveDx } from './types';
import { RuleError } from './types';

function validateDx(dx: unknown): asserts dx is MoveDx {
  if (dx !== -1 && dx !== 0 && dx !== 1) throw new RuleError('Некорректное направление хода');
}

function enemyPhase(state: GameState): void {
  if (state.freeze > 0) {
    state.freeze -= 1;
    if (state.shield > 0) state.shield -= 1;
    state.lastEvent = 'frozen';
    return;
  }

  for (const enemy of state.enemies) {
    const target = chooseEnemyMove(state, enemy);
    if (target) {
      enemy.x = target.x;
      enemy.y = target.y;
    }
    if (enemy.x === state.player.x && enemy.y === state.player.y) {
      state.status = 'lost';
      state.capturedBy = enemy.type;
      state.lastEvent = 'captured';
      return;
    }
  }

  if (state.shield > 0) state.shield -= 1;
}

/**
 * Применить действие игрока. Возвращает новое состояние, исходное не мутирует.
 * Все правила продублированы на сервере: клиент не может «нарисовать» победу.
 */
export function applyAction(previous: GameState, action: GameAction): GameState {
  if (previous.status !== 'playing') throw new RuleError('Партия уже завершена');

  if (action.type === 'buff') {
    const buff: BuffKind = action.buff;
    if (buff !== 'freeze' && buff !== 'shield') throw new RuleError('Неизвестный бонус');
    const state = cloneState(previous);
    if (buff === 'freeze') {
      state.freeze = Math.max(state.freeze, 2);
      state.lastEvent = 'freeze';
    } else {
      state.shield = Math.max(state.shield, 3);
      state.lastEvent = 'shield';
    }
    return state;
  }

  const state = cloneState(previous);

  if (action.type === 'skip') {
    if (legalMoves(state).length > 0) throw new RuleError('Пропуск возможен, только если все ходы закрыты');
    state.lastEvent = 'skip';
  } else if (action.type === 'move') {
    validateDx(action.dx);
    const x = state.player.x + action.dx;
    const y = state.player.y + 1;
    if (y >= state.height) {
      throw new RuleError('Верхняя граница поля');
    }
    if (x < 0 || x >= state.width) throw new RuleError('За границей поля');
    if (enemyAt(state, x, y)) throw new RuleError('Клетка занята');
    state.player = { x, y };
    state.lastEvent = 'move';
  } else {
    throw new RuleError('Неизвестное действие');
  }

  state.moves += 1;
  state.score = Math.max(state.score, state.player.y);

  if (state.mode === 'campaign' && state.player.y >= state.height - 1) {
    state.status = 'won';
    state.lastEvent = 'won';
    return state;
  }

  if (state.mode === 'endless') {
    state.tier = 1 + Math.floor(state.moves / 5);
    ensureEndlessSpace(state);
  }

  enemyPhase(state);
  return state;
}

/** Применить цепочку действий (используется для проверки на сервере). */
export function applyActions(initial: GameState, actions: GameAction[]): GameState {
  let state = initial;
  for (const action of actions) state = applyAction(state, action);
  return state;
}

/** Можно ли отменить последний ход (клиентская логика истории). */
export function canUndo(historyLength: number): boolean {
  return historyLength > 1;
}
