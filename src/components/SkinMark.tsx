import type { CSSProperties, ReactNode } from 'react';
import { PATH_STROKE_WIDTH, type ResolvedSkin } from '../engine';
import { cn } from '../lib/format';

/**
 * Фигура темы: нарисованный пальцем контур, а если его рисовали - глиф.
 *
 * Заливка выключена атрибутом пути, а не только стилем: `fill: none` лежит в
 * CSS, а клиент Telegram неделями досматривает старый кэш стилей - и на старом
 * бандле замкнутые петли фигуры заливались чёрным, а незамкнутая дуга получала
 * «мнимую линию» там, где контур не замкнут. Атрибут переживёт любой кэш.
 *
 * Отдельный компонент потому, что «своя тема» раньше кончалась на доске: цвета
 * экрана тема уже красит, а сам знак игрока нигде, кроме клетки, не виделся - и
 * в меню оставалась чужая латунная пешка. Разметка та же, что у доски, чтобы
 * силуэт не разъезжался между превью, полем и меню.
 */
export function SkinMark({
  skin,
  size,
  plate = false,
  className,
}: {
  skin: Pick<ResolvedSkin, 'glyph' | 'path'>;
  size: number;
  /** С плашкой и рамкой, как на клетке поля. */
  plate?: boolean;
  className?: string;
}): ReactNode {
  const path = skin.path;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.78) } as CSSProperties;
  return (
    <span className={cn('skin-mark', path && 'skin-mark-shape', plate && 'skin-mark-plate', className)} style={style} aria-hidden="true">
      {path ? (
        <svg className="skin-mark-shape-svg" viewBox="0 0 32 32" focusable="false">
          <path d={path} fill="none" strokeWidth={PATH_STROKE_WIDTH} />
        </svg>
      ) : (
        <span className="skin-mark-glyph">{skin.glyph}</span>
      )}
    </span>
  );
}
