import { useState, type ReactNode } from 'react';
import {
  AD_COINS_REWARD,
  LIFE_REGEN_MS,
  SKINS,
  type GameMode,
} from '../engine';
import { useApp } from '../context/AppContext';
import { api, ApiError } from '../lib/api';
import { cn, formatDuration, formatNumber } from '../lib/format';
import { useCountdown, useNow } from '../lib/hooks';
import type { AdRewardResponse } from '../lib/types';
import { Hud, HeartsRow, ProfileChip } from '../components/Hud';
import { Icon } from '../components/Icon';
import { ChallengeBanner } from '../components/ChallengeBanner';

interface MenuScreenProps {
  onPlay: (mode: GameMode) => void;
  onOpenRules: () => void;
}

export function MenuScreen({ onPlay, onOpenRules }: MenuScreenProps): ReactNode {
  const { profile, config, active, challenge, setProfile, refresh, toast, showAd, goShop, goShopStars, goRecords } = useApp();
  const [challengeHidden, setChallengeHidden] = useState(false);
  const [adLoading, setAdLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const now = useNow(1000, adLoading || cooldownUntil > 0);
  const cooldownLeft = Math.max(0, cooldownUntil - now);

  const campaignRun = active.campaign;
  const endlessRun = active.endless;

  async function claimCoins() {
    if (adLoading || cooldownLeft > 0 || profile.adFree) return;
    setAdLoading(true);
    try {
      const rewarded = await showAd(`+${AD_COINS_REWARD} 🪙`);
      if (!rewarded) return;
      const response = await api<AdRewardResponse>('/api/ads/reward', {
        method: 'POST',
        body: { kind: 'coins' },
      });
      setProfile(response.profile);
      toast(`+${AD_COINS_REWARD} монет`, 'success');
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          const retry = Number(error.details.retryInMs ?? 60_000);
          setCooldownUntil(Date.now() + Math.max(0, retry));
        }
        toast(error.message, 'error');
      } else {
        toast('Не удалось получить награду', 'error');
      }
    } finally {
      setAdLoading(false);
    }
  }

  function playEndless() {
    if (!profile.endlessUnlocked) {
      toast('Бесконечный режим откроется после 10 уровня', 'info');
      return;
    }
    onPlay('endless');
  }

  return (
    <div className="screen menu-screen">
      <div className="menu-aurora" aria-hidden="true" />
      <header className="menu-top">
        <ProfileChip profile={profile} />
        <div className="menu-top-side">
          <Hud profile={profile} compact onCoins={goShop} onLives={goShopStars} />
          <button type="button" className="icon-btn rules-btn" onClick={onOpenRules} aria-label="Правила игры">
            ?
          </button>
        </div>
      </header>

      {challenge && !challengeHidden && (
        <ChallengeBanner challenge={challenge} onAccept={() => onPlay('campaign')} onClose={() => setChallengeHidden(true)} />
      )}

      <section className="hero">
        <div className="hero-stage" aria-hidden="true">
          <div className="hero-halo" />
          <div className="hero-board">
            {Array.from({ length: 9 }).map((_, index) => (
              <span key={index} className={(Math.floor(index / 3) + index) % 2 === 0 ? 'hero-cell dark' : 'hero-cell light'} />
            ))}
            <span className="hero-enemy" style={{ gridArea: '1 / 1' }}>♜</span>
            <span className="hero-enemy" style={{ gridArea: '1 / 2' }}>♛</span>
            <span className="hero-enemy" style={{ gridArea: '1 / 3' }}>♞</span>
            <span className="hero-enemy soft" style={{ gridArea: '2 / 1' }}>♝</span>
            <span className="hero-enemy soft" style={{ gridArea: '2 / 3' }}>♟</span>
          </div>
          <div className={cn('hero-pawn', `skin-${profile.skin}`)}>
            <span>{SKINS[profile.skin]?.pawn ?? '♟'}</span>
          </div>
          <span className="hero-spark s1">✦</span>
          <span className="hero-spark s2">✦</span>
          <span className="hero-spark s3">✧</span>
        </div>

        <span className="eyebrow">Шахматная головоломка в Telegram</span>
        <h1 className="wordmark">
          <span>Пешка</span>
          <em>против всех</em>
        </h1>
        <p className="tagline">Дойди до последней линии. Не дай фигурам себя поймать.</p>
      </section>

      <div className="menu-cta">
        <button type="button" className="btn btn-gold play-cta" onClick={() => onPlay('campaign')}>
          <span className="play-orb">
            <Icon name="play" size={19} />
          </span>
          <span className="play-copy">
            <b>{campaignRun ? 'Продолжить' : 'Играть'}</b>
            <small>
              {campaignRun
                ? `Уровень ${campaignRun.level} · ход ${campaignRun.moves + 1}`
                : profile.levelsCleared > 0
                  ? `Уровень ${profile.level} · ${profile.levelsCleared} пройдено`
                  : 'Уровень 1 · путь начинается'}
            </small>
          </span>
          <Icon name="chevronRight" size={21} className="cta-chevron" />
        </button>

        <div className="menu-stats">
          <div>
            <b>{profile.maxLevel}</b>
            <span>уровень</span>
          </div>
          <div>
            <b>{formatNumber(profile.endlessBest)}</b>
            <span>рекорд</span>
          </div>
          <div>
            <b>{profile.lives}<em>/{profile.maxLives}</em></b>
            <span>жизни</span>
          </div>
        </div>
      </div>

      <div className="menu-grid">
        <button
          type="button"
          className={cn('menu-card menu-card-endless', !profile.endlessUnlocked && 'is-locked')}
          onClick={playEndless}
          aria-disabled={!profile.endlessUnlocked}
        >
          <span className="menu-card-icon icon-infinity">
            <Icon name="infinity" size={23} />
          </span>
          <span className="menu-card-copy">
            <b>Бесконечный</b>
            <small>
              {!profile.endlessUnlocked
                ? 'Откроется после 10 уровня'
                : endlessRun
                  ? `Продолжить · ${endlessRun.score} клеток`
                  : `Рекорд · ${profile.endlessBest} клеток`}
            </small>
          </span>
          {!profile.endlessUnlocked ? (
            <span className="menu-lock"><Icon name="lock" size={15} /></span>
          ) : (
            <Icon name="chevronRight" size={18} className="menu-card-chevron" />
          )}
        </button>

        <button type="button" className="menu-card" onClick={goShop}>
          <span className="menu-card-icon icon-shop"><Icon name="bag" size={21} /></span>
          <span className="menu-card-copy">
            <b>Магазин</b>
            <small>Бонусы и скины</small>
          </span>
        </button>

        <button type="button" className="menu-card" onClick={goRecords}>
          <span className="menu-card-icon icon-trophy"><Icon name="trophy" size={21} /></span>
          <span className="menu-card-copy">
            <b>Рекорды</b>
            <small>Лидеры и друзья</small>
          </span>
        </button>
      </div>

      {profile.lives < profile.maxLives && <LivesPool onShop={goShop} onRefresh={refresh} />}

      {!profile.adFree && (
        <button
          type="button"
          className={cn('ad-card', (adLoading || cooldownLeft > 0) && 'is-disabled')}
          onClick={claimCoins}
          disabled={adLoading || cooldownLeft > 0}
        >
          <span className="ad-card-icon"><Icon name="play" size={18} /></span>
          <span className="ad-card-copy">
            <b>{adLoading ? 'Загружаем рекламу…' : cooldownLeft > 0 ? `Следующая награда через ${formatDuration(cooldownLeft)}` : 'Реклама за монеты'}</b>
            <small>Rewarded video · раз в минуту</small>
          </span>
          <span className="ad-card-reward">+{AD_COINS_REWARD} <Icon name="coin" size={16} /></span>
        </button>
      )}

      {profile.isGuest && (
        <div className="guest-note">
          <Icon name="spark" size={14} />
          <span>Гостевой режим: прогресс хранится только в этом браузере.</span>
        </div>
      )}

      <footer className="menu-footer">
        <button type="button" onClick={onOpenRules}>Правила игры</button>
        <span className="dot">·</span>
        <span>v1.0.0</span>
        {profile.adFree && (
          <>
            <span className="dot">·</span>
            <span className="footer-badge"><Icon name="shield" size={12} /> без рекламы</span>
          </>
        )}
        {config.devMode && (
          <>
            <span className="dot">·</span>
            <span className="footer-dev">dev</span>
          </>
        )}
      </footer>
    </div>
  );
}

function LivesPool({ onShop, onRefresh }: { onShop: () => void; onRefresh: () => Promise<void> }): ReactNode {
  const { profile } = useApp();
  const remaining = useCountdown(profile.nextLifeAt, () => {
    void onRefresh();
  });
  const progress = Math.min(1, Math.max(0, 1 - remaining / LIFE_REGEN_MS));

  return (
    <div className="resource-card lives-pool">
      <div className="resource-main">
        <HeartsRow lives={profile.lives} maxLives={profile.maxLives} />
        <div className="resource-caption">
          <Icon name="clock" size={14} />
          <span>
            Следующая жизнь через <b>{formatDuration(remaining)}</b>
          </span>
        </div>
        <div className="lives-progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <button type="button" className="resource-action" onClick={onShop} aria-label="В магазин">
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}
