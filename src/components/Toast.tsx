import type { ReactNode } from 'react';
import { cn } from '../lib/format';
import { Icon, type IconName } from './Icon';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const ICONS: Record<ToastKind, IconName> = {
  success: 'check',
  error: 'close',
  info: 'spark',
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
          <span className="toast-icon">
            <Icon name={ICONS[item.kind]} size={16} />
          </span>
          <span>{item.message}</span>
        </button>
      ))}
    </div>
  );
}
