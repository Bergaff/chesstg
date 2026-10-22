// Единая точка входа для «любого забега»: сервер хранит в одной таблице и
// пешечные партии, и головоломку «Парковка». Разница между ними только в форме
// состояния и в применении хода, всё остальное (проверка истории, счётчики,
// итог) здесь общее, чтобы новый режим не требовал правки каждого хендлера.

import { RuleError, type GameAction, type GameState, type PieceType } from './types';
import { applyActions } from './rules';
import { applyJamActions, isJamState, type JamAction, type JamState } from './jam';

export type RunAction = GameAction | JamAction;
export type AnyRunState = GameState | JamState;

export interface RunSnapshot {
  status: 'playing' | 'won' | 'lost';
  moves: number;
  score: number;
  tier: number;
  capturedBy?: PieceType;
  /** Служебная метка последнего события: 'stuck', 'budget', 'won'. */
  lastEvent?: string;
}

/** Разобрать состояние забега из БД: у «Парковки» своя форма. */
export function parseRunState(raw: unknown): AnyRunState {
  return (raw as AnyRunState).mode === 'jam' ? (raw as JamState) : (raw as GameState);
}

export function replayRun(initial: AnyRunState, actions: RunAction[]): AnyRunState {
  if (isJamState(initial)) {
    return applyJamActions(initial, actions as JamAction[], RuleError);
  }
  return applyActions(initial, actions as GameAction[]);
}

/** Что читает сервер: исход, счётчики и причина. Полям состояния не верим внаглую. */
export function snapshotOf(state: AnyRunState): RunSnapshot {
  if (isJamState(state)) {
    return {
      status: state.status,
      moves: state.moves,
      score: state.score,
      tier: 1,
      lastEvent: state.lastEvent,
    };
  }
  return {
    status: state.status,
    moves: state.moves,
    score: state.score,
    tier: state.tier ?? 1,
    capturedBy: state.capturedBy,
    lastEvent: state.lastEvent,
  };
}

/** Действие можно превратить в каноническую строку только зная его форму. */
export function jsonRunAction(action: RunAction): string {
  if (action.type === 'piece') {
    return `{"type":"piece","id":"${action.id}","to":{"x":${action.to.x},"y":${action.to.y}}}`;
  }
  if (action.type === 'move') {
    return action.dy === 2
      ? `{"type":"move","dx":${action.dx},"dy":2}`
      : `{"type":"move","dx":${action.dx}}`;
  }
  if (action.type === 'skip') return '{"type":"skip"}';
  return `{"type":"buff","buff":"${action.buff}"}`;
}
