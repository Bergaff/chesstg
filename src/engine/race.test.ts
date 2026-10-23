import { describe, expect, it } from 'vitest';
import {
  RACE_FIGURES_PER_COLUMN,
  RACE_KING_ROW,
  RACE_KING_ROWS,
  RACE_MIN_WIDTH,
  RACE_MOVES_PER_LEVEL,
  RACE_ROWS,
  RACE_SPAWN_ROWS,
  RACE_TIER_MOVES,
  RACE_WIDTH,
  applyAction,
  createRaceLevel,
  legalMoves,
  raceCoinReward,
  raceLevelForMoves,
  raceSpawnEvery,
  raceTierForMoves,
  raceWidthForSpawned,
  rulesFor,
  survivalHint,
  type GameState,
  type MoveDx,
  type MoveDy,
} from '../engine';

function move(state: GameState, dx: MoveDx, dy: MoveDy = 0): GameState {
  return applyAction(state, { type: 'move', dx, dy });
}

/**
 * Жадный бот: выжить, снять фигуру, не залезать в угол полосы
 * полосы. Подъёма наверх в оценке нет: король заперт в двух нижних рядах, и
 * спорить за высоту ему не за что. Нужен не «идеальной игрой», а тем же
 * критерием, которым мерили напряжение притока: если даже такой бот живёт десятки
 * ходов, приток никого не убивает на ровном месте.
 */
function nearest(state: GameState): number {
  let best = 99;
  for (const enemy of state.enemies) {
    const distance = Math.max(Math.abs(enemy.x - state.player.x), Math.abs(enemy.y - state.player.y));
    if (distance < best) best = distance;
  }
  return best;
}

/** Первый легальный ход: нужен, когда все остальные ведут на клетку под бой. */
function anyReply(state: GameState): GameState | null {
  const option = legalMoves(state)[0];
  if (!option) return null;
  return applyAction(state, { type: 'move', dx: option.dx as MoveDx, dy: (option.dy ?? 1) as MoveDy });
}

function bestReply(state: GameState): GameState | null {
  let best: GameState | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const option of legalMoves(state)) {
    const next = move(state, option.dx, option.dy ?? 1);
    if (next.status !== 'playing') continue;
    let rank =
      next.enemies.length * 6 -
      legalMoves(next).length * 1.5 -
      nearest(next) * 2 +
      (next.player.y >= next.height - 3 ? 1.5 : 0);
    // Угол полосы - ловушка: половина ходов отрезана краем.
    if (next.player.x === 0 || next.player.x === next.width - 1) rank += 1.2;
    if (rank < bestRank) {
      bestRank = rank;
      best = next;
    }
  }
  return best;
}

/** Чистое поле нужной ширины: на нём видно только то, что сделал сам ход. */
function open(state: Partial<GameState> & { player: GameState['player'] }): GameState {
  return {
    ...createRaceLevel(1, 4242),
    width: RACE_WIDTH,
    spawned: 0,
    enemies: [],
    freeze: 0,
    shield: 0,
    moves: 0,
    ...state,
  } as GameState;
}

describe('Гонки: король против фигур сверху', () => {
  it('режим собран на короле и узком стартовом поле', () => {
    const rules = rulesFor('race');
    expect(rules).toMatchObject({
      motion: 'greedy',
      goal: 'survive',
      player: 'king',
      wrapOnTop: false,
      scroll: true,
      spawnRows: RACE_SPAWN_ROWS,
      kingRows: RACE_KING_ROWS,
    });
    expect(RACE_KING_ROWS).toBe(2);
    const state = createRaceLevel(1, 12345);
    // Старт - три колонки при восьми рядах: «как шахматная доска», только уже.
    expect(state.width).toBe(RACE_MIN_WIDTH);
    expect(state.height).toBe(RACE_ROWS);
    expect(RACE_ROWS).toBe(8);
    // Король рождается внутри полосы: второй ряд от низа.
    expect(state.player.y).toBe(RACE_KING_ROW);
    expect(state.player.y).toBeLessThan(RACE_KING_ROWS);
    expect(state.status).toBe('playing');
    expect(state.spawned).toBe(0);
    // Стартовая пробка не должна снимать короля до первого хода.
    expect(state.enemies.length).toBeGreaterThan(0);
    for (const enemy of state.enemies) {
      expect(enemy.y).toBeGreaterThanOrEqual(RACE_ROWS - RACE_SPAWN_ROWS);
      expect(enemy.x).toBeGreaterThanOrEqual(0);
      expect(enemy.x).toBeLessThan(RACE_MIN_WIDTH);
    }
  });

  it('король ходит в любую сторону, но только по двум нижним рядам', () => {
    const state = open({ player: { x: 3, y: RACE_KING_ROWS - 1 } });
    const options = legalMoves(state);
    // Восемь соседей минус три хода за верхнюю границу полосы.
    expect(options.length).toBe(5);
    expect(options.every((option) => option.y < RACE_KING_ROWS)).toBe(true);
    expect(options.some((option) => option.dy === -1)).toBe(true);
    expect(options.some((option) => option.dy === 0)).toBe(true);
    expect(options.every((option) => Math.abs(option.dx) <= 1)).toBe(true);
    // Явная попытка шагнуть выше полосы - ошибка правил, а не тихий отказ.
    expect(() => move(state, 0, 1)).toThrow(/полос/);
    // У левого края ходов меньше, и шага за край нет.
    const edge = legalMoves(open({ player: { x: 0, y: 1 } }));
    expect(edge.every((option) => option.dx >= 0)).toBe(true);
    expect(edge.length).toBe(3);
  });

  it('сдвиг поля уносит фигуры, но не короля', () => {
    // Ладья стоит далеко по ряду на единицу выше короля: её собственный ход идёт по
    // горизонтали, поэтому смена y у фигуры - это ровно сдвиг поля.
    const home = open({ player: { x: 0, y: 1 }, enemies: [{ id: 'r', type: 'rook', x: 7, y: 3 }] });
    const sideways = move(home, 1, 0);
    // Король остался на своём ряду: полоса никуда не едет.
    expect(sideways.player).toEqual({ x: 1, y: 1 });
    expect(sideways.enemies.find((e) => e.id === 'r')!.y).toBe(2);

    // Фигура на нижнем ряду сходит с поля, и это не конец партии.
    const edge = open({ player: { x: 4, y: 1 }, enemies: [{ id: 'r', type: 'rook', x: 1, y: 0 }] });
    const swept = move(edge, 1, 0);
    expect(swept.enemies.some((e) => e.id === 'r')).toBe(false);
    expect(swept.lastEvent).toBe('swept');
    expect(swept.status).toBe('playing');
  });

  it('нижний ряд больше не смертельный: стоять на нём можно', () => {
    const state = open({ player: { x: 1, y: 0 } });
    // Шаг в сторону с нулевого ряда: раньше это было «ряд унёс короля».
    const sideways = move(state, 1, 0);
    expect(sideways.status).toBe('playing');
    expect(sideways.player.y).toBe(0);
    // И вверх из нуля - тоже легальный ход внутри полосы.
    const up = move(state, 1, 1);
    expect(up.status).toBe('playing');
    expect(up.player).toEqual({ x: 2, y: 1 });
  });

  it('фигуру привозит поле: приехал на клетку короля - это взятие', () => {
    // Король стоит на своей полосе и никуда не едет, а лента идёт: фигура,
    // которой сдвиг дал клетку короля, снимает его, даже не потратив свой ход.
    const home = open({ player: { x: 0, y: 0 }, enemies: [{ id: 'r', type: 'rook', x: 1, y: 1 }] });
    const into = move(home, 1, 0);
    expect(into.status).toBe('lost');
    expect(into.capturedBy).toBe('rook');
    expect(into.lastEvent).toBe('captured');
    // Уход в другой ряд той же колонки - фигура приезжает мимо.
    expect(move(home, 1, 1).status).toBe('playing');
  });

  it('шаг назад выигрывает темп, когда надо съесть фигуру', () => {
    // Слон встал рядом с королём на нижнем ряду: взять его можно шагом
    // назад-вбок, и это законный ход, а не самоубийство.
    const home = open({
      player: { x: 2, y: RACE_KING_ROWS - 1 },
      enemies: [{ id: 'b', type: 'bishop', x: 1, y: 0 }],
    });
    const take = move(home, -1, -1);
    expect(take.captures).toBe(1);
    expect(take.enemies.some((e) => e.id === 'b')).toBe(false);
  });

  it('поле растёт колонкой справа каждые RACE_FIGURES_PER_COLUMN фигур', () => {
    expect(raceWidthForSpawned(0)).toBe(RACE_MIN_WIDTH);
    expect(raceWidthForSpawned(RACE_FIGURES_PER_COLUMN - 1)).toBe(RACE_MIN_WIDTH);
    expect(raceWidthForSpawned(RACE_FIGURES_PER_COLUMN)).toBe(RACE_MIN_WIDTH + 1);
    expect(raceWidthForSpawned(RACE_FIGURES_PER_COLUMN * 3)).toBe(RACE_MIN_WIDTH + 3);
    expect(raceWidthForSpawned(40)).toBe(RACE_WIDTH);
    // Левый край не двигается: прибавка идёт справа.
    for (let spawned = 0; spawned <= 40; spawned++) {
      expect(raceWidthForSpawned(spawned)).toBeGreaterThanOrEqual(RACE_MIN_WIDTH);
      expect(raceWidthForSpawned(spawned)).toBeLessThanOrEqual(RACE_WIDTH);
    }
  });

  it('пришедшая фигура расширяет поле и встаёт по всей новой ширине', () => {
    const every = raceSpawnEvery(1);
    const state = open({
      width: RACE_MIN_WIDTH,
      player: { x: 0, y: RACE_KING_ROW },
      spawned: RACE_FIGURES_PER_COLUMN - 1,
      moves: every - 1,
    });
    const next = move(state, 1, 0);
    expect(next.spawned).toBe(RACE_FIGURES_PER_COLUMN);
    // Колонка прибавилась ровно на пороге пяти пришедших фигур.
    expect(next.width).toBe(RACE_MIN_WIDTH + 1);
    expect(next.lastEvent).toBe('width');
    for (const enemy of next.enemies) {
      expect(enemy.x).toBeLessThan(next.width);
    }
  });

  it('приток приходит по такту, а не каждый ход', () => {
    const every = raceSpawnEvery(1);
    let current = open({ width: RACE_MIN_WIDTH, player: { x: 0, y: RACE_KING_ROW } });
    for (let turn = 1; turn < every; turn++) {
      current = move(current, turn % 2 === 1 ? 1 : -1, 0);
      expect(current.enemies.filter((enemy) => enemy.id.startsWith('s')).length).toBe(0);
    }
    current = move(current, current.player.x === 0 ? 1 : -1, 0);
    expect(current.moves).toBe(every);
    expect(current.enemies.some((enemy) => enemy.id.startsWith(`s${every}-`))).toBe(true);
  });

  it('фигура рождается в верхних рядах, а не в полосе короля', () => {
    const every = raceSpawnEvery(1);
    const state = open({
      width: RACE_MIN_WIDTH,
      player: { x: 0, y: RACE_KING_ROW },
      freeze: 1,
      moves: every - 1,
    });
    const next = move(state, 1, 0);
    const born = next.enemies.filter((enemy) => enemy.id.startsWith(`s${every}-`));
    expect(born.length).toBeGreaterThan(0);
    for (const enemy of born) {
      expect(enemy.y).toBeGreaterThanOrEqual(RACE_ROWS - RACE_SPAWN_ROWS);
      expect(enemy.y).toBeLessThan(RACE_ROWS);
      expect(enemy.x).toBeLessThan(RACE_MIN_WIDTH);
    }
  });

  it('фигура, вставшая на клетку короля, заканчивает забег', () => {
    // Ладья в том же ряду, что король: за ход она проезжает два шага
    // (`slideCap: 2`) и встаёт ровно на клетку короля.
    const lined = open({
      width: RACE_MIN_WIDTH,
      player: { x: 0, y: 1 },
      enemies: [{ id: 'r', type: 'rook', x: 3, y: 2 }],
    });
    const doomed = move(lined, 1, 0);
    expect(doomed.status).toBe('lost');
    expect(doomed.capturedBy).toBe('rook');
    // Отход в другой ряд той же полосы спасает: ладье нужно время на перестроение.
    expect(move(lined, 1, -1).status).toBe('playing');
  });

  it('заморозка держит и поле, и приток', () => {
    const home = open({
      width: RACE_MIN_WIDTH,
      player: { x: 1, y: 0 },
      enemies: [{ id: 'r', type: 'rook', x: 0, y: 2 }],
    });
    const frozen = move({ ...home, freeze: 1 }, 1, 1);
    // Король поднялся по полосе, ряд за ним не поехал: заморозка - передышка в ход.
    expect(frozen.player).toEqual({ x: 2, y: 1 });
    expect(frozen.enemies.find((e) => e.id === 'r')!.y).toBe(2);
    // Без заморозки тот же шаг оставил бы ладью на ряду короля.
    const thawed = move(home, 1, 1);
    expect(thawed.player).toEqual({ x: 2, y: 1 });
    expect(thawed.enemies.find((e) => e.id === 'r')!.y).toBe(1);
  });

  it('на длинной серии король не выходит из полосы и не выигрывает', () => {
    let current: GameState = createRaceLevel(1, 2024);
    for (let turn = 0; turn < 60 && current.status === 'playing'; turn++) {
      const options = legalMoves(current);
      if (options.length === 0) break;
      const step = options[turn % options.length]!;
      const widthBefore = current.width;
      const yBefore = current.player.y;
      current = move(current, (step.x - current.player.x) as MoveDx, (step.y - current.player.y) as MoveDy);
      expect(current.player.y).toBeGreaterThanOrEqual(0);
      expect(current.player.y).toBeLessThan(RACE_KING_ROWS);
      expect(current.width).toBeGreaterThanOrEqual(widthBefore);
      // Сдвиг поля больше не двигает игрока: ряд у короля свой, и после хода он
      // ровно тот, что был выбран.
      expect(current.player.y).toBe(step.y);
      expect(yBefore).toBeGreaterThanOrEqual(0);
      for (const enemy of current.enemies) {
        expect(enemy.y).toBeGreaterThanOrEqual(0);
        expect(enemy.y).toBeLessThan(RACE_ROWS);
        expect(enemy.x).toBeGreaterThanOrEqual(0);
        expect(enemy.x).toBeLessThan(current.width);
      }
      expect(current.status).not.toBe('won');
    }
  });

  it('подсказка в забеге отдаёт клетки полосы, а не пустоту', () => {
    for (let seed = 0; seed < 10; seed++) {
      const state = createRaceLevel(1 + seed, 4242 + seed * 31);
      const cells = survivalHint(state, 2);
      expect(cells.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(state.width);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        // Подсказка не имеет права звать короля за красную линию.
        expect(cell.y).toBeLessThan(RACE_KING_ROWS);
      }
    }
    const empty: GameState = { ...createRaceLevel(1, 5), enemies: [], status: 'lost' };
    expect(survivalHint(empty, 2)).toEqual([]);
  });

  it('выживающий бот не умирает в первые ходы и доживает до среднего забега', () => {
    const lives: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      let state = createRaceLevel(1, 1000 + seed * 7919);
      let guard = 0;
      while (state.status === 'playing' && guard++ < 300) {
        const next = bestReply(state) ?? anyReply(state);
        if (!next) break;
        state = next;
      }
      // Первые два хода смерть означает, что приток встал королю под ногу.
      expect(state.moves).toBeGreaterThanOrEqual(3);
      lives.push(state.score);
    }
    const median = [...lives].sort((a, b) => a - b)[20];
    expect(median).toBeGreaterThanOrEqual(12);
  });

  it('волна считается по ходам и меняет приток, а не ширину поля', () => {
    expect(raceTierForMoves(0)).toBe(1);
    expect(raceTierForMoves(RACE_TIER_MOVES - 1)).toBe(1);
    expect(raceTierForMoves(RACE_TIER_MOVES)).toBe(2);
    // С волной меняется только частота притока: ширина поля живёт своим счётом.
    expect(raceSpawnEvery(1)).toBeGreaterThan(raceSpawnEvery(2));
    expect(raceSpawnEvery(9)).toBe(1);
  });

  it('один и тот же журнал воспроизводится байт в байт', () => {
    const first = createRaceLevel(2, 4242);
    let a = first;
    let b = first;
    for (let turn = 0; turn < 12 && a.status === 'playing'; turn++) {
      const options = legalMoves(a);
      if (options.length === 0) break;
      const step = options[(turn * 3) % options.length]!;
      const dx = (step.x - a.player.x) as MoveDx;
      const dy = (step.y - a.player.y) as MoveDy;
      a = move(a, dx, dy);
      b = move(b, dx, dy);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.tier).toBe(raceTierForMoves(a.score));
    expect(a.width).toBe(raceWidthForSpawned(a.spawned ?? 0));
  });

  it('уровень режима растёт от пережитых ходов, награда ограничена сверху', () => {
    expect(raceLevelForMoves(0)).toBe(1);
    expect(raceLevelForMoves(RACE_MOVES_PER_LEVEL - 1)).toBe(1);
    expect(raceLevelForMoves(RACE_MOVES_PER_LEVEL)).toBe(2);
    expect(raceLevelForMoves(RACE_MOVES_PER_LEVEL * 4)).toBe(5);
    expect(raceCoinReward(0)).toBeLessThanOrEqual(50);
    expect(raceCoinReward(8)).toBeLessThan(raceCoinReward(32));
    expect(raceCoinReward(1000)).toBe(50);
  });

  it('счёт это пережитые ходы, а не высота короля', () => {
    let state = createRaceLevel(1, 555);
    for (let turn = 0; turn < 5 && state.status === 'playing'; turn++) {
      state = bestReply(state) ?? state;
    }
    expect(state.score).toBe(state.moves);
  });
});
