import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * След хода на доске - движение, а не контур.
 *
 * Пунктирная рамка вокруг клетки, откуда ушла фигура, читалась как «на поле
 * появились лишние горизонтальные линии»: рамка то пропадала, то возвращалась
 * на каждом ответе фигур, и игрок принимал это за мерцание доски. Правило
 * держим на уровне исходника, потому что в CSS такая строка появляется снова
 * сама, как только кто-то решает «усилить подсказку».
 */
describe('след хода без рамок', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
  const boards = ['src/components/Board.tsx', 'src/components/JamBoard.tsx'].map((rel) =>
    readFileSync(resolve(process.cwd(), rel), 'utf8'),
  );

  it('у доски нет класса клетки-источника', () => {
    for (const board of boards) {
      expect(board).not.toContain("'cell-left'");
    }
    expect(boards[0]).not.toContain('leftCell');
  });

  it('в стилях поля нет нейтральной пунктирной рамки клетки', () => {
    // Пунктир остаётся только там, где он правило, а не след: красная линия
    // выпадa (`.cell-strike`) стоит на намеренно чужом цвете и не путается с
    // линией доски. След хода же рисовали `var(--line)` - цветом сетки, и это
    // «случайная линия поля».
    const cellRules = [...css.matchAll(/\.cell-[a-z-]+\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(cellRules.length).toBeGreaterThan(0);
    for (const rule of cellRules) {
      expect(rule).not.toMatch(/(outline|border(-top|-bottom|-left|-right)?):\s*1px dashed var\(--line/);
    }
  });

  it('плашка чужой фигуры берёт рамку из темы, а дно остаётся тёмным', () => {
    const at = css.indexOf('.enemy-piece .piece-glyph {');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('background: #121109');
    expect(rule).toContain('var(--skin-edge');
  });
});
