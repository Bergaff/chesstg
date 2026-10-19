import { anyEnemyAttacksPlayer, legalMoves } from './board';
import { Rng, mix32 } from './rng';
import { analyzeState } from './solver';
import type { GameState, PieceType } from './types';

export const MAX_BOARD = 6;

export interface PieceUnlock {
  type: PieceType;
  level: number;
}

export const PIECE_UNLOCKS: PieceUnlock[] = [
  { type: 'pawn', level: 1 },
  { type: 'rook', level: 3 },
  { type: 'bishop', level: 5 },
  { type: 'knight', level: 8 },
  { type: 'queen', level: 15 },
];

export function sizeForLevel(level: number): number {
  if (level <= 5) return 3;
  if (level <= 15) return 4;
  if (level <= 30) return 5;
  return MAX_BOARD;
}

export function pieceCountForLevel(level: number): number {
  if (level <= 1) return 1;
  if (level <= 4) return 2;
  if (level <= 9) return 3;
  if (level <= 14) return 4;
  if (level <= 20) return 5;
  if (level <= 26) return 6;
  return 7;
}

export function availablePieceTypes(level: number): PieceType[] {
  return PIECE_UNLOCKS.filter((u) => level >= u.level).map((u) => u.type);
}

export function newPiecesAtLevel(level: number): PieceType[] {
  return PIECE_UNLOCKS.filter((u) => u.level === level).map((u) => u.type);
}

function typeWeights(level: number): Array<[PieceType, number]> {
  const weights: Array<[PieceType, number]> = [['pawn', 3.6]];
  if (level >= 3) weights.push(['rook', 2.2]);
  if (level >= 5) weights.push(['bishop', 1.9]);
  if (level >= 8) weights.push(['knight', 2.0]);
  if (level >= 15) weights.push(['queen', 1.1]);
  return weights;
}

function weightedType(rng: Rng, level: number): PieceType {
  const values = typeWeights(level);
  const total = values.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [type, weight] of values) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return values[values.length - 1][0];
}

function buildCandidate(level: number, seed: number, attempt: number, count: number): GameState {
  const rng = new Rng(mix32(seed, attempt, count, level, 0x1e7e1));
  const width = sizeForLevel(level);
  const height = width;
  const startX = rng.int(width);

  const state: GameState = {
    version: 1,
    mode: 'campaign',
    width,
    height,
    player: { x: startX, y: 0 },
    enemies: [],
    status: 'playing',
    moves: 0,
    score: 0,
    level,
    tier: 1,
    freeze: 0,
    shield: 0,
    rng: 0,
    seed,
  };

  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 1; y <= height - 2; y++) {
    for (let x = 0; x < width; x++) {
      if (x === startX && y === 0) continue;
      cells.push({ x, y });
    }
  }
  rng.shuffle(cells);

  let pawns = 0;
  const pawnCap = Math.max(1, Math.ceil(count / 2));
  const types = availablePieceTypes(level);

  for (const cell of cells) {
    if (state.enemies.length >= count) break;
    let type = weightedType(rng, level);
    if (type === 'pawn' && pawns >= pawnCap && types.length > 1) {
      type = rng.pick(types.filter((t) => t !== 'pawn'));
    }
    if (type === 'pawn') pawns += 1;
    state.enemies.push({
      id: `e${state.enemies.length}`,
      type,
      x: cell.x,
      y: cell.y,
    });
  }

  state.rng = rng.save();
  return state;
}

/** Заведомо решаемая страховка, если случайный поиск не справился. */
function fallbackLevel(level: number, seed: number): GameState {
  const width = sizeForLevel(level);
  const height = width;
  const x = Math.floor(width / 2);
  return {
    version: 1,
    mode: 'campaign',
    width,
    height,
    player: { x, y: 0 },
    enemies: [{ id: 'e0', type: 'pawn', x, y: 1 }],
    status: 'playing',
    moves: 0,
    score: 0,
    level,
    tier: 1,
    freeze: 0,
    shield: 0,
    rng: seed >>> 0,
    seed,
  };
}

/**
 * Генерирует уровень кампании. Каждый уровень проверяется перебором:
 * должен существовать путь наверх, враги не должны бить стартовую клетку,
 * и у игрока обязан быть хотя бы один ход вперёд.
 */
export function createCampaignLevel(level: number, seed: number): GameState {
  const target = pieceCountForLevel(level);
  const maxByCells = (sizeForLevel(level) - 2) * sizeForLevel(level) - 1;
  const maxCount = Math.max(1, Math.min(target, maxByCells));
  const counts: number[] = [];
  for (let count = maxCount; count >= Math.max(1, maxCount - 4); count--) {
    counts.push(count);
  }

  for (const count of counts) {
    const attempts = count === maxCount ? 70 : 45;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const candidate = buildCandidate(level, seed, attempt, count);
      if (candidate.enemies.length < Math.min(1, count)) continue;
      if (legalMoves(candidate).length === 0) continue;
      if (anyEnemyAttacksPlayer(candidate)) continue;
      const analysis = analyzeState(candidate, {
        maxDepth: sizeForLevel(level) + 2,
        maxNodes: 3500,
      });
      if (analysis.solvable) return { ...candidate, lastEvent: 'level' };
    }
  }

  return fallbackLevel(level, seed);
}

/** Метаданные для экрана «перед уровнем». */
export function levelInfo(level: number) {
  return {
    level,
    size: sizeForLevel(level),
    pieces: pieceCountForLevel(level),
    unlockedNow: newPiecesAtLevel(level),
    available: availablePieceTypes(level),
  };
}
