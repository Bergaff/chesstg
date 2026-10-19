import type { ReactNode } from 'react';
import type { Profile } from '../lib/types';
import { formatNumber } from '../lib/format';
import { Icon } from './Icon';

interface HudProps {
  profile: Profile;
  onCoins?: () => void;
  onLives?: () => void;
  compact?: boolean;
}

export function Hud({ profile, onCoins, onLives, compact }: HudProps): ReactNode {
  return (
    <div className={compact ? 'hud hud-compact' : 'hud'}>
      <button type="button" className="hud-pill hud-lives" onClick={onLives} aria-label={`Жизни: ${profile.lives} из ${profile.maxLives}`}>
        <Icon name="heart" size={16} />
        <span>
          <b>{profile.lives}</b>
          <em>/{profile.maxLives}</em>
        </span>
      </button>
      <button type="button" className="hud-pill hud-coins" onClick={onCoins} aria-label={`Монеты: ${profile.coins}`}>
        <Icon name="coin" size={17} />
        <span>{formatNumber(profile.coins)}</span>
      </button>
    </div>
  );
}

export function ProfileChip({ profile }: { profile: Profile }): ReactNode {
  return (
    <div className="profile-chip">
      <div className="profile-avatar">
        <span>{profile.name.trim()[0]?.toUpperCase() ?? '♟'}</span>
      </div>
      <div className="profile-meta">
        <span className="profile-name">{profile.name}</span>
        <span className="profile-sub">
          {profile.isGuest ? 'гостевой режим' : `уровень ${profile.maxLevel}`}
        </span>
      </div>
    </div>
  );
}

export function HeartsRow({ lives, maxLives, className }: { lives: number; maxLives: number; className?: string }): ReactNode {
  return (
    <div className={className ? `hearts-row ${className}` : 'hearts-row'} aria-label={`${lives} из ${maxLives} жизней`}>
      {Array.from({ length: maxLives }).map((_, index) => (
        <span key={index} className={index < lives ? 'heart heart-full' : 'heart heart-empty'}>
          <Icon name="heart" size={17} />
        </span>
      ))}
    </div>
  );
}
