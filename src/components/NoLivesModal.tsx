import { useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { formatDuration } from '../lib/format';
import { useCountdown } from '../lib/hooks';
import { hapticNotify } from '../lib/telegram';
import type { AdRewardResponse, AppConfig, Profile } from '../lib/types';
import { HeartsRow } from './Hud';
import { Icon } from './Icon';
import { Modal } from './Modal';

interface NoLivesModalProps {
  profile: Profile;
  config: AppConfig;
  showAd: (label: string) => Promise<boolean>;
  onProfile: (profile: Profile) => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onShop: () => void;
}

export function NoLivesModal({
  profile,
  config,
  showAd,
  onProfile,
  onClose,
  onRefresh,
  onShop,
}: NoLivesModalProps): ReactNode {
  const [loading, setLoading] = useState(false);
  const remaining = useCountdown(profile.nextLifeAt, () => {
    void onRefresh();
  });

  async function watchAd() {
    if (loading) return;
    setLoading(true);
    try {
      const rewarded = await showAd('+1 жизнь');
      if (!rewarded) return;
      const response = await api<AdRewardResponse>('/api/ads/reward', { method: 'POST', body: { kind: 'life' } });
      onProfile(response.profile);
      hapticNotify('success');
      onClose();
    } catch (error) {
      /* ошибку показывает вызывающий экран через общий тост */
      if (error instanceof ApiError && error.code === 'cooldown') {
        onRefresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onClose={onClose} showClose>
      <div className="result-hero result-hero-empty">
        <div className="result-orb">
          <Icon name="heart" size={34} />
        </div>
        <span className="eyebrow">Передышка</span>
        <h2 className="modal-title" id="no-lives-title">Жизни закончились</h2>
        <p className="modal-text">
          Новая жизнь появится через <b>{formatDuration(remaining)}</b>. Или восстанови силы прямо сейчас.
        </p>
      </div>

      <HeartsRow lives={profile.lives} maxLives={profile.maxLives} className="hearts-center" />

      <div className="modal-actions">
        {!profile.adFree && (
          <button type="button" className="btn btn-gold" onClick={watchAd} disabled={loading}>
            <Icon name="play" size={18} />
            {loading ? 'Загружаем…' : 'Смотреть рекламу +1 ❤️'}
          </button>
        )}
        {profile.adFree && (
          <div className="hint-line">
            <Icon name="shield" size={16} /> Реклама отключена
          </div>
        )}
        <button type="button" className="btn btn-ghost" onClick={onShop}>
          Магазин · +5 жизней за 25 ⭐
        </button>
        <button type="button" className="btn btn-text" onClick={onClose}>
          Подождать
        </button>
      </div>
      {!config.paymentsEnabled && (
        <p className="modal-footnote">Оплата звёздами станет доступна после подключения бота.</p>
      )}
    </Modal>
  );
}
