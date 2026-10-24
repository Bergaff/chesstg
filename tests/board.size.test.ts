import { describe, expect, it } from 'vitest';
import { stableCell } from '../src/components/Board';

/**
 * Поле «Гонок» не должно менять размер от того, что строка статуса стала на
 * символ длиннее: это выглядело как дрожание экрана на каждый тап.
 */
describe('размер поля', () => {
  const wide = { cell: 44, width: 360 };

  it('не трогает клетку, когда высота поменялась чуть-чуть', () => {
    // Строка статуса переехала на вторую: 14 px на восемь рядов = 1-2 px клетки.
    expect(stableCell(wide, 43, 360)).toBe(44);
    expect(stableCell(wide, 42, 360)).toBe(44);
  });

  it('пересчитывает поле, когда разница заметна', () => {
    expect(stableCell(wide, 41, 360)).toBe(41);
    expect(stableCell(wide, 47, 360)).toBe(47);
  });

  it('следит за шириной: поворот экрана и новая клавиатура', () => {
    expect(stableCell(wide, 30, 361)).toBe(30);
    expect(stableCell(wide, 30, 359)).toBe(30);
  });

  it('первый кадр верит измерению, а схлопывание контейнера - прежнему полю', () => {
    expect(stableCell({ cell: 0, width: 0 }, 40, 360)).toBe(40);
    // Измеритель вернул нуль на миг: пустой экран вместо поля - и есть то дрожание.
    expect(stableCell(wide, 0, 360)).toBe(44);
    expect(stableCell({ cell: 0, width: 0 }, 0, 0)).toBe(0);
  });
});
