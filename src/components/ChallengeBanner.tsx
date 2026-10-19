import type { ReactNode } from 'react';
import type { Challenge } from '../lib/types';
import { Icon } from './Icon';

interface ChallengeBannerProps {
  challenge: Challenge;
  onAccept: () => void;
  onClose: () => void;
}

export function ChallengeBanner({ challenge, onAccept, onClose }: ChallengeBannerProps): ReactNode {
  return (
    <div className="challenge-banner">
      <span className="challenge-icon"><Icon name="trophy" size={18} /></span>
      <div className="challenge-copy">
        <b>Тебя вызвали</b>
        <span>Уровень {challenge.level} · {challenge.score} клеток</span>
      </div>
      <button type="button" className="challenge-accept" onClick={onAccept}>Принять</button>
      <button type="button" className="challenge-close" onClick={onClose} aria-label="Скрыть вызов">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
