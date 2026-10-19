import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  BONUSES,
  PIECE_GLYPH,
  PIECE_NAME,
  SKINS,
  analyzeState,
  applyAction,
  applyActions,
  legalMoves,
  newPiecesAtLevel,
  projectHint,
  type BonusId,
  type Cell,
  type GameAction,
  type GameMode,
  type GameState,
  type MoveDx,
} from '../engine';
import { useApp } from '../context/AppContext';
import { api, ApiError, saveOnExit } from '../lib/api';
import { cn, formatDuration, formatNumber } from '../lib/format';
import { useCountdown } from '../lib/hooks';
import { hapticImpact, hapticNotify, setClosingConfirmation, shareContent } from '../lib/telegram';
import type {
  AdRewardResponse,
  BonusUseResponse,
  FinishResponse,
  FinishResult,
  Profile,
  RunPayload,
  StartRunResponse,
} from '../lib/types';
import { Board } from '../components/Board';
import { HeartsRow } from '../components/Hud';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { RulesModal } from '../components/RulesModal';

type Phase = 'loading' | 'pre' | 'playing' | 'resolving' | 'finishing' | 'won' | 'lost' | 'quit';

interface GameScreenProps {
  mode: GameMode;
  onExit: () => void;
  onNoLives: () => void;
}

export function GameScreen({ mode, onExit, onNoLives }: GameScreenProps): ReactNode {
  const { profile, config, setProfile, refresh, toast, showAd, goShop, goShopStars } = useApp();
  const [phase, setPhase] = useState<Phase>('loading');
  const [run, setRun] = useState<RunPayload | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [actions, setActions] = useState<GameAction[]>([]);
  const [historyDepth, setHistoryDepth] = useState(0);
  const [result, setResult] = useState<FinishResult | null>(null);
  const [hint, setHint] = useState<Cell[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [quitOpen, setQuitOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [adBusy, setAdBusy] = useState(false);
  const [bonusBusy, setBonusBusy] = useState(false);
  const [shieldUsed, setShieldUsed] = useState(false);
  const [adLifeClaimed, setAdLifeClaimed] = useState(false);
  const [noCoins, setNoCoins] = useState(false);
  const [preOpen, setPreOpen] = useState(false);

  const runRef = useRef<RunPayload | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const actionsRef = useRef<GameAction[]>([]);
  const historyRef = useRef<GameState[]>([]);
  const phaseRef = useRef<Phase>('loading');
  const finishedRef = useRef(false);
  const finishingRef = useRef(false);
  const finalActionsRef = useRef<GameAction[]>([]);
  const exitAfterRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveBusyRef = useRef(false);
  const pendingSaveRef = useRef<GameAction[] | null>(null);
  const finishTimerRef = useRef<number | null>(null);
  const lastActionAt = useRef(0);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const scheduleSave = useCallback((nextActions: GameAction[]) => {
    if (!runRef.current || finishedRef.current) return;
    pendingSaveRef.current = nextActions;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave();
    }, 450);
  }, []);

  const flushSave = useCallback(async () => {
    if (saveBusyRef.current || !runRef.current || finishedRef.current) return;
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    saveBusyRef.current = true;
    try {
      await api(`/api/run/${runRef.current.id}/save`, { method: 'POST', body: { actions: pending } });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'run_finished') return;
      if (error instanceof ApiError && error.code !== 'actions_conflict' && error.code !== 'save_conflict') {
        /* молча: финальный finish всё равно отправит полный лог */
      }
    } finally {
      saveBusyRef.current = false;
      if (pendingSaveRef.current && !finishedRef.current) void flushSave();
    }
  }, []);

  const finishRun = useCallback(
    async (target: RunPayload, finalActions: GameAction[]) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      setFinishError(null);
      changePhase('finishing');
      try {
        const response = await api<FinishResponse>(`/api/run/${target.id}/finish`, {
          method: 'POST',
          body: { actions: finalActions },
        });
        finishedRef.current = true;
        if (saveTimerRef.current) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        pendingSaveRef.current = null;
        setProfile(response.profile);
        setResult(response.result);
        setRun((previous) => (previous ? { ...previous, status: response.result.outcome, result: response.result } : previous));

        if (response.result.outcome === 'quit') {
          if (exitAfterRef.current) {
            exitAfterRef.current = false;
            onExit();
            return;
          }
          changePhase('quit');
          return;
        }
        changePhase(response.result.outcome === 'won' ? 'won' : 'lost');
        if (response.result.outcome === 'won') hapticNotify('success');
        else hapticNotify('error');
        void refresh();
      } catch (error) {
        finishingRef.current = false;
        const message = error instanceof ApiError ? error.message : 'Не удалось сохранить результат';
        setFinishError(message);
      }
    },
    [changePhase, onExit, refresh, setProfile],
  );

  const start = useCallback(async () => {
    changePhase('loading');
    finishedRef.current = false;
    finishingRef.current = false;
    finalActionsRef.current = [];
    exitAfterRef.current = false;
    setRun(null);
    runRef.current = null;
    setState(null);
    stateRef.current = null;
    setActions([]);
    actionsRef.current = [];
    historyRef.current = [];
    setHistoryDepth(0);
    setResult(null);
    setHint([]);
    setStartError(null);
    setFinishError(null);
    setQuitOpen(false);
    setShieldUsed(false);
    setAdLifeClaimed(false);
    setPreOpen(false);
    setBonusBusy(false);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    pendingSaveRef.current = null;

    try {
      const response = await api<StartRunResponse>('/api/run/start', { method: 'POST', body: { mode } });
      const nextRun = response.run;
      let current = nextRun.initial;
      const history: GameState[] = [];
      try {
        for (const action of nextRun.actions) {
          history.push(current);
          current = applyAction(current, action);
        }
      } catch {
        setStartError('Не удалось восстановить партию. Начни заново из меню.');
        changePhase('loading');
        return;
      }

      runRef.current = nextRun;
      setRun(nextRun);
      stateRef.current = current;
      setState(current);
      actionsRef.current = nextRun.actions;
      setActions(nextRun.actions);
      historyRef.current = history;
      setHistoryDepth(history.length);

      if (current.status !== 'playing') {
        finalActionsRef.current = nextRun.actions;
        void finishRun(nextRun, nextRun.actions);
        return;
      }

      if (nextRun.actions.length === 0) {
        setPreOpen(true);
        changePhase('pre');
      } else {
        changePhase('playing');
        if (response.resumed) toast('Партия восстановлена', 'info');
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'no_lives') {
          onNoLives();
          onExit();
          return;
        }
        if (error.code === 'endless_locked') {
          toast(error.message, 'info');
          onExit();
          return;
        }
        setStartError(error.message);
      } else {
        setStartError('Не удалось загрузить поле. Проверь связь.');
      }
      changePhase('loading');
    }
  }, [changePhase, finishRun, mode, onExit, onNoLives, toast]);

  useEffect(() => {
    void start();
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (finishTimerRef.current) window.clearTimeout(finishTimerRef.current);
    };
    // Стартуем один раз при открытии экрана.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setClosingConfirmation(true);
    return () => setClosingConfirmation(false);
  }, []);

  useEffect(() => {
    if (!hint.length) return;
    const timer = window.setTimeout(() => setHint([]), 7000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  useEffect(() => {
    return () => {
      if (!finishedRef.current && runRef.current && actionsRef.current.length > 0) {
        saveOnExit(`/api/run/${runRef.current.id}/save`, { actions: actionsRef.current });
      }
    };
  }, []);

  useEffect(() => {
    if (!run) return;
    const onPageHide = () => {
      if (!finishedRef.current && actionsRef.current.length > 0) {
        saveOnExit(`/api/run/${run.id}/save`, { actions: actionsRef.current });
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [run]);

  const moves = useMemo(() => (state ? legalMoves(state) : []), [state]);

  const lastMoveIndex = useMemo(() => {
    for (let index = actions.length - 1; index >= 0; index--) {
      if (actions[index].type === 'move') return index;
    }
    return -1;
  }, [actions]);

  const canPlay = phase === 'playing' && state?.status === 'playing';

  function performAction(action: GameAction) {
    const current = stateRef.current;
    if (!current || current.status !== 'playing' || phaseRef.current !== 'playing') return;
    const now = Date.now();
    if (now - lastActionAt.current < 110) return;
    lastActionAt.current = now;

    let next: GameState;
    try {
      next = applyAction(current, action);
    } catch {
      return;
    }

    historyRef.current.push(current);
    const nextActions = [...actionsRef.current, action];
    actionsRef.current = nextActions;
    stateRef.current = next;
    setActions(nextActions);
    setState(next);
    setHistoryDepth(historyRef.current.length);
    setHint([]);
    hapticImpact('light');

    if (next.status === 'playing') {
      scheduleSave(nextActions);
      return;
    }

    finalActionsRef.current = nextActions;
    changePhase('resolving');
    if (finishTimerRef.current) window.clearTimeout(finishTimerRef.current);
    finishTimerRef.current = window.setTimeout(() => {
      if (runRef.current) void finishRun(runRef.current, nextActions);
    }, next.status === 'lost' ? 700 : 450);
  }

  function handleMove(dx: MoveDx) {
    if (!moves.some((move) => move.dx === dx)) return;
    performAction({ type: 'move', dx });
  }

  function handleSkip() {
    if (moves.length > 0) return;
    performAction({ type: 'skip' });
  }

  function patchMoney(response: BonusUseResponse) {
    setProfile({ ...profile, coins: response.coins, inventory: response.inventory });
  }

  function handleBonusError(error: unknown) {
    if (error instanceof ApiError) {
      if (error.code === 'not_enough_coins') {
        setNoCoins(true);
        return;
      }
      toast(error.message, 'error');
      return;
    }
    toast('Бонус не сработал', 'error');
  }

  async function useHint() {
    if (!state || !canPlay || bonusBusy) return;
    const analysis = analyzeState(state, { maxDepth: 6, maxNodes: 3000 });
    const cells = projectHint(state, analysis.path, 2);
    if (!cells.length) {
      toast('Безопасного пути не видно. Попробуй другой ход.', 'info');
      return;
    }
    setBonusBusy(true);
    try {
      const response = await api<BonusUseResponse>('/api/bonus/use', {
        method: 'POST',
        body: { kind: 'hint', runId: run?.id, at: actionsRef.current.length },
      });
      patchMoney(response);
      setHint(cells);
      toast('Подсказка: следуй золотым клеткам', 'success');
    } catch (error) {
      handleBonusError(error);
    } finally {
      setBonusBusy(false);
    }
  }

  async function useFreeze() {
    if (!state || !canPlay || bonusBusy || state.freeze > 0) return;
    setBonusBusy(true);
    try {
      const response = await api<BonusUseResponse>('/api/bonus/use', {
        method: 'POST',
        body: { kind: 'freeze', runId: run?.id, at: actionsRef.current.length },
      });
      patchMoney(response);
      applyLocalBuff('freeze');
      toast('Враги замерли на два хода', 'success');
    } catch (error) {
      handleBonusError(error);
    } finally {
      setBonusBusy(false);
    }
  }

  function applyLocalBuff(buff: 'freeze' | 'shield') {
    const current = stateRef.current;
    if (!current || current.status !== 'playing') return;
    const next = applyAction(current, { type: 'buff', buff });
    historyRef.current.push(current);
    const nextActions = [...actionsRef.current, { type: 'buff', buff } as GameAction];
    actionsRef.current = nextActions;
    stateRef.current = next;
    setActions(nextActions);
    setState(next);
    setHistoryDepth(historyRef.current.length);
    setHint([]);
    scheduleSave(nextActions);
  }

  async function useUndo() {
    if (!state || !canPlay || bonusBusy || lastMoveIndex < 0) return;
    const targetState = historyRef.current[lastMoveIndex];
    if (!targetState) return;
    const targetActions = actionsRef.current.slice(0, lastMoveIndex);
    setBonusBusy(true);
    try {
      const response = await api<BonusUseResponse>('/api/bonus/use', {
        method: 'POST',
        body: { kind: 'undo', runId: run?.id, at: targetActions.length },
      });
      patchMoney(response);
      stateRef.current = targetState;
      actionsRef.current = targetActions;
      historyRef.current = historyRef.current.slice(0, lastMoveIndex);
      setState(targetState);
      setActions(targetActions);
      setHistoryDepth(historyRef.current.length);
      setHint([]);
      scheduleSave(targetActions);
      toast('Ход отменён', 'success');
    } catch (error) {
      handleBonusError(error);
    } finally {
      setBonusBusy(false);
    }
  }

  async function watchShield() {
    if (!run || adBusy || shieldUsed || (stateRef.current?.shield ?? 0) > 0) return;
    if (actionsRef.current.length !== 0) return;
    setAdBusy(true);
    try {
      const rewarded = await showAd('Щит на 3 хода');
      if (!rewarded) return;
      const response = await api<AdRewardResponse>('/api/ads/reward', {
        method: 'POST',
        body: { kind: 'shield', runId: run.id, at: 0 },
      });
      setProfile(response.profile);
      applyLocalBuff('shield');
      setShieldUsed(true);
      toast('Щит активен три хода', 'success');
    } catch (error) {
      if (error instanceof ApiError) toast(error.message, 'error');
      else toast('Реклама недоступна', 'error');
    } finally {
      setAdBusy(false);
    }
  }

  async function watchLifeAd() {
    if (adBusy || adLifeClaimed) return;
    setAdBusy(true);
    try {
      const rewarded = await showAd('+1 ❤️');
      if (!rewarded) return;
      const response = await api<AdRewardResponse>('/api/ads/reward', {
        method: 'POST',
        body: { kind: 'life' },
      });
      setProfile(response.profile);
      setAdLifeClaimed(true);
      hapticNotify('success');
      toast('+1 жизнь', 'success');
    } catch (error) {
      if (error instanceof ApiError) toast(error.message, 'error');
      else toast('Не удалось получить жизнь', 'error');
    } finally {
      setAdBusy(false);
    }
  }

  function requestExit() {
    if (phaseRef.current === 'resolving' || phaseRef.current === 'finishing') return;
    if (phaseRef.current === 'won' || phaseRef.current === 'lost' || phaseRef.current === 'quit') {
      onExit();
      return;
    }
    if (phaseRef.current === 'pre' && actionsRef.current.length === 0) {
      onExit();
      return;
    }
    setQuitOpen(true);
  }

  function confirmExit() {
    setQuitOpen(false);
    if (phaseRef.current === 'pre' && actionsRef.current.length === 0) {
      onExit();
      return;
    }
    if (mode === 'endless') {
      if (!runRef.current || actionsRef.current.length === 0) {
        onExit();
        return;
      }
      exitAfterRef.current = true;
      void finishRun(runRef.current, actionsRef.current);
      return;
    }
    if (runRef.current && !finishedRef.current) {
      saveOnExit(`/api/run/${runRef.current.id}/save`, { actions: actionsRef.current });
    }
    onExit();
  }

  function beginPlay() {
    setPreOpen(false);
    changePhase('playing');
    hapticImpact('medium');
  }

  function nextLevel() {
    setResult(null);
    void start();
  }

  async function shareResult(kind: 'win' | 'lose') {
    const bot = config.botUsername;
    const level = result?.maxLevel ?? profile.maxLevel;
    const endless = mode === 'endless';
    const payload = endless ? `ch_0_${profile.endlessBest}` : `ch_${level}_${level}`;
    const url = bot ? `https://t.me/${bot}?startapp=${payload}` : config.webappUrl;
    const text = endless
      ? `Мой рекорд в «Пешке против всех» — ${profile.endlessBest} клеток. Слабо выше?`
      : kind === 'win'
        ? `Я прошёл уровень ${result?.level ?? profile.level} в «Пешке против всех». Слабо повторить?`
        : `Я пал на ${result?.level ?? profile.level} уровне в «Пешке против всех». Сможешь лучше?`;
    const status = await shareContent(text, url);
    if (status === 'copied') toast('Ссылка скопирована', 'success');
    if (status === 'failed') toast('Не удалось поделиться', 'error');
  }

  if (!state || !run) {
    return (
      <div className="screen game-screen game-loading">
        <div className="game-loading-inner">
          {startError ? (
            <>
              <div className="result-orb result-orb-danger"><Icon name="close" size={30} /></div>
              <h2 className="modal-title">Поле не загрузилось</h2>
              <p className="modal-text">{startError}</p>
              <div className="modal-actions">
                <button type="button" className="btn btn-gold" onClick={() => void start()}>
                  Повторить
                </button>
                <button type="button" className="btn btn-text" onClick={onExit}>
                  В меню
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="loading-pawn">♟</div>
              <span className="eyebrow">Расставляем фигуры</span>
              <p className="loading-hint">Готовим поле…</p>
            </>
          )}
          <button type="button" className="btn btn-text" onClick={onExit}>
            В меню
          </button>
        </div>
      </div>
    );
  }

  const isEndless = mode === 'endless';
  const styles = run.initial.width;
  const levelTypes = [...new Set(run.initial.enemies.map((enemy) => enemy.type))];
  const unlockedNow = newPiecesAtLevel(run.level);
  const playerAlive = state.status !== 'lost';

  return (
    <div className="screen game-screen">
      <header className="game-top">
        <button type="button" className="icon-btn game-back" onClick={requestExit} aria-label="Назад">
          <Icon name="back" size={20} />
        </button>
        <div className="game-title">
          <span>{isEndless ? 'Бесконечный' : 'Кампания'}</span>
          <b>{isEndless ? `Высота ${state.score}` : `Уровень ${run.level}`}</b>
        </div>
        <div className="game-hud">
          <span className="game-hud-pill">
            <Icon name="heart" size={14} />
            {profile.lives}
          </span>
          <span className="game-hud-pill">
            <Icon name="coin" size={14} />
            {formatNumber(profile.coins)}
          </span>
        </div>
      </header>

      <div className="game-status">
        <span className="status-chip">
          <Icon name="spark" size={13} />
          Ход {state.moves + 1}
        </span>
        {isEndless && (
          <span className="status-chip">
            <Icon name="flame" size={13} />
            Волна {state.tier}
          </span>
        )}
        {!isEndless && <span className="status-chip">{styles}×{styles}</span>}
        {state.shield > 0 && (
          <span className="status-chip chip-shield">
            <Icon name="shield" size={13} />
            Щит {state.shield}
          </span>
        )}
        {state.freeze > 0 && (
          <span className="status-chip chip-freeze">
            <Icon name="snow" size={13} />
            Мороз {state.freeze}
          </span>
        )}
      </div>

      <div className="board-area">
        <div className="goal-line">
          <span className="goal-crown"><Icon name="crown" size={13} /></span>
          <span>{isEndless ? 'Поднимайся выше. Поле бесконечно' : 'Финиш на верхнем ряду'}</span>
          {isEndless && <b>{state.score}</b>}
        </div>
        <Board
          state={state}
          moves={canPlay ? moves : []}
          hint={hint}
          skin={profile.skin}
          interactive={canPlay}
          onMove={handleMove}
          turn={state.moves}
        />
      </div>

      {phase === 'resolving' && <div className="resolve-bar" aria-hidden="true" />}

      <div className="game-controls">
        <div className="buff-row">
          <button
            type="button"
            className="buff-btn"
            onClick={() => void useHint()}
            disabled={!canPlay || bonusBusy}
          >
            <span className="buff-icon icon-bulb"><Icon name="bulb" size={19} /></span>
            <span className="buff-copy">
              <b>Подсказка</b>
              <small>{profile.inventory.hint > 0 ? `×${profile.inventory.hint}` : `${BONUSES.hint.price} 🪙`}</small>
            </span>
          </button>
          <button
            type="button"
            className={cn('buff-btn', state.freeze > 0 && 'buff-active')}
            onClick={() => void useFreeze()}
            disabled={!canPlay || bonusBusy || state.freeze > 0}
          >
            <span className="buff-icon icon-freeze"><Icon name="snow" size={19} /></span>
            <span className="buff-copy">
              <b>{state.freeze > 0 ? `Мороз ${state.freeze}` : 'Заморозка'}</b>
              <small>{state.freeze > 0 ? 'активно' : profile.inventory.freeze > 0 ? `×${profile.inventory.freeze}` : `${BONUSES.freeze.price} 🪙`}</small>
            </span>
          </button>
          <button
            type="button"
            className="buff-btn"
            onClick={() => void useUndo()}
            disabled={!canPlay || bonusBusy || lastMoveIndex < 0}
          >
            <span className="buff-icon icon-undo"><Icon name="undo" size={19} /></span>
            <span className="buff-copy">
              <b>Отмена</b>
              <small>{historyDepth === 0 ? 'нет ходов' : profile.inventory.undo > 0 ? `×${profile.inventory.undo}` : `${BONUSES.undo.price} 🪙`}</small>
            </span>
          </button>
        </div>

        {moves.length === 0 && canPlay ? (
          <button type="button" className="btn skip-btn" onClick={handleSkip}>
            Все ходы закрыты · Пропустить
            <Icon name="chevronRight" size={19} />
          </button>
        ) : (
          <div className="move-row">
            {([-1, 0, 1] as MoveDx[]).map((dx) => {
              const available = canPlay && moves.some((move) => move.dx === dx);
              return (
                <button
                  key={dx}
                  type="button"
                  className={cn('move-btn', dx === 0 && 'move-btn-forward', !available && 'move-btn-off')}
                  disabled={!available}
                  onClick={() => handleMove(dx)}
                  aria-label={dx === -1 ? 'Влево-вперёд' : dx === 0 ? 'Вперёд' : 'Вправо-вперёд'}
                >
                  <span className="move-arrow" style={{ transform: `rotate(${dx * 45}deg)` }}>
                    <Icon name="arrowUp" size={26} />
                  </span>
                  <span className="move-label">{dx === -1 ? 'влево' : dx === 0 ? 'вперёд' : 'вправо'}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="control-hint">
          {playerAlive ? 'Ходят только вперёд. Пешка не бьёт фигуры.' : 'Пешка поймана.'}
        </p>
      </div>

      {preOpen && (
        <Modal dismissible={false} onClose={() => undefined} className="pre-modal">
          <div className="pre-head">
            <span className="eyebrow">{isEndless ? 'Забег' : `Поле ${styles}×${styles}`}</span>
            <h2 className="modal-title" id="pre-title">
              {isEndless ? 'Бесконечный режим' : `Уровень ${run.level}`}
            </h2>
            <p className="modal-text">
              {isEndless
                ? 'Поле растёт вверх каждые пять клеток. Сложность — каждые пять ходов. Сколько продержишься?'
                : 'Дойди до верхнего ряда. Фигуры ходят после тебя и пытаются подобраться ближе.'}
            </p>
          </div>

          <div className="pre-pieces">
            <div className="pre-pieces-title">На поле</div>
            <div className="pre-piece-list">
              {levelTypes.map((type) => (
                <span className="pre-piece" key={type}>
                  <em>{PIECE_GLYPH[type]}</em>
                  <span>{PIECE_NAME[type]}</span>
                </span>
              ))}
            </div>
            {unlockedNow.length > 0 && (
              <div className="pre-unlock">
                <Icon name="spark" size={15} />
                Новая фигура: {unlockedNow.map((type) => PIECE_NAME[type]).join(', ')}
              </div>
            )}
          </div>

          {!profile.adFree && (
            <button
              type="button"
              className={cn('shield-offer', shieldUsed && 'is-used')}
              onClick={() => void watchShield()}
              disabled={adBusy || shieldUsed || state.shield > 0}
            >
              <span className="shield-offer-icon"><Icon name="shield" size={20} /></span>
              <span>
                <b>{adBusy ? 'Загружаем рекламу…' : shieldUsed ? 'Щит уже взят' : 'Щит на 3 хода'}</b>
                <small>За просмотр рекламы · один раз за забег</small>
              </span>
              <Icon name="play" size={16} />
            </button>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-gold" onClick={beginPlay}>
              <Icon name="play" size={17} />
              Начать
            </button>
            <button type="button" className="btn btn-text" onClick={() => setRulesOpen(true)}>
              Как играть
            </button>
          </div>
        </Modal>
      )}

      {phase === 'finishing' && !finishError && (
        <div className="finishing-veil">
          <span className="spinner" />
          <span>Сохраняем результат…</span>
        </div>
      )}

      {finishError && (
        <Modal dismissible={false} onClose={() => undefined}>
          <div className="result-orb result-orb-danger"><Icon name="close" size={28} /></div>
          <h2 className="modal-title">Результат не сохранился</h2>
          <p className="modal-text">{finishError}. Проверь связь и попробуй ещё раз — партия осталась на сервере.</p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-gold"
              onClick={() => {
                if (runRef.current) {
                  setFinishError(null);
                  void finishRun(runRef.current, finalActionsRef.current.length ? finalActionsRef.current : actionsRef.current);
                }
              }}
            >
              Повторить
            </button>
            <button type="button" className="btn btn-text" onClick={onExit}>
              В меню
            </button>
          </div>
        </Modal>
      )}

      {result && phase === 'won' && (
        <WinModal
          result={result}
          onNext={nextLevel}
          onShare={() => void shareResult('win')}
          onMenu={onExit}
          isEndless={false}
        />
      )}

      {result && phase === 'lost' && (
        <LoseModal
          result={result}
          profile={profile}
          adFree={profile.adFree}
          adBusy={adBusy}
          adClaimed={adLifeClaimed}
          isEndless={isEndless}
          onWatchLife={() => void watchLifeAd()}
          onRetry={nextLevel}
          onShare={() => void shareResult('lose')}
          onMenu={onExit}
          onShop={goShopStars}
          onRefresh={refresh}
        />
      )}

      {result && phase === 'quit' && (
        <Modal dismissible={false} onClose={() => undefined}>
          <div className="result-orb"><Icon name="star" size={30} /></div>
          <span className="eyebrow">Забег завершён</span>
          <h2 className="modal-title">{result.newBest ? 'Новый рекорд' : 'Забег завершён'}</h2>
          <p className="modal-text">
            {result.newBest ? `Ты поднялся на ${result.bestScore ?? result.score} клеток.` : `Ты остановился на ${result.score} клетках.`}
            {result.coinsEarned > 0 ? ` Награда: +${result.coinsEarned} 🪙` : ''}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-gold" onClick={onExit}>В меню</button>
            <button type="button" className="btn btn-ghost" onClick={() => void shareResult('win')}>Поделиться</button>
          </div>
        </Modal>
      )}

      {quitOpen && (
        <Modal onClose={() => setQuitOpen(false)}>
          <div className="result-orb"><Icon name="clock" size={28} /></div>
          <h2 className="modal-title">{isEndless ? 'Завершить забег?' : 'Выйти в меню?'}</h2>
          <p className="modal-text">
            {isEndless
              ? 'Результат попадёт в рекорды, но продолжить этот забег уже не получится.'
              : 'Партия сохранится. Ты сможешь продолжить с этого хода.'}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-gold" onClick={confirmExit}>
              {isEndless ? 'Завершить' : 'Выйти'}
            </button>
            <button type="button" className="btn btn-text" onClick={() => setQuitOpen(false)}>
              Остаться
            </button>
          </div>
        </Modal>
      )}

      {noCoins && (
        <Modal onClose={() => setNoCoins(false)} showClose>
          <div className="result-orb"><Icon name="coin" size={30} /></div>
          <h2 className="modal-title">Не хватает монет</h2>
          <p className="modal-text">
            Монеты дают за победы. Ещё немного можно получить за просмотр рекламы в главном меню или в магазине.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-gold" onClick={() => { setNoCoins(false); goShop(); }}>
              В магазин
            </button>
            <button type="button" className="btn btn-text" onClick={() => setNoCoins(false)}>
              Понятно
            </button>
          </div>
        </Modal>
      )}

      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  );
}

function WinModal({
  result,
  onNext,
  onShare,
  onMenu,
  isEndless,
}: {
  result: FinishResult;
  onNext: () => void;
  onShare: () => void;
  onMenu: () => void;
  isEndless: boolean;
}): ReactNode {
  return (
    <Modal dismissible={false} onClose={() => undefined} className="result-modal win-modal">
      <div className="confetti" aria-hidden="true">
        {Array.from({ length: 14 }).map((_, index) => (
          <span key={index} className={`confetti-piece c${index % 5}`} style={{ left: `${6 + index * 6.5}%`, animationDelay: `${index * 70}ms` }} />
        ))}
      </div>
      <div className="result-orb result-orb-gold">
        <Icon name="crown" size={34} />
      </div>
      <span className="eyebrow">{isEndless ? 'Бесконечный режим' : `Уровень ${result.level}`}</span>
      <h2 className="modal-title">Финиш!</h2>
      <p className="modal-text">Пешка прошла поле и осталась цела. Красиво.</p>

      <div className="result-rewards">
        <span className="reward-pill">
          <Icon name="coin" size={16} />
          +{result.coinsEarned}
        </span>
        {result.newBest && (
          <span className="reward-pill reward-best">
            <Icon name="trophy" size={16} />
            Рекорд {result.bestScore}
          </span>
        )}
      </div>

      {result.endlessUnlockedNow && (
        <div className="unlock-banner">
          <Icon name="infinity" size={22} />
          <div>
            <b>Бесконечный режим открыт</b>
            <span>Поле будет расти, пока ты держишься.</span>
          </div>
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-gold" onClick={onNext}>
          {isEndless ? 'Ещё забег' : 'Следующий уровень'}
          <Icon name="chevronRight" size={18} />
        </button>
        <button type="button" className="btn btn-ghost" onClick={onShare}>
          <Icon name="share" size={16} />
          Бросить вызов
        </button>
        <button type="button" className="btn btn-text" onClick={onMenu}>
          В меню
        </button>
      </div>
    </Modal>
  );
}

function LoseModal({
  result,
  profile,
  adFree,
  adBusy,
  adClaimed,
  isEndless,
  onWatchLife,
  onRetry,
  onShare,
  onMenu,
  onShop,
  onRefresh,
}: {
  result: FinishResult;
  profile: Profile;
  adFree: boolean;
  adBusy: boolean;
  adClaimed: boolean;
  isEndless: boolean;
  onWatchLife: () => void;
  onRetry: () => void;
  onShare: () => void;
  onMenu: () => void;
  onShop: () => void;
  onRefresh: () => Promise<void>;
}): ReactNode {
  const remaining = useCountdown(profile.nextLifeAt, () => {
    void onRefresh();
  });
  const captured = result.capturedBy;
  const canRetry = profile.lives > 0;

  return (
    <Modal dismissible={false} onClose={() => undefined} className="result-modal lose-modal">
      <div className="result-orb result-orb-danger">
        <span className="result-enemy">{captured ? PIECE_GLYPH[captured] : '♟'}</span>
      </div>
      <span className="eyebrow">{isEndless ? `Высота ${result.score}` : `Уровень ${result.level}`}</span>
      <h2 className="modal-title">Пешка поймана</h2>
      <p className="modal-text">
        {captured ? `${PIECE_NAME[captured]} добрался(ась) до твоей пешки.` : 'Фигура добралась до твоей пешки.'} Минус одна жизнь.
      </p>

      <div className="lose-lives">
        <HeartsRow lives={profile.lives} maxLives={profile.maxLives} />
        <span className="lose-heart">−1 ❤️</span>
      </div>

      {result.newBest && (
        <div className="unlock-banner record-banner">
          <Icon name="trophy" size={20} />
          <div>
            <b>Новый рекорд: {result.bestScore}</b>
            <span>+{result.coinsEarned} 🪙 за высоту</span>
          </div>
        </div>
      )}

      {!canRetry && (
        <div className="lose-timer">
          <Icon name="clock" size={16} />
          Новая жизнь через <b>{formatDuration(remaining)}</b>
        </div>
      )}

      <div className="modal-actions">
        {canRetry && (
          <button type="button" className="btn btn-gold" onClick={onRetry}>
            <Icon name="play" size={16} />
            {isEndless ? 'Новый забег' : 'Ещё раз'}
          </button>
        )}

        {!adFree && !adClaimed && (
          <button
            type="button"
            className={cn('btn', canRetry ? 'btn-ghost' : 'btn-gold')}
            onClick={onWatchLife}
            disabled={adBusy}
          >
            <Icon name="play" size={16} />
            {adBusy ? 'Загружаем…' : 'Смотреть рекламу +1 ❤️'}
          </button>
        )}

        {!canRetry && (
          <button type="button" className="btn btn-ghost" onClick={onShop}>
            Магазин · +5 жизней за 25 ⭐
          </button>
        )}

        <button type="button" className="btn btn-text" onClick={onShare}>
          <Icon name="share" size={15} />
          Бросить вызов
        </button>
        <button type="button" className="btn btn-text" onClick={onMenu}>
          В меню
        </button>
      </div>
    </Modal>
  );
}
