import { anyEnemyAttacksPlayer, legalMoves } from './board';
import { Rng, mix32 } from './rng';
import { auditState, difficultyBand } from './audit';
import { boardForMode, piecesFor } from './modes';
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

export interface BoardSize {
  width: number;
  height: number;
}

/**
 * Размер поля. Ширина идёт по ТЗ (3, 4, 5, 6), а высота больше ширины.
 *
 * Забег длится `height - 1` ходов: на квадратном 4×4 это три хода, на 5×5 четыре,
 * и за три хода пешке не из чего выбирать, кроме как угадать единственный
 * безопасный ход. Два-три ряда запаса дают обход, выжидание и несколько
 * победных линий, то есть то, что игрок вообще может решать.
 */
export function boardForLevel(level: number): BoardSize {
  return boardForMode('campaign', level);
}

export function sizeForLevel(level: number): number {
  return boardForLevel(level).width;
}

/** Рядов в кампании задаёт `MODE_RULES.campaign.rows`, здесь только чтение. */

export function heightForLevel(level: number): number {
  return boardForLevel(level).height;
}

/** Число фигур. Рядов теперь больше, поэтому и фигуры добавляются чуть раньше. */
export function pieceCountForLevel(level: number): number {
  return piecesFor('campaign', level);
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

/** Фигуры, которые бьют через всю доску: на малом поле они перекрывают целый ряд или вертикаль. */
const LONG_RANGE: PieceType[] = ['rook', 'queen'];
/** Не больше двух фигур в ряду, прилегающем к старту: три фигуры в одном ряду съедают все три первых хода. */
const MAX_NEAR_START_ROW = 2;
const MAX_PER_COLUMN = 2;

function buildCandidate(level: number, seed: number, attempt: number, count: number): GameState {
  const rng = new Rng(mix32(seed, attempt, count, level, 0x1e7e1));
  const { width, height } = boardForLevel(level);
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
  const inRow = new Map<number, number>();
  const inColumn = new Map<number, number>();

  const fits = (type: PieceType, x: number, y: number): boolean => {
    if (y === 1 && (inRow.get(1) ?? 0) >= MAX_NEAR_START_ROW) return false;
    if ((inColumn.get(x) ?? 0) >= MAX_PER_COLUMN) return false;
    // Дальнобойная фигура во втором ряду держит всю вертикаль до самого старта,
    // поэтому ей отдаём ряды выше второго.
    if (y <= 2 && LONG_RANGE.includes(type)) return false;
    if (LONG_RANGE.includes(type) && state.enemies.some((e) => LONG_RANGE.includes(e.type) && e.x === x)) return false;
    return true;
  };

  for (const cell of cells) {
    if (state.enemies.length >= count) break;
    let type = weightedType(rng, level);
    if (type === 'pawn' && pawns >= pawnCap && types.length > 1) {
      type = rng.pick(types.filter((t) => t !== 'pawn'));
    }
    if (!fits(type, cell.x, cell.y)) {
      // Клетка не подошла этой фигуре, попробуем другую: отказ от клетки не должен
      // сокращать число фигур, иначе на тесном поле уровень тихонько пустеет.
      const alternative = types.find((candidate) => fits(candidate, cell.x, cell.y));
      if (!alternative) continue;
      type = alternative;
    }
    if (type === 'pawn') pawns += 1;
    inRow.set(cell.y, (inRow.get(cell.y) ?? 0) + 1);
    inColumn.set(cell.x, (inColumn.get(cell.x) ?? 0) + 1);
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
  const { width, height } = boardForLevel(level);
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
 * Генерирует уровень кампании.
 *
 * Кандидат проходит обязательные проверки: пешке есть куда идти, стартовая
 * клетка не под боем, решение существует. Затем уровень оценивается разбором
 * (`auditState`) и сравнивается с целевой полосой сложности: слишком простые
 * расстановки отбрасываются, слишком тяжёлые тоже.
 *
 * Дополнительно с третьего уровня нужен выбор: минимум два первых хода,
 * ведущих к победе. Расстановка с единственным спасением на каждом шаге
 * формально самая требовательная, но игрок в ней не решает, а угадывает,
 * и таких расстановок в пространстве уровня большинство.
 */
export function createCampaignLevel(level: number, seed: number): GameState {
  const target = pieceCountForLevel(level);
  const maxByCells = (sizeForLevel(level) - 2) * sizeForLevel(level) - 1;
  const maxCount = Math.max(1, Math.min(target, maxByCells));
  const counts: number[] = [];
  for (let count = maxCount; count >= Math.max(1, maxCount - 4); count--) {
    counts.push(count);
  }

  const band = difficultyBand(level);
  const maxAudits = 520;
  const minFirst = level >= 3 ? 2 : 1;
  let audits = 0;
  let best: { state: GameState; score: number; delta: number } | null = null;
  let bestVaried: { state: GameState; score: number; delta: number } | null = null;

  const better = (
    current: { score: number; delta: number } | null,
    score: number,
    delta: number,
  ): boolean => !current || delta < current.delta || (delta === current.delta && score > current.score);

  for (const count of counts) {
    const attempts = count === maxCount ? 220 : 90;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const candidate = buildCandidate(level, seed, attempt, count);
      if (candidate.enemies.length < 1) continue;
      if (legalMoves(candidate).length === 0) continue;
      if (anyEnemyAttacksPlayer(candidate)) continue;

      const report = auditState(candidate);
      audits += 1;
      if (!report.solvable) continue;

      const delta = Math.abs(report.score - band.target);
      if (better(best, report.score, delta)) {
        best = { state: candidate, score: report.score, delta };
      }
      const varied = report.firstMoves >= minFirst && report.paths >= 2;
      // При равной близости к цели берём тот вариант, где выбора больше.
      const rank = delta - Math.min(8, (report.choiceSteps ?? 0) * 1.5);
      if (varied && better(bestVaried, report.score, rank)) {
        bestVaried = { state: candidate, score: report.score, delta: rank };
        if (report.score >= band.min && report.score <= band.max) {
          return { ...candidate, lastEvent: 'level' };
        }
      }
      if (audits >= maxAudits) break;
    }
    if (audits >= maxAudits) break;
  }

  if (bestVaried) return { ...bestVaried.state, lastEvent: 'level' };
  if (best) return { ...best.state, lastEvent: 'level' };
  return fallbackLevel(level, seed);
}

/** Метаданные для экрана «перед уровнем». */
export function levelInfo(level: number) {
  return {
    level,
    size: sizeForLevel(level),
    height: heightForLevel(level),
    pieces: pieceCountForLevel(level),
    unlockedNow: newPiecesAtLevel(level),
    available: availablePieceTypes(level),
  };
}
