import { useEffect, useState, type ReactNode } from 'react';
import {
  ASH_RECORD_MOVES,
  BONUSES,
  BONUS_ORDER,
  PAID_SKINS,
  PRODUCTS,
  SKINS,
  SKIN_ORDER,
  SKIN_CUSTOM_COINS,
  SKIN_CUSTOM_STARS,
  SKIN_SET_COINS,
  SKIN_SET_STARS,
  SKIN_COINS,
  SKIN_STARS,
  productSkuForSkin,
  resolveSkin,
  skinCoinPrice,
  skinUnlocked,
  type BonusId,
  type CustomSkin,
  type PaidSkinId,
  type ProductSku,
  type SkinId,
} from '../engine';
import { useApp, type ShopTab } from '../context/AppContext';
import { api, ApiError } from '../lib/api';
import { cn, formatNumber } from '../lib/format';
import { getTg, hapticNotify, openInvoice } from '../lib/telegram';
import type { BonusUseResponse, Profile } from '../lib/types';
import { Modal } from '../components/Modal';
import { SkinPreview } from '../components/SkinPreview';
import { SkinStudio } from '../components/SkinStudio';
import { tr, trf } from '../lib/i18n';

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
  // Монетная покупка идёт своим флагом: `paying` держит SKU звёздного товара, а
  // набора за монеты в нём нет и быть не должно - счёт на звёзды не создаётся.
  const [coinBuying, setCoinBuying] = useState<PaidSkinId | 'set' | 'custom' | null>(null);
  const [purchaseDone, setPurchaseDone] = useState<ProductSku | null>(null);
  const [setModal, setSetModal] = useState(false);
  // Студию открывают под конкретный слот: «править первую» и «рисовать вторую»
  // - разные намерения, а сохранение всегда в первый слот затирало бы рисунок.
  const [studioSlot, setStudioSlot] = useState<number | null>(null);
  const [slotBusy, setSlotBusy] = useState<number | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [installing, setInstalling] = useState<number | null>(null);

  const ownedSet = PAID_SKINS.every((skin) => profile.skins.includes(skin));
  const wearing = resolveSkin(profile.skin, profile.customSkin);

  // Свои темы - слоты. Профиль старой сборки сервера их ещё не присылает,
  // поэтому числа выводятся из того, что есть: `customPaid` = один слот.
  const customSlots = profile.customSlots ?? (profile.customPaid ? 1 : 0);
  const customMaxSlots = profile.customMaxSlots ?? 3;
  const customActive = profile.customActive ?? 1;
  const customSkins = profile.customSkins ?? [profile.customSkin ?? null];

  // Открытие витрины пишется в журнал: без этой метрики доля покупателей в
  // лаборатории считается от всех игроков сразу и выглядит вдвое лучше, чем есть.
  useEffect(() => {
    void api('/api/shop/open', { method: 'POST' }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (tab !== 'skins') return;
    void api<{ items: GalleryItem[] }>('/api/skins/gallery')
      .then((data) => setGallery(data.items ?? []))
      .catch(() => setGallery([]));
  }, [tab]);

  async function buyBonus(kind: BonusId) {
    if (buyingBonus) return;
    const price = BONUSES[kind].price;
    if (profile.coins < price) {
      toast(tr('Не хватает монет. Посмотри рекламу в меню.'), 'info');
      return;
    }
    setBuyingBonus(kind);
    try {
      const response = await api<{ profile: Profile }>('/api/shop/bonus', { method: 'POST', body: { kind } });
      setProfile(response.profile);
      hapticNotify('success');
      toast(`+1 ${tr(BONUSES[kind].name).toLowerCase()}`, 'success');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : tr('Покупка не прошла'), 'error');
    } finally {
      setBuyingBonus(null);
    }
  }

  async function selectSkin(skin: SkinId) {
    if (skin === profile.skin || selectingSkin) return;
    // Своя тема надевается всегда: она либо уже в профиле, либо её ещё не
    // собрали - и тогда вместо надевания открываем студию.
    if (skin === 'custom' && (!profile.customSkin || !profile.customPaid)) {
      // Студия открыта всем: без рисунка и без мастерской надевать нечего,
      // поэтому здесь просто показываем, где это собирается и сколько стоит.
      setStudioSlot(Math.max(1, customActive));
      return;
    }
    if (!skinUnlocked(skin, profile.skins, Boolean(profile.customSkin))) {
      setSetModal(true);
      return;
    }
    setSelectingSkin(skin);
    try {
      const response = await api<{ profile: Profile }>('/api/profile/skin', { method: 'POST', body: { skin } });
      setProfile(response.profile);
      hapticNotify('success');
      toast(trf('{0}, теперь ваш образ', [tr(SKINS[skin].name)]), 'success');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : tr('Не удалось выбрать скин'), 'error');
    } finally {
      setSelectingSkin(null);
    }
  }

  /**
   * Тема за монеты. Отдельный путь, а не `buyProduct`: звёзды идут через счёт и
   * webhook, монеты списываются на месте - и возвратом тут не пахнет, возвращать
   * нечего. Тема награды (`ash`) сюда не доходит: её нельзя купить ни за что.
   */
  /** Цена монетами одной вещи: тема, набор или мастерская - всё из курса `COINS_PER_STAR`. */
  function coinPriceOf(target: PaidSkinId | 'set' | 'custom'): number {
    if (target === 'set') return SKIN_SET_COINS;
    if (target === 'custom') return SKIN_CUSTOM_COINS;
    return skinCoinPrice(SKINS[target].stars);
  }

  async function buySkinWithCoins(target: PaidSkinId | 'set' | 'custom'): Promise<void> {
    if (paying || coinBuying) return;
    const price = coinPriceOf(target);
    if (profile.coins < price) {
      toast(trf('Не хватает {0} монет: их дают за уровни и рекорды', [formatNumber(price - profile.coins)]), 'info');
      return;
    }
    setCoinBuying(target);
    try {
      const response = await api<{ profile: Profile }>('/api/skins/buy-coins', {
        method: 'POST',
        body: { target },
      });
      setProfile(response.profile);
      await refresh();
      hapticNotify('success');
      toast(
        target === 'set' ? tr('Все темы ваши') : target === 'custom' ? tr('Мастерская открыта') : tr('Тема куплена за монеты'),
        'success',
      );
    } catch (error) {
      toast(error instanceof ApiError ? error.message : tr('Покупка за монеты не прошла'), 'error');
      await refresh().catch(() => undefined);
    } finally {
      setCoinBuying(null);
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

  async function buyProduct(sku: ProductSku, extra?: Record<string, unknown>): Promise<boolean> {
    if (paying) return false;
    if (!config.paymentsEnabled) {
      toast(tr('Оплата звёздами ещё не подключена в этой сборке'), 'info');
      return false;
    }
    const tg = getTg();
    if (!tg) {
      toast(tr('Оплата звёздами доступна только в Telegram'), 'info');
      return false;
    }
    setPaying(sku);
    try {
      const invoice = await api<{ url: string; chargeId: string }>('/api/shop/invoice', {
        method: 'POST',
        body: { sku, ...(extra ?? {}) },
      });
      const status = await openInvoice(invoice.url);
      if (status === 'cancelled') {
        toast(tr('Оплата отменена'), 'info');
        return false;
      }
      if (status === 'failed' || status === 'unavailable') {
        toast(tr('Не удалось открыть оплату'), 'error');
        return false;
      }
      const paid = await waitForPayment(invoice.chargeId);
      if (paid) {
        await refresh();
        hapticNotify('success');
        return true;
      }
      toast(tr('Платёж обрабатывается. Проверьте профиль через минуту.'), 'info');
      return false;
    } catch (error) {
      toast(error instanceof ApiError ? error.message : tr('Покупка не прошла'), 'error');
      return false;
    } finally {
      setPaying(null);
    }
  }

  /**
   * Публикация своей темы. Счёта нет с тех пор, как за свои темы платят слотом:
   * показ чужого рисунка ничего не стоит, иначе код темы стыдно было бы нести
   * другу. Проверка очереди остаётся - её видит модератор, а не кошелёк.
   */
  async function shareSkin(skin: CustomSkin, slot?: number): Promise<boolean> {
    try {
      await api<{ ok: boolean }>('/api/skins/publish', { method: 'POST', body: { skin, ...(slot ? { slot } : {}) } });
      await refresh();
      hapticNotify('success');
      return true;
    } catch (error) {
      toast(error instanceof ApiError ? error.message : tr('Публикация не прошла'), 'error');
      return false;
    }
  }

  /**
   * Надеть свою тему из конкретного слота. Отдельная ручка не нужна: `slot`
   * приезжает в тот же выбор темы, и сервер решает, куплено ли место.
   */
  async function wearSlot(slot: number) {
    if (slotBusy !== null) return;
    setSlotBusy(slot);
    try {
      const response = await api<{ profile: Profile }>('/api/profile/skin', {
        method: 'POST',
        body: { skin: 'custom', slot },
      });
      setProfile(response.profile);
      hapticNotify('success');
      toast(trf('Своя тема из слота {0} надета', [slot]), 'success');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : tr('Надеть не удалось'), 'error');
    } finally {
      setSlotBusy(null);
    }
  }

  /** Стереть тему: купленное место остаётся, освобождается только рисунок. */
  async function clearSlot(slot: number) {
    if (slotBusy !== null) return;
    setSlotBusy(slot);
    try {
      const response = await api<{ profile: Profile }>('/api/profile/skin-custom', {
        method: 'POST',
        body: { skin: null, slot },
      });
      setProfile(response.profile);
      toast(trf('Слот {0} освобождён', [slot]), 'info');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : tr('Стереть не удалось'), 'error');
    } finally {
      setSlotBusy(null);
    }
  }

  async function installSkin(item: GalleryItem) {
    if (installing !== null) return;
    setInstalling(item.id);
    try {
      const response = await api<{ profile: Profile }>('/api/skins/install', {
        method: 'POST',
        body: { id: item.id },
      });
      setProfile(response.profile);
      hapticNotify('success');
      toast(trf('«{0}» надета - автор {1}', [item.name, item.author]), 'success');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : tr('Поставить тему не удалось'), 'error');
    } finally {
      setInstalling(null);
    }
  }

  return (
    <div className="screen shop-screen">
      <header className="page-top">
        <button type="button" className="back-btn" onClick={onBack} aria-label={tr('Назад')}>
          ←
        </button>
        <div className="page-heading" style={{ flex: 1 }}>
          <span className="label">{tr('Витрина')}</span>
          <h1 className="page-title">{tr('Магазин')}</h1>
        </div>
        <div className="page-side">
          <span className="label">{tr('Монеты')}</span>
          <b>{formatNumber(profile.coins)}</b>
        </div>
      </header>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'bonuses'} className={cn('tab', tab === 'bonuses' && 'active')} onClick={() => setTab('bonuses')}>
          {tr('Бонусы')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'skins'} className={cn('tab', tab === 'skins' && 'active')} onClick={() => setTab('skins')}>
          {tr('Темы')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'stars'} className={cn('tab', tab === 'stars' && 'active')} onClick={() => setTab('stars')}>
          {tr('Звёзды')}
        </button>
      </div>

      {tab === 'bonuses' && (
        <div>
          <div className="shop-intro">
            <span className="label">{tr('За монеты')}</span>
            <h2>{tr('Бонусы на партию')}</h2>
            <p>
              {tr('Монеты начисляют за пройденные уровни и рекорды в бесконечном режиме. Бонусы лежат в инвентаре и тратятся по команде.')}
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
                      {tr(bonus.name)}
                      {count > 0 && <span className="owned-count">{tr('в запасе')} {count}</span>}
                    </div>
                    <p className="shop-row-desc">{bonus.description}</p>
                    <div className="shop-row-price">{bonus.price} {tr('монет')}</div>
                  </div>
                  <button
                    type="button"
                    className="buy-btn"
                    onClick={() => void buyBonus(kind)}
                    disabled={buyingBonus !== null || !affordable}
                  >
                    {buyingBonus === kind ? tr('Покупка') : affordable ? tr('Купить') : tr('Мало монет')}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="notice">
            <span className="label">{tr('Как это работает')}</span>
            <span>
              {tr('Бонус можно взять прямо в партии. Если монет не хватит, игра предложит посмотреть рекламу в меню или дождаться новой награды.')}
            </span>
          </div>

          <div className="legal-link-row">
            <button type="button" onClick={onTerms}>{tr('Условия использования')}</button>
            <button type="button" onClick={onPrivacy}>{tr('Конфиденциальность')}</button>
          </div>
        </div>
      )}

      {tab === 'skins' && (
        <div>
          <div className="skin-feature">
            <SkinPreview skin={wearing} cell={34} />
            <div className="feature-main">
              <span className="label label-accent">{ownedSet ? tr('Коллекция открыта') : tr('Темы поля')}</span>
              <h2>{tr(wearing.name)} {tr('- надета сейчас')}</h2>
              <p>
                {wearing.custom ? tr('Ваши цвета: собраны в студии и не показываются никому, пока вы сами не выставите их в галерею.') : tr(SKINS[wearing.id].description)}.{' '}
                {ownedSet
                  ? tr('Все платные темы ваши - надевайте любую.')
                  : trf('Набор из {0} тем стоит {1} звёзд или {2} монет, тема поштучно - {3} звёзд или {4} монет. Монеты идут из игры: уровни, рекорды и ролики.', [PAID_SKINS.length, SKIN_SET_STARS, formatNumber(SKIN_SET_COINS), SKIN_STARS, formatNumber(SKIN_COINS)])}
              </p>
              <div className="skin-feature-actions">
                {ownedSet ? null : (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void buyProduct('skins')}
                      disabled={paying !== null || coinBuying !== null}
                    >
                      {paying === 'skins' ? tr('Открываем') : trf('Набор за {0} звёзд', [SKIN_SET_STARS])}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => void buySkinWithCoins('set')}
                      disabled={paying !== null || coinBuying !== null}
                    >
                      {coinBuying === 'set' ? tr('Считаем') : trf('Набор за {0} монет', [formatNumber(SKIN_SET_COINS)])}
                    </button>
                  </>
                )}
                <button type="button" className="btn btn-outline" onClick={() => setStudioSlot(Math.max(1, customActive))}>
                  {profile.customSkin ? tr('Поправить свою тему') : tr('Собрать свою тему')}
                </button>
              </div>
            </div>
          </div>

          <span className="label section-label">{tr('Надето и доступно')}</span>
          <div className="skin-list">
            {SKIN_ORDER.map((id) => {
              const skin = SKINS[id];
              const unlocked = skinUnlocked(id, profile.skins, Boolean(profile.customSkin));
              const active = profile.skin === id;
              return (
                <div className={cn('skin-row', active && 'active')} key={id}>
                  <button
                    type="button"
                    className="skin-row-main"
                    onClick={() => void selectSkin(id)}
                    disabled={selectingSkin !== null}
                  >
                    <SkinPreview skin={skin} />
                    <span className="skin-text">
                      <span className="skin-name">
                        {tr(skin.name)}
                        {active && <span className="owned-count">{tr('надета')}</span>}
                      </span>
                      <span className="skin-desc">
                        {skin.reward
                          ? trf('{0}. За {1} пережитых ходов в «Гонках».', [tr(skin.description), ASH_RECORD_MOVES])
                          : unlocked
                            ? trf('{0}. Открыта навсегда.', [tr(skin.description)])
                            : trf('{0}. {1} звёзд или {2} монет.', [tr(skin.description), skin.stars, formatNumber(skinCoinPrice(skin.stars))])}
                      </span>
                    </span>
                  </button>
                  <span className="skin-side">
                    {skin.reward && !unlocked ? (
                      <span className="skin-locked">{tr('награда')}</span>
                    ) : unlocked && active ? (
                      <span className="skin-state">{tr('на вас')}</span>
                    ) : unlocked ? (
                      <button
                        type="button"
                        className="buy-btn buy-btn-quiet"
                        onClick={() => void selectSkin(id)}
                        disabled={selectingSkin !== null}
                      >
                        {selectingSkin === id ? tr('Примерка') : tr('надеть')}
                      </button>
                    ) : (
                      <span className="skin-buy-pair">
                        <button
                          type="button"
                          className="buy-btn"
                          onClick={() => void buyProduct(productSkuForSkin(id as PaidSkinId))}
                          disabled={paying !== null}
                        >
                          {paying === `skin:${id}` ? tr('Оплата') : trf('{0} звёзд', [skin.stars])}
                        </button>
                        <button
                          type="button"
                          className="buy-btn buy-btn-quiet"
                          onClick={() => void buySkinWithCoins(id as PaidSkinId)}
                          disabled={paying !== null || coinBuying !== null}
                        >
                          {coinBuying === id ? tr('Ждём') : trf('{0} монет', [formatNumber(skinCoinPrice(skin.stars))])}
                        </button>
                      </span>
                    )}
                  </span>
                </div>
              );
            })}

            <div className={cn('skin-row', profile.skin === 'custom' && 'active')}>
              <button
                type="button"
                className="skin-row-main"
                onClick={() => void selectSkin('custom')}
                disabled={selectingSkin !== null}
              >
                <SkinPreview
                  skin={
                    profile.customSkin
                      ? { ...profile.customSkin.tokens, glyph: profile.customSkin.glyph, path: profile.customSkin.path }
                      : SKINS.classic
                  }
                />
                <span className="skin-text">
                  <span className="skin-name">
                    {profile.customSkin?.name ?? tr('Своя тема')}
                    {profile.customSkin?.sharedBy ? trf(' · от {0}', [profile.customSkin.sharedBy]) : ''}
                  </span>
                  <span className="skin-desc">
                    {profile.qa
                      ? tr('Льгота: мастерская открыта вашему аккаунту, правьте и надевайте без доплат.')
                      : profile.customPaid
                        ? tr('Мастерская открыта: правится в любой момент и надевается без доплат.')
                        : trf('Цвета доски, фон и фигура. Своя тема повторяет любую из полки, поэтому место под неё стоит {0} звёзд или {1} монет. Правки, код и показ чужим - бесплатно.', [SKIN_CUSTOM_STARS, formatNumber(SKIN_CUSTOM_COINS)])}
                  </span>
                </span>
              </button>
              <span className="skin-side">
                {profile.customPaid || profile.qa ? (
                  <button type="button" className="buy-btn buy-btn-quiet" onClick={() => setStudioSlot(Math.max(1, customActive))}>
                    {profile.customSkin ? tr('студия') : tr('собрать')}
                  </button>
                ) : (
                  <span className="skin-buy-pair">
                    <button
                      type="button"
                      className="buy-btn"
                      onClick={() => void buyProduct('custom')}
                      disabled={paying !== null}
                    >
                      {paying === 'custom' ? tr('Оплата') : trf('{0} звёзд', [SKIN_CUSTOM_STARS])}
                    </button>
                    <button
                      type="button"
                      className="buy-btn buy-btn-quiet"
                      onClick={() => void buySkinWithCoins('custom')}
                      disabled={paying !== null || coinBuying !== null}
                    >
                      {coinBuying === 'custom' ? tr('Ждём') : trf('{0} монет', [formatNumber(SKIN_CUSTOM_COINS)])}
                    </button>
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Свои темы по слотам. Список показываем и когда мест меньше трёх:
              игрок должен видеть, что второе место продаётся, а не что его
              нарисованная тема - потолок витрины. */}
          {customSlots > 0 && (
            <div className="skin-slots">
              <span className="label section-label">{trf('Свои темы: {0} из {1}', [customSlots, customMaxSlots])}</span>
              {profile.customBlocked && (
                <p className="modal-note">{tr('Темы этого аккаунта заморожены: их нельзя надеть и править, разбирательство - у поддержки.')}</p>
              )}
              <div className="skin-list">
                {Array.from({ length: customMaxSlots }, (_, index) => index + 1).map((slot) => {
                  const skin = customSkins[slot - 1] ?? null;
                  const bought = slot <= customSlots;
                  const active = bought && profile.skin === 'custom' && slot === customActive;
                  return (
                    <div className={cn('skin-row', active && 'active')} key={slot}>
                      <div className="skin-row-main">
                        <SkinPreview
                          skin={skin ? { ...skin.tokens, glyph: skin.glyph, path: skin.path } : SKINS.classic}
                        />
                        <span className="skin-text">
                          <span className="skin-name">
                            {trf('Слот {0}', [slot])}
                            {active && <span className="owned-count">{tr('надета')}</span>}
                          </span>
                          <span className="skin-desc">
                            {!bought
                              ? tr('Место не куплено: его докупают ниже, правки бесплатны.')
                              : skin
                                ? trf('«{0}». Правится бесплатно в любой момент.', [skin.name])
                                : tr('Пустой слот: нарисуйте сюда вторую тему, первая останется на месте.')}
                          </span>
                        </span>
                      </div>
                      <span className="skin-side">
                        {bought ? (
                          <>
                            {skin && !active && (
                              <button
                                type="button"
                                className="buy-btn buy-btn-quiet"
                                onClick={() => void wearSlot(slot)}
                                disabled={slotBusy !== null || profile.customBlocked}
                              >
                                {slotBusy === slot ? tr('Примерка') : tr('надеть')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="buy-btn buy-btn-quiet"
                              onClick={() => setStudioSlot(slot)}
                              disabled={profile.customBlocked}
                            >
                              {skin ? tr('править') : tr('рисовать')}
                            </button>
                            {skin && (
                              <button
                                type="button"
                                className="buy-btn buy-btn-quiet"
                                onClick={() => void clearSlot(slot)}
                                disabled={slotBusy !== null}
                              >
                                {tr('стереть')}
                              </button>
                            )}
                          </>
                        ) : slot === customSlots + 1 ? (
                          <span className="skin-buy-pair">
                            <button
                              type="button"
                              className="buy-btn"
                              onClick={() => void buyProduct('custom')}
                              disabled={paying !== null || coinBuying !== null}
                            >
                              {paying === 'custom' ? tr('Оплата') : trf('{0} звёзд', [SKIN_CUSTOM_STARS])}
                            </button>
                            <button
                              type="button"
                              className="buy-btn buy-btn-quiet"
                              onClick={() => void buySkinWithCoins('custom')}
                              disabled={paying !== null || coinBuying !== null}
                            >
                              {coinBuying === 'custom' ? tr('Ждём') : trf('{0} монет', [formatNumber(SKIN_CUSTOM_COINS)])}
                            </button>
                          </span>
                        ) : (
                          <span className="skin-locked">{trf('нужен слот {0}', [slot])}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {gallery.length > 0 && (
            <>
              <span className="label section-label">{tr('Галерея игроков')}</span>
              {customSlots === 0 && !profile.qa && (
                <p className="modal-note">
                  {tr('Чужую тему ставят с открытой мастерской: она встанет в первый свободный слот и не затрёт ваш рисунок.')}
                </p>
              )}
              <div className="skin-list">
                {gallery.map((item) => (
                  <div className="skin-row" key={item.id}>
                    <button
                      type="button"
                      className="skin-row-main"
                      onClick={() => void installSkin(item)}
                      disabled={installing !== null}
                    >
                      <SkinPreview skin={{ ...item.skin.tokens, glyph: item.skin.glyph, path: item.skin.path }} />
                      <span className="skin-text">
                        <span className="skin-name">{item.name}</span>
                        <span className="skin-desc">
                          {trf('автор {0} · поставили {1}', [item.author, item.installs])}
                        </span>
                      </span>
                    </button>
                    <span className="skin-side">
                      <button
                        type="button"
                        className="buy-btn buy-btn-quiet"
                        onClick={() => void installSkin(item)}
                        disabled={installing !== null}
                      >
                        {installing === item.id ? tr('ставим') : tr('поставить')}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="ledger">
            {tr('Своя тема проходит проверку, только если вы несёте её в общую галерею: для себя правят без модератора.')}{' '}
            {trf(
              'Платят за место - {0} звёзд или {1} монет за слот: иначе полка из готовых тем не продаётся, а те же восемь цветов доступны в студии.',
              [SKIN_CUSTOM_STARS, formatNumber(SKIN_CUSTOM_COINS)],
            )}{' '}
            {tr('Второе и третье место докупаются по той же цене, правки в них ничего не стоят.')}{' '}
            {tr('Код темы передаётся бесплатно: скопируйте его в студии или перешлите в чат, вставивший получит тему к себе, а у автора ничего не изменится.')}
          </p>

          <div className="legal-link-row">
            <button type="button" onClick={onTerms}>{tr('Условия использования')}</button>
            <button type="button" onClick={onPrivacy}>{tr('Конфиденциальность')}</button>
          </div>
        </div>
      )}

      {studioSlot !== null && (
        <SkinStudio
          // Перезапуск по номеру слота: редактор инициализируется темой, и
          // переключать её внутри той же модалки значило бы хранить два
          // несогласованных состояния рисования.
          key={studioSlot}
          slot={studioSlot}
          onPickSlot={(next) => setStudioSlot(next)}
          onClose={() => setStudioSlot(null)}
          onShare={shareSkin}
          onUnlock={() => buyProduct('custom')}
        />
      )}

      {tab === 'stars' && (
        <div>
          <div className="shop-intro">
            <span className="label">Telegram Stars</span>
            <h2>{tr('Поддержать игру')}</h2>
            <p>
              {tr('Звёзды это внутренняя валюта Telegram. Покупки приходят сразу и остаются в профиле.')}
            </p>
          </div>

          {!config.paymentsEnabled && (
            <div className="notice">
              <span className="label">{tr('Внимание')}</span>
              <span>{tr('В этой сборке оплата звёздами ещё не подключена. Настройте бота, и витрина заработает.')}</span>
            </div>
          )}

          <div className="shop-list">
            <ProductCard
              sku="lives"
              disabled={profile.lives >= profile.maxLives || paying !== null}
              note={profile.lives >= profile.maxLives ? tr('Жизни уже полны') : tr('Мгновенно восстанавливает все пять жизней')}
              onBuy={() => void buyProduct('lives')}
              paying={paying === 'lives'}
              owned={false}
            />
            {config.adsEnabled && (
              <ProductCard
                sku="noads"
                disabled={profile.adFree || paying !== null}
                note={profile.adFree ? tr('Реклама уже отключена') : tr('Никаких роликов и предложений навсегда')}
                onBuy={() => void buyProduct('noads')}
                paying={paying === 'noads'}
                owned={profile.adFree}
              />
            )}
            <ProductCard
              sku="skins"
              disabled={ownedSet || paying !== null}
              note={ownedSet ? tr('Все скины уже открыты') : tr('Золото, полночь и лилия')}
              onBuy={() => void buyProduct('skins')}
              paying={paying === 'skins'}
              owned={ownedSet}
            />
          </div>

          <p className="stars-note">
            {tr('Оплата проходит в Telegram. Если покупка не пришла сразу, подождите минуту и обновите профиль. Возврат регулируется правилами Telegram.')}
          </p>

          <div className="legal-link-row">
            <button type="button" onClick={onTerms}>{tr('Условия использования')}</button>
            <button type="button" onClick={onPrivacy}>{tr('Конфиденциальность')}</button>
          </div>
        </div>
      )}

      {setModal && (
        <Modal onClose={() => setSetModal(false)} showClose>
          <span className="label">{tr('Набор скинов')}</span>
          <h2 className="modal-title">{tr('Темы поля')}</h2>
          <p className="modal-text">
            {trf(
              'Эта тема не открыта. Набор из {0} тем - {1} звёзд или {2} монет, каждая тема поштучно - {3} звёзд или {4} монет. Свои цвета в студии стоят ноль: они для вас.',
              [
                PAID_SKINS.length,
                PRODUCTS.skins.stars,
                formatNumber(SKIN_SET_COINS),
                PRODUCTS['skin:gold'].stars,
                formatNumber(SKIN_COINS),
              ],
            )}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => { setSetModal(false); void buyProduct('skins'); }} disabled={paying !== null}>
              {trf('Купить за {0} звёзд', [PRODUCTS.skins.stars])}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setSetModal(false)}>
              {tr('Позже')}
            </button>
          </div>
        </Modal>
      )}

      {purchaseDone && (
        <Modal onClose={() => setPurchaseDone(null)}>
          <span className="label">{tr('Готово')}</span>
          <h2 className="modal-title">{tr('Покупка зачислена')}</h2>
          <p className="modal-text">
            {purchaseDone === 'lives'
              ? tr('Все пять жизней восстановлены. Возвращайтесь на поле.')
              : purchaseDone === 'noads'
                ? tr('Реклама отключена навсегда. Спасибо, что поддерживаете игру.')
                : purchaseDone === 'skins'
                  ? tr('Все темы поля открыты. Наденьте любую - доска перекрасится целиком.')
                  : tr('Тема открыта и уже на вас. Если не видите изменений - наденьте её вручную в списке тем.')}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => setPurchaseDone(null)}>
              {tr('Отлично')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Строка галереи: проверенная тема, автор и число установок. */
interface GalleryItem {
  id: number;
  name: string;
  author: string;
  installs: number;
  createdAt: number;
  skin: CustomSkin;
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
          {tr(product.title)}
          {product.badge && <span className="owned-count">{product.badge}</span>}
        </div>
        <p className="shop-row-desc">{note}</p>
        <div className="shop-row-price">{product.stars} {tr('звёзд')}</div>
      </div>
      <button type="button" className="buy-btn" onClick={onBuy} disabled={disabled}>
        {owned ? tr('Есть') : paying ? tr('Оплата') : tr('Купить')}
      </button>
    </div>
  );
}
