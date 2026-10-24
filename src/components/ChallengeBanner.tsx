import type { ReactNode } from 'react';
import type { Challenge } from '../lib/types';

export function ChallengeBanner({
  challenge,
  onAccept,
  onClose,
}: {
  challenge: Challenge;
  onAccept: () => void;
  onClose: () => void;
}): ReactNode {
  return (
    <div className="callout">
      <span className="label label-accent">Вызов</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ color: 'var(--ink)', fontWeight: 600 }}>Друг зовёт на уровень {challenge.level}</b>
        <p style={{ marginTop: 2 }}>
          {challenge.score > 0 ? `Его результат: ${challenge.score} клеток. ` : ''}
          Пройди тот же уровень и сравни счёт.
        </p>
        <div style={{ display: 'flex', gap: 14, marginTop: 9 }}>
          <button type="button" className="btn btn-primary" style={{ minHeight: 34, padding: '0 12px', fontSize: 11 }} onClick={onAccept}>
            Принять
          </button>
          <button type="button" className="btn btn-quiet" style={{ minHeight: 34, padding: '0 8px', fontSize: 11 }} onClick={onClose}>
            Скрыть
          </button>
        </div>
      </div>
    </div>
  );
}
