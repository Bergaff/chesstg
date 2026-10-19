/** Детерминированный ГПСЧ (mulberry32). Одинаковые seed → одинаковое поле. */

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Возвращает число в диапазоне [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Целое число в диапазоне [0, max). */
  int(max: number): number {
    if (max <= 0) return 0;
    return Math.floor(this.next() * max);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  save(): number {
    return this.state >>> 0;
  }
}

/** Стабильный 32-битный микс для производных seed'ов. */
export function mix32(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    let v = value | 0;
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      v >>>= 8;
    }
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function randomSeed(): number {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0] >>> 0;
    }
  } catch {
    /* среда без Web Crypto */
  }
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Короткий детерминированный код (для инвайтов/шеринга). */
export function shortCode(seed: number, length = 8): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const rng = new Rng(seed);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[rng.int(alphabet.length)];
  return out;
}
