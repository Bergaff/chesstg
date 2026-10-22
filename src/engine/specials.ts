import { anyEnemyAttacksPlayer, legalMoves } from './board';
import { auditState, difficultyBand, SURVIVAL_DEPTH, survivalTargetFor } from './audit';
import { boardForMode, piecesFor, rulesFor, type ModeId } from './modes';
import { Rng, mix32 } from './rng';
import type { GameState, PieceType } from './types';
import { availablePieceTypes, createCampaignLevel } from './level';

/**
 * Генераторы режимов лаборатории: «Парковка» и «Гонки».
 *
 * Оба собраны на том же движке и том же разборе, отличается только расстановка
 * и правила режима (файл `modes.ts`). Поэтому отчёт лаборатории для них честный:
 * то же `auditState`, те же доли решаемых расстановок.
 */

const JAM_PIECE_ORDER: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

function emptyState(mode: ModeId, level: number, seed: number): GameState {
  const { width, height } = boardForMode(mode, level);
  return {
    version: 1,
    mode,
    width,
    height,
    player: { x: Math.floor(width / 2), y: 0 },
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
}

/**
 * «Парковка»: почти всё поле занято, фигуры не ходят. Пешка прочищает себе
 * дорогу взятиями по диагонали, поэтому в решение входит не только маршрут,
 * но и порядок, в котором фигуры уходят с доски.
 */
export function createJamLevel(level: number, seed: number): GameState {
  const base = emptyState('jam', level, seed);
  const { width, height } = { width: base.width, height: base.height };
  const rng = new Rng(mix32(seed, level, 0x1a4c, width, height));
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 1; y <= height - 2; y++) {
    for (let x = 0; x < width; x++) cells.push({ x, y });
  }
  rng.shuffle(cells);

  const target = Math.min(piecesFor('jam', level), cells.length);
  // Заполняем ряд за рядом: сплошная стена рядом со стартом и дыра в другом
  // месте дают другой рисунок, чем случайные клетки по всему полю.
  const perRow = new Map<number, number>();
  const placed: Array<{ x: number; y: number }> = [];
  for (const cell of cells) {
    if (placed.length >= target) break;
    const inRow = perRow.get(cell.y) ?? 0;
    if (inRow >= Math.max(2, Math.ceil(width * 0.75))) continue;
    perRow.set(cell.y, inRow + 1);
    placed.push(cell);
  }
  for (const cell of cells) {
    if (placed.length >= target) break;
    if (!placed.some((other) => other.x === cell.x && other.y === cell.y)) placed.push(cell);
  }

  const state: GameState = { ...base, player: { x: rng.int(width), y: 0 }, enemies: [] };
  placed
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .forEach((cell, index) => {
      // Дешевле всего бить пешку и коня, поэтому их в стене больше, а дальнобойные
      // фигуры редки: ладья в стене перекрывает целый ряд и решение часто не существует.
      const type = index % 4 === 3 ? JAM_PIECE_ORDER[2 + (index % 2)] : JAM_PIECE_ORDER[index % 2];
      state.enemies.push({ id: `e${index}`, type, x: cell.x, y: cell.y });
    });
  state.rng = rng.save();
  return state;
}

/**
 * «Гонки»: фигуры едут рядом вниз, пешка идёт навстречу. Ушедшая за нижний край
 * фигура покидает поле, поэтому с каждым ходом дорога вверх очищается, а цена
 * ошибки меняется: в начале важно не встать под фигуру, в конце успеть.
 */
export function createRaceLevel(level: number, seed: number): GameState {
  const base = emptyState('race', level, seed);
  const rng = new Rng(mix32(seed, level, 0x9ac3, base.width, base.height));
  const state: GameState = { ...base, player: { x: rng.int(base.width), y: 0 }, enemies: [] };
  const types = availablePieceTypes(Math.min(31, 8 + level));
  const target = Math.min(piecesFor('race', level), (base.height - 2) * base.width);
  const columns = new Map<number, number>();
  let placed = 0;
  let guard = 0;
  while (placed < target && guard++ < 200) {
    const x = rng.int(base.width);
    // Фигуры стараемся ставить выше середины: иначе они сходят с поля раньше,
    // чем пешка успеет до них добежать, и забег превращается в прогулку.
    const y = Math.min(base.height - 2, Math.floor(base.height / 2) + rng.int(Math.max(1, Math.ceil(base.height / 2))));
    if (y < 2) continue;
    if ((columns.get(x) ?? 0) >= 2) continue;
    if (state.enemies.some((e) => e.x === x && e.y === y)) continue;
    columns.set(x, (columns.get(x) ?? 0) + 1);
    const type = rng.pick(types);
    state.enemies.push({ id: `e${placed}`, type, x, y });
    placed += 1;
  }
  state.rng = rng.save();
  return state;
}

/**
 * Кандидат режима лаборатории: базовая корректность плюс решаемость по разбору.
 * Перебор ограничен несколькими попытками: если не нашли, возвращаем последний
 * просмотренный вариант, а не крутимся бесконечно.
 */
function createSpecialCandidate(mode: ModeId, level: number, seed: number): GameState {
  const family = mode.startsWith('jam') ? 'jam' : mode.startsWith('race') ? 'race' : 'campaign';
  const base =
    family === 'jam' ? createJamLevel(level, seed) : family === 'race' ? createRaceLevel(level, seed) : createCampaignLevel(level, seed);
  // Важно: режим на состоянии подменяется на вариант, иначе движок читает
  // правила базового режима и сравнение вариантов показывает одно и то же.
  return base.mode === mode ? base : { ...base, mode };
}

/**
 * Кандидат режима лаборатории: базовая корректность плюс решаемость по разбору.
 * Перебор ограничен несколькими попытками: если не нашли, возвращаем последний
 * просмотренный вариант, а не крутимся бесконечно.
 */
export function createSpecialLevel(mode: ModeId, level: number, seed: number, attempts = 12): GameState {
  const band = difficultyBand(level, mode);
  let best: { state: GameState; quality: number } | null = null;
  for (let shift = 0; shift < attempts; shift++) {
    const state = createSpecialCandidate(mode, level, seed + shift * 104729);
    if (state.enemies.length === 0 || legalMoves(state).length === 0 || anyEnemyAttacksPlayer(state)) continue;
    const survivalMode = rulesFor(mode).goal === 'survive';
    const depth = survivalMode ? SURVIVAL_DEPTH : state.height + 4;
    const report = auditState(state, { maxDepth: depth, maxNodes: 60_000 });
    // В режиме на выживание полоса другая: считается не цена ошибки, а длина
    // жизни, поэтому цель для него своя и берётся ближайший к ней вариант.
    if (!report.solvable && !report.survival) continue;
    if (report.survival) {
      // Доска, где пешка доживает до потолка разбора, уровню не годится: у неё
      // нет конца, счёт превращается в бесконечный. Такие попытки отбрасываем,
      // а если свободных не осталось, лаборатория увидит fallback.
      if (report.survivalCapped) continue;
      const target = survivalTargetFor(level);
      const quality = -Math.abs(report.steps - target);
      if (!best || quality > best.quality) best = { state, quality };
      if (Math.abs(report.steps - target) <= 1) return { ...state, lastEvent: 'level' };
      continue;
    }
    const quality = -Math.abs(report.score - band.target);
    if (!best || quality > best.quality) best = { state, quality };
    if (report.score >= band.min && report.score <= band.max) return { ...state, lastEvent: 'level' };
  }
  if (best) return { ...best.state, lastEvent: 'level' };
  // Ни одна попытка не прошла разбор: отдаём последнюю корректную расстановку,
  // чтобы лаборатория показала её как нерешаемую, а не упала.
  return { ...createSpecialCandidate(mode, level, seed), lastEvent: 'fallback' };
}
