import { useState, type ReactNode } from 'react';
import { AD_COINS_REWARD, LIFE_REGEN_MS, resolveSkin, type GameMode } from '../engine';
import { useApp } from '../context/AppContext';
import { api, ApiError, clearSessionToken, isLinked } from '../lib/api';
import { getTg } from '../lib/telegram';
import { TelegramLink } from '../components/TelegramLink';
import { cn, formatDuration, formatNumber } from '../lib/format';
import { useCountdown, useNow } from '../lib/hooks';
import type { AdRewardResponse } from '../lib/types';
import { HeartsRow, Hud, ProfileChip } from '../components/Hud';
import { ChallengeBanner } from '../components/ChallengeBanner';
import { SkinMark } from '../components/SkinMark';
import { tr, trf } from '../lib/i18n';

interface MenuScreenProps {
  onPlay: (mode: GameMode) => void;
  onOpenRules: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
}

export function MenuScreen({ onPlay, onOpenRules, onTerms, onPrivacy }: MenuScreenProps): ReactNode {
  const { profile, config, active, challenge, setProfile, refresh, toast, showAd, goShop, goShopStars, goRecords } = useApp();
  const [challengeHidden, setChallengeHidden] = useState(false);
  const [adLoading, setAdLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [linked, setLinked] = useState(() => isLinked());
  const inTelegram = Boolean(getTg()?.initData);
  const now = useNow(1000, adLoading || cooldownUntil > 0);
  const cooldownLeft = Math.max(0, cooldownUntil - now);

  // Тема надета на аккаунт, поэтому она в шапке: цвета экрана тема красит, а
  // без фигуры игрока в меню было не видно, надел ты свою «Кляксу» или нет.
  const skin = resolveSkin(profile.skin, profile.customSkin ?? null);
  const campaignRun = active.campaign;
  const modes = profile.modes;

  async function claimCoins() {
    if (adLoading || cooldownLeft > 0 || profile.adFree) return;
    setAdLoading(true);
    try {
      const rewarded = await showAd(trf('+{0} монет', [AD_COINS_REWARD]));
      if (!rewarded) return;
      const response = await api<AdRewardResponse>('/api/ads/reward', {
        method: 'POST',
        body: { kind: 'coins' },
      });
      setProfile(response.profile);
      toast(trf('+{0} монет', [AD_COINS_REWARD]), 'success');
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          const retry = Number(error.details.retryInMs ?? 60_000);
          setCooldownUntil(Date.now() + Math.max(0, retry));
        }
        toast(error.message, 'error');
      } else {
        toast(tr('Не удалось получить награду'), 'error');
      }
    } finally {
      setAdLoading(false);
    }
  }

  /**
   * Карточка режима: та же кнопка, что у кампании, а не строка в «Разделах».
   * «Парковка», «Гонки» и бесконечный режим - полноценные режимы со своим
   * уровнем, рекордом и незаконченным забегом, и прятать их ниже склада было не
   * за что. Замок карточку не убирает: на ней видно, на каком уровне кампании
   * режим откроется.
   *
   * Название режима живёт на карточке всегда: если «Продолжить» подменяет
   * подпись входа, игрок не понимает, куда именно его возвращают, - о
   * незаконченной партии говорит своя строка ниже.
   */
  function modeCard(mode: 'jam' | 'race' | 'endless', title: string, description: string) {
    const progress = modes?.[mode];
    const run = active[mode];
    const unlocked = mode === 'endless' ? profile.endlessUnlocked : (progress?.unlocked ?? true);
    const cleared = Math.max(0, (progress?.maxLevel ?? 1) - 1);
    const best = progress?.bestMoves ?? progress?.best;
    // Уровень и рекорд режима живут на самой кнопке и не исчезают ради строки
    // «незаконченная партия»: отдельного блока цифр под меню больше нет, и без
    // этой строки прогресс режима посмотреть было бы негде.
    const numbers =
      mode === 'endless'
        ? profile.endlessBest > 0
          ? trf('Рекорд {0} клеток', [formatNumber(profile.endlessBest)])
          : tr('Рекорда ещё нет')
        : trf('Уровень {0}, {1}', [
            progress?.level ?? 1,
            mode === 'race'
              ? best
                ? trf('рекорд {0} ходов', [formatNumber(best)])
                : tr('считается длина забега')
              : trf('пройдено {0}', [formatNumber(cleared)]),
          ]);
    const status = !unlocked
      ? trf('Откроется на {0} уровне кампании', [progress?.unlockAtLevel ?? 3])
      : run
        ? mode === 'endless'
          ? trf('Незаконченный забег: высота {0}, ход {1}', [run.score, run.moves + 1])
          : trf('Незаконченная партия: уровень {0}, ход {1}', [run.level, run.moves + 1])
        : description;
    return (
      <button
        type="button"
        className={cn('cta-block', 'cta-mode', !unlocked && 'locked')}
        onClick={() => onPlay(mode)}
        aria-disabled={!unlocked}
      >
        <span className="cta-body">
          <span className="label">{title}</span>
          <span className="cta-title serif">{unlocked ? (run ? tr('Продолжить') : tr('Играть')) : tr('Закрыт')}</span>
          <span className="cta-meta">{unlocked ? `${status} ${numbers}` : status}</span>
        </span>
        <span className="cta-arrow" aria-hidden="true">→</span>
      </button>
    );
  }

  return (
    <div className="screen menu-screen">
      <header className="topbar">
        <ProfileChip profile={profile} />
        <div className="topbar-actions">
          <Hud profile={profile} onCoins={goShop} onLives={goShopStars} />
          <button type="button" className="help-btn" onClick={onOpenRules} aria-label={tr('Правила игры')}>
            ?
          </button>
        </div>
      </header>

      {challenge && !challengeHidden && (
        <ChallengeBanner challenge={challenge} onAccept={() => onPlay('campaign')} onClose={() => setChallengeHidden(true)} />
      )}

      <section className="masthead">
        <span className="label masthead-kicker">{tr('Шахматные головоломки в Telegram')}</span>
        <div className="masthead-line">
          <h1 className="masthead-title serif">
            <span>{tr('Край')}</span> <em>{tr('доски')}</em>
          </h1>
          {/*
            Фигура надетой темы стоит в одной строке с названием: ниже она
            сползала к концу подзаголовка и читалась как картинка при описании,
            а не как то, чем ты играешь.
          */}
          <span className="masthead-figure">
            <SkinMark skin={skin} size={38} plate />
          </span>
        </div>
        <p className="masthead-sub">
          {tr('Четыре режима - одна доска: кампания с уровнями, «Парковка» - пробка фигур к своему краю, «Гонки» - король в полосе, и бесконечный подъём без финиша. Правила у каждого свои, жизни - общие.')}
        </p>
      </section>

      {/*
        Четыре входа в игру одной сеткой 2×2: полосы на всю ширину выталкивали
        «Магазин» и «Рекорды» за нижний край, и их искали скроллом.
      */}
      <div className="menu-modes">
        <button type="button" className="cta-block cta-primary" onClick={() => onPlay('campaign')}>
          <span className="cta-body">
            <span className="label">{tr('Кампания')}</span>
            <span className="cta-title serif">{campaignRun ? tr('Продолжить') : tr('Играть')}</span>
            <span className="cta-meta">
              {campaignRun
                ? trf('Незаконченная партия: уровень {0}, ход {1}', [campaignRun.level, campaignRun.moves + 1])
                : profile.levelsCleared > 0
                  ? trf('Уровень {0}, пройдено {1}', [profile.level, formatNumber(profile.levelsCleared)])
                  : tr('Уровень 1, путь начинается')}
            </span>
          </span>
          <span className="cta-arrow" aria-hidden="true">→</span>
        </button>

        {modeCard('jam', tr('Парковка'), tr('Пробка фигур: белых за нижний край, чёрных за верхний.'))}
        {modeCard('race', tr('Гонки'), tr('Король в полосе против фигур сверху.'))}
        {modeCard('endless', tr('Бесконечный режим'), tr('Пешка идёт всё выше, сложность растёт каждые пять ходов.'))}
      </div>

      <div className="section-head">
        <span className="label">{tr('Разделы')}</span>
        <span className="label">{profile.lives < profile.maxLives ? tr('жизни восстанавливаются') : tr('все жизни в запасе')}</span>
      </div>

      <div className="menu-list">
        <button type="button" className="menu-row" onClick={goShop}>
          <span className="menu-row-main">
            <span className="menu-row-title">{tr('Магазин')}</span>
            <span className="menu-row-desc">{tr('Бонусы за монеты, скины и покупки за звёзды')}</span>
          </span>
          <span className="menu-row-end">→</span>
        </button>

        <button type="button" className="menu-row" onClick={goRecords}>
          <span className="menu-row-main">
            <span className="menu-row-title">{tr('Рекорды')}</span>
            <span className="menu-row-desc">{tr('Мировая таблица и друзья, пришедшие по ссылке')}</span>
          </span>
          <span className="menu-row-end">→</span>
        </button>

        {/*
          Разбор расстановок и статистика - служебная часть, и в общем меню она
          только путает: игроку некуда вести ссылку на чужую кухню. Показываем её
          аккаунтам из льготного списка `QA_LIVES_IDS`, у остальных строки нет.
          Сам /admin при этом закрыт паролем для всех.
        */}
        {profile.qa && (
          <a className="menu-row" href="/admin">
            <span className="menu-row-main">
              <span className="menu-row-title">{tr('Лаборатория')}</span>
              <span className="menu-row-desc">{tr('Разбор расстановок и статистика, вход по паролю')}</span>
            </span>
            <span className="menu-row-end">→</span>
          </a>
        )}

      </div>

      <div className="account">
        <span className="label">{tr('Сохранение прогресса')}</span>
        {inTelegram ? (
          <p className="account-text">
            {tr('Игра открыта из Telegram, прогресс привязан к твоему аккаунту и не потеряется при перезапуске.')}
          </p>
        ) : linked ? (
          <>
            <p className="account-text">{tr('Аккаунт Telegram подключён, прогресс переживёт закрытие браузера.')}</p>
            <div className="account-actions">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  clearSessionToken();
                  setLinked(false);
                  void refresh();
                  toast(tr('Сеанс сброшен, играешь как гость на этом устройстве'));
                }}
              >
                {tr('Выйти из аккаунта')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="account-text">
              {tr('Без входа прогресс живёт в этом браузере и может пропасть вместе с ним. Привяжи Telegram: уровень, монеты и рекорды останутся с аккаунтом на любом устройстве, а текущий прогресс переедет следом. Откроется чат бота, там нужно нажать «Да».')}
            </p>
            <TelegramLink
              onLinked={({ merged }) => {
                setLinked(true);
                void refresh();
                toast(merged ? tr('Прогресс привязан к Telegram') : tr('Вошли через Telegram'));
              }}
            />
          </>
        )}
      </div>

      {profile.lives < profile.maxLives && <LivesPool onShop={goShopStars} onRefresh={refresh} />}

      {config.adsEnabled && !profile.adFree && (
        <button
          type="button"
          className="ad-row"
          onClick={claimCoins}
          disabled={adLoading || cooldownLeft > 0}
        >
          <span className="ad-row-main">
            <span className="ad-row-title">
              {adLoading
                ? tr('Загружаем ролик')
                : cooldownLeft > 0
                  ? trf('Следующая награда через {0}', [formatDuration(cooldownLeft)])
                  : tr('Реклама за монеты')}
            </span>
            <span className="ad-row-desc">{tr('Добровольный просмотр, не чаще одного раза в минуту')}</span>
          </span>
          <span className="ad-row-reward">+{AD_COINS_REWARD}</span>
        </button>
      )}

      {profile.isGuest && (
        <p className="guest-note">
          {tr('Гостевой режим: прогресс хранится только в этом браузере. Чтобы сохранить его в Telegram, откройте игру через бота.')}
        </p>
      )}

      <footer className="menu-footer">
        <button type="button" onClick={onOpenRules}>{tr('Правила')}</button>
        <span className="sep">/</span>
        <button type="button" onClick={onTerms}>{tr('Условия')}</button>
        <span className="sep">/</span>
        <button type="button" onClick={onPrivacy}>{tr('Конфиденциальность')}</button>
        <span className="sep">/</span>
        <span>2026</span>
        {profile.adFree && <span className="sep">/</span>}
        {profile.adFree && <span>{tr('без рекламы')}</span>}
        <span className="footer-mode">{config.devMode ? 'dev' : 'v1.0'}</span>
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
    <div className="resource-row">
      <span className="resource-main">
        <HeartsRow
          lives={profile.lives}
          maxLives={profile.maxLives}
          eternal={profile.eternalLives}
        />
        <span className="resource-caption">
          {tr('Следующая жизнь через')} <b>{formatDuration(remaining)}</b>
        </span>
        <span className="resource-note">
          {progress > 0 ? tr('Отсчёт идёт') : tr('Отсчёт начнётся после потери жизни')}
        </span>
      </span>
      <button type="button" className="btn btn-outline" style={{ minHeight: 32, padding: '0 10px', fontSize: 11 }} onClick={onShop}>
        {tr('Пополнить')}
      </button>
    </div>
  );
}
