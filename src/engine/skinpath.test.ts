import { describe, expect, it } from 'vitest';
import {
  GRID,
  MAX_COVERAGE,
  MIN_COVERAGE,
  PATH_STROKE_WIDTH,
  SILHOUETTE_BOX,
  inkMask,
  isSafePath,
  maskCoverage,
  pathFromFrame,
  silhouettePath,
  strokesPath,
  simplify,
} from './index';

function frame(fill: (x: number, y: number) => boolean, size = GRID, ink = 'alpha'): { data: Uint8Array; size: number } {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = fill(x, y);
      const i = (y * size + x) * 4;
      if (ink === 'alpha') {
        data[i] = 20;
        data[i + 1] = 20;
        data[i + 2] = 20;
        data[i + 3] = on ? 255 : 0;
      } else {
        const value = on ? 0 : 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
      }
    }
  }
  return { data, size };
}

function rect(x0: number, y0: number, x1: number, y1: number) {
  return (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

describe('силуэт из рисунка', () => {
  it('квадрат превращается в замкнутый путь в box 32', () => {
    const source = frame(rect(8, 8, 39, 39));
    const mask = inkMask(source);
    const path = silhouettePath(mask, source.size);
    expect(path.startsWith('M ')).toBe(true);
    expect(path.endsWith(' Z')).toBe(true);
    expect(isSafePath(path)).toBe(true);
    const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(numbers.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(SILHOUETTE_BOX);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
  });

  it('круг упрощается, но остаётся замкнутым и внутри клетки', () => {
    const source = frame((x, y) => (x - 32) ** 2 + (y - 32) ** 2 <= 20 * 20);
    const path = silhouettePath(inkMask(source), source.size);
    const coords = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(coords.length % 2).toBe(0);
    expect(Math.max(...coords)).toBeLessThanOrEqual(SILHOUETTE_BOX);
    // Точек после упрощения заметно меньше, чем пикселей границы.
    expect(coords.length / 2).toBeLessThan(200);
  });

  it('тычок и залитый квадрат не считаются фигурой', () => {
    const dot = pathFromFrame(frame(rect(30, 30, 31, 31)));
    expect(dot.path).toBe('');
    expect(dot.coverage).toBeLessThan(MIN_COVERAGE);

    const whole = pathFromFrame(frame(() => true));
    expect(whole.path).toBe('');
    expect(whole.coverage).toBeGreaterThan(MAX_COVERAGE);

    const empty = pathFromFrame(frame(() => false));
    expect(empty.path).toBe('');
  });

  it('режим затемнения читает рисунок по белому', () => {
    const dark = frame(rect(10, 10, 40, 40), GRID, 'dark');
    expect(maskCoverage(inkMask(dark, 'dark'))).toBeGreaterThan(0.2);
    expect(maskCoverage(inkMask(dark, 'alpha'))).toBeGreaterThan(0.9);
  });

  it('упрощение выбрасывает точки на той же стене', () => {
    const line: [number, number][] = Array.from({ length: 40 }, (_, i) => [i, 0]);
    expect(simplify(line, 0.9)).toHaveLength(2);
    const corner: [number, number][] = [...line, ...Array.from({ length: 40 }, (_, i): [number, number] => [39, i])];
    const cut = simplify(corner, 0.9);
    expect(cut.length).toBeLessThanOrEqual(6);
    expect(cut[0]).toEqual([0, 0]);
    expect(cut[cut.length - 1]).toEqual([39, 39]);
  });

  it('страж пути не пропускает ничего кроме литералов', () => {
    expect(isSafePath('M 1 1 L 2 2 Z')).toBe(true);
    expect(isSafePath('M 1 1" onload="alert(1)')).toBe(false);
    expect(isSafePath('L 1 1')).toBe(false);
    expect(isSafePath('')).toBe(false);
    expect(isSafePath(`M ${'1 '.repeat(7000)}`)).toBe(false);
  });

  /**
   * Штрихи - то, ради чего студия не отдаёт рисунок на растеризацию. Замкнёшь
   * круг (или оставь в нём щель) - и внутри должно быть пусто: ни `Z`, ни
   * второго контура, ни «заливки всей клетки».
   */
  it('штрихи остаются линиями: без замыкания и без заливки', () => {
    const circle: [number, number][] = [];
    for (let a = 0; a <= Math.PI * 1.9; a += 0.05) {
      circle.push([32 + Math.cos(a) * 22, 32 + Math.sin(a) * 22]);
    }
    const path = strokesPath([circle], GRID);
    expect(path.startsWith('M ')).toBe(true);
    expect(path).not.toContain('Z');
    expect((path.match(/M/g) ?? []).length).toBe(1);
    const coords = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(coords.length % 2).toBe(0);
    expect(Math.max(...coords)).toBeLessThanOrEqual(SILHOUETTE_BOX);
    expect(Math.min(...coords)).toBeGreaterThanOrEqual(0);
    // Дрожащая рука даёт сотни точек, в коде темы каждый знак на счету.
    expect(coords.length / 2).toBeLessThan(circle.length);
    expect(isSafePath(path)).toBe(true);
  });

  it('каждый штрих - отдельный подпуть, а не контур вокруг всего рисунка', () => {
    const cross = strokesPath(
      [
        [
          [8, 8],
          [56, 56],
        ],
        [
          [8, 56],
          [56, 8],
        ],
      ],
      GRID,
    );
    expect((cross.match(/M/g) ?? []).length).toBe(2);
    expect(cross).not.toContain('Z');
    // Тычок в одну точку - не фигура: студия скажет «нарисуй крупнее», а не
    // сохранит невидимку.
    expect(strokesPath([[[4, 4]]], GRID)).toBe('');
    expect(strokesPath([], GRID)).toBe('');
  });

  it('толщина штриха задана один раз и она не нулевая', () => {
    expect(PATH_STROKE_WIDTH).toBeGreaterThan(1);
    expect(PATH_STROKE_WIDTH).toBeLessThan(5);
  });
});
