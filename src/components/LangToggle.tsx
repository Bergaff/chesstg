import type { ReactNode } from 'react';
import { getLang, setLang, tr } from '../lib/i18n';

/**
 * Кнопка языка в шапке.
 *
 * Язык по умолчанию берётся из клиента Telegram (см. `src/lib/i18n.ts`), но
 * переключатель нужен: у человека может быть английский клиент и русская
 * привычка играть - и наоборот. Кнопка показывает не текущий язык, а тот, на
 * который вас переключат: так видно, что произойдёт от нажатия.
 *
 * Смена языка перезагружает вкладку. Часть подписей - памятка с правилами,
 * названия тем и режимов из движка - переводится один раз при загрузке модуля,
 * и живое переключение оставило бы половину экрана на старом языке. Перезагрузка
 * дешевле, чем превращение всего текста в пропсы.
 */
export function LangToggle({ className }: { className?: string }): ReactNode {
  const next = getLang() === 'ru' ? 'en' : 'ru';
  return (
    <button
      type="button"
      className={className ? `lang-btn ${className}` : 'lang-btn'}
      onClick={() => {
        setLang(next);
        try {
          window.location.reload();
        } catch {
          /* предпросмотр без права на перезагрузку: язык применится при следующем входе */
        }
      }}
      aria-label={tr('Сменить язык интерфейса')}
      title={next === 'en' ? 'English' : 'Русский'}
    >
      {next.toUpperCase()}
    </button>
  );
}
