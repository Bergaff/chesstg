import {
  availablePieceTypes,
  boardForMode,
  difficultyBand,
  piecesFor,
  PIECE_UNLOCKS,
  type DifficultyBand,
  type ModeId,
  type PieceType,
} from '../engine';
import type { PlacementSpec } from '../engine';

/**
 * Задание уровня для лаборатории - одним местом.
 *
 * Раньше геометрию, набор фигур и полосу считали по своему в двух местах
 * панели: в разборе одного уровня и в таблице масштаба. Расхождение на одной
 * строке выглядит как «лаборатория врет», поэтому формула здесь одна.
 */
export interface LabLevel {
  level: number;
  width: number;
  height: number;
  types: PieceType[];
  /** Сколько фигур допускает уровень: не больше тех, что влезает в поле. */
  maxPieces: number;
  band: DifficultyBand;
}

export function labLevel(mode: ModeId, level: number): LabLevel {
  const { width, height } = boardForMode(mode, level);
  // В лаборатории доступны все фигуры, что открыты в игре к этому уровню, а
  // для лабораторных режимов - весь список разблокировок: у них своей
  // прогрессии нет.
  const types = mode === 'campaign' || mode === 'endless' ? availablePieceTypes(level) : PIECE_UNLOCKS.map((entry) => entry.type);
  const maxPieces = Math.max(1, Math.min(piecesFor(mode, level), (height - 2) * width - 1));
  return { level, width, height, types, maxPieces, band: difficultyBand(level, mode) };
}

/**
 * `pieces` - сколько фигур взять (по умолчанию максимум уровня): меньше -
 * проще перебор, больше - нельзя.
 */
export function labSpec(mode: ModeId, level: number, pieces?: number): { spec: PlacementSpec; band: DifficultyBand } {
  const entry = labLevel(mode, level);
  const count = Math.max(1, Math.min(pieces ?? entry.maxPieces, entry.maxPieces));
  return {
    spec: { width: entry.width, height: entry.height, count, types: entry.types, mode },
    band: entry.band,
  };
}
