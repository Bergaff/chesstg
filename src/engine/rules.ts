import { cloneState, enemyAttacksCell, enemyTarget, legalMoves } from './board';
import { Rng } from './rng';
import { RACE_KING_ROW, RACE_SPAWN_ROWS, raceScrollEvery, raceSpawnPool, raceSpawnWidth, raceTierForMoves } from './race';

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
 * Приток фигур с верхних рядов. Колонка, ряд и тип берутся из `state.rng`, то
 * есть из зерна уровня, поэтому сервер воспроизводит партию шаг в шаг и
 * договориться о «невидимом» появлении фигуры нельзя.
 */
function spawnPhase(state: GameState): void {
  const rules = rulesFor(state.mode);
  const perTurn = rules.spawnRate ? rules.spawnRate(state.tier) : rules.spawnPerTurn;
  if (perTurn <= 0 || state.status !== 'playing') return;
  const every = rules.spawnEvery ? Math.max(1, rules.spawnEvery(state.tier)) : 1;
  // Волна приходит по такту, иначе на узком поле приток превращается в стену.
  if (every > 1 && state.moves % every !== 0) return;
  const rng = new Rng(state.rng || 1);
  const rows = Math.max(1, Math.min(rules.spawnRows || 1, state.height - 1));
  const pool: readonly string[] = rules.player === 'king' ? raceSpawnPool(state.tier) : SPAWN_POOL;
  // Приток занимает полосу по центру: на первой волне три колонки, дальше
  // полоса растёт и с шестой волны держит всю ширину поля.
  const band = rules.player === 'king' ? raceSpawnWidth(state.tier) : state.width;
  const left = Math.max(0, Math.floor((state.width - band) / 2));
  const span = Math.max(1, Math.min(band, state.width));
  const taken = (x: number, y: number) =>
    state.enemies.some((e) => e.x === x && e.y === y) || (state.player.x === x && state.player.y === y);
  for (let spawned = 0; spawned < perTurn; spawned++) {
    let placed = false;
    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      const x = left + rng.int(span);
      const y = state.height - 1 - rng.int(rows);
      if (taken(x, y)) continue;
      const type = pickSpawnType(pool, rng);
      const candidate = { id: `s${state.moves}-${spawned}-${x}`, type, x, y };
      state.enemies.push(candidate);
      // Фигура, которая бьёт игрока прямо с клетки рождения, хода не оставляет:
      // в режимах на выживание такое не подставляется, иначе длина жизни
      // превращается в лотерею притока. Не удалось подобрать место за 8 попыток,
      // значит приток в этом ходу пропускается.
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

/**
 * Такт поля в бегущих режимах: нижний ряд уходит за край и уносит всё, что на
 * нём стояло, остальных сдвигает на ряд вниз. Короля сдвиг не трогает: он
 * «двигается, но остаётся» на своём ряду, а ряды протекают мимо. Фигура,
 * спущенная на клетку короля, ловит его на месте, поэтому проверка стоит здесь,
 * а не в шахматном ходе.
 */
function scrollPhase(state: GameState): void {
  const rules = rulesFor(state.mode);
  // Заморозка держит всё поле, а не только шахматные ходы фигур: иначе она
  // стоила бы тридцати монет за передышку в один ход.
  if (!rules.scroll || state.freeze > 0 || state.status !== 'playing') return;
  const every = Math.max(1, raceScrollEvery(state.tier));
  if (state.moves % every !== 0) return;

  const kept: typeof state.enemies = [];
  let swept = 0;
  for (const enemy of state.enemies) {
    const y = enemy.y - 1;
    if (y < 0) {
      swept += 1;
      continue;
    }
    if (y === state.player.y && enemy.x === state.player.x) {
      state.status = 'lost';
      state.capturedBy = enemy.type;
      state.lastEvent = 'captured';
      state.enemies = state.enemies.map((e) => (e.id === enemy.id ? { ...e, y } : e));
      return;
    }
    kept.push({ ...enemy, y });
  }
  state.enemies = kept;
  if (swept > 0) state.lastEvent = 'swept';
}

/**
 * Конвейер: король живёт на своём втором ряду. Шаг вперёд придвигает всё поле на
 * ряд ближе и уносит то, что свалилось за нижний край; сам король при этом
 * возвращается на свой ряд, поэтому «поле едет, а король стоит» видно с первого
 * хода. Назад отступить можно на нулевой ряд и оставить там: поле не едет следом
 * за королём вверх, иначе «оттягивать волну» было бы вечным безопасным ходом и
 * счёт перестал бы что-то значить. Фигура, которую сдвиг посадил на клетку
 * короля, ловит его: та же логика, что и с уносимым рядом.
 */
function conveyorPhase(state: GameState): void {
  const rules = rulesFor(state.mode);
  if (!rules.scroll || state.status !== 'playing') return;
  const delta = state.player.y - RACE_KING_ROW;
  if (delta <= 0) return;

  const kept: typeof state.enemies = [];
  let swept = 0;
  for (const enemy of state.enemies) {
    const y = enemy.y - delta;
    if (y < 0) {
      swept += 1;
      continue;
    }
    if (y === RACE_KING_ROW && enemy.x === state.player.x) {
      state.status = 'lost';
      state.capturedBy = enemy.type;
      state.lastEvent = 'captured';
      state.enemies = state.enemies.map((e) => (e.id === enemy.id ? { ...e, y } : e));
      state.player = { ...state.player, y: RACE_KING_ROW };
      return;
    }
    kept.push({ ...enemy, y });
  }
  state.enemies = kept;
  state.player = { ...state.player, y: RACE_KING_ROW };
  if (swept > 0) state.lastEvent = 'swept';
}

function enemyPhase(state: GameState): void {
  const rules = rulesFor(state.mode);
  // Партия могла кончиться на такте поля: ответ фигур тогда не пишется в
  // журнал, чтобы `lastEvent` остался причиной конца забега.
  if (state.status !== 'playing') return;
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
    const rules = rulesFor(state.mode);
    const king = rules.player === 'king';
    const dy = action.dy ?? 1;
    // Король ходит на клетку в любую сторону, поэтому его шаг это и -1, и 0.
    // Пешка: только вперёд (1) и двойной шаг с начальной позиции (2).
    if (king ? dy < -1 || dy > 1 : dy !== 1 && dy !== 2) throw new RuleError('Некорректная длина хода');
    const x = state.player.x + action.dx;
    const y = state.player.y + dy;
    const option = legalMoves(state).find((m) => m.dx === action.dx && (m.dy ?? 1) === dy);
    if (!option) {
      // Сообщения те же, что и раньше, по ним сверяет отказ клиент.
      if (king && y < 0) throw new RuleError('За границей поля');
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
  // В режиме на выживание счёт это пережитые ходы: финиша нет, есть дистанция.
  state.score = modeRules.goal === 'survive' ? state.moves : Math.max(state.score, state.player.y);

  if (modeRules.goal === 'survive' && modeRules.player === 'king') {
    // Волна считается по своим ходам, а не по уровню режима: уровню нужен
    // сопоставимый рекорд, а игре - чтобы рост полосы притока был виден за забег.
    const tension = raceTierForMoves(state.score);
    if (tension > state.tier) {
      state.tier = tension;
      state.lastEvent = 'tension';
    }
  }

  // Победа по верхнему ряду во всех режимах, кроме бесконечного: там цели нет,
  // есть высота. «Парковка» и «Гонки» иначе никогда не выигрывают, и лаборатория
  // показывает 0% решаемых расстановок при работающих правилах.
  const goal = rulesFor(state.mode).goal;
  // Режим на уклонение: верхний ряд не победа, а перелив в нижний (только там,
  // где он разрешён правилами). Пешка «проскакивает» на стартовую линию, и
  // дальше всё продолжается, пока её не съели. Королю перелив не нужен: у него
  // восемь направлений, он и так ходит назад.
  if (goal === 'survive' && rulesFor(state.mode).wrapOnTop && state.player.y >= state.height - 1) {
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
  conveyorPhase(state);
  scrollPhase(state);
  spawnPhase(state);
  enemyPhase(state);

  // Тупик: если после хода фигур и притока ходить нечем, а режима не даёт
  // ни победы по верхнему ряду, ни осмысленного ожидания, партия проиграна.
  // Заморозка и щит ожиданием не считаются: там позиция обязана измениться.
  const rules = rulesFor(state.mode);
  const stuckByRules = rules.motion === 'static' || rules.goal === 'survive';
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
