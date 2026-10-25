import type { ReactNode } from 'react';
import type { Profile } from '../lib/types';
import { formatNumber } from '../lib/format';
import { tr, trf } from '../lib/i18n';

export function Hud({ profile, onCoins, onLives }: { profile: Profile; onCoins?: () => void; onLives?: () => void; compact?: boolean }): ReactNode {
  return (
    <>
      <button type="button" className="topbar-stat" onClick={onLives} aria-label={trf('Жизни: {0} из {1}', [profile.lives, profile.maxLives])}>
        <span className="label">{tr('Жизни')}</span>
        <b>
          {profile.lives}<span style={{ color: 'var(--dim)' }}>/{profile.maxLives}</span>
        </b>
      </button>
      <button type="button" className="topbar-stat" onClick={onCoins} aria-label={trf('Монеты: {0}', [profile.coins])}>
        <span className="label">{tr('Монеты')}</span>
        <b>{formatNumber(profile.coins)}</b>
      </button>
    </>
  );
}

export function ProfileChip({ profile }: { profile: Profile }): ReactNode {
  return (
    <div className="identity">
      <div className="avatar">{profile.name.trim()[0]?.toUpperCase() ?? tr('П')}</div>
      <div>
        <span className="identity-name">{profile.name}</span>
        <span className="identity-sub">
          {profile.isGuest ? tr('гостевой режим') : trf('уровень {0}', [profile.maxLevel])}
        </span>
      </div>
    </div>
  );
}

/**
 * Ряд сердец. `eternal` - аккаунт из списка `QA_LIVES_IDS`: вместо пяти сердец
 * показываем бесконечность, чтобы проверяющий видел, что список сработал.
 * Остальные цифры профиля при этом обычные: режим про жизни, а не про льготы.
 */
export function HeartsRow({
  lives,
  maxLives,
  className,
  eternal = false,
}: {
  lives: number;
  maxLives: number;
  className?: string;
  eternal?: boolean;
}): ReactNode {
  if (eternal) {
    return (
      <span
        className={className ? `hearts hearts-eternal ${className}` : 'hearts hearts-eternal'}
        aria-label={tr('Жизни не списываются: аккаунт в списке QA')}
      >
        <span className="heart-filled">♥</span>
        <span className="heart-infinity" aria-hidden="true">
          ∞
        </span>
      </span>
    );
  }
  return (
    <span
      className={className ? `hearts ${className}` : 'hearts'}
      aria-label={trf('{0} из {1} жизней', [lives, maxLives])}
    >
      {Array.from({ length: maxLives }).map((_, index) => (
        <span key={index} className={index < lives ? 'heart-filled' : 'heart-empty'}>
          ♥
        </span>
      ))}
    </span>
  );
}
