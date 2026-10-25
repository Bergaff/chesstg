import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BONUSES,
  applyJamAction,
  isJamState,
  jamBudget,
  jamLegalActions,
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
import { tr, trf } from '../lib/i18n';

type Phase = 'loading' | 'pre' | 'playing' | 'finishing' | 'won' | 'lost';

interface JamHintResponse {
  move: JamAction;
  removed: number;
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
  // «Начать заново» после сбоя: сервер закрывает активную партию и выдаёт новую,
  // иначе старт возвращает то же несовместимое поле и экран сбоя повторяется.
  const freshRef = useRef(false);
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
        setFinishError(error instanceof ApiError ? error.message : tr('Не удалось сохранить результат'));
      }
    },
    [changePhase, refresh, setProfile],
  );

  const start = useCallback(async () => {
    changePhase('loading');
    finishedRef.current = false;
    finishingRef.current = false;
    const repeat = repeatRef.current;
    const fresh = freshRef.current;
    repeatRef.current = false;
    freshRef.current = false;
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
        body: repeat ? { mode: 'jam', repeat: true } : fresh ? { mode: 'jam', fresh: true } : { mode: 'jam' },
      });
      const nextRun = response.run;
      if (!isJamState(nextRun.initial)) {
        setStartError(tr('Сервер прислал поле прежнего забега, этот режим его не принимает. «Начать заново» закроет старый забег, и поле сгенерируется заново.'));
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
        setStartError(tr('Не удалось восстановить партию: её ходы не подходят текущим правилам. «Начать заново» закроет её и выдаст новое поле.'));
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
        if (response.resumed) toast(tr('Партия восстановлена'), 'info');
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
        setStartError(tr('Не удалось загрузить поле. Проверьте связь.'));
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

  const removed = jam?.removed ?? 0;
  const total = jam?.total ?? 0;
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
      toast(error instanceof Error ? tr('Так фигура не ходит') : tr('Ход не прошёл'), 'info');
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
      toast(tr('Ход отменён'), 'success');
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
    toast(tr('Бонус не сработал'), 'error');
  }

  async function useHint() {
    const current = jamRef.current;
    if (!current || !canPlay || bonusBusy) return;
    setBonusBusy(true);
    try {
      const paid = await api<BonusUseResponse>('/api/bonus/use', {
        method: 'POST',
        body: { kind: 'hint', runId: run?.id, at: actionsRef.current.length },
      });
      // Монеты уже списаны, поэтому счётчик обновляем до запроса хода: отказ
      // на /hint не должен оставлять игрока с цифрой, которой больше нет.
      setProfile({ ...profile, coins: paid.coins, inventory: paid.inventory });
      const response = await api<JamHintResponse>(`/api/run/${runRef.current!.id}/hint`, {
        method: 'POST',
        body: { actions: actionsRef.current },
      });
      setHint({ id: response.move.id, to: response.move.to });
      setSelected(response.move.id);
      toast(tr('Показали полезный ход'), 'success');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'no_hint') {
        toast(tr('Полезного хода не видно: пробуйте разобрать пробку с другого края'), 'info');
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
      const rewarded = await showAd(tr('+1 жизнь'));
      if (!rewarded) return;
      const response = await api<AdRewardResponse>('/api/ads/reward', { method: 'POST', body: { kind: 'life' } });
      setProfile(response.profile);
      setAdLifeClaimed(true);
      hapticNotify('success');
      toast(tr('+1 жизнь'), 'success');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : tr('Не удалось получить жизнь'), 'error');
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

  /** Аварийный путь из экрана сбоя: та же партия больше не предлагается. */
  function restartFresh() {
    freshRef.current = true;
    repeatRef.current = false;
    void start();
  }

  async function shareResult() {
    const bot = config.botUsername;
    const level = result?.level ?? run?.level ?? profile.modes?.jam?.level ?? 1;
    const url = bot ? `https://t.me/${bot}?startapp=play` : '';
    const text = trf('Собрал «Парковку» уровня {0} в «Крае доски». За {1} перестановок.', [level, movesUsed]);
    const status = await shareContent(text, url);
    if (status === 'copied') toast(tr('Текст скопирован'), 'success');
    if (status === 'failed') toast(tr('Не удалось поделиться'), 'error');
  }

  const movablePieces = useMemo(() => {
    if (!jam || !canPlay) return new Set<string>();
    return new Set(jamLegalActions(jam).map((action) => action.id));
  }, [canPlay, jam]);

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
                {tr('Поле не загрузилось')}
              </h2>
              <p className="modal-text">{startError}</p>
              <div className="modal-actions" style={{ width: '100%' }}>
                <button type="button" className="btn btn-primary" onClick={restartFresh}>
                  {tr('Начать заново')}
                </button>
                <button type="button" className="btn btn-quiet" onClick={onExit}>
                  {tr('В меню')}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="loading-mark serif" aria-hidden="true">
                ♜
              </span>
              <span className="label">{tr('Расставляем пробку')}</span>
              <p className="loading-text">{tr('Готовим поле')}</p>
            </>
          )}
          {!startError && (
            <button type="button" className="btn btn-quiet" onClick={onExit}>
              {tr('В меню')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="screen game-screen jam-screen">
      <header className="game-top">
        <button type="button" className="back-btn" onClick={requestExit} aria-label={tr('Назад')}>
          ←
        </button>
        <div className="game-heading">
          <span className="label">{tr(modeDef('jam').name)}</span>
          <b className="game-title">{tr('Уровень')} {run.level}</b>
        </div>
        <div className="game-hud">
          <span className="hud-item">
            <span className="label">{tr('Жизни')}</span>
            <b>{profile.lives}</b>
          </span>
          <span className="hud-item">
            <span className="label">{tr('Монеты')}</span>
            <b>{formatNumber(profile.coins)}</b>
          </span>
        </div>
      </header>

      <div className="game-status">
        <span className={cn('status-item', movesLeft <= 3 && 'warn')}>{tr('ходов')} {movesLeft}</span>
        <span className="status-sep" aria-hidden="true">/</span>
        <span className="status-item">
          {trf('уведено {0} из {1}', [removed, total])}
        </span>
        <span className="status-sep" aria-hidden="true">/</span>
        <span className="status-item">{tr('поле')} {jam.width}×{jam.height}</span>
      </div>

      <div className="jam-progress" role="progressbar" aria-valuenow={removed} aria-valuemin={0} aria-valuemax={total}>
        <span style={{ width: total ? `${Math.round((removed / total) * 100)}%` : 0 }} />
      </div>

      <div className="board-area">
        <div className="goal-line">
          <span>{tr('белые на нижний ряд, чёрные на верхний')}</span>
          <span className="num">{selected ? tr('выберите клетку') : tr('троньте фигуру')}</span>
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
            <span className="buff-name">{tr('Подсказка')}</span>
            <span className="buff-meta">
              {profile.inventory.hint > 0 ? trf('в запасе {0}', [profile.inventory.hint]) : trf('{0} монет', [BONUSES.hint.price])}
            </span>
          </button>
          <button
            type="button"
            className="buff-btn"
            onClick={() => void useUndo()}
            disabled={!canPlay || bonusBusy || actions.length === 0}
          >
            <span className="buff-name">{tr('Отмена')}</span>
            <span className="buff-meta">
              {actions.length === 0
                ? tr('ходить нечем')
                : profile.inventory.undo > 0
                  ? trf('в запасе {0}', [profile.inventory.undo])
                  : trf('{0} монет', [BONUSES.undo.price])}
            </span>
          </button>
          <button type="button" className="buff-btn" onClick={() => setRulesOpen(true)}>
            <span className="buff-name">{tr('Правила')}</span>
            <span className="buff-meta">{tr('как переставлять')}</span>
          </button>
        </div>

        <p className="control-hint">
          {jam.status === 'won'
            ? tr('Поле собрано.')
            : jam.status === 'lost'
              ? tr('Перестановки кончились, пробка не разошлась.')
              : selected
                ? tr('Клетки с меткой - куда фигура доедет.')
                : movablePieces.size === 0
                  ? tr('Ни одна фигура не может сдвинуться: отмените ход.')
                  : tr('Ладья ездит прямо, слон по диагонали, конь перепрыгивает. Бить нельзя.')}
        </p>
      </div>

      {rulesOpen && (
        <RulesModal jam onClose={() => setRulesOpen(false)} onTerms={onTerms} onPrivacy={onPrivacy} />
      )}

      {phase === 'pre' && (
        <Modal dismissible={false} onClose={() => undefined} labelledBy="jam-pre-title">
          <span className="label">{tr('Поле')} {jam.width}×{jam.height}{tr(', фигур увести')} {total}</span>
          <h2 className="modal-title" id="jam-pre-title">
            {tr(modeDef('jam').name)}{tr(', уровень')} {run.level}
          </h2>
          <p className="modal-text">
            {tr('Все фигуры ваши - ходите любой по её шахматному правилу. Довели до её края - она ушла с поля: белым нужен нижний ряд, чёрным верхний. Бить нельзя. Уведите всех за данный запас ходов.')}
          </p>
          <div className="pre-meta">
            <div>
              <span>{tr('Перестановок дано')}</span>
              <b>{budget}</b>
            </div>
            <div>
              <span>{tr('Фигур на поле')}</span>
              <b>{jam.total}</b>
            </div>
            <div>
              <span>{tr('Жизней в запасе')}</span>
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
              {tr('Начать')}
            </button>
            <button type="button" className="btn btn-quiet" onClick={onExit}>
              {tr('В меню')}
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
            <span className="label label-accent">{tr('Парковка, уровень')} {result.level}</span>
            <h2 className="modal-title" id="jam-win-title">
              {tr('Пробка разведена')}
            </h2>
            <p className="modal-text">
              {trf('Все фигуры на чужой половине за {0} перестановок.', [result.moves])}
            </p>
          </div>
          <div className="reward-list">
            <div className="reward-item">
              <span>{tr('Монеты за уровень')}</span>
              <b>+{result.coinsEarned}</b>
            </div>
            <div className="reward-item">
              <span>{tr('Следующий уровень')}</span>
              <b>{result.nextLevel}</b>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => restart(false)}>
              {tr('Дальше')}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => void shareResult()}>
              {tr('Поделиться')}
            </button>
            <button type="button" className="btn btn-quiet" onClick={onExit}>
              {tr('В меню')}
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
            <span className="label">{trf('Парковка, уровень {0}', [result.level])}</span>
            <h2 className="modal-title" id="jam-lose-title">
              {tr('Ходы кончились')}
            </h2>
            <p className="modal-text">
              {trf(
                'Уведено {0} из {1}. Жизнь списана, уровень тот же: попробуйте другой порядок перестановок или получите то же поле ещё раз.',
                [removed, total],
              )}
            </p>
          </div>
          {profile.lives === 0 && !profile.adFree && (
            <p className="modal-text">
              {tr('Жизней нет: посмотрите видео и играйте дальше, либо купите жизни за звёзды.')}
            </p>
          )}
          <div className="modal-actions">
            {profile.lives > 0 ? (
              <button type="button" className="btn btn-primary" onClick={() => restart(true)}>
                {tr('Переиграть поле')}
              </button>
            ) : profile.adFree ? (
              <button type="button" className="btn btn-primary" onClick={() => restart(true)} disabled>
                {tr('Нет жизней')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void watchLifeAd()} disabled={adBusy || adLifeClaimed}>
                {adLifeClaimed ? tr('Жизнь получена') : adBusy ? tr('Смотрим видео') : tr('Видео за жизнь')}
              </button>
            )}
            <button type="button" className="btn btn-outline" onClick={() => restart(false)}>
              {tr('Новое поле')}
            </button>
            {profile.lives === 0 && (
              <button type="button" className="btn btn-outline" onClick={goShopStars}>
                {tr('Жизни за звёзды')}
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={onExit}>
              {tr('В меню')}
            </button>
          </div>
        </Modal>
      )}

      {quitOpen && (
        <Modal onClose={() => setQuitOpen(false)}>
          <span className="label">{tr('Пауза')}</span>
          <h2 className="modal-title">{tr('Выйти в меню')}</h2>
          <p className="modal-text">{tr('Позиция сохранится, можно вернуться к этой пробке позже.')}</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={confirmExit}>
              {tr('Выйти')}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setQuitOpen(false)}>
              {tr('Остаться')}
            </button>
          </div>
        </Modal>
      )}

      {finishError && (
        <Modal dismissible={false} onClose={() => undefined}>
          <span className="label">{tr('Сбой')}</span>
          <h2 className="modal-title">{tr('Результат не сохранился')}</h2>
          <p className="modal-text">{finishError}{tr('. Партия осталась на сервере, можно повторить отправку.')}</p>
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
              {tr('Повторить')}
            </button>
            <button type="button" className="btn btn-quiet" onClick={onExit}>
              {tr('В меню')}
            </button>
          </div>
        </Modal>
      )}

      {noCoins && (
        <Modal onClose={() => setNoCoins(false)} showClose>
          <span className="label">{tr('Магазин')}</span>
          <h2 className="modal-title">{tr('Монет не хватает')}</h2>
          <p className="modal-text">
            {tr('Монеты падают за победы в кампании и режимах с уровнем, за рекорды и за видео.')}{' '}
            {trf('Награда за этот уровень: {0} монет в запасе.', [formatNumber(profile.coins)])}
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
              {tr('Открыть магазин')}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setNoCoins(false)}>
              {tr('Позже')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
