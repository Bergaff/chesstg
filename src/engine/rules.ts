import { cloneState, enemyAttacksCell, enemyTarget, legalMoves } from './board';
import { Rng } from './rng';
import { raceLevelForRows, raceSpawnPool } from './race';

/** Кем пополняется поле: конь и слон создают уклонения, ладья прижимает ряд. */
const SPAWN_POOL = ['pawn', 'pawn', 'knight', 'bishop', 'rook'] as const;
import { rulesFor } from './modes';
import { ensureEndlessSpace } from './endless';
import type { BuffKind, GameAction, GameState, MoveDx } from './types';
import { RuleError } from './types';

function validateDx(dx: unknown): asserts dx is MoveDx {
  if (dx !== -1 && dx !== 0 && dx !== 1) throw new RuleError('Некорректное направление хода');
}

/** Позиция без счётчиков хода: нужна, чтобы понять, сдвинулось ли хоть что-то. */
function boardSignature(state: GameState): string {
  const enemies = state.enemies
    .map((enemy) => `${enemy.type[0]}${enemy.x},${enemy.y}`)
    .sort()
    .join(';');
  return `${state.player.x},${state.player.y}|${enemies}`;
}

function noMovesLeft(state: GameState): boolean {
  return state.status === 'playing' && legalMoves(state).length === 0;
}

/**
 * Гибельна ли клетка для шага конвейера. Считаем геометрией, а не списком
 * ходов: проверка вызывается на каждое появление фигуры, а журнал длинного
 * забега сервер прогоняет целиком. Правила здесь те же, что у `conveyorStep`:
 * падение рядом, прыжок коня, ход слона по диагонали и выстрел ладьи вдоль ряда.
 */
function cellLost(state: GameState, x: number, y: number): boolean {
  for (const enemy of state.enemies) {
    if (enemy.x === x && enemy.y === y) continue;
    if (enemy.type !== 'bishop' && enemy.type !== 'knight' && enemy.x === x && enemy.y === y + 1) return true;
    if (enemy.type === 'bishop' && Math.abs(enemy.x - x) === 1 && enemy.y === y + 1) return true;
    if (enemy.type === 'knight') {
      const dx = Math.abs(enemy.x - x);
      const dy = enemy.y - y;
      if ((dx === 1 && dy === 2) || (dx === 2 && dy === 1)) return true;
    }
    if (state.shield <= 0 && (enemy.type === 'rook' || enemy.type === 'queen') && enemy.y === y) {
      const step = enemy.x < x ? 1 : -1;
      let clear = true;
      for (let cursor = enemy.x + step; cursor !== x; cursor += step) {
        if (state.enemies.some((other) => other.x === cursor && other.y === y)) {
          clear = false;
          break;
        }
      }
      if (clear) return true;
    }
  }
  return false;
}

/**
 * Жив ли ещё игрок после своего хода: нужен притоку, чтобы конвейер не
 * перекрывал последний выход. Смерть от следующего ряда допустима, смерть от
 * самого появления фигуры - нет.
 */
function escapeExists(state: GameState): boolean {
  const rules = rulesFor(state.mode);
  if (!rules.pinned) return legalMoves(state).length > 0;
  for (const dx of [-1, 0, 1]) {
    const x = state.player.x + dx;
    if (x < 0 || x >= state.width) continue;
    const y = state.player.y;
    const occupant = state.enemies.find((enemy) => enemy.x === x && enemy.y === y);
    // Свою клетку пешка не занимает, чужую - убирает рубкой, если режим её даёт.
    if (occupant && !rules.ram) continue;
    const probe = occupant ? { ...state, enemies: state.enemies.filter((enemy) => enemy !== occupant) } : state;
    if (!cellLost(probe, x, y)) return true;
  }
  return false;
}

/**
 * Приток фигур сверху: движок «Гонок». Колонка и тип берутся из
 * `state.rng`, то есть из зерна уровня, поэтому сервер воспроизводит партию
 * шаг в шаг и договориться о «невидимом» появлении фигуры нельзя.
 */
function spawnPhase(state: GameState): void {
  const rules = rulesFor(state.mode);
  const perTurn = rules.spawnRate ? rules.spawnRate(state.tier) : rules.spawnPerTurn;
  if (perTurn <= 0 || state.status !== 'playing') return;
  const every = rules.spawnEvery ? Math.max(1, rules.spawnEvery(state.tier)) : 1;
  // Волна приходит по такту, иначе на узком поле приток превращается в стену.
  if (every > 1 && state.moves % every !== 0) return;
  const rng = new Rng(state.rng || 1);
  const y = state.height - 1;
  const pool: readonly string[] = rules.goal === 'scroll' ? raceSpawnPool(state.tier) : SPAWN_POOL;
  const taken = (x: number) => state.enemies.some((e) => e.x === x && e.y === y) || (state.player.x === x && state.player.y === y);
  for (let spawned = 0; spawned < perTurn; spawned++) {
    let placed = false;
    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      const x = rng.int(state.width);
      if (taken(x)) continue;
      const type = pickSpawnType(pool, rng);
      const candidate = { id: `s${state.moves}-${spawned}-${x}`, type, x, y };
      state.enemies.push(candidate);
      // Конвейер не имеет права ставить фигуру, которая отнимает последний ход:
      // тогда длина жизни превращается в лотерею притока, а не в задачу.
      if (rules.goal === 'scroll' && !escapeExists(state)) {
        state.enemies.pop();
        continue;
      }
      // Фигура, которая бьёт пешку прямо с клетки рождения, хода не оставляет:
      // в режимах на выживание такое не подставляется, иначе длина жизни
      // превращается в лотерею. Не удалось подобрать место за 8 попыток, значит
      // приток в этом ходу пропускается.
      if (rules.goal === 'survive' && enemyAttacksCell(state, candidate, state.player.x, state.player.y)) {
        state.enemies.pop();
        continue;
      }
      placed = true;
    }
  }
  state.rng = rng.save();
}

function pickSpawnType(pool: readonly string[], rng: Rng): GameState['enemies'][number]['type'] {
  return pool[rng.int(pool.length)] as GameState['enemies'][number]['type'];
}

function enemyPhase(state: GameState): void {
  const rules = rulesFor(state.mode);
  if (state.freeze > 0) {
    state.freeze -= 1;
    if (state.shield > 0) state.shield -= 1;
    state.lastEvent = 'frozen';
    return;
  }

  const escaped: string[] = [];
  for (const enemy of state.enemies) {
    const target = enemyTarget(state, enemy);
    if (target === 'escape') {
      // В «Гонках» фигура, ушедшая за нижний край, покидает поле.
      escaped.push(enemy.id);
      continue;
    }
    if (target) {
      enemy.x = target.x;
      enemy.y = target.y;
    }
    if (enemy.x === state.player.x && enemy.y === state.player.y) {
      state.status = 'lost';
      state.capturedBy = enemy.type;
      state.lastEvent = 'captured';
      return;
    }
  }

  if (escaped.length > 0) {
    state.enemies = state.enemies.filter((e) => !escaped.includes(e.id));
    state.lastEvent = 'escaped';
  }

  if (state.shield > 0) state.shield -= 1;
}

/**
 * Применить действие игрока. Возвращает новое состояние, исходное не мутирует.
 * Все правила продублированы на сервере: клиент не может «нарисовать» победу.
 */
export function applyAction(previous: GameState, action: GameAction): GameState {
  if (previous.status !== 'playing') throw new RuleError('Партия уже завершена');

  if (action.type === 'buff') {
    const buff: BuffKind = action.buff;
    if (buff !== 'freeze' && buff !== 'shield') throw new RuleError('Неизвестный бонус');
    const state = cloneState(previous);
    if (buff === 'freeze') {
      state.freeze = Math.max(state.freeze, 2);
      state.lastEvent = 'freeze';
    } else {
      state.shield = Math.max(state.shield, 3);
      state.lastEvent = 'shield';
    }
    return state;
  }

  const state = cloneState(previous);

  if (action.type === 'skip') {
    // Вынужденный пропуск бесплатен, но только там, где ход противника что-то меняет.
    const forced = legalMoves(state).length === 0 && rulesFor(state.mode).motion !== 'static';
    if (!forced) {
      // Добровольный пропуск тратит квоту режима: иначе забег превращается
      // в ожидание, пока фигуры разойдутся сами.
      if ((state.skips ?? 0) >= rulesFor(state.mode).skipQuota) {
        throw new RuleError('Добровольные пропуски закончились');
      }
      state.skips = (state.skips ?? 0) + 1;
    }
    state.lastEvent = 'skip';
  } else if (action.type === 'move') {
    validateDx(action.dx);
    const pinned = rulesFor(state.mode).pinned === true;
    const dy = action.dy ?? (pinned ? 0 : 1);
    if (pinned ? dy !== 0 : dy !== 1 && dy !== 2) throw new RuleError('Некорректная длина хода');
    const x = state.player.x + action.dx;
    const y = state.player.y + dy;
    const option = legalMoves(state).find((m) => m.dx === action.dx && (m.dy ?? 1) === dy);
    if (!option) {
      // Сообщения те же, что и раньше, по ним сверяет отказ клиент.
      if (pinned) throw new RuleError('Пешка ходит только в своём ряду');
      if (y >= state.height) throw new RuleError('Верхняя граница поля');
      if (x < 0 || x >= state.width) throw new RuleError('За границей поля');
      if (dy === 2) throw new RuleError('Двойной ход доступен только с начальной позиции');
      throw new RuleError('Клетка занята');
    }
    if (option.takes) {
      state.enemies = state.enemies.filter((e) => !(e.x === option.x && e.y === option.y));
      state.captures = (state.captures ?? 0) + 1;
      state.lastCapture = { x: option.x, y: option.y };
      state.lastEvent = 'capture';
    } else {
      state.lastEvent = 'move';
    }
    state.player = { x: option.x, y: option.y };
  } else {
    throw new RuleError('Неизвестное действие');
  }

  state.moves += 1;
  const modeRules = rulesFor(state.mode);
  // В конвейере счёт это прокрученные ряды: пешка стоит на месте, ряды идут мимо.
  state.score = modeRules.goal === 'scroll' ? state.moves : Math.max(state.score, state.player.y);

  if (modeRules.goal === 'scroll') {
    const tension = raceLevelForRows(state.score);
    if (tension > state.tier) {
      state.tier = tension;
      state.lastEvent = 'scroll';
    }
  }

  // Победа по верхнему ряду во всех режимах, кроме бесконечного: там цели нет,
  // есть высота. «Парковка» и «Гонки» иначе никогда не выигрывают, и лаборатория
  // показывает 0% решаемых расстановок при работающих правилах.
  const goal = rulesFor(state.mode).goal;
  // Режим на уклонение: верхний ряд не победа, а перелив в нижний. Пешка
  // «проскакивает» на стартовую линию, и дальше всё продолжается, пока её не
  // съели. Именно поэтому метрика режима длина жизни, а не проход.
  if (goal === 'survive' && state.player.y >= state.height - 1) {
    state.player = { x: state.player.x, y: 0 };
    state.lastEvent = 'wrap';
  }

  if (
    state.mode !== 'endless' &&
    goal === 'top' &&
    state.player.y >= state.height - 1
  ) {
    state.status = 'won';
    state.lastEvent = 'won';
    return state;
  }

  if (state.mode === 'endless') {
    state.tier = 1 + Math.floor(state.moves / 5);
    ensureEndlessSpace(state);
  }

  // Позиция до ответа фигур: нужна, чтобы понять, было ли ожидание полезным.
  const waitingForNothing = action.type === 'skip' && state.freeze === 0 && state.shield === 0 && noMovesLeft(state);
  const before = waitingForNothing ? boardSignature(state) : '';
  enemyPhase(state);
  spawnPhase(state);

  // Тупик: если после хода фигур и притока ходить нечем, а режима не даёт
  // ни победы по верхнему ряду, ни осмысленного ожидания, партия проиграна.
  // Заморозка и щит ожиданием не считаются: там позиция обязана измениться.
  const rules = rulesFor(state.mode);
  const stuckByRules = rules.motion === 'static' || rules.goal === 'survive' || rules.goal === 'scroll';
  const noProgress = waitingForNothing && before === boardSignature(state);
  if (stuckByRules && noMovesLeft(state)) {
    state.status = 'lost';
    state.lastEvent = 'stuck';
    return state;
  }
  if (noProgress) {
    state.status = 'lost';
    state.lastEvent = 'stuck';
  }
  return state;
}

/** Применить цепочку действий (используется для проверки на сервере). */
export function applyActions(initial: GameState, actions: GameAction[]): GameState {
  let state = initial;
  for (const action of actions) state = applyAction(state, action);
  return state;
}

/** Можно ли отменить последний ход (клиентская логика истории). */
export function canUndo(historyLength: number): boolean {
  return historyLength > 1;
}
