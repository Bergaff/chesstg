import { useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { formatDuration } from '../lib/format';
import { useCountdown } from '../lib/hooks';
import { hapticNotify } from '../lib/telegram';
import type { AdRewardResponse, AppConfig, Profile } from '../lib/types';
import { HeartsRow } from './Hud';
import { Modal } from './Modal';
import { tr } from '../lib/i18n';

interface NoLivesModalProps {
  profile: Profile;
  config: AppConfig;
  showAd: (label: string) => Promise<boolean>;
  onProfile: (profile: Profile) => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onShop: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
}

export function NoLivesModal({
  profile,
  config,
  showAd,
  onProfile,
  onClose,
  onRefresh,
  onShop,
  onTerms,
  onPrivacy,
}: NoLivesModalProps): ReactNode {
  const [loading, setLoading] = useState(false);
  const remaining = useCountdown(profile.nextLifeAt, () => {
    void onRefresh();
  });

  async function watchAd() {
    if (loading) return;
    setLoading(true);
    try {
      const rewarded = await showAd(tr('+1 жизнь'));
      if (!rewarded) return;
      const response = await api<AdRewardResponse>('/api/ads/reward', { method: 'POST', body: { kind: 'life' } });
      onProfile(response.profile);
      hapticNotify('success');
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'cooldown') {
        onRefresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onClose={onClose} showClose labelledBy="no-lives-title">
      <span className="label">{tr('Передышка')}</span>
      <h2 className="modal-title" id="no-lives-title">
        {tr('Жизни закончились')}
      </h2>
      <p className="modal-text">
        {tr('Следующая жизнь появится через')} <b>{formatDuration(remaining)}</b>
        {tr('. Можно подождать или восстановить силы сейчас.')}
      </p>

      <div className="lives-line">
        <span>{tr('В запасе')}</span>
        <HeartsRow lives={profile.lives} maxLives={profile.maxLives} />
      </div>

      <div className="modal-actions">
        {config.adsEnabled && !profile.adFree && (
          <button type="button" className="btn btn-primary" onClick={watchAd} disabled={loading}>
            {loading ? tr('Загрузка') : tr('Смотреть рекламу за жизнь')}
          </button>
        )}
        {profile.adFree && <p className="modal-note">{tr('Реклама отключена, ждать придётся естественным путём.')}</p>}
        {!config.adsEnabled && (
          <p className="modal-note">{tr('Реклама ещё не включена, поэтому жизнь только за ждани или за звёзды.')}</p>
        )}
        <button type="button" className="btn btn-outline" onClick={onShop}>
          {tr('Магазин: пять жизней за 25 звёзд')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          {tr('Подождать')}
        </button>
      </div>

      <div className="legal-link-row">
        <button type="button" onClick={onTerms}>{tr('Условия использования')}</button>
        <button type="button" onClick={onPrivacy}>{tr('Конфиденциальность')}</button>
        {!config.paymentsEnabled && <span>{tr('Оплата звёздами станет доступна после подключения бота.')}</span>}
      </div>
    </Modal>
  );
}
