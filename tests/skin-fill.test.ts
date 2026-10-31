import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Контур своей темы обязан оставаться штрихом на любом клиенте.
 *
 * Заливку выключает и стиль (`.player-shape { fill: none }`), и атрибут пути.
 * Стиль проверяет тест ниже, а атрибут нужен потому, что WebView Telegram
 * держит старый CSS: на нём путь без `fill` красится чёрным по правилу SVG, и
 * игрок видит чёрные пятна внутри замкнутых петель и «мнимую линию» там, где
 * дуга не замкнута. Это ровно тот баг, который выглядит как «мы это правили, а
 * пятна остались».
 */
const SHAPE_FILES = [
  'src/components/Board.tsx',
  'src/components/SkinMark.tsx',
  'src/components/SkinPreview.tsx',
];

describe('контур темы без заливки', () => {
  it.each(SHAPE_FILES)('%s рисует путь с fill="none"', (rel) => {
    const source = readFileSync(resolve(process.cwd(), rel), 'utf8');
    const paths = source.match(/<path [^>]*d=\{[^}]+\}[^>]*\/>/g) ?? [];
    expect(paths.length).toBeGreaterThan(0);
    for (const tag of paths) expect(tag).toContain('fill="none"');
  });

  it('стили держат fill: none у каждого слоя темы', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    for (const selector of ['.player-shape', '.skin-mark-shape-svg', '.sp-player svg']) {
      const at = css.indexOf(`${selector} {`);
      expect(at).toBeGreaterThan(-1);
      expect(css.slice(at, css.indexOf('}', at))).toContain('fill: none');
    }
  });
});
