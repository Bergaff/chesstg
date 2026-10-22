import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BONUSES,
  applyJamAction,
  isJamState,
  jamBudget,
  jamLegalActions,
  jamParkedCount,
  jamSolution,
  modeDef,
  type Cell,
  type JamAction,
  type JamState,
} from '../engine';
import { useApp } from '../context/AppContext';
import { api, ApiError, saveOnExit } from '../lib/api';
import { cn, formatNumber } from '../lib/format';
import { hapticImpact, hapticNotify, setClosingConfirmation, shareContent } from '../lib/telegram';
import type {
  AdRewardResponse,
  BonusUseResponse,
  FinishResponse,
  FinishResult,
  RunPayload,
  StartRunResponse,
} from '../lib/types';
import { JamBoard } from '../components/JamBoard';
import { Modal } from '../components/Modal';
import { RulesModal } from '../components/RulesModal';

type Phase = 'loading' | 'pre' | 'playing' | 'finishing' | 'won' | 'lost';

interface JamHintResponse {
  move: JamAction;
  parked: number;
  total: number;
  movesLeft: number;
}

interface JamScreenProps {
  onExit: () => void;
  onNoLives: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
}

/** Подсказка живёт на экране недолго: иначе поле превращается в раскраску. */
const HINT_MS = 9000;
/** Пауза перед финалом: видно, что поле встало на свои места. */
const ENDING_MS = 420;

/**
 * «Парковка»: головоломка про перегон плотной пробки фигур. Взятий нет, ходит
 * игрок любой фигурой по её правилу, цель - разойтись половинами за данное
 * число перестановок.
 */
export function JamScreen({ onExit, onNoLives, onTerms, onPrivacy }: JamScreenProps): ReactNode {
  const { profile, config, setProfile, refresh, toast, showAd, goShopStars } = useApp();
  const [phase, setPhase] = useState<Phase>('loading');
  const [run, setRun] = useState<RunPayload | null>(null);
  const [jam, setJam] = useState<JamState | null>(null);
  const [actions, setActions] = useState<JamAction[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hint, setHint] = useState<{ id: string; to: Cell } | null>(null);
  const [result, setResult] = useState<FinishResult | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [quitOpen, setQuitOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [bonusBusy, setBonusBusy] = useState(false);
  const [noCoins, setNoCoins] = useState(false);
  const [adBusy, setAdBusy] = useState(false);
  const [adLifeClaimed, setAdLifeClaimed] = useState(false);

  const phaseRef = useRef<Phase>('loading');
  const runRef = useRef<RunPayload | null>(null);
  const jamRef = useRef<JamState | null>(null);
  const actionsRef = useRef<JamAction[]>([]);
  const historyRef = useRef<JamState[]>([]);
  const finishedRef = useRef(false);
  const finishingRef = useRef(false);
  const repeatRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<JamAction[] | null>(null);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const flushSave = useCallback(async () => {
    const target = runRef.current;
    const pending = pendingSaveRef.current;
    if (!target || !pending || finishedRef.current) return;
    pendingSaveRef.current = null;
    await api(`/api/run/${target.id}/save`, { method: 'POST', body: { actions: pending } }).catch(() => undefined);
  }, []);

  const scheduleSave = useCallback(
    (nextActions: JamAction[]) => {
      if (!runRef.current || finishedRef.current) return;
      pendingSaveRef.current = nextActions;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, 1200);
    },
    [flushSave],
  );

  const finishRun = useCallback(
    async (target: RunPayload, finalActions: JamAction[]) => {
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
        changePhase(response.result.outcome === 'won' ? 'won' : 'lost');
        hapticNotify(response.result.outcome === 'won' ? 'success' : 'error');
        void refresh();
      } catch (error) {
        finishingRef.current = false;
        setFinishError(error instanceof ApiError ? error.message : 'Не удалось сохранить результат');
      }
    },
    [changePhase, refresh, setProfile],
  );

  const start = useCallback(async () => {
    changePhase('loading');
    finishedRef.current = false;
    finishingRef.current = false;
    repeatRef.current = false;
    setRun(null);
    runRef.current = null;
    setJam(null);
    jamRef.current = null;
    setActions([]);
    actionsRef.current = [];
    historyRef.current = [];
    setSelected(null);
    setHint(null);
    setResult(null);
    setStartError(null);
    setFinishError(null);
    setQuitOpen(false);
    setAdLifeClaimed(false);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
    saveTimerRef.current = null;
    pendingSaveRef.current = null;

    try {
      const response = await api<StartRunResponse>('/api/run/start', {
        method: 'POST',
        body: repeatRef.current ? { mode: 'jam', repeat: true } : { mode: 'jam' },
      });
      const nextRun = response.run;
      if (!isJamState(nextRun.initial)) {
        setStartError('Сервер прислал поле прежнего забега, этот режим его не принимает. Нажмите «Повторить»: старый забег закроется, поле сгенерируется заново.');
        changePhase('loading');
        return;
      }
      let current = nextRun.initial;
      const history: JamState[] = [];
      try {
        for (const action of nextRun.actions) {
          if (action.type !== 'piece') continue;
          history.push(current);
          current = applyJamAction(current, action, Error);
        }
      } catch {
        setStartError('Не удалось восстановить партию. Начните заново из меню.');
        changePhase('loading');
        return;
      }

      runRef.current = nextRun;
      setRun(nextRun);
      jamRef.current = current;
      setJam(current);
      actionsRef.current = nextRun.actions.filter((action): action is JamAction => action.type === 'piece');
      setActions(actionsRef.current);
      historyRef.current = history;

      if (current.status !== 'playing') {
        void finishRun(nextRun, actionsRef.current);
        return;
      }
      if (nextRun.actions.length === 0) {
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
        if (error.code === 'mode_locked' || error.code === 'db_migration_required') {
          toast(error.message, 'info');
          onExit();
          return;
        }
        setStartError(error.message);
      } else {
        setStartError('Не удалось загрузить поле. Проверьте связь.');
      }
      changePhase('loading');
    }
  }, [changePhase, finishRun, onExit, onNoLives, toast]);

  useEffect(() => {
    void start();
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
    };
    // Экран открывает забег один раз: повтор нужен только через restart().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setClosingConfirmation(true);
    return () => setClosingConfirmation(false);
  }, []);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), HINT_MS);
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

  const parked = jam ? jamParkedCount(jam.pieces, jam.mid) : 0;
  const total = jam?.pieces.length ?? 0;
  const movesUsed = jam?.moves ?? 0;
  const budget = jam?.budget ?? jamBudget(1);
  const movesLeft = Math.max(0, budget - movesUsed);
  const canPlay = phase === 'playing' && jam?.status === 'playing';
  const lastActionAt = useRef(0);

  // Конец поля: даём полсекунды увидеть пробку в финальном виде, потом отправляем результат.
  const endOfLine = useCallback(
    (next: JamState) => {
      if (next.status === 'playing') return;
      setSelected(null);
      setHint(null);
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
      endTimerRef.current = window.setTimeout(() => {
        endTimerRef.current = null;
        const target = runRef.current;
        if (target) void finishRun(target, actionsRef.current);
      }, ENDING_MS);
    },
    [finishRun],
  );

  function place(cell: Cell) {
    const current = jamRef.current;
    if (!current || !selected || !canPlay) return;
    const now = Date.now();
    if (now - lastActionAt.current < 90) return;
    lastActionAt.current = now;
    try {
      const next = applyJamAction(current, { type: 'piece', id: selected, to: cell }, Error);
      historyRef.current.push(current);
      jamRef.current = next;
      setJam(next);
      const nextActions = [...actionsRef.current, { type: 'piece' as const, id: selected, to: cell }];
      actionsRef.current = nextActions;
      setActions(nextActions);
      setSelected(null);
      setHint(null);
      hapticImpact('light');
      scheduleSave(nextActions);
      endOfLine(next);
    } catch (error) {
      toast(error instanceof Error ? 'Так фигура не ходит' : 'Ход не прошёл', 'info');
      setSelected(null);
    }
  }

  function pick(id: string) {
    if (!canPlay) return;
    setSelected((current) => (current === id ? null : id));
    hapticImpact('light');
  }

  function undoMove() {
    void useUndo();
  }

  async function useUndo() {
    const current = jamRef.current;
    if (!current || !canPlay || bonusBusy || historyRef.current.length === 0) return;
    const targetState = historyRef.current[historyRef.current.length - 1];
    const targetActions = actionsRef.current.slice(0, -1);
    setBonusBusy(true);
    try {
      const response = await api<BonusUseResponse>('/api/bonus/use', {
        method: 'POST',
        body: { kind: 'undo', runId: run?.id, at: targetActions.length },
      });
      setProfile({ ...profile, coins: response.coins, inventory: response.inventory });
      historyRef.current = historyRef.current.slice(0, -1);
      jamRef.current = targetState;
      setJam(targetState);
      actionsRef.current = targetActions;
      setActions(targetActions);
      setSelected(null);
      setHint(null);
      scheduleSave(targetActions);
      toast('Ход отменён', 'success');
    } catch (error) {
      handleBonusError(error);
    } finally {
      setBonusBusy(false);
    }
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
    const current = jamRef.current;
    if (!current || !canPlay || bonusBusy) return;
    setBonusBusy(true);
    try {
      await api<BonusUseResponse>('/api/bonus/use', {
        method: 'POST',
        body: { kind: 'hint', runId: run?.id, at: actionsRef.current.length },
      });
      const response = await api<JamHintResponse>(`/api/run/${runRef.current!.id}/hint`, {
        method: 'POST',
        body: { actions: actionsRef.current },
      });
      setHint({ id: response.move.id, to: response.move.to });
      setSelected(response.move.id);
      toast('Показали полезный ход', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'no_hint') {
        toast('Полезного хода не видно: пробуйте разобрать пробку с другого края', 'info');
      } else {
        handleBonusError(error);
      }
    } finally {
      setBonusBusy(false);
    }
  }

  async function watchLifeAd() {
    if (adBusy || adLifeClaimed) return;
    setAdBusy(true);
    try {
      const rewarded = await showAd('+1 жизнь');
      if (!rewarded) return;
      const response = await api<AdRewardResponse>('/api/ads/reward', { method: 'POST', body: { kind: 'life' } });
      setProfile(response.profile);
      setAdLifeClaimed(true);
      hapticNotify('success');
      toast('+1 жизнь', 'success');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Не удалось получить жизнь', 'error');
    } finally {
      setAdBusy(false);
    }
  }

  function requestExit() {
    if (phaseRef.current === 'finishing') return;
    if (phaseRef.current === 'won' || phaseRef.current === 'lost') {
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
    if (runRef.current && !finishedRef.current && actionsRef.current.length > 0) {
      saveOnExit(`/api/run/${runRef.current.id}/save`, { actions: actionsRef.current });
    }
    onExit();
  }

  function restart(repeat: boolean) {
    repeatRef.current = repeat;
    void start();
  }

  async function shareResult() {
    const bot = config.botUsername;
    const level = result?.level ?? run?.level ?? profile.modes?.jam?.level ?? 1;
    const url = bot ? `https://t.me/${bot}?startapp=play` : '';
    const text = `Собрал «Парковку» уровня ${level} в «Пешке против всех». За ${movesUsed} перестановок.`;
    const status = await shareContent(text, url);
    if (status === 'copied') toast('Текст скопирован', 'success');
    if (status === 'failed') toast('Не удалось поделиться', 'error');
  }

  const movablePieces = useMemo(() => {
    if (!jam || !canPlay) return new Set<string>();
    return new Set(jamLegalActions(jam).map((action) => action.id));
  }, [canPlay, jam]);

  const solutionPreview = useMemo(() => (jam ? jamSolution(jam).length : 0), [jam]);

  if (!jam || !run) {
    return (
      <div className="screen game-screen game-loading">
        <div className="loading-state">
          {startError ? (
            <>
              <span className="loading-mark serif" aria-hidden="true">
                ♜
              </span>
              <h2 className="modal-title" style={{ margin: '0 auto 8px' }}>
                Поле не загрузилось
              </h2>
              <p className="modal-text">{startError}</p>
              <div className="modal-actions" style={{ width: '100%' }}>
                <button type="button" className="btn btn-primary" onClick={() => void start()}>
                  Повторить
                </button>
                <button type="button" className="btn btn-quiet" onClick={onExit}>
                  В меню
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="loading-mark serif" aria-hidden="true">
                ♜
              </span>
              <span className="label">Расставляем пробку</span>
              <p className="loading-text">Готовим поле</p>
            </>
          )}
          {!startError && (
            <button type="button" className="btn btn-quiet" onClick={onExit}>
              В меню
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="screen game-screen jam-screen">
      <header className="game-top">
        <button type="button" className="back-btn" onClick={requestExit} aria-label="Назад">
          ←
        </button>
        <div className="game-heading">
          <span className="label">{modeDef('jam').name}</span>
          <b className="game-title">Уровень {run.level}</b>
        </div>
        <div className="game-hud">
          <span className="hud-item">
            <span className="label">Жизни</span>
            <b>{profile.lives}</b>
          </span>
          <span className="hud-item">
            <span className="label">Монеты</span>
            <b>{formatNumber(profile.coins)}</b>
          </span>
        </div>
      </header>

      <div className="game-status">
        <span className={cn('status-item', movesLeft <= 3 && 'warn')}>ходов {movesLeft}</span>
        <span className="status-sep" aria-hidden="true">/</span>
        <span className="status-item">
          на месте {parked} из {total}
        </span>
        <span className="status-sep" aria-hidden="true">/</span>
        <span className="status-item">поле {jam.width}×{jam.height}</span>
      </div>

      <div className="jam-progress" role="progressbar" aria-valuenow={parked} aria-valuemin={0} aria-valuemax={total}>
        <span style={{ width: total ? `${Math.round((parked / total) * 100)}%` : 0 }} />
      </div>

      <div className="board-area">
        <div className="goal-line">
          <span>белые наверх, чёрные вниз</span>
          <span className="num">{selected ? 'выберите клетку' : 'троньте фигуру'}</span>
        </div>
        <JamBoard
          state={jam}
          selected={selected}
          hint={hint}
          interactive={canPlay}
          onPick={pick}
          onPlace={place}
        />
      </div>

      <div className="game-controls">
        <div className="buff-row">
          <button type="button" className="buff-btn" onClick={() => void useHint()} disabled={!canPlay || bonusBusy}>
            <span className="buff-name">Подсказка</span>
            <span className="buff-meta">
              {profile.inventory.hint > 0 ? `в запасе ${profile.inventory.hint}` : `${BONUSES.hint.price} монет`}
            </span>
          </button>
          <button
            type="button"
            className="buff-btn"
            onClick={() => void useUndo()}
            disabled={!canPlay || bonusBusy || actions.length === 0}
          >
            <span className="buff-name">Отмена</span>
            <span className="buff-meta">
              {actions.length === 0
                ? 'ходить нечем'
                : profile.inventory.undo > 0
                  ? `в запасе ${profile.inventory.undo}`
                  : `${BONUSES.undo.price} монет`}
            </span>
          </button>
          <button type="button" className="buff-btn" onClick={() => setRulesOpen(true)}>
            <span className="buff-name">Правила</span>
            <span className="buff-meta">как переставлять</span>
          </button>
        </div>

        <p className="control-hint">
          {jam.status === 'won'
            ? 'Поле собрано.'
            : jam.status === 'lost'
              ? 'Перестановки кончились, пробка не разошлась.'
              : selected
                ? 'Клетки с меткой - куда фигура доедет. Своя половина не нужна: идите на чужую.'
                : movablePieces.size === 0
                  ? 'Ни одна фигура не может сдвинуться: отмените ход.'
                  : 'Ладья ездит прямо, слон по диагонали, конь перепрыгивает. Бить нельзя.'}
        </p>
      </div>

      {rulesOpen && (
        <RulesModal jam onClose={() => setRulesOpen(false)} onTerms={onTerms} onPrivacy={onPrivacy} />
      )}

      {phase === 'pre' && (
        <Modal dismissible={false} onClose={() => undefined} labelledBy="jam-pre-title">
          <span className="label">Поле {jam.width}×{jam.height}, фигур {total}</span>
          <h2 className="modal-title" id="jam-pre-title">
            {modeDef('jam').name}, уровень {run.level}
          </h2>
          <p className="modal-text">
            Пробка забита белыми и чёрными фигурами. Ходите любой: ладья ездит по прямым, слон по
            диагоналям, конь перепрыгивает. Взятий нет, так что путь расчищать нечем - только объезжать.
            Белые должны встать на верхнюю половину, чёрные на нижнюю.
          </p>
          <div className="pre-meta">
            <div>
              <span>Перестановок дано</span>
              <b>{budget}</b>
            </div>
            <div>
              <span>Решение генератора</span>
              <b>{solutionPreview > 0 ? solutionPreview : 'не найдено'}</b>
            </div>
            <div>
              <span>Жизней в запасе</span>
              <b>{profile.lives}</b>
            </div>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                changePhase('playing');
                hapticImpact('medium');
              }}
            >
              Начать
            </button>
            <button type="button" className="btn btn-quiet" onClick={onExit}>
              В меню
            </button>
          </div>
        </Modal>
      )}

      {result && phase === 'won' && (
        <Modal dismissible={false} onClose={() => undefined} className="result-modal" labelledBy="jam-win-title">
          <div className="result-hero">
            <div className="result-mark" aria-hidden="true">
              ♔
            </div>
            <span className="label label-accent">Парковка, уровень {result.level}</span>
            <h2 className="modal-title" id="jam-win-title">
              Пробка разведена
            </h2>
            <p className="modal-text">
              Все фигуры на чужой половине за {result.moves} перестановок.
            </p>
          </div>
          <div className="reward-list">
            <div className="reward-item">
              <span>Монеты за уровень</span>
              <b>+{result.coinsEarned}</b>
            </div>
            <div className="reward-item">
              <span>Следующий уровень</span>
              <b>{result.nextLevel}</b>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => restart(false)}>
              Дальше
            </button>
            <button type="button" className="btn btn-outline" onClick={() => void shareResult()}>
              Поделиться
            </button>
            <button type="button" className="btn btn-quiet" onClick={onExit}>
              В меню
            </button>
          </div>
        </Modal>
      )}

      {result && phase === 'lost' && (
        <Modal dismissible={false} onClose={() => undefined} className="result-modal" labelledBy="jam-lose-title">
          <div className="result-hero">
            <div className="result-mark danger" aria-hidden="true">
              <span className="result-glyph">♜</span>
            </div>
            <span className="label">Парковка, уровень {result.level}</span>
            <h2 className="modal-title" id="jam-lose-title">
              Ходы кончились
            </h2>
            <p className="modal-text">
              На месте {parked} из {total}. Жизнь списана, уровень тот же: попробуйте другой порядок
              перестановок или получите то же поле ещё раз.
            </p>
          </div>
          {profile.lives === 0 && !profile.adFree && (
            <p className="modal-text">
              Жизней нет: посмотрите видео и играйте дальше, либо купите жизни за звёзды.
            </p>
          )}
          <div className="modal-actions">
            {profile.lives > 0 ? (
              <button type="button" className="btn btn-primary" onClick={() => restart(true)}>
                Переиграть поле
              </button>
            ) : profile.adFree ? (
              <button type="button" className="btn btn-primary" onClick={() => restart(true)} disabled>
                Нет жизней
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void watchLifeAd()} disabled={adBusy || adLifeClaimed}>
                {adLifeClaimed ? 'Жизнь получена' : adBusy ? 'Смотрим видео' : 'Видео за жизнь'}
              </button>
            )}
            <button type="button" className="btn btn-outline" onClick={() => restart(false)}>
              Новое поле
            </button>
            {profile.lives === 0 && (
              <button type="button" className="btn btn-outline" onClick={goShopStars}>
                Жизни за звёзды
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={onExit}>
              В меню
            </button>
          </div>
        </Modal>
      )}

      {quitOpen && (
        <Modal onClose={() => setQuitOpen(false)}>
          <span className="label">Пауза</span>
          <h2 className="modal-title">Выйти в меню</h2>
          <p className="modal-text">Позиция сохранится, можно вернуться к этой пробке позже.</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={confirmExit}>
              Выйти
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setQuitOpen(false)}>
              Остаться
            </button>
          </div>
        </Modal>
      )}

      {finishError && (
        <Modal dismissible={false} onClose={() => undefined}>
          <span className="label">Сбой</span>
          <h2 className="modal-title">Результат не сохранился</h2>
          <p className="modal-text">{finishError}. Партия осталась на сервере, можно повторить отправку.</p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (runRef.current) {
                  setFinishError(null);
                  void finishRun(runRef.current, actionsRef.current);
                }
              }}
            >
              Повторить
            </button>
            <button type="button" className="btn btn-quiet" onClick={onExit}>
              В меню
            </button>
          </div>
        </Modal>
      )}

      {noCoins && (
        <Modal onClose={() => setNoCoins(false)} showClose>
          <span className="label">Магазин</span>
          <h2 className="modal-title">Монет не хватает</h2>
          <p className="modal-text">
            Монеты падают за победы в кампании и режимах с уровнем, за рекорды и за видео. Награда за
            этот уровень: {formatNumber(profile.coins)} монет в запасе.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setNoCoins(false);
                goShopStars();
              }}
            >
              Открыть магазин
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setNoCoins(false)}>
              Позже
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
