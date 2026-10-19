import type { ReactNode } from 'react';
import type { Profile } from '../lib/types';
import { formatNumber } from '../lib/format';

export function Hud({ profile, onCoins, onLives }: { profile: Profile; onCoins?: () => void; onLives?: () => void; compact?: boolean }): ReactNode {
  return (
    <>
      <button type="button" className="topbar-stat" onClick={onLives} aria-label={`Жизни: ${profile.lives} из ${profile.maxLives}`}>
        <span className="label">Жизни</span>
        <b>
          {profile.lives}<span style={{ color: 'var(--dim)' }}>/{profile.maxLives}</span>
        </b>
      </button>
      <button type="button" className="topbar-stat" onClick={onCoins} aria-label={`Монеты: ${profile.coins}`}>
        <span className="label">Монеты</span>
        <b>{formatNumber(profile.coins)}</b>
      </button>
    </>
  );
}

export function ProfileChip({ profile }: { profile: Profile }): ReactNode {
  return (
    <div className="identity">
      <div className="avatar">{profile.name.trim()[0]?.toUpperCase() ?? 'П'}</div>
      <div>
        <span className="identity-name">{profile.name}</span>
        <span className="identity-sub">
          {profile.isGuest ? 'гостевой режим' : `уровень ${profile.maxLevel}`}
        </span>
      </div>
    </div>
  );
}

export function HeartsRow({ lives, maxLives, className }: { lives: number; maxLives: number; className?: string }): ReactNode {
  return (
    <span
      className={className ? `hearts ${className}` : 'hearts'}
      aria-label={`${lives} из ${maxLives} жизней`}
    >
      {Array.from({ length: maxLives }).map((_, index) => (
        <span key={index} className={index < lives ? 'heart-filled' : 'heart-empty'}>
          ♥
        </span>
      ))}
    </span>
  );
}
