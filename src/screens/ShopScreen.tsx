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
import { Modal } from '../components/Modal';

interface ShopScreenProps {
  onBack: () => void;
  initialTab?: ShopTab;
  onTerms: () => void;
  onPrivacy: () => void;
}

export function ShopScreen({ onBack, initialTab = 'bonuses', onTerms, onPrivacy }: ShopScreenProps): ReactNode {
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
      toast(`${SKINS[skin].name}, теперь ваш образ`, 'success');
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
        toast('Платёж обрабатывается. Проверьте профиль через минуту.', 'info');
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
        <button type="button" className="back-btn" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <div className="page-heading" style={{ flex: 1 }}>
          <span className="label">Витрина</span>
          <h1 className="page-title">Магазин</h1>
        </div>
        <div className="page-side">
          <span className="label">Монеты</span>
          <b>{formatNumber(profile.coins)}</b>
        </div>
      </header>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'bonuses'} className={cn('tab', tab === 'bonuses' && 'active')} onClick={() => setTab('bonuses')}>
          Бонусы
        </button>
        <button type="button" role="tab" aria-selected={tab === 'skins'} className={cn('tab', tab === 'skins' && 'active')} onClick={() => setTab('skins')}>
          Скины
        </button>
        <button type="button" role="tab" aria-selected={tab === 'stars'} className={cn('tab', tab === 'stars' && 'active')} onClick={() => setTab('stars')}>
          Звёзды
        </button>
      </div>

      {tab === 'bonuses' && (
        <div>
          <div className="shop-intro">
            <span className="label">За монеты</span>
            <h2>Бонусы на партию</h2>
            <p>
              Монеты начисляют за пройденные уровни и рекорды в бесконечном режиме. Бонусы лежат в
              инвентаре и тратятся по команде.
            </p>
          </div>

          <div className="shop-list">
            {BONUS_ORDER.map((kind) => {
              const bonus = BONUSES[kind];
              const count = profile.inventory[kind];
              const affordable = profile.coins >= bonus.price;
              return (
                <div className="shop-row" key={kind}>
                  <div className="shop-row-main">
                    <div className="shop-row-title">
                      {bonus.name}
                      {count > 0 && <span className="owned-count">в запасе {count}</span>}
                    </div>
                    <p className="shop-row-desc">{bonus.description}</p>
                    <div className="shop-row-price">{bonus.price} монет</div>
                  </div>
                  <button
                    type="button"
                    className="buy-btn"
                    onClick={() => void buyBonus(kind)}
                    disabled={buyingBonus !== null || !affordable}
                  >
                    {buyingBonus === kind ? 'Покупка' : affordable ? 'Купить' : 'Мало монет'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="notice">
            <span className="label">Как это работает</span>
            <span>
              Бонус можно взять прямо в партии. Если монет не хватит, игра предложит посмотреть
              рекламу в меню или дождаться новой награды.
            </span>
          </div>

          <div className="legal-link-row">
            <button type="button" onClick={onTerms}>Условия использования</button>
            <button type="button" onClick={onPrivacy}>Конфиденциальность</button>
          </div>
        </div>
      )}

      {tab === 'skins' && (
        <div>
          <div className="skin-feature">
            <div className="feature-pawns" aria-hidden="true">
              <span>♟</span>
              <span>♟</span>
              <span>♟</span>
            </div>
            <span className="label label-accent">Набор из трёх</span>
            <h2>{ownedSet ? 'Набор открыт' : 'Другой образ пешки'}</h2>
            <p>
              Золото, полночь и лилия. Скин меняет только вид пешки, правила остаются
              прежними.
            </p>
            {ownedSet ? (
              <p className="modal-note">Все три образа уже в коллекции, выберите любой ниже.</p>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void buyProduct('skins')} disabled={paying !== null}>
                {paying === 'skins' ? 'Открываем' : `Набор за ${PRODUCTS.skins.stars} звёзд`}
              </button>
            )}
          </div>

          <span className="label section-label">Выберите образ</span>
          <div className="skin-list">
            {SKIN_ORDER.map((skin) => {
              const owned = profile.skins.includes(skin);
              const active = profile.skin === skin;
              return (
                <button
                  type="button"
                  key={skin}
                  className={cn('skin-row', active && 'active')}
                  onClick={() => void selectSkin(skin)}
                  disabled={selectingSkin !== null}
                >
                  <span className={cn('skin-swatch', `skin-${skin}`)} aria-hidden="true">
                    {SKINS[skin].pawn}
                  </span>
                  <span className="skin-row-main">
                    <span className="skin-name">{SKINS[skin].name}</span>
                    <span className="skin-desc">
                      {SKINS[skin].description}. {owned ? '' : 'Входит в набор.'}
                    </span>
                  </span>
                  <span className="skin-state">{active ? 'выбран' : owned ? 'открыт' : 'закрыт'}</span>
                </button>
              );
            })}
          </div>

          <p className="ledger">
            Один набор открывает все три скина навсегда. Выбрать можно в любой момент, даже в
            середине партии.
          </p>
        </div>
      )}

      {tab === 'stars' && (
        <div>
          <div className="shop-intro">
            <span className="label">Telegram Stars</span>
            <h2>Поддержать игру</h2>
            <p>
              Звёзды это внутренняя валюта Telegram. Покупки приходят сразу и остаются в профиле.
            </p>
          </div>

          {!config.paymentsEnabled && (
            <div className="notice">
              <span className="label">Внимание</span>
              <span>В этой сборке оплата звёздами ещё не подключена. Настройте бота, и витрина заработает.</span>
            </div>
          )}

          <div className="shop-list">
            <ProductCard
              sku="lives"
              disabled={profile.lives >= profile.maxLives || paying !== null}
              note={profile.lives >= profile.maxLives ? 'Жизни уже полны' : 'Мгновенно восстанавливает все пять жизней'}
              onBuy={() => void buyProduct('lives')}
              paying={paying === 'lives'}
              owned={false}
            />
            {config.adsEnabled && (
              <ProductCard
                sku="noads"
                disabled={profile.adFree || paying !== null}
                note={profile.adFree ? 'Реклама уже отключена' : 'Никаких роликов и предложений навсегда'}
                onBuy={() => void buyProduct('noads')}
                paying={paying === 'noads'}
                owned={profile.adFree}
              />
            )}
            <ProductCard
              sku="skins"
              disabled={ownedSet || paying !== null}
              note={ownedSet ? 'Все скины уже открыты' : 'Золото, полночь и лилия'}
              onBuy={() => void buyProduct('skins')}
              paying={paying === 'skins'}
              owned={ownedSet}
            />
          </div>

          <p className="stars-note">
            Оплата проходит в Telegram. Если покупка не пришла сразу, подождите минуту и обновите
            профиль. Возврат регулируется правилами Telegram.
          </p>

          <div className="legal-link-row">
            <button type="button" onClick={onTerms}>Условия использования</button>
            <button type="button" onClick={onPrivacy}>Конфиденциальность</button>
          </div>
        </div>
      )}

      {setModal && (
        <Modal onClose={() => setSetModal(false)} showClose>
          <span className="label">Набор скинов</span>
          <h2 className="modal-title">Три образа пешки</h2>
          <p className="modal-text">
            Золото, полночь и лилия открываются одним набором навсегда.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => { setSetModal(false); void buyProduct('skins'); }} disabled={paying !== null}>
              Купить за {PRODUCTS.skins.stars} звёзд
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setSetModal(false)}>
              Позже
            </button>
          </div>
        </Modal>
      )}

      {purchaseDone && (
        <Modal onClose={() => setPurchaseDone(null)}>
          <span className="label">Готово</span>
          <h2 className="modal-title">Покупка зачислена</h2>
          <p className="modal-text">
            {purchaseDone === 'lives'
              ? 'Все пять жизней восстановлены. Возвращайтесь на поле.'
              : purchaseDone === 'noads'
                ? 'Реклама отключена навсегда. Спасибо, что поддерживаете игру.'
                : 'Набор скинов открыт. Золотой образ уже на пешке.'}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => setPurchaseDone(null)}>
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
  note,
  disabled,
  owned,
  paying,
  onBuy,
}: {
  sku: ProductSku;
  disabled: boolean;
  owned: boolean;
  paying: boolean;
  note: string;
  onBuy: () => void;
}): ReactNode {
  const product = PRODUCTS[sku];
  return (
    <div className="shop-row">
      <div className="shop-row-main">
        <div className="shop-row-title">
          {product.title}
          {product.badge && <span className="owned-count">{product.badge}</span>}
        </div>
        <p className="shop-row-desc">{note}</p>
        <div className="shop-row-price">{product.stars} звёзд</div>
      </div>
      <button type="button" className="buy-btn" onClick={onBuy} disabled={disabled}>
        {owned ? 'Есть' : paying ? 'Оплата' : 'Купить'}
      </button>
    </div>
  );
}
