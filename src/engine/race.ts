// «Гонки»: бесконечный конвейер. Пешка приколота к своему ряду и ходит
// влево-вправо (плюс рубит фигуру, встав на её клетку). Фигуры падают сверху
// рядом; ладья и ферзь дополнительно бьют вдоль общего ряда.
//
// Ряды и есть счёт. Каждые RACE_ROWS_PER_LEVEL рядов конвейер ускоряется
// (`tier`), поэтому забег сам себя догоняет: начало спокойное, к пятидесяти
// рядам приходится считать. Уровень режима выводится из рекорда, а не наоборот:
// все играют на одной доске, иначе рекорды были бы несопоставимы.
//
// Здесь только таблица напряжённости. Правила живут в `modes.ts` (флаг
// `motion: 'conveyor'`), проверка «есть ли выход» - в `rules.ts`.

import type { PieceType } from './types';

/** Ряд, к которому приколота пешка: нулевой ряд оставлен под уход фигур. */
export const RACE_PIN_ROW = 1;
/** Сколько рядов нужно прокрутить, чтобы конвейер ускорился, а режим поднял уровень. */
export const RACE_ROWS_PER_LEVEL = 10;
/** Поле одинаковое у всех забегов: семь колонок и десять рядов. */
export const RACE_WIDTH = 7;
export const RACE_ROWS = 10;
/** Сколько фигур стоит на поле до первого хода. */
export const RACE_PREFILL = 2;

/** Сколько фигур приходит волной на данном напряжении конвейера. */
export function raceSpawnPerTurn(tier: number): number {
  return tier <= 6 ? 1 : tier <= 11 ? 2 : 3;
}

/**
 * Такт конвейера: раз в столько-то ходов приходит волна. На семи колонках
 * фигура каждый ход означает стену, поэтому первые уровни дышат реже.
 */
export function raceSpawnEvery(tier: number): number {
  return tier <= 1 ? 4 : tier <= 3 ? 3 : tier <= 7 ? 2 : 1;
}

/** Уровень режима по числу прокрученных рядов: каждые десять рядов плюс один. */
export function raceLevelForRows(rows: number): number {
  return 1 + Math.floor(Math.max(0, rows) / RACE_ROWS_PER_LEVEL);
}

/**
 * Пруд фигур по напряжению. Иерархия та же, что в кампании (дальнобойные
 * опаснее), только включается раньше: режим открывается пятым уровнем кампании,
 * и ладью игрок к этому моменту уже видел.
 */
export function raceSpawnPool(tier: number): PieceType[] {
  const pool: PieceType[] = ['pawn', 'pawn', 'pawn', 'rook'];
  if (tier >= 2) pool.push('bishop');
  if (tier >= 3) pool.push('rook', 'knight');
  if (tier >= 5) pool.push('bishop', 'knight');
  if (tier >= 8) pool.push('queen');
  if (tier >= 10) pool.push('rook', 'queen');
  return pool;
}

/** Награда за забег: платим за ряды, потолок тот же, что в остальных режимах. */
export function raceCoinReward(rows: number): number {
  const level = raceLevelForRows(rows);
  return Math.min(50, 5 + level + Math.floor(Math.max(0, rows) / 4));
}
