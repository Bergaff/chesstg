import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameMode } from './engine';
import { AppContext, type AppContextValue, type ShopTab } from './context/AppContext';
import { api, ApiError } from './lib/api';
import { initTelegram, getStartParam, hapticNotify } from './lib/telegram';
import { showAdsgram } from './lib/ads';
import type { SessionResponse } from './lib/types';
import { ToastStack, type ToastItem, type ToastKind } from './components/Toast';
import { DemoAd } from './components/DemoAd';
import { NoLivesModal } from './components/NoLivesModal';
import { RulesModal } from './components/RulesModal';
import { MenuScreen } from './screens/MenuScreen';
import { GameScreen } from './screens/GameScreen';
import { ShopScreen } from './screens/ShopScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { LegalScreen } from './screens/LegalScreen';

type Screen = 'menu' | 'game' | 'shop' | 'records' | 'terms' | 'privacy';

interface DemoRequest {
  label: string;
  resolve: (value: boolean) => void;
}

export default function App(): ReactNode {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [bootError, setBootError] = useState<{ message: string; hint: string } | null>(null);
  const [screen, setScreen] = useState<Screen>('menu');
  const [shopTab, setShopTab] = useState<ShopTab>('bonuses');
  const [gameMode, setGameMode] = useState<GameMode>('campaign');
  const [gameKey, setGameKey] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [demoRequest, setDemoRequest] = useState<DemoRequest | null>(null);
  const [noLivesOpen, setNoLivesOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [legalReturn, setLegalReturn] = useState<Screen>('menu');
  const [reloadKey, setReloadKey] = useState(0);

  const toastId = useRef(0);
  const sessionRef = useRef<SessionResponse | null>(null);
  const screenRef = useRef<Screen>('menu');

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    initTelegram();
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-2), { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3500);
    if (kind === 'success') hapticNotify('success');
    if (kind === 'error') hapticNotify('error');
  }, []);

  const setProfile = useCallback((profile: NonNullable<SessionResponse>['profile']) => {
    setSession((current) => (current ? { ...current, profile } : current));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await api<SessionResponse>('/api/session');
      setSession((current) =>
        current
          ? {
              ...current,
              profile: response.profile,
              config: response.config,
              active: response.active,
              invitedCount: response.invitedCount,
              challenge: current.challenge ?? response.challenge,
            }
          : response,
      );
    } catch {
      /* офлайн-режим: продолжаем с последними данными */
    }
  }, []);

  const showAd = useCallback(
    async (label: string): Promise<boolean> => {
      const config = sessionRef.current?.config;
      if (!config) return false;
      if (config.demoAds) {
        return new Promise<boolean>((resolve) => {
          setDemoRequest({ label, resolve });
        });
      }
      if (!config.adsgram.blockId) {
        toast('Реклама ещё не настроена', 'info');
        return false;
      }
      try {
        const rewarded = await showAdsgram(config.adsgram.blockId, config.adsgram.src);
        if (!rewarded) toast('Ролик закрыт, награда не начислена', 'info');
        return rewarded;
      } catch {
        toast('Реклама временно недоступна', 'error');
        return false;
      }
    },
    [toast],
  );

  // Первичная загрузка сессии.
  useEffect(() => {
    let cancelled = false;
    const startParam = getStartParam();
    (async () => {
      try {
        const response = await api<SessionResponse>('/api/session', {
          method: 'POST',
          body: { startParam },
        });
        if (cancelled) return;
        setSession(response);
        setBootError(null);
        if (response.referral?.rewarded) {
          toast(`Приглашение сработало: +${response.referral.bonus}  монет`, 'success');
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError) {
          if (error.status === 401) {
            setBootError({
              message: error.message,
              hint: 'Открой игру через кнопку в Telegram-боте. В браузере прогресс доступен только в гостевом режиме.',
            });
          } else if (error.code === 'network') {
            setBootError({ message: 'Нет связи с сервером', hint: 'Проверьте интернет и попробуйте ещё раз.' });
          } else {
            setBootError({ message: error.message, hint: 'Попробуй обновить экран.' });
          }
        } else {
          setBootError({ message: 'Не удалось открыть игру', hint: 'Попробуй ещё раз.' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, toast]);

  // Периодическое обновление жизней и профиля.
  useEffect(() => {
    if (!session) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const interval = window.setInterval(tick, session.profile.lives < session.profile.maxLives ? 30_000 : 90_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh, session]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, reloadKey]);

  const goMenu = useCallback(() => {
    setNoLivesOpen(false);
    setRulesOpen(false);
    setScreen('menu');
    void refresh();
  }, [refresh]);

  const goShop = useCallback(() => {
    setNoLivesOpen(false);
    setRulesOpen(false);
    setShopTab('bonuses');
    setScreen('shop');
    void refresh();
  }, [refresh]);

  const goShopStars = useCallback(() => {
    setNoLivesOpen(false);
    setRulesOpen(false);
    setShopTab('stars');
    setScreen('shop');
    void refresh();
  }, [refresh]);

  const goRecords = useCallback(() => {
    setNoLivesOpen(false);
    setRulesOpen(false);
    setScreen('records');
    void refresh();
  }, [refresh]);

  const openLegal = useCallback((kind: 'terms' | 'privacy') => {
    setLegalReturn((current) => (current === 'terms' || current === 'privacy' ? current : screenRef.current));
    setRulesOpen(false);
    setScreen(kind);
    window.scrollTo(0, 0);
  }, []);

  const switchLegal = useCallback((kind: 'terms' | 'privacy') => {
    setScreen(kind);
    window.scrollTo(0, 0);
  }, []);

  const play = useCallback(
    (mode: GameMode) => {
      if (!session) return;
      if (mode === 'endless' && !session.profile.endlessUnlocked) {
        toast('Бесконечный режим откроется после 10 уровня', 'info');
        return;
      }
      if (session.profile.lives <= 0 && !session.active[mode]) {
        setNoLivesOpen(true);
        return;
      }
      setGameMode(mode);
      setGameKey((key) => key + 1);
      setScreen('game');
    },
    [session, toast],
  );

  const exitGame = useCallback(() => {
    setScreen('menu');
    void refresh();
  }, [refresh]);

  const handleNoLives = useCallback(() => {
    setNoLivesOpen(true);
  }, []);

  const contextValue = useMemo<AppContextValue | null>(() => {
    if (!session) return null;
    return {
      profile: session.profile,
      config: session.config,
      active: session.active,
      invitedCount: session.invitedCount,
      challenge: session.challenge,
      setProfile,
      refresh,
      toast,
      showAd,
      goMenu,
      goShop,
      goShopStars,
      goRecords,
      openTerms: () => openLegal('terms'),
      openPrivacy: () => openLegal('privacy'),
    };
  }, [goMenu, goRecords, goShop, goShopStars, openLegal, refresh, session, setProfile, showAd, toast]);

  if (!session || !contextValue) {
    return (
      <div className="boot-screen">
        <span className="boot-mark" aria-hidden="true">♟</span>
        <h1 className="boot-title">
          Пешка <em>против всех</em>
        </h1>
        {bootError ? (
          <div className="boot-error">
            <p className="boot-text" style={{ marginTop: 0 }}>{bootError.message}</p>
            <p className="boot-text" style={{ marginTop: 0 }}>{bootError.hint}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setBootError(null);
                setSession(null);
                setReloadKey((key) => key + 1);
              }}
            >
              Повторить
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => window.location.reload()}>
              Перезагрузить
            </button>
          </div>
        ) : (
          <p className="boot-text">Расставляем фигуры</p>
        )}
        <footer className="boot-foot">Telegram Mini App, 2026</footer>
      </div>
    );
  }

  return (
    <AppContext.Provider value={contextValue}>
      <div className="app">
        {screen === 'menu' && (
          <MenuScreen
            onPlay={play}
            onOpenRules={() => setRulesOpen(true)}
            onTerms={() => openLegal('terms')}
            onPrivacy={() => openLegal('privacy')}
          />
        )}
        {screen === 'game' && (
          <GameScreen
            key={gameKey}
            mode={gameMode}
            onExit={exitGame}
            onNoLives={handleNoLives}
            onTerms={() => openLegal('terms')}
            onPrivacy={() => openLegal('privacy')}
          />
        )}
        {screen === 'shop' && (
          <ShopScreen
            onBack={goMenu}
            initialTab={shopTab}
            onTerms={() => openLegal('terms')}
            onPrivacy={() => openLegal('privacy')}
          />
        )}
        {screen === 'records' && <RecordsScreen onBack={goMenu} />}
        {(screen === 'terms' || screen === 'privacy') && (
          <LegalScreen
            kind={screen}
            onBack={() => setScreen(legalReturn === 'terms' || legalReturn === 'privacy' ? 'menu' : legalReturn)}
            onSwitch={switchLegal}
          />
        )}

        <ToastStack
          items={toasts}
          onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))}
        />

        {demoRequest && (
          <DemoAd
            label={demoRequest.label}
            onFinish={(rewarded) => {
              const resolve = demoRequest.resolve;
              setDemoRequest(null);
              resolve(rewarded);
            }}
          />
        )}

        {noLivesOpen && (
          <NoLivesModal
            profile={session.profile}
            config={session.config}
            showAd={showAd}
            onProfile={setProfile}
            onClose={() => setNoLivesOpen(false)}
            onRefresh={refresh}
            onShop={goShopStars}
            onTerms={() => openLegal('terms')}
            onPrivacy={() => openLegal('privacy')}
          />
        )}

        {rulesOpen && (
          <RulesModal
            onClose={() => setRulesOpen(false)}
            onTerms={() => openLegal('terms')}
            onPrivacy={() => openLegal('privacy')}
          />
        )}
      </div>
    </AppContext.Provider>
  );
}

export function BootFallback(): ReactNode {
  return (
    <div className="boot-screen">
      <div className="boot-screen">
        <span className="boot-mark" aria-hidden="true">♟</span>
        <h1 className="boot-title">
          Пешка <em>против всех</em>
        </h1>
        <p className="boot-text">Загружаем игру</p>
      </div>
    </div>
  );
}
