/**
 * Силуэт из рисунка.
 *
 * Игрок рисует фигуру пальцем на холсте, а доске нужен контур: на клетке в
 * 36 пикселей растровая картинка мылится, а path-контур держит край. Поэтому
 * клиент отдаёт сюда альфа-канал сетки, а обратно получает SVG-путь в box 32×32.
 *
 * Алгоритм намеренно старый и скучный: порог, левый и правый край по строкам,
 * упрощение Рамера-Даугласа-Пекера. Он не «узнаёт» фигуру и не чинит кривые руки - он
 * честно превращает то, что нарисовано, в ровный край. Ровный край и есть вся
 * работа, которую нельзя сделать руками игрока на телефоне.
 */

export const SILHOUETTE_BOX = 32;
export const GRID = 64;

export interface Rgba {
  /** RGBA-пиксели, row-major. */
  data: Uint8Array | Uint8ClampedArray;
  size: number;
}

/**
 * Чернила по альфа-каналу (рисовали прозрачным фоном) или по затемнению
 * (рисовали по белому). Порог один и тот же: 0.5 силы.
 */
export function inkMask(source: Rgba, mode: 'alpha' | 'dark' = 'alpha'): Uint8Array {
  const { data, size } = source;
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    let ink: number;
    if (mode === 'alpha') {
      ink = data[i * 4 + 3];
    } else {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      ink = 255 - (0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
    mask[i] = ink >= 110 ? 1 : 0;
  }
  return mask;
}

/** Сколько клеток занято: по нему решаем, рисовал игрок фигуру или каракулю. */
export function maskCoverage(mask: Uint8Array): number {
  let filled = 0;
  for (const value of mask) filled += value;
  return filled / mask.length;
}

/** Минимальная доля залитого: ниже - это не фигура, а тычок. */
export const MIN_COVERAGE = 0.02;
/** Максимальная доля: залитый квадрат не читается фигурой. */
export const MAX_COVERAGE = 0.92;

/**
 * Внешний контур маски: левый и правый край по каждой строке.
 *
 * Так проще, чем обводкой Мура, и у этого выбора есть цена: дырка внутри
 * рисунка и выступающая внутрь балка не различаются - силуэт станет залитым.
 * На 32 пикселях они сливаются в то же самое, а обводка соседа (Moore) на
 * пальцем нарисованной маске жует границу и может ходить по ней кругами.
 * Здесь длина контура ограничена двумя высотами сетки, и это важнее точности.
 */
export function outerBoundary(mask: Uint8Array, size: number): [number, number][] {
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let y = 0; y < size; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < size; x++) {
      if (mask[y * size + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0) continue;
    left.push([first, y]);
    right.push([last, y]);
  }
  if (left.length < 2) return [];
  return [...left, ...right.reverse()];
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function pointLineDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const length = Math.hypot(vx, vy);
  if (length === 0) return distance(p, a);
  return Math.abs((p[0] - a[0]) * vy - (p[1] - a[1]) * vx) / length;
}

/**
 * Упрощение Рамера-Даугласа-Пекера, итеративное: стек держим руками, потому что
 * рекурсия на длинной границе (а палец рисует её по каждому пикселю строки)
 * роняет вкладку с «Maximum call stack size exceeded».
 */
export function simplify(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop() as [number, number];
    let far = -1;
    let index = -1;
    for (let i = from + 1; i < to; i++) {
      const d = pointLineDistance(points[i], points[from], points[to]);
      if (d > far) {
        far = d;
        index = i;
      }
    }
    if (index < 0 || far < epsilon) continue;
    keep[index] = 1;
    stack.push([from, index], [index, to]);
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Путь по силуэту: обводка → упрощение → масштабирование и центрирование в
 * box 32×32, одна десятичная цифра (дальше глаз не различает, а байт экономит).
 * Пустой или вырожденный рисунок даёт пустую строку: клиент обязан показать
 * «похоже на тычок», а не сохранить невидимую фигуру.
 */
export function silhouettePath(mask: Uint8Array, size: number): string {
  const boundary = outerBoundary(mask, size);
  if (boundary.length === 0) return '';
  let minX = size;
  let maxX = 0;
  let minY = size;
  let maxY = 0;
  for (const [x, y] of boundary) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  // Клетка почти квадратная, поэтому масштаб один на обе оси: вытянутый рисунок
  // останется вытянутым, но никогда не упрётся в край клетки.
  const scale = (SILHOUETTE_BOX - 3) / Math.max(width, height);
  const padX = (SILHOUETTE_BOX - width * scale) / 2;
  const padY = (SILHOUETTE_BOX - height * scale) / 2;
  const points = simplify(boundary, 0.9).map(([x, y]): [number, number] => [
    Number((padX + (x - minX) * scale).toFixed(1)),
    Number((padY + (y - minY) * scale).toFixed(1)),
  ]);
  if (points.length < 3) return '';
  return `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
}

/** Готовый путь из кадра: то, чем пользуется студия. */
export function pathFromFrame(source: Rgba, mode: 'alpha' | 'dark' = 'alpha'): { path: string; coverage: number } {
  const mask = inkMask(source, mode);
  const coverage = maskCoverage(mask);
  if (coverage < MIN_COVERAGE || coverage > MAX_COVERAGE) return { path: '', coverage };
  return { path: silhouettePath(mask, source.size), coverage };
}

/** Только форма литералов пути и разумная длина: в `d` нечего вставить. */
export function isSafePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || text.length > 6000) return false;
  if (!/^M/.test(text) || !/^[-MmLlHhVvCcSsQqTtAaZz0-9.,\s]+$/.test(text)) return false;
  return true;
}
