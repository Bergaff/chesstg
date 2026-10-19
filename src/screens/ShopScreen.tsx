import { useState, type ReactNode } from 'react';
import {
  BONUSES,
  BONUS_ORDER,
  PAID_SKINS,
  PRODUCTS,
  SKINS,
  SKIN_ORDER,
  type BonusId,
  type ProductSku,
  type SkinId,
} from '../engine';
import { useApp, type ShopTab } from '../context/AppContext';
import { api, ApiError } from '../lib/api';
import { cn, formatNumber } from '../lib/format';
import { getTg, hapticNotify, openInvoice } from '../lib/telegram';
import type { BonusUseResponse, Profile } from '../lib/types';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';

interface ShopScreenProps {
  onBack: () => void;
  initialTab?: ShopTab;
}

export function ShopScreen({ onBack, initialTab = 'bonuses' }: ShopScreenProps): ReactNode {
  const { profile, config, setProfile, refresh, toast } = useApp();
  const [tab, setTab] = useState<ShopTab>(initialTab);
  const [buyingBonus, setBuyingBonus] = useState<BonusId | null>(null);
  const [selectingSkin, setSelectingSkin] = useState<SkinId | null>(null);
  const [paying, setPaying] = useState<ProductSku | null>(null);
  const [purchaseDone, setPurchaseDone] = useState<ProductSku | null>(null);
  const [setModal, setSetModal] = useState(false);

  const ownedSet = PAID_SKINS.every((skin) => profile.skins.includes(skin));

  async function buyBonus(kind: BonusId) {
    if (buyingBonus) return;
    const price = BONUSES[kind].price;
    if (profile.coins < price) {
      toast('Не хватает монет. Посмотри рекламу в меню.', 'info');
      return;
    }
    setBuyingBonus(kind);
    try {
      const response = await api<{ profile: Profile }>('/api/shop/bonus', { method: 'POST', body: { kind } });
      setProfile(response.profile);
      hapticNotify('success');
      toast(`+1 ${BONUSES[kind].name.toLowerCase()}`, 'success');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Покупка не прошла', 'error');
    } finally {
      setBuyingBonus(null);
    }
  }

  async function selectSkin(skin: SkinId) {
    if (skin === profile.skin || selectingSkin) return;
    if (!profile.skins.includes(skin)) {
      setSetModal(true);
      return;
    }
    setSelectingSkin(skin);
    try {
      const response = await api<{ profile: Profile }>('/api/profile/skin', { method: 'POST', body: { skin } });
      setProfile(response.profile);
      hapticNotify('success');
      toast(`${SKINS[skin].name} — теперь твой образ`, 'success');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Не удалось выбрать скин', 'error');
    } finally {
      setSelectingSkin(null);
    }
  }

  async function waitForPayment(chargeId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const status = await api<{ status: string }>(`/api/pay/status?charge=${encodeURIComponent(chargeId)}`);
        if (status.status === 'paid') return true;
        if (status.status === 'failed' || status.status === 'refunded') return false;
      } catch {
        /* пропускаем попытку */
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return false;
  }

  async function buyProduct(sku: ProductSku) {
    if (paying) return;
    if (!config.paymentsEnabled) {
      toast('Оплата звёздами ещё не подключена в этой сборке', 'info');
      return;
    }
    const tg = getTg();
    if (!tg) {
      toast('Оплата звёздами доступна только в Telegram', 'info');
      return;
    }
    setPaying(sku);
    try {
      const invoice = await api<{ url: string; chargeId: string }>('/api/shop/invoice', {
        method: 'POST',
        body: { sku },
      });
      const status = await openInvoice(invoice.url);
      if (status === 'cancelled') {
        toast('Оплата отменена', 'info');
        return;
      }
      if (status === 'failed' || status === 'unavailable') {
        toast('Не удалось открыть оплату', 'error');
        return;
      }
      const paid = await waitForPayment(invoice.chargeId);
      if (paid) {
        await refresh();
        setPurchaseDone(sku);
        hapticNotify('success');
      } else {
        toast('Платёж обрабатывается. Проверь профиль через минуту.', 'info');
      }
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Покупка не прошла', 'error');
    } finally {
      setPaying(null);
    }
  }

  return (
    <div className="screen shop-screen">
      <header className="page-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Назад">
          <Icon name="back" size={20} />
        </button>
        <div className="page-title">
          <span>Витрина</span>
          <b>Магазин</b>
        </div>
        <span className="shop-coins">
          <Icon name="coin" size={17} />
          {formatNumber(profile.coins)}
        </span>
      </header>

      <div className="segmented shop-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'bonuses'} className={tab === 'bonuses' ? 'active' : ''} onClick={() => setTab('bonuses')}>
          Бонусы
        </button>
        <button type="button" role="tab" aria-selected={tab === 'skins'} className={tab === 'skins' ? 'active' : ''} onClick={() => setTab('skins')}>
          Скины
        </button>
        <button type="button" role="tab" aria-selected={tab === 'stars'} className={tab === 'stars' ? 'active' : ''} onClick={() => setTab('stars')}>
          Звёзды
        </button>
      </div>

      {tab === 'bonuses' && (
        <div className="shop-body">
          <div className="shop-intro">
            <span className="eyebrow">За монеты</span>
            <h2>Купи спокойствие</h2>
            <p>Монеты дают за победы в кампании и рекорды в бесконечном режиме. Бонусы лежат в инвентаре до нужного момента.</p>
          </div>

          <div className="shop-list">
            {BONUS_ORDER.map((kind) => {
              const bonus = BONUSES[kind];
              const count = profile.inventory[kind];
              const affordable = profile.coins >= bonus.price;
              return (
                <div className="shop-item" key={kind}>
                  <span className={`shop-item-icon icon-${kind}`}>
                    <Icon name={kind === 'hint' ? 'bulb' : kind === 'freeze' ? 'snow' : 'undo'} size={22} />
                  </span>
                  <div className="shop-item-copy">
                    <div className="shop-item-head">
                      <b>{bonus.name}</b>
                      {count > 0 && <span className="owned-count">×{count}</span>}
                    </div>
                    <p>{bonus.description}</p>
                    <div className="shop-item-price">
                      <Icon name="coin" size={14} />
                      {bonus.price}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={cn('buy-btn', !affordable && 'is-poor')}
                    onClick={() => void buyBonus(kind)}
                    disabled={buyingBonus !== null || !affordable}
                  >
                    {buyingBonus === kind ? '…' : 'Купить'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="tip-card">
            <Icon name="bulb" size={18} />
            <p>Бонус можно купить прямо во время партии — цена спишется автоматически. Если монет не хватит, игра предложит заработать их за рекламу.</p>
          </div>

          <button type="button" className="btn btn-ghost show-stars" onClick={() => setTab('stars')}>
            <Icon name="star" size={17} />
            Жизни и отключение рекламы за ⭐
          </button>
        </div>
      )}

      {tab === 'skins' && (
        <div className="shop-body">
          <div className={cn('skin-feature', ownedSet && 'is-owned')}>
            <div className="skin-feature-art">
              {(['gold', 'neon', 'royal'] as SkinId[]).map((skin) => (
                <span key={skin} className={cn('skin-demo', `skin-${skin}`)}>
                  <span>{SKINS[skin].pawn}</span>
                </span>
              ))}
            </div>
            <div className="skin-feature-copy">
              <span className="eyebrow">Набор из трёх</span>
              <h2>Другой образ пешки</h2>
              <p>Золото, неон и королевский стиль. Скины меняют только внешний вид — правила остаются прежними.</p>
            </div>
            {ownedSet ? (
              <span className="owned-badge"><Icon name="check" size={14} /> Куплено</span>
            ) : (
              <button type="button" className="btn btn-gold" onClick={() => void buyProduct('skins')} disabled={paying !== null}>
                <Icon name="star" size={16} />
                {paying === 'skins' ? 'Открываем…' : `Набор · ${PRODUCTS.skins.stars} ⭐`}
              </button>
            )}
          </div>

          <div className="section-label">Выбери образ</div>
          <div className="skin-grid">
            {SKIN_ORDER.map((skin) => {
              const owned = profile.skins.includes(skin);
              const active = profile.skin === skin;
              return (
                <button
                  type="button"
                  key={skin}
                  className={cn('skin-card', active && 'is-active', !owned && 'is-locked')}
                  onClick={() => void selectSkin(skin)}
                  disabled={selectingSkin !== null}
                >
                  <span className={cn('skin-preview', `skin-${skin}`)}>
                    <span>{SKINS[skin].pawn}</span>
                    {!owned && <span className="skin-lock"><Icon name="lock" size={14} /></span>}
                  </span>
                  <span className="skin-name">{SKINS[skin].name}</span>
                  <span className="skin-desc">{owned ? (active ? 'выбран' : 'открыт') : 'в наборе'}</span>
                  {active && <span className="skin-check"><Icon name="check" size={13} /></span>}
                </button>
              );
            })}
          </div>

          <div className="tip-card">
            <Icon name="spark" size={18} />
            <p>Один набор открывает все три скина навсегда. Выбрать можно в любой момент, даже во время партии.</p>
          </div>
        </div>
      )}

      {tab === 'stars' && (
        <div className="shop-body">
          <div className="shop-intro">
            <span className="eyebrow">Telegram Stars</span>
            <h2>Поддержать игру</h2>
            <p>Звёзды — внутренняя валюта Telegram. Покупки приходят мгновенно и сохраняются в профиле.</p>
          </div>

          {!config.paymentsEnabled && (
            <div className="notice-card">
              <Icon name="spark" size={18} />
              <p>В этой сборке оплата звёздами ещё не подключена. Настрой бота — и витрина заработает.</p>
            </div>
          )}

          <div className="shop-list stars-list">
            <ProductCard
              sku="lives"
              icon="heart"
              disabled={profile.lives >= profile.maxLives || paying !== null}
              note={profile.lives >= profile.maxLives ? 'Жизни уже полны' : 'Мгновенно восстановит все 5 жизней'}
              onBuy={() => void buyProduct('lives')}
              paying={paying === 'lives'}
              owned={false}
            />
            <ProductCard
              sku="noads"
              icon="shield"
              disabled={profile.adFree || paying !== null}
              note={profile.adFree ? 'Реклама уже отключена' : 'Никаких роликов и предложений навсегда'}
              onBuy={() => void buyProduct('noads')}
              paying={paying === 'noads'}
              owned={profile.adFree}
            />
            <ProductCard
              sku="skins"
              icon="crown"
              disabled={ownedSet || paying !== null}
              note={ownedSet ? 'Все скины уже открыты' : 'Золото, неон и корона для пешки'}
              onBuy={() => void buyProduct('skins')}
              paying={paying === 'skins'}
              owned={ownedSet}
            />
          </div>

          <p className="purchase-note">
            Оплата проходит через Telegram. Если платёж не пришёл сразу, подожди минуту и обнови профиль.
          </p>
        </div>
      )}

      {setModal && (
        <Modal onClose={() => setSetModal(false)} showClose>
          <div className="result-orb result-orb-gold"><Icon name="crown" size={30} /></div>
          <h2 className="modal-title">Набор скинов</h2>
          <p className="modal-text">Три образа пешки — золото, неон и корона — открываются одним набором навсегда.</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-gold" onClick={() => { setSetModal(false); void buyProduct('skins'); }} disabled={paying !== null}>
              <Icon name="star" size={16} />
              Купить за {PRODUCTS.skins.stars} ⭐
            </button>
            <button type="button" className="btn btn-text" onClick={() => setSetModal(false)}>
              Позже
            </button>
          </div>
        </Modal>
      )}

      {purchaseDone && (
        <Modal onClose={() => setPurchaseDone(null)}>
          <div className="result-orb result-orb-gold"><Icon name="check" size={32} /></div>
          <span className="eyebrow">Готово</span>
          <h2 className="modal-title">Покупка зачислена</h2>
          <p className="modal-text">
            {purchaseDone === 'lives'
              ? 'Все пять жизней восстановлены. Возвращайся на поле.'
              : purchaseDone === 'noads'
                ? 'Реклама отключена навсегда. Спасибо, что поддерживаешь игру!'
                : 'Набор скинов открыт. Золотой образ уже на пешке.'}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-gold" onClick={() => setPurchaseDone(null)}>
              Отлично
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProductCard({
  sku,
  icon,
  note,
  disabled,
  owned,
  paying,
  onBuy,
}: {
  sku: ProductSku;
  icon: 'heart' | 'shield' | 'crown';
  note: string;
  disabled: boolean;
  owned: boolean;
  paying: boolean;
  onBuy: () => void;
}): ReactNode {
  const product = PRODUCTS[sku];
  return (
    <div className={cn('shop-item product-card', owned && 'is-owned')}>
      <span className={cn('shop-item-icon', `product-${sku}`)}>
        <Icon name={icon} size={22} />
      </span>
      <div className="shop-item-copy">
        <div className="shop-item-head">
          <b>{product.title}</b>
          {product.badge && <span className="owned-count">{product.badge}</span>}
        </div>
        <p>{note}</p>
        <div className="shop-item-price stars-price">
          <Icon name="star" size={14} />
          {product.stars}
        </div>
      </div>
      <button type="button" className="buy-btn" onClick={onBuy} disabled={disabled}>
        {owned ? 'Есть' : paying ? '…' : 'Купить'}
      </button>
    </div>
  );
}
