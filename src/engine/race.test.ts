import { describe, expect, it } from 'vitest';
import {
  RACE_FIGURES_PER_COLUMN,
  RACE_KING_ROW,
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
 * Жадный бот: выжить, снять фигуру, не вставать под линию, не задерживаться
 * внизу (ряд уезжает каждый ход) и не лезть в строки рождения. Нужен не
 * «идеальной игрой», а тем же критерием, которым мерили напряжение притока: если
 * даже такой бот живёт десятки ходов, приток никого не убивает на ровном месте.
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
    const rank =
      next.enemies.length * 6 -
      legalMoves(next).length * 1.5 -
      nearest(next) * 2 +
      (next.player.y <= 1 ? 2.5 - next.player.y : 0) +
      (next.player.y >= next.height - 3 ? 1.5 : 0) -
      next.player.y * 0.7;
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
    });
    const state = createRaceLevel(1, 12345);
    // Старт - три колонки при восьми рядах: «как шахматная доска», только уже.
    expect(state.width).toBe(RACE_MIN_WIDTH);
    expect(state.height).toBe(RACE_ROWS);
    expect(RACE_ROWS).toBe(8);
    expect(state.player.y).toBe(RACE_KING_ROW);
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

  it('король ходит на клетку в любую сторону, назад включительно', () => {
    const state = open({ player: { x: 1, y: 3 } });
    const options = legalMoves(state);
    expect(options.length).toBe(8);
    expect(options.some((option) => option.dy === 1)).toBe(true);
    expect(options.some((option) => option.dy === -1)).toBe(true);
    expect(options.every((option) => Math.abs(option.dx) <= 1 && Math.abs(option.dy ?? 1) <= 1)).toBe(true);
    // У края options меньше, и шага за край нет.
    const edge = legalMoves(open({ player: { x: 0, y: 3 } }));
    expect(edge.every((option) => option.dx >= 0)).toBe(true);
  });

  it('ряд уезжает каждый ход и несёт короля вместе с фигурами', () => {
    // Ладья стоит_far по тому же ряду: её собственный ход идёт по горизонтали,
    // поэтому смена y у обеих сторон это ровно сдвиг поля, а не шахматный ход.
    const home = open({ player: { x: 0, y: 3 }, enemies: [{ id: 'r', type: 'rook', x: 7, y: 3 }] });
    const sideways = move(home, 1, 0);
    expect(sideways.player).toEqual({ x: 1, y: 2 });
    expect(sideways.enemies.find((e) => e.id === 'r')!.y).toBe(2);

    // Шаг вперёд придвигает поле, и король возвращается на свой ряд: «двигается,
    // но остаётся во втором».
    const forward = move(home, 0, 1);
    expect(forward.player).toEqual({ x: 0, y: 3 });
    expect(forward.enemies.find((e) => e.id === 'r')!.y).toBe(2);
  });

  it('отступление на нижний ряд означает, что сдвиг унесёт короля за край', () => {
    const home = open({ player: { x: 1, y: RACE_KING_ROW } });
    const back = move(home, 0, -1);
    expect(back.status).toBe('lost');
    expect(back.lastEvent).toBe('swept');
    // Тот же шаг вверх из того же ряда жив: король уходит с уносимой клетки.
    expect(move(home, 0, 1).status).toBe('playing');
  });

  it('внизу можно продержаться ровно один ход', () => {
    let state = open({ player: { x: 1, y: 0 } });
    // Стоим на нулевом ряду и ходим вверх: сдвиг возвращает нас на ноль, мы живы.
    state = move(state, 0, 1);
    expect(state.status).toBe('playing');
    expect(state.player.y).toBe(0);
    // А вот шаг в сторону с нулевого ряда - это уже сдвиг с поля.
    expect(move(state, 1, 0).status).toBe('lost');
  });

  it('шаг назад выигрывает темп, когда надо съесть фигуру', () => {
    // Слон встал рядом с королём на нулевом ряду: взять его можно только шагом
    // назад-вбок, и это законный ход, а не самоубийство - сдвиг считается после.
    const home = open({
      player: { x: 2, y: RACE_KING_ROW },
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
      player: { x: 1, y: RACE_KING_ROW + 1 },
      spawned: RACE_FIGURES_PER_COLUMN - 1,
      moves: every - 1,
    });
    const next = move(state, 0, 1);
    expect(next.spawned).toBe(RACE_FIGURES_PER_COLUMN);
    // Колонка прибавилась ровно на пороге пяти пришедших фигур.
    expect(next.width).toBe(RACE_MIN_WIDTH + 1);
    expect(next.lastEvent).toBe('width');
    for (const enemy of next.enemies) {
      expect(enemy.x).toBeLessThan(next.width);
    }
  });

  it('приток приходит по такту, а не каждый ход', () => {
    const state = open({ width: RACE_MIN_WIDTH, player: { x: 1, y: RACE_KING_ROW + 1 } });
    const every = raceSpawnEvery(1);
    let current = state;
    for (let turn = 1; turn < every; turn++) {
      current = move(current, 0, 1);
      expect(current.enemies.filter((enemy) => enemy.id.startsWith('s')).length).toBe(0);
    }
    current = move(current, 0, 1);
    expect(current.moves).toBe(every);
    expect(current.enemies.some((enemy) => enemy.id.startsWith(`s${every}-`))).toBe(true);
  });

  it('фигура рождается в верхних рядах, а не на голове у короля', () => {
    const every = raceSpawnEvery(1);
    const state = open({
      width: RACE_MIN_WIDTH,
      player: { x: 0, y: RACE_KING_ROW + 1 },
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
    // Ладья стоит в двух клетках по ряду короля: за ход она доезжает ровно на
    // клетку короля, дальше её путь не пускает ограничение дальности скользящего
    // хода (`slideCap: 2` в правилах «Гонок»).
    const lined = open({
      width: RACE_MIN_WIDTH,
      player: { x: 1, y: 4 },
      enemies: [{ id: 'r', type: 'rook', x: 0, y: 4 }],
    });
    const stuck = move(lined, 1, 0);
    expect(stuck.status).toBe('lost');
    expect(stuck.capturedBy).toBe('rook');
    // Тот же шаг вверх спасает: ладье нужен ход, чтобы перестроиться.
    expect(move(lined, 0, 1).status).toBe('playing');
  });

  it('заморозка держит и поле, и приток', () => {
    const home = open({ width: RACE_MIN_WIDTH, player: { x: 1, y: 3 }, enemies: [{ id: 'r', type: 'rook', x: 0, y: 2 }] });
    const frozen = move({ ...home, freeze: 1 }, 0, 1);
    // Король поднялся, ряд за ним не поехал: заморозка - это передышка в ход.
    expect(frozen.player).toEqual({ x: 1, y: 4 });
    expect(frozen.enemies.find((e) => e.id === 'r')!.y).toBe(2);
    // Без заморозки тот же шаг оставил бы короля на третьем ряду.
    expect(move(home, 0, 1).player.y).toBe(3);
  });

  it('на длинной серии ходов король не выпадает за поле и не выигрывает', () => {
    let current: GameState = createRaceLevel(1, 2024);
    for (let turn = 0; turn < 60 && current.status === 'playing'; turn++) {
      const options = legalMoves(current);
      if (options.length === 0) break;
      const step = options[turn % options.length]!;
      const widthBefore = current.width;
      current = move(current, (step.x - current.player.x) as MoveDx, (step.y - current.player.y) as MoveDy);
      expect(current.player.y).toBeGreaterThanOrEqual(0);
      expect(current.player.y).toBeLessThan(RACE_ROWS);
      expect(current.width).toBeGreaterThanOrEqual(widthBefore);
      for (const enemy of current.enemies) {
        expect(enemy.y).toBeGreaterThanOrEqual(0);
        expect(enemy.y).toBeLessThan(RACE_ROWS);
        expect(enemy.x).toBeGreaterThanOrEqual(0);
        expect(enemy.x).toBeLessThan(current.width);
      }
      expect(current.status).not.toBe('won');
    }
  });

  it('подсказка в забеге отдаёт клетки, а не пустоту', () => {
    for (let seed = 0; seed < 10; seed++) {
      const state = createRaceLevel(1 + seed, 4242 + seed * 31);
      const cells = survivalHint(state, 2);
      expect(cells.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(state.width);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeLessThan(RACE_ROWS);
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
    const journal: Array<[MoveDx, MoveDy]> = [
      [0, 1],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, 1],
      [-1, 1],
      [1, -1],
      [0, 1],
    ];
    for (const [dx, dy] of journal) {
      if (a.status !== 'playing' || b.status !== 'playing') break;
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
