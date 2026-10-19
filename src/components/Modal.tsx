import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/format';
import { Icon } from './Icon';

interface ModalProps {
  children: ReactNode;
  onClose?: () => void;
  dismissible?: boolean;
  className?: string;
  showClose?: boolean;
  labelledBy?: string;
}

export function Modal({ children, onClose, dismissible = true, className, showClose, labelledBy }: ModalProps) {
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
      <div className={cn('modal', className)} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {showClose && (
          <button type="button" className="modal-close icon-btn" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="modal-actions">{children}</div>;
}
