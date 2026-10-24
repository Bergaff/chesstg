import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({
  children,
  onClose,
  dismissible = true,
  className,
  showClose,
  labelledBy,
}: {
  children: ReactNode;
  onClose?: () => void;
  dismissible?: boolean;
  className?: string;
  showClose?: boolean;
  labelledBy?: string;
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dismissible, onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose?.();
      }}
    >
      <div className={className ? `modal ${className}` : 'modal'} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {showClose && (
          <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
