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
  analyzeState,
  applyAction,
  applyActions,
  isJamState,
  legalMoves,
  newPiecesAtLevel,
  skipsLeft,
  capturesLeft,
  isLevelMode,
  isWinLadder,
  modeDef,
  rulesFor,
  projectHint,
  survivalHint,
  RACE_WIDTH,
  raceSpawnEvery,
  resolveSkin,
  type BonusId,
  type Cell,
  type GameAction,
  type GameMode,
  type GameState,
  type MoveDx,
  type MoveDy,
} from '../engine';

/** Темп хода фигур: столько игрок видит, куда встала каждая фигура. */
const ENEMY_BEAT_MS = 700;

/**
 * Пауза между моим ходом и ответом фигур, в миллисекундах. Движок считает такт
 * целиком и синхронно, поэтому показ разбит на два кадра: сначала пешка стала,
 * через паузу поехали фигуры. Кампания держит паузу самой длинной: там один ход
 * решает партию, и надо успеть увидеть, что осталось после тебя. В «Гонках» темп
 * свой - там фигуры ездят каждый ход, длинная пауза превратила бы игру в слайды.
 */
function replyPauseMs(mode: GameState['mode']): number {
  if (mode === 'campaign') return 520;
  if (mode === 'endless') return 380;
  if (mode === 'race') return 200;
  return 0;
}

import { useApp } from '../context/AppContext';
import { api, ApiError, saveOnExit } from '../lib/api';
import { appBaseUrl, cn, formatDuration, formatNumber } from '../lib/format';
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
import { Board, type SweptPiece } from '../components/Board';
import { HeartsRow } from '../components/Hud';
import { Modal } from '../components/Modal';
import { RulesModal } from '../components/RulesModal';

type Phase = 'loading' | 'pre' | 'playing' | 'resolving' | 'finishing' | 'won' | 'lost' | 'quit';

type PawnMode = Exclude<GameMode, 'jam'>;

/** Забег пешечного экрана: initial и actions всегда в форме GameState. */
type PawnRun = Omit<RunPayload, 'initial' | 'actions'> & { initial: GameState; actions: GameAction[] };

interface GameScreenProps {
  /** «Парковка» живёт на отдельном экране: здесь только пешечные режимы. */
  mode: PawnMode;
  onExit: () => void;
  onNoLives: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
}

export function GameScreen({ mode, onExit, onNoLives, onTerms, onPrivacy }: GameScreenProps): ReactNode {
  const { profile, config, setProfile, refresh, toast, showAd, goShop, goShopStars } = useApp();
  const skin = useMemo(() => resolveSkin(profile.skin, profile.customSkin), [profile.skin, profile.customSkin]);

  // Переменные темы вешает на `:root` оболочка (см. useSkinTheme): партия, меню
  // и витрина красятся одним и тем же набором, иначе тема выглядела бы
  // включённой только на время хода.
  const [phase, setPhase] = useState<Phase>('loading');
  const [run, setRun] = useState<PawnRun | null>(null);
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

  const runRef = useRef<PawnRun | null>(null);
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
  /** Таймер раскрытия ответа фигур (см. `replyPauseMs`). */
  const replyTimerRef = useRef<number | null>(null);
  /** Сколько длится блокировка ввода на этом ходу: пауза + бит ответа. */
  const beatRef = useRef(ENEMY_BEAT_MS);

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
    async (target: PawnRun, finalActions: GameAction[]) => {
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

  // Повтор того же поля: флаг читается один раз при старте забега.
  const repeatRef = useRef(false);
  // «Начать заново» после сбоя: сервер закрывает активную партию и выдаёт новую,
  // иначе старт возвращает то же несовместимое поле и экран сбоя повторяется.
  const freshRef = useRef(false);

  const start = useCallback(async () => {
    changePhase('loading');
    finishedRef.current = false;
    finishingRef.current = false;
    finalActionsRef.current = [];
    const fresh = freshRef.current;
    freshRef.current = false;
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
      const repeat = repeatRef.current;
      repeatRef.current = false;
      const response = await api<StartRunResponse>('/api/run/start', {
        method: 'POST',
        body:
          isWinLadder(mode) && repeat
            ? { mode, repeat: true }
            : fresh
              ? { mode, fresh: true }
              : { mode },
      });
      const payload = response.run;
      if (isJamState(payload.initial)) {
        setStartError('Этот режим открыт на другом экране. «Начать заново» выдаст поле этого режима.');
        changePhase('loading');
        return;
      }
      const pawnActions = payload.actions.filter((action): action is GameAction => action.type !== 'piece');
      const nextRun: PawnRun = { ...payload, initial: payload.initial, actions: pawnActions };
      let current = nextRun.initial;
      const history: GameState[] = [];
      try {
        for (const action of nextRun.actions) {
          history.push(current);
          current = applyAction(current, action);
        }
      } catch {
        setStartError('Не удалось восстановить партию: её ходы не подходят текущим правилам. «Начать заново» закроет её и выдаст новое поле.');
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
        if (error.code === 'endless_locked' || error.code === 'mode_locked') {
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
  }, [changePhase, finishRun, mode, onExit, onNoLives, toast]);

  useEffect(() => {
    void start();
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (finishTimerRef.current) window.clearTimeout(finishTimerRef.current);
      if (replyTimerRef.current) window.clearTimeout(replyTimerRef.current);
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
  const skipsLeftNow = state ? skipsLeft(state) : 0;

  // Куда переставились фигуры после последнего хода: без этого ход врага
  // выглядит телепортом, и игрок не понимает, что его поймали.
  const enemiesBefore = useRef<GameState['enemies']>([]);
  // Куда переставили фигуры и что сошло с поля: первое нужно, чтобы ход фигуры
  // читался перестановкой, второе - чтобы уход через нижний край не выглядел
  // исчезновением. Конвейера с бегущим рядом в «Гонках» больше нет.
  const turnShift = useMemo(() => {
    const empty = { moved: [] as Array<{ id: string; from: Cell; to: Cell }>, swept: [] as SweptPiece[] };
    if (!state) return empty;
    const before = new Map(enemiesBefore.current.map((e) => [e.id, e]));
    const moved: Array<{ id: string; from: Cell; to: Cell }> = [];
    for (const enemy of state.enemies) {
      const old = before.get(enemy.id);
      if (old && (old.x !== enemy.x || old.y !== enemy.y)) {
        moved.push({ id: enemy.id, from: { x: old.x, y: old.y }, to: { x: enemy.x, y: enemy.y } });
      }
    }
    // Фигура, которой больше нет на поле и которую снял не король, сошла с края:
    // её дорисовываем уезжающим призраком, иначе исчезновение выглядит багом.
    const swept: SweptPiece[] = [];
    const alive = new Set(state.enemies.map((e) => e.id));
    for (const [id, old] of before) {
      if (alive.has(id) || old.y !== 0) continue;
      // Фигуру на клетке короля снял он сам, это взятие, а не сход с поля.
      if (state.player.x === old.x && state.player.y === old.y) continue;
      // Выпад снимает фигуру через линию, и король при этом не сходит с места:
      // проверяем и клетку последнего взятия, чтобы не рисовать двойную анимацию.
      if (state.lastCapture && state.lastCapture.x === old.x && state.lastCapture.y === old.y) continue;
      swept.push({ id, type: old.type, x: old.x, y: old.y });
    }
    enemiesBefore.current = state.enemies.map((e) => ({ ...e }));
    return { moved, swept };
  }, [state]);
  const moved = turnShift.moved;

  // Пауза на ход фигур: 700 мс анимации, в это время кнопки не отвечают.
  // Реагируем только на настоящий ход: при первой отрисовке (продолжение партии,
  // возврат из админки) блокировать ввод нечего, фигуры никуда не ехали.
  const [settling, setSettling] = useState(false);
  const movesShown = useRef<number | null>(null);
  // Таймер разблокировки живёт в рефе и снимается только при размонтировании.
  // Раньше он чистился в cleanup эффекта ниже, и второй кадр такта (приходит
  // пауза, потом ответ фигур - `state` меняется дважды на один ход) успевал его
  // убить: на втором кадре номер хода тот же, эффект выходит раньше, чем ставит
  // новый таймер, - и `settling` оставался включённым до конца партии. На экране
  // это выглядело как подвисание после первого хода: поле рисовалось, ввод не
  // отвечал, помогала только перезагрузка.
  const settleTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!state) {
      movesShown.current = null;
      return;
    }
    const previous = movesShown.current;
    movesShown.current = state.moves;
    if (previous === null || state.moves === previous) return;
    setSettling(true);
    // На ходу с паузой блокировка держится дольше: и пока фигуры не поехали, и
    // пока они едут. `beatRef` выставляет сам `performAction`, для остальных
    // смены позиции (отмена, подсказка, возврат в партию) бит остаётся обычным.
    const beat = beatRef.current;
    beatRef.current = ENEMY_BEAT_MS;
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      setSettling(false);
    }, beat);
  }, [state]);
  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    },
    [],
  );

  const lastMoveIndex = useMemo(() => {
    for (let index = actions.length - 1; index >= 0; index--) {
      if (actions[index].type === 'move') return index;
    }
    return -1;
  }, [actions]);

  const canPlay = phase === 'playing' && state?.status === 'playing' && !settling;

  function performAction(action: GameAction) {
    const current = stateRef.current;
    if (!current || current.status !== 'playing' || phaseRef.current !== 'playing') return;
    const now = Date.now();
    if (now - lastActionAt.current < 110) return;
    lastActionAt.current = now;

    let next: GameState;
    let interim: GameState | null = null;
    const pause = replyPauseMs(current.mode);
    try {
      next = applyAction(current, action);
      // Первый кадр - позиция сразу после моего хода, до притока и ответа фигур.
      // Партию она не заканчивает и не выигрывает: это только показ, настоящая
      // позиция уже лежит в `stateRef`, по ней работают отмена и подсказка.
      if (pause > 0 && next.status === 'playing') {
        interim = applyAction(current, action, { playerOnly: true });
      }
    } catch {
      return;
    }

    historyRef.current.push(current);
    const nextActions = [...actionsRef.current, action];
    actionsRef.current = nextActions;
    stateRef.current = next;
    setActions(nextActions);
    setHistoryDepth(historyRef.current.length);
    setHint([]);
    hapticImpact('light');
    if (next.status === 'playing') scheduleSave(nextActions);

    const commit = () => {
      setState(next);
      if (next.status === 'playing') return;
      finalActionsRef.current = nextActions;
      changePhase('resolving');
      if (finishTimerRef.current) window.clearTimeout(finishTimerRef.current);
      finishTimerRef.current = window.setTimeout(() => {
        if (runRef.current) void finishRun(runRef.current, nextActions);
      }, next.status === 'lost' ? 700 : 450);
    };

    if (interim) {
      beatRef.current = ENEMY_BEAT_MS + pause;
      if (replyTimerRef.current) window.clearTimeout(replyTimerRef.current);
      setState(interim);
      replyTimerRef.current = window.setTimeout(() => {
        replyTimerRef.current = null;
        commit();
      }, pause);
      return;
    }

    commit();
  }

  function handleMove(dx: MoveDx, dy: MoveDy = 1) {
    const option = moves.find((move) => move.dx === dx && (move.dy ?? 1) === dy);
    if (!option) return;
    performAction(dy === 1 ? { type: 'move', dx } : { type: 'move', dx, dy });
  }

  function handleSkip() {
    // Пропуск бывает вынужденным (ходов нет) и добровольным: квота режима.
    if (moves.length > 0 && skipsLeftNow <= 0) return;
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
    // У режимов на выживание финиша нет, поэтому там подсказка ищет не путь, а
    // лучший следующий ход. Перебор до верхнего ряда на них только сжигает лимит
    // узлов и возвращает пустоту, из-за чего подсказка «не работала».
    const cells =
      rulesFor(state.mode).goal === 'survive'
        ? survivalHint(state, 2)
        : projectHint(state, analyzeState(state, { maxDepth: 6, maxNodes: 3000 }).path, 2);
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
      const rewarded = await showAd('+1 жизнь');
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
    // Режимы без финиша (бесконечный и «Гонки») при выходе надо
    // закрывать забегом, иначе ходы останутся в активной партии и не попадут в
    // рекорд и в уровень режима.
    if (mode === 'endless' || mode === 'race') {
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

  function restart(repeat: boolean) {
    repeatRef.current = repeat;
    setResult(null);
    void start();
  }

  function nextLevel() {
    restart(false);
  }

  async function shareResult(kind: 'win' | 'lose') {
    const bot = config.botUsername;
    const level = result?.maxLevel ?? profile.maxLevel;
    const endless = mode === 'endless';
    const payload = endless ? `ch_0_${profile.endlessBest}` : `ch_${level}_${level}`;
    const url = bot ? `https://t.me/${bot}?startapp=${payload}` : appBaseUrl(config.webappUrl);
    const where = mode === 'campaign' ? 'в «Крае доски»' : `в режиме «${modeDef(mode).name}»`;
    const text = endless
      ? `Мой рекорд в «Крае доски», ${profile.endlessBest} клеток. Слабо выше?`
      : kind === 'win'
        ? `Я прошёл уровень ${result?.level ?? run?.level ?? profile.level} ${where}. Слабо повторить?`
        : `Я пал на ${result?.level ?? run?.level ?? profile.level} уровне ${where}. Сможешь лучше?`;
    const status = await shareContent(text, url);
    if (status === 'copied') toast('Ссылка скопирована', 'success');
    if (status === 'failed') toast('Не удалось поделиться', 'error');
  }

  function restartFresh() {
    freshRef.current = true;
    repeatRef.current = false;
    void start();
  }

  if (!state || !run) {
    return (
      <div className="screen game-screen game-loading">
        <div className="loading-state">
          {startError ? (
            <>
              <span className="loading-mark serif" aria-hidden="true">♟</span>
              <h2 className="modal-title" style={{ margin: '0 auto 8px' }}>Поле не загрузилось</h2>
              <p className="modal-text">{startError}</p>
              <div className="modal-actions" style={{ width: '100%' }}>
                <button type="button" className="btn btn-primary" onClick={restartFresh}>
                  Начать заново
                </button>
                <button type="button" className="btn btn-quiet" onClick={onExit}>
                  В меню
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="loading-mark serif" aria-hidden="true">♟</span>
              <span className="label">Расставляем фигуры</span>
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

  const isEndless = mode === 'endless';
  const isRace = mode === 'race';
  const rules = rulesFor(mode);
  // Такт притока: сколько ходов до следующей волны. Полоса из клеток отвечает
  // на вопрос «фигура придёт сейчас или через ход», и это же объясняет, почему
  // поле заполняется не каждый ход.
  const raceEvery = isRace ? raceSpawnEvery(state.tier) : 0;
  const raceElapsed = isRace ? state.moves % raceEvery : 0;
  // Ширина поля - местная шкала сложности: колонки добавляются справа по мере
  // того, как приходят фигуры, поэтому «сколько поля уже отросло» стоит показывать
  // так же заметно, как номер волны. Такт поля не показываем: ряд едет каждый
  // ход, и считать тут нечего.
  const raceWidth = isRace ? state.width : 0;
  // Король: у «Гонок» игрок ходит на клетку в любую сторону, поэтому кнопок
  // девять, а не три.
  const king = rules.player === 'king';
  const modeName = isEndless ? 'Бесконечный режим' : modeDef(mode).name;
  const captures = state ? capturesLeft(state) : Number.POSITIVE_INFINITY;
  const levelTypes = [...new Set(run.initial.enemies.map((enemy) => enemy.type))];
  const unlockedNow = newPiecesAtLevel(run.level);
  const playerAlive = state.status !== 'lost';

  return (
    <div className="screen game-screen">
      <header className="game-top">
        <button type="button" className="back-btn" onClick={requestExit} aria-label="Назад">
          ←
        </button>
        <div className="game-heading">
          <span className="label">{modeName}</span>
          <b className="game-title">
            {isEndless ? `Высота ${state.score}` : isRace ? `Ходы ${state.score}` : `Уровень ${run.level}`}
          </b>
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
        <span className="status-item">Ход {state.moves + 1}</span>
        <span className="status-sep" aria-hidden="true">/</span>
        <span className="status-item">
          {isEndless || isRace ? `Волна ${state.tier}` : `Поле ${run.initial.width}×${run.initial.height}`}
        </span>
        {isRace && (
          <>
            <span className="status-sep" aria-hidden="true">/</span>
            <span className="status-item">рекорд {profile.modes.race.best ?? 0}</span>
          </>
        )}
        {isRace && (
          <>
            <span className="status-sep" aria-hidden="true">/</span>
            <span className="status-item">
              волна через {raceEvery - raceElapsed}
              <span className="race-ticks" aria-hidden="true">
                {Array.from({ length: raceEvery }).map((_, index) => (
                  <i key={index} className={index < raceElapsed ? 'on' : undefined} />
                ))}
              </span>
            </span>
          </>
        )}
        {isRace && (
          <>
            <span className="status-sep" aria-hidden="true">/</span>
            <span className={cn('status-item', raceWidth >= RACE_WIDTH && 'off')}>
              ширина {raceWidth} из {RACE_WIDTH}
            </span>
          </>
        )}
        {rules.captureQuota > 0 && (
          <>
            <span className="status-sep" aria-hidden="true">/</span>
            <span className={cn('status-item', captures === 0 && 'off')}>
              взятий {captures === Number.POSITIVE_INFINITY ? '∞' : captures}
            </span>
          </>
        )}
        {rules.skipQuota > 0 && (
          <>
            <span className="status-sep" aria-hidden="true">/</span>
            <span className="status-item">пропусков {skipsLeftNow}</span>
          </>
        )}
        {state.shield > 0 && (
          <>
            <span className="status-sep" aria-hidden="true">/</span>
            <span className="status-item on">щит {state.shield}</span>
          </>
        )}
        {state.freeze > 0 && (
          <>
            <span className="status-sep" aria-hidden="true">/</span>
            <span className="status-item on">фигуры заморожены</span>
          </>
        )}
      </div>

      <div className="board-area">
        <div className="goal-line">
          <span>
            {isEndless
              ? 'Поднимайтесь выше, поле растёт'
              : isRace
                ? 'Держитесь в полосе: бейте и уходите в любую сторону'
                : 'Дойти до верхнего ряда'}
          </span>
          <span className="num">{state.score > 0 ? (isRace ? `${state.score} ход.` : `${state.score} кл.`) : ''}</span>
        </div>
        <Board
          state={state}
          moves={canPlay ? moves : []}
          hint={hint}
          skin={skin}
          interactive={canPlay}
          onMove={handleMove}
          turn={state.moves}
          moved={moved}
          swept={turnShift.swept}
          settling={settling}
        />
      </div>

      <div className="game-controls">
        <div className="buff-row">
          <button
            type="button"
            className="buff-btn"
            onClick={() => void useHint()}
            disabled={!canPlay || bonusBusy}
          >
            <span className="buff-name">Подсказка</span>
            <span className="buff-meta">
              {profile.inventory.hint > 0 ? `в запасе ${profile.inventory.hint}` : `${BONUSES.hint.price} монет`}
            </span>
          </button>
          <button
            type="button"
            className={cn('buff-btn', state.freeze > 0 && 'active')}
            onClick={() => void useFreeze()}
            disabled={!canPlay || bonusBusy || state.freeze > 0}
          >
            <span className="buff-name">{state.freeze > 0 ? `Мороз ${state.freeze}` : 'Заморозка'}</span>
            <span className="buff-meta">
              {state.freeze > 0
                ? 'фигуры стоят'
                : profile.inventory.freeze > 0
                  ? `в запасе ${profile.inventory.freeze}`
                  : `${BONUSES.freeze.price} монет`}
            </span>
          </button>
          <button
            type="button"
            className="buff-btn"
            onClick={() => void useUndo()}
            disabled={!canPlay || bonusBusy || lastMoveIndex < 0}
          >
            <span className="buff-name">Отмена</span>
            <span className="buff-meta">
              {historyDepth === 0
                ? 'ходов нет'
                : profile.inventory.undo > 0
                  ? `в запасе ${profile.inventory.undo}`
                  : `${BONUSES.undo.price} монет`}
            </span>
          </button>
        </div>

        {/* Ряд кнопок хода (влево / вперёд / вправо и «на две клетки») убран: режим
            управляется тапом по подсвеченной клетке, а кнопки только спорили с полем
            за высоту - из-за них поле дышало на каждый ход. */}
        <div className="side-row">
          {canPlay && (moves.length === 0 || skipsLeftNow > 0) ? (
            <button type="button" className="skip-btn" onClick={handleSkip}>
              {moves.length === 0 ? 'Ходов нет. Пропустить' : `Пропустить ход, в запасе ${skipsLeftNow}`}
            </button>
          ) : null}
        </div>
        <p className="control-hint">
          {!playerAlive
            ? isRace
              ? 'Короля сняли.'
              : 'Пешка поймана.'
            : settling
              ? isRace
                ? 'Фигуры спускаются на короля.'
                : 'Фигуры идут за пешкой.'
              : king
                ? isRace
                  ? 'Тап по клетке: шаг или взятие в любую сторону, только в двух нижних рядах. Фигуру впритык к красной линии бейте на месте.'
                  : 'Король: шаг и взятие в любую из восьми сторон, назад включительно. Клетка с фигурой доступна, если её можно взять.'
                : 'Ходите по полю: тап по подсвеченной клетке. Пешка идёт вперёд, бьёт по диагонали, первым ходом - на две клетки.'}
        </p>
      </div>

      {preOpen && (
        <Modal dismissible={false} onClose={() => undefined} labelledBy="pre-title">
          <span className="label">
            {isEndless
              ? 'Забег'
              : isRace
                ? `Поле ${run.initial.width} на ${run.initial.height}, рост вширь`
                : `Поле ${run.initial.width} на ${run.initial.height}`}
          </span>
          <h2 className="modal-title" id="pre-title">
            {isEndless ? 'Бесконечный режим' : `${modeName}, уровень ${run.level}`}
          </h2>
          <p className="modal-text">
            {isEndless
              ? 'Поле прибавляет пять клеток за каждые пять клеток подъёма. Сложность растёт вместе с высотой.'
              : isRace
                ? 'Вы король в двух нижних рядах: шаг и взятие в любую сторону. Выше красной линии хода нет, но фигуру, вставшую впритык к ней, можно снять на месте - это выпад, и он стоит хода. Фигуры приходят сверху и за такт делают ровно один свой ход; дошли до нижнего ряда - ушли с поля. Поймать вас может только та, что встала на вашу клетку. Счёт - пережитые ходы: каждые 8 волна быстрее, каждые 12 уровень режима.'
                : 'Дойти до верхнего ряда. Фигуры ходят после игрока и стараются подобраться ближе.'}
          </p>

          <div className="pre-meta">
            <div>
              <span>Размер поля</span>
              <b>{isEndless ? '6 на 9 и выше' : `${run.initial.width} на ${run.initial.height}`}</b>
            </div>
            <div>
              <span>Фигур на поле</span>
              <b>{run.initial.enemies.length}</b>
            </div>
            <div>
              <span>Жизней в запасе</span>
              <b>{profile.lives}</b>
            </div>
          </div>

          <div className="pre-piece-list">
            {levelTypes.map((type) => (
              <span className="pre-piece" key={type}>
                <em>{PIECE_GLYPH[type]}</em>
                <span>{PIECE_NAME[type]}</span>
              </span>
            ))}
          </div>

          {unlockedNow.length > 0 && (
            <p className="pre-unlock">
              Новая фигура: {unlockedNow.map((type) => PIECE_NAME[type]).join(', ')}
            </p>
          )}

          {!profile.adFree && (
            <button
              type="button"
              className="shield-offer"
              onClick={() => void watchShield()}
              disabled={adBusy || shieldUsed || state.shield > 0}
            >
              <span>
                <b>{adBusy ? 'Загружаем ролик' : shieldUsed ? 'Щит уже взят' : 'Щит на три хода'}</b>
                <small>За просмотр рекламы, один раз за забег</small>
              </span>
              <span className="arrow" aria-hidden="true">→</span>
            </button>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={beginPlay}>
              Начать
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setRulesOpen(true)}>
              Как играть
            </button>
          </div>
        </Modal>
      )}

      {phase === 'finishing' && !finishError && (
        <div className="finishing-veil">
          <span className="loading-text">Сохраняем результат</span>
        </div>
      )}

      {finishError && (
        <Modal dismissible={false} onClose={() => undefined}>
          <span className="label">Сбой</span>
          <h2 className="modal-title">Результат не сохранился</h2>
          <p className="modal-text">
            {finishError}. Партия осталась на сервере, можно повторить отправку.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (runRef.current) {
                  setFinishError(null);
                  void finishRun(runRef.current, finalActionsRef.current.length ? finalActionsRef.current : actionsRef.current);
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

      {result && phase === 'won' && (
        <WinModal
          result={result}
          modeName={modeName}
          onNext={nextLevel}
          onShare={() => void shareResult('win')}
          onMenu={onExit}
          isEndless={false}
        />
      )}

      {result && phase === 'lost' && (
        <LoseModal
          result={result}
          modeName={modeName}
          profile={profile}
          adFree={profile.adFree}
          adBusy={adBusy}
          adClaimed={adLifeClaimed}
          isEndless={isEndless}
          isRace={isRace}
          onWatchLife={() => void watchLifeAd()}
          onRetry={nextLevel}
          onRetrySame={isWinLadder(mode) ? () => restart(true) : undefined}
          onShare={() => void shareResult('lose')}
          onMenu={onExit}
          onShop={goShopStars}
          onRefresh={refresh}
        />
      )}

      {result && phase === 'quit' && (
        <Modal dismissible={false} onClose={() => undefined}>
          <span className="label">Забег</span>
          <h2 className="modal-title">{result.newBest ? 'Новый рекорд' : 'Забег завершён'}</h2>
          <p className="modal-text">
            {mode === 'race'
              ? result.newBest
                ? `Рекорд: ${result.bestScore ?? result.score} ходов.`
                : `Продержались ${result.score} ходов.`
              : result.newBest
                ? `Высота ${result.bestScore ?? result.score} клеток.`
                : `Остановились на высоте ${result.score} клеток.`}
            {result.coinsEarned > 0 ? ` Награда: ${result.coinsEarned} монет.` : ''}
            {result.skinAward ? ` Открыта тема «${result.skinAward}» - её можно надеть в магазине.` : ''}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={onExit}>В меню</button>
            <button type="button" className="btn btn-outline" onClick={() => void shareResult('win')}>Поделиться</button>
          </div>
        </Modal>
      )}

      {quitOpen && (
        <Modal onClose={() => setQuitOpen(false)}>
          <span className="label">Пауза</span>
          <h2 className="modal-title">{isEndless || isRace ? 'Завершить забег' : 'Выйти в меню'}</h2>
          <p className="modal-text">
            {isEndless || isRace
              ? 'Результат попадёт в рекорды, но продолжить этот забег уже не получится.'
              : 'Партия сохранится, можно вернуться к этому ходу позже.'}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={confirmExit}>
              {isEndless || isRace ? 'Завершить' : 'Выйти'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setQuitOpen(false)}>
              Остаться
            </button>
          </div>
        </Modal>
      )}

      {noCoins && (
        <Modal onClose={() => setNoCoins(false)} showClose>
          <span className="label">Баланс</span>
          <h2 className="modal-title">Не хватает монет</h2>
          <p className="modal-text">
            Монеты дают за пройденные уровни и рекорды. Ещё немного можно получить за рекламу в меню.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => { setNoCoins(false); goShop(); }}>
              В магазин
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setNoCoins(false)}>
              Понятно
            </button>
          </div>
        </Modal>
      )}

      {rulesOpen && (
        <RulesModal
          race={isRace}
          onClose={() => setRulesOpen(false)}
          onTerms={onTerms}
          onPrivacy={onPrivacy}
        />
      )}
    </div>
  );
}

function WinModal({
  result,
  modeName,
  onNext,
  onShare,
  onMenu,
  isEndless,
}: {
  result: FinishResult;
  /** Название режима в шапке: «Парковка, уровень 7» звучит иначе, чем «Кампания». */
  modeName: string;
  onNext: () => void;
  onShare: () => void;
  onMenu: () => void;
  isEndless: boolean;
}): ReactNode {
  return (
    <Modal dismissible={false} onClose={() => undefined} className="result-modal" labelledBy="win-title">
      <div className="result-hero">
        <div className="result-mark" aria-hidden="true">♔</div>
        <span className="label label-accent">{isEndless ? 'Бесконечный режим' : `${modeName}, уровень ${result.level}`}</span>
        <h2 className="modal-title" id="win-title">Пешка дошла</h2>
        <p className="modal-text">Верхний ряд взят, пешка цела.</p>
      </div>

      <div className="reward-list">
        <div className="reward-item">
          <span>Монеты за уровень</span>
          <b>+{result.coinsEarned}</b>
        </div>
        {result.newBest && (
          <div className="reward-item">
            <span>Новый рекорд высоты</span>
            <b>{result.bestScore}</b>
          </div>
        )}
        <div className="reward-item">
          <span>Следующий уровень</span>
          <b>{result.nextLevel}</b>
        </div>
        {result.undoGranted ? (
          <div className="reward-item">
            <span>Бесплатный откат</span>
            <b>+{result.undoGranted}</b>
          </div>
        ) : null}
      </div>

      {result.endlessUnlockedNow && (
        <div className="callout">
          <span className="label label-accent">Открыто</span>
          <span>Бесконечный режим. Поле растёт, пока вы держитесь.</span>
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={onNext}>
          {isEndless ? 'Ещё забег' : 'Следующий уровень'}
        </button>
        <button type="button" className="btn btn-outline" onClick={onShare}>
          Бросить вызов
        </button>
        <button type="button" className="btn btn-outline" onClick={onMenu}>
          В меню
        </button>
      </div>
    </Modal>
  );
}

function LoseModal({
  result,
  modeName,
  profile,
  adFree,
  adBusy,
  adClaimed,
  isEndless,
  isRace,
  onWatchLife,
  onRetry,
  onRetrySame,
  onShare,
  onMenu,
  onShop,
  onRefresh,
}: {
  result: FinishResult;
  modeName: string;
  profile: Profile;
  adFree: boolean;
  adBusy: boolean;
  adClaimed: boolean;
  isEndless: boolean;
  isRace: boolean;
  onWatchLife: () => void;
  onRetry: () => void;
  /** Повторить ровно то же поле, что привело к поражению. */
  onRetrySame?: () => void;
  onShare: () => void;
  onMenu: () => void;
  onShop: () => void;
  onRefresh: () => Promise<void>;
}): ReactNode {
  const remaining = useCountdown(profile.nextLifeAt, () => {
    void onRefresh();
  });
  const captured = result.capturedBy;
  // В тупике фигуры не ходят и не бьют, поэтому победителя у поражения нет.
  const stuck = captured === undefined;
  const canRetry = profile.lives > 0;

  return (
    <Modal dismissible={false} onClose={() => undefined} className="result-modal" labelledBy="lose-title">
      <div className="result-hero">
        <div className="result-mark danger" aria-hidden="true">
          <span className="result-glyph">{captured ? PIECE_GLYPH[captured] : '♟'}</span>
        </div>
        <span className="label">
          {isEndless
            ? `Высота ${result.score}`
            : isRace
              ? `${modeName}, ходов ${result.score}`
              : `${modeName}, уровень ${result.level}`}
        </span>
        <h2 className="modal-title" id="lose-title">
          {stuck ? 'Тупик' : isRace ? 'Короля поймали' : 'Пешка поймана'}
        </h2>
        <p className="modal-text">
          {isRace
            ? stuck
              ? 'В полосе из двух нижних рядов не осталось клетки, куда можно шагнуть, и бить нечего: фигуры встали вплотную. Каждый пережитый ход идёт в рекорд, каждые двенадцать режим поднимает уровень.'
              : 'Фигура встала на клетку короля своим ходом. Больше проиграть нельзя: поле никуда не уезжает, а король стоит на своей полосе. Каждый пережитый ход идёт в рекорд, каждые двенадцать режим поднимает уровень.'
            : stuck
              ? 'Дорога закрыта: ходить некуда, взятия кончились.'
              : captured
                ? `${PIECE_NAME[captured]} добрался до вашей пешки.`
                : 'Фигура добралась до вашей пешки.'}{' '}
          Минус одна жизнь.
        </p>
      </div>

      <div className="lives-line">
        <span>Осталось жизней</span>
        <HeartsRow
          lives={profile.lives}
          maxLives={profile.maxLives}
          eternal={profile.eternalLives}
        />
      </div>

      {result.newBest && (
        <div className="callout">
          <span className="label label-accent">Рекорд</span>
          <span>
            {isRace ? `${result.bestScore} ходов` : `Высота ${result.bestScore} клеток`}, награда {result.coinsEarned} монет.
          </span>
        </div>
      )}

      {!canRetry && (
        <div className="timer-line">
          <span>Новая жизнь через</span>
          <b>{formatDuration(remaining)}</b>
        </div>
      )}

      <div className="modal-actions">
        {canRetry && (
          <button type="button" className="btn btn-primary" onClick={onRetrySame ?? onRetry}>
            {isEndless || isRace ? 'Новый забег' : 'Переиграть это поле'}
          </button>
        )}
        {canRetry && onRetrySame && !isEndless ? (
          <button type="button" className="btn btn-outline" onClick={onRetry}>
            Новый уровень
          </button>
        ) : null}
        {!adFree && !adClaimed && (
          <button
            type="button"
            className={canRetry ? 'btn btn-outline' : 'btn btn-primary'}
            onClick={onWatchLife}
            disabled={adBusy}
          >
            {adBusy ? 'Загружаем ролик' : 'Смотреть рекламу за жизнь'}
          </button>
        )}
        {!canRetry && (
          <button type="button" className="btn btn-outline" onClick={onShop}>
            Магазин: пять жизней за 25 звёзд
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={onShare}>
          Бросить вызов
        </button>
        <button type="button" className="btn btn-outline" onClick={onMenu}>
          В меню
        </button>
      </div>
    </Modal>
  );
}
