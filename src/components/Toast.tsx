import type { ReactNode } from 'react';
import { cn } from '../lib/format';
import { tr } from '../lib/i18n';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const LABELS: Record<ToastKind, string> = {
  success: tr('Готово'),
  error: tr('Ошибка'),
  info: tr('Заметка'),
};

export function ToastStack({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }): ReactNode {
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={cn('toast', `toast-${item.kind}`)}
          onClick={() => onDismiss(item.id)}
        >
          <span className="toast-kind">{LABELS[item.kind]}</span>
          <span>{item.message}</span>
        </button>
      ))}
    </div>
  );
}
