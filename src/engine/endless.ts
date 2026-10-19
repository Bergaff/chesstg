import { Rng, mix32 } from './rng';
import { anyEnemyAttacksPlayer, legalMoves } from './board';
import type { Enemy, GameState, PieceType } from './types';

export const ENDLESS_WIDTH = 6;
export const ENDLESS_START_HEIGHT = 9;
export const ENDLESS_GROWTH = 5;
export const ENDLESS_VIEW_ROWS = 8;
export const ENDLESS_MAX_ENEMIES = 26;
const INITIAL_ENEMIES = 4;

function typePool(tier: number): Array<[PieceType, number]> {
  const pool: Array<[PieceType, number]> = [
    ['pawn', 3],
    ['rook', 2],
    ['bishop', tier >= 2 ? 1.6 : 1],
    ['knight', tier >= 2 ? 1.8 : 1],
  ];
  if (tier >= 2) pool.push(['queen', 0.9]);
  if (tier >= 5) pool.push(['queen', 0.6]);
  return pool;
}

function weightedType(rng: Rng, tier: number): PieceType {
  const pool = typePool(tier);
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [type, weight] of pool) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return 'pawn';
}

function spawnInitialEnemies(state: GameState, rng: Rng, count: number): void {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 1; y <= state.height - 2; y++) {
    for (let x = 0; x < state.width; x++) {
      if (x === state.player.x && y === state.player.y) continue;
      cells.push({ x, y });
    }
  }
  rng.shuffle(cells);
  let id = 0;
  for (const cell of cells) {
    if (state.enemies.length >= count) break;
    if (cell.x === state.player.x && cell.y === state.player.y) continue;
    state.enemies.push({
      id: `e${id++}`,
      type: weightedType(rng, 1),
      x: cell.x,
      y: cell.y,
    });
  }
}

/** Стартовое поле бесконечного режима. */
export function createEndlessRun(seed: number): GameState {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rng = new Rng(mix32(seed, attempt, 0xe11d1e55));
    const state: GameState = {
      version: 1,
      mode: 'endless',
      width: ENDLESS_WIDTH,
      height: ENDLESS_START_HEIGHT,
      player: { x: rng.int(ENDLESS_WIDTH), y: 0 },
      enemies: [],
      status: 'playing',
      moves: 0,
      score: 0,
      level: 0,
      tier: 1,
      freeze: 0,
      shield: 0,
      rng: rng.save(),
      seed,
    };
    const count = Math.min(INITIAL_ENEMIES, Math.max(2, INITIAL_ENEMIES - Math.floor(attempt / 15)));
    spawnInitialEnemies(state, rng, count);
    state.rng = rng.save();

    if (state.enemies.length === 0) continue;
    if (legalMoves(state).length === 0) continue;
    if (anyEnemyAttacksPlayer(state)) continue;
    return state;
  }

  // Практически недостижимый, но полностью безопасный фолбэк.
  return {
    version: 1,
    mode: 'endless',
    width: ENDLESS_WIDTH,
    height: ENDLESS_START_HEIGHT,
    player: { x: 2, y: 0 },
    enemies: [{ id: 'e0', type: 'pawn', x: 4, y: 5 }],
    status: 'playing',
    moves: 0,
    score: 0,
    level: 0,
    tier: 1,
    freeze: 0,
    shield: 0,
    rng: seed >>> 0,
    seed,
  };
}

function spawnSegment(state: GameState, rng: Rng, fromY: number, toY: number, tier: number): void {
  const count = Math.min(5, 1 + tier);
  if (state.enemies.length >= ENDLESS_MAX_ENEMIES) return;

  const cells: Array<{ x: number; y: number }> = [];
  for (let y = fromY; y < toY; y++) {
    for (let x = 0; x < state.width; x++) {
      if (state.enemies.some((e) => e.x === x && e.y === y)) continue;
      cells.push({ x, y });
    }
  }
  rng.shuffle(cells);

  let placed = 0;
  let id = state.enemies.length;
  for (const cell of cells) {
    if (placed >= count || state.enemies.length >= ENDLESS_MAX_ENEMIES) break;
    if (cell.x === state.player.x && cell.y === state.player.y) continue;
    state.enemies.push({
      id: `e${id++}`,
      type: weightedType(rng, tier),
      x: cell.x,
      y: cell.y,
    });
    placed++;
  }
}

/**
 * Достраивает поле вверх, пока пешке не хватает запаса хода.
 * Вызывается после каждого хода бесконечного режима.
 */
export function ensureEndlessSpace(state: GameState): void {
  if (state.mode !== 'endless' || state.status !== 'playing') return;
  let guard = 0;
  while (state.player.y >= state.height - 3 && guard++ < 20) {
    const oldHeight = state.height;
    state.height += ENDLESS_GROWTH;
    const rng = new Rng(state.rng);
    spawnSegment(state, rng, oldHeight, state.height, state.tier);
    state.rng = rng.save();
    state.score = Math.max(state.score, state.player.y);
  }
}

/** Видимое окно бесконечного поля (8 рядов вокруг игрока). */
export function endlessViewport(state: GameState): { from: number; to: number } {
  const rows = Math.min(ENDLESS_VIEW_ROWS, state.height);
  const from = Math.max(0, Math.min(state.player.y - 2, state.height - rows));
  return { from, to: from + rows };
}

export function makeEnemy(id: string, type: PieceType, x: number, y: number): Enemy {
  return { id, type, x, y };
}
