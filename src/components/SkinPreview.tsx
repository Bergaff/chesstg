import { type CSSProperties, type ReactNode } from 'react';
import { SKINS, skinTokens, skinVars, type SkinTokens } from '../engine';
import { cn } from '../lib/format';

/**
 * Кусочек доски в четыре клетки: своя фигура, чужая фигура и обе клетки.
 * Магазин показывает превью, потому что описание цвета не пересказывает ничего:
 * «латунь по чернильной стали» и «тёмная фигура» на слух звучат одинаково, а на
 * доске выглядят по-разному. Чужая фигура стоит здесь намеренно: тема обязана
 * сохранять различие «моё» и «чужое», и проверять это надо до покупки.
 */
export function SkinPreview({
  skin,
  cell = 30,
  className,
}: {
  /** Enough of a skin to paint: черновик из очереди может не иметь глифа. */
  skin?: Partial<SkinTokens>;
  cell?: number;
  className?: string;
}): ReactNode {
  const given = skin ?? {};
  const full: SkinTokens = { ...skinTokens(SKINS.classic), ...given, glyph: given.glyph || SKINS.classic.glyph };
  const style = { ...skinVars(full), '--sp-cell': `${cell}px` } as CSSProperties;
  return (
    <span className={cn('skin-preview', className)} style={style} aria-hidden="true">
      <span className="sp-cell sp-cell-light" />
      <span className="sp-cell sp-cell-dark">
        <span className="sp-enemy">♜</span>
      </span>
      <span className="sp-cell sp-cell-dark" />
      <span className="sp-cell sp-cell-light">
        <span className={cn('sp-player', full.path && 'sp-player-shape')}>
          {full.path ? (
            <svg viewBox="0 0 32 32" focusable="false">
              <path d={full.path} />
            </svg>
          ) : (
            full.glyph
          )}
        </span>
      </span>
    </span>
  );
}
