import { describe, expect, it } from 'vitest';
import {
  RACE_KING_ROW,
  RACE_MOVES_PER_LEVEL,
  RACE_ROWS,
  RACE_SPAWN_ROWS,
  RACE_WIDTH,
  applyAction,
  createRaceLevel,
  legalMoves,
  raceCoinReward,
  raceLevelForMoves,
  raceScrollEvery,
  raceSpawnEvery,
  raceSpawnWidth,
  raceTierForMoves,
  RACE_TIER_MOVES,
  RACE_SPAWN_MIN_WIDTH,
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
 * Жадный бот: выжить, снять фигуру, не вставать под линию и не прижиматься к
 * краю. Нужен не «идеальной игрой», а тем же критерием, которым мерили напряжение
 * притока: если даже такой бот живёт десятки ходов, приток никого не убивает на
 * ровном месте.
 */
function nearest(state: GameState): number {
  let best = 99;
  for (const enemy of state.enemies) {
    const distance = Math.max(Math.abs(enemy.x - state.player.x), Math.abs(enemy.y - state.player.y));
    if (distance < best) best = distance;
  }
  return best;
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
      (next.player.y <= 1 ? 0.5 : 0) +
      (next.player.y >= next.height - 3 ? 1.5 : 0);
    if (rank < bestRank) {
      bestRank = rank;
      best = next;
    }
  }
  return best;
}

describe('Гонки: король против фигур сверху', () => {
  it('режим собран на короле и постоянном поле', () => {
    const rules = rulesFor('race');
    expect(rules).toMatchObject({
      motion: 'greedy',
      goal: 'survive',
      player: 'king',
      wrapOnTop: false,
      spawnRows: RACE_SPAWN_ROWS,
    });
    const state = createRaceLevel(1, 12345);
    expect(state.width).toBe(RACE_WIDTH);
    expect(state.height).toBe(RACE_ROWS);
    expect(state.player.y).toBe(RACE_KING_ROW);
    expect(state.status).toBe('playing');
    // Стартовая пробка не должна снимать короля до первого хода.
    expect(state.enemies.length).toBeGreaterThan(0);
    for (const enemy of state.enemies) {
      expect(enemy.y).toBeGreaterThanOrEqual(RACE_ROWS - RACE_SPAWN_ROWS);
    }
  });

  it('король ходит на клетку в любую сторону, назад включительно', () => {
    const open: GameState = { ...createRaceLevel(1, 999), enemies: [] };
    const options = legalMoves(open);
    // В центре поля у короля восемь ходов, у края меньше.
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.some((option) => option.dy === 1)).toBe(true);
    expect(options.some((option) => option.dy === -1)).toBe(open.player.y > 0);
    expect(options.every((option) => Math.abs(option.dx) <= 1 && Math.abs(option.dy ?? 1) <= 1)).toBe(true);
  });

  it('взятие короля работает и вперёд, и назад, фигура уходит с поля', () => {
    const base: GameState = { ...createRaceLevel(1, 4242), player: { x: 3, y: RACE_KING_ROW }, enemies: [] };
    // Вперёд: фигурабита с клетки рядом, а сам король возвращается на свой ряд.
    const forward = move({ ...base, enemies: [{ id: 'r', type: 'rook', x: 4, y: RACE_KING_ROW + 1 }] }, 1, 1);
    expect(forward.enemies.length).toBe(0);
    expect(forward.player).toEqual({ x: 4, y: RACE_KING_ROW });
    expect(forward.captures).toBe(1);

    // Назад: на нулевой ряд можно отступить, и поле за королём не едет - иначе
    // «оттягивать волну» было бы вечным безопасным ходом.
    const backward = move({ ...base, enemies: [{ id: 'b', type: 'bishop', x: 2, y: 0 }] }, -1, -1);
    expect(backward.enemies.length).toBe(0);
    expect(backward.player).toEqual({ x: 2, y: 0 });
  });

  it('конвейер: шаг вперёд придвигает поле, а король остаётся на втором ряду', () => {
    // Заморозка выключает такт поля и ход фигур, поэтому сдвиг в один ряд виден
    // отдельно: его сделал сам игрок, а не очередь конвейера.
    const home: GameState = {
      ...createRaceLevel(1, 99),
      player: { x: 3, y: RACE_KING_ROW },
      enemies: [{ id: 'r', type: 'rook', x: 5, y: 5 }],
      freeze: 1,
    };
    const forward = move(home, 0, 1);
    expect(forward.player).toEqual({ x: 3, y: RACE_KING_ROW });
    expect(forward.enemies.find((e) => e.id === 'r')!.y).toBe(4);

    const back = move(home, 0, -1);
    expect(back.player).toEqual({ x: 3, y: 0 });
    expect(back.enemies.find((e) => e.id === 'r')!.y).toBe(5);

    // Фигура с нулевого ряда при сдвиге уходит за край: конвейер не копит хвост.
    const edge: GameState = { ...home, enemies: [{ id: 'r', type: 'rook', x: 5, y: 0 }] };
    const sweptByShift = move(edge, 0, 1);
    // Отдельный `lastEvent: 'swept'` тут перекрывает ответ фигур (поле на
    // заморозке), поэтому проверяем сам факт: фигуры за краем на поле нет.
    expect(sweptByShift.enemies.find((e) => e.id === 'r')).toBeUndefined();
  });

  it('волна растёт каждые RACE_TIER_MOVES ходов и доходит до всей доски', () => {
    expect(raceTierForMoves(0)).toBe(1);
    expect(raceTierForMoves(RACE_TIER_MOVES - 1)).toBe(1);
    expect(raceTierForMoves(RACE_TIER_MOVES)).toBe(2);
    expect(raceSpawnWidth(1)).toBe(RACE_SPAWN_MIN_WIDTH);
    expect(raceSpawnWidth(2)).toBe(RACE_SPAWN_MIN_WIDTH + 1);
    // К сорока ходам приток держит всю ширину: забег жадного бота (35 ходов)
    // успевает показать рост, а не одну и ту же полосу.
    expect(raceSpawnWidth(raceTierForMoves(40))).toBe(RACE_WIDTH);
  });

  it('фигура, вставшая на клетку короля, заканчивает забег', () => {
    // Ладья стоит в двух клетках по ряду короля: за ход она доезжает ровно на
    // клетку короля, дальше её путь не пускает ограничение дальности скользящего
    // хода (`slideCap: 2` в правилах «Гонок»).
    const lined: GameState = {
      ...createRaceLevel(1, 777),
      player: { x: 3, y: 4 },
      enemies: [{ id: 'r', type: 'rook', x: 2, y: 4 }],
    };
    const stuck = move(lined, 1, 0);
    expect(stuck.status).toBe('lost');
    expect(stuck.capturedBy).toBe('rook');
    // Тот же шаг с линии спасает: ладье нужен ход, чтобы перестроиться.
    expect(move(lined, 1, 1).status).toBe('playing');
  });

  it('приток приходит по такту, а не каждый ход', () => {
    const state: GameState = { ...createRaceLevel(1, 2024), player: { x: 0, y: 0 }, enemies: [] };
    const every = raceSpawnEvery(state.tier);
    let current = state;
    for (let turn = 1; turn < every; turn++) {
      current = move(current, 0, 1);
      // Пока такт не наступил, новых фигур на поле нет: иначе узкая полоса
      // превращалась бы в стену за три хода.
      expect(current.enemies.filter((enemy) => enemy.id.startsWith('s')).length).toBe(0);
    }
    current = move(current, 0, 1);
    expect(current.moves).toBe(every);
    expect(current.enemies.some((enemy) => enemy.id.startsWith(`s${every}-`))).toBe(true);
  });

  it('фигура рождается в верхних рядах, а не на голове у короля', () => {
    // Заморозка держит и поле, и ходы фигур: на этом ходу появляется только
    // приток, поэтому клетки рождения видно как есть.
    const every = raceSpawnEvery(1);
    const state: GameState = {
      ...createRaceLevel(1, 2024),
      player: { x: 0, y: 0 },
      enemies: [],
      freeze: 1,
      moves: every - 1,
    };
    const next = move(state, 1, 0);
    const born = next.enemies.filter((enemy) => enemy.id.startsWith(`s${every}-`));
    expect(born.length).toBeGreaterThan(0);
    for (const enemy of born) {
      expect(enemy.y).toBeGreaterThanOrEqual(RACE_ROWS - RACE_SPAWN_ROWS);
      expect(enemy.y).toBeLessThan(RACE_ROWS);
      expect(enemy.x === 0 && enemy.y === 0).toBe(false);
    }
  });

  it('на длинной серии ходов король не выпадает за поле и не выигрывает', () => {
    // Бродим по легальным клеткам: нужно не умение выживать, а то, что бегущее
    // поле не ломает партию. Финиша в забеге нет, поэтому «won» здесь быть не
    // может по определению: верхний ряд это линия рождения фигур.
    let current: GameState = createRaceLevel(1, 2024);
    for (let turn = 0; turn < 60 && current.status === 'playing'; turn++) {
      const options = legalMoves(current);
      if (options.length === 0) break;
      const step = options[turn % options.length]!;
      current = move(current, (step.x - current.player.x) as MoveDx, (step.y - current.player.y) as MoveDy);
      expect(current.player.y).toBeGreaterThanOrEqual(0);
      expect(current.player.y).toBeLessThan(RACE_ROWS);
      for (const enemy of current.enemies) {
        expect(enemy.y).toBeGreaterThanOrEqual(0);
        expect(enemy.y).toBeLessThan(RACE_ROWS);
      }
      expect(current.status).not.toBe('won');
    }
  });  it('полоса притока растёт с волной: три колонки в начале, вся доска с шестой', () => {
    expect(raceSpawnWidth(1)).toBe(3);
    expect(raceSpawnWidth(3)).toBe(5);
    expect(raceSpawnWidth(RACE_WIDTH - 2)).toBe(RACE_WIDTH);
    expect(raceSpawnWidth(40)).toBe(RACE_WIDTH);
    // Стартовая пробка стоит в полосе первой волны: фланги свободны, и король
    // с первого хода видит, куда уходить.
    const state = createRaceLevel(1, 31337);
    const left = Math.floor((RACE_WIDTH - raceSpawnWidth(1)) / 2);
    expect(state.enemies.length).toBeGreaterThan(0);
    for (const enemy of state.enemies) {
      expect(enemy.x).toBeGreaterThanOrEqual(left);
      expect(enemy.x).toBeLessThan(left + raceSpawnWidth(1));
    }
  });

  it('поле бежит: нижний ряд уходит за край, короля сдвиг не трогает', () => {
    const base: GameState = {
      ...createRaceLevel(1, 4242),
      moves: raceScrollEvery(1) - 1,
      player: { x: 0, y: 0 },
      enemies: [
        { id: 'b', type: 'bishop', x: 2, y: 0 },
        { id: 'r', type: 'rook', x: 7, y: RACE_ROWS - 1 },
      ],
    };
    const next = move(base, 1, 0);
    expect(next.player).toEqual({ x: 1, y: 0 });
    expect(next.moves).toBe(raceScrollEvery(1));
    // Слон стоял на уходящем ряду: его унесло.
    expect(next.enemies.some((enemy) => enemy.id === 'b')).toBe(false);
    // Ладья уехала на ряд вниз и осталась в поле.
    const rook = next.enemies.find((enemy) => enemy.id === 'r');
    expect(rook).toBeDefined();
    expect(rook!.y).toBeLessThan(RACE_ROWS - 1);
    // Заморозка держит поле: на такте заморозки ряд не едет.
    const frozen = move({ ...base, freeze: 1 }, 1, 0);
    expect(frozen.enemies.some((enemy) => enemy.id === 'b')).toBe(true);
  });

  it('фигура, спущенная рядом на клетку короля, ловит его', () => {
    const base: GameState = {
      ...createRaceLevel(1, 4242),
      moves: raceScrollEvery(1) - 1,
      player: { x: 3, y: 0 },
      enemies: [{ id: 'r', type: 'rook', x: 3, y: 1 }],
    };
    expect(move(base, 1, 0).status).toBe('lost');
    expect(move(base, 1, 0).lastEvent).toBe('captured');
  });

  it('подсказка в забеге отдаёт клетки, а не пустоту', () => {
    // Перебор «до верха» здесь бесполезен: финиша нет, а ветвление короля
    // сжигает лимит узлов, и подсказка возвращала пустой список.
    for (let seed = 0; seed < 10; seed++) {
      const state = createRaceLevel(1 + seed, 4242 + seed * 31);
      const cells = survivalHint(state, 2);
      expect(cells.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(RACE_WIDTH);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeLessThan(RACE_ROWS);
      }
    }
    // На пустом поле подсказка не выдумывает ход.
    const empty: GameState = { ...createRaceLevel(1, 5), enemies: [], status: 'lost' };
    expect(survivalHint(empty, 2)).toEqual([]);
  });

  it('выживающий бот не умирает в первые ходы и доживает до среднего забега', () => {
    const lives: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      let state = createRaceLevel(1, 1000 + seed * 7919);
      let guard = 0;
      while (state.status === 'playing' && guard++ < 300) {
        const next = bestReply(state);
        if (!next) break;
        state = next;
      }
      // Первые два хода смерть означает, что приток встал королю под ногу.
      expect(state.moves).toBeGreaterThanOrEqual(3);
      lives.push(state.score);
    }
    const median = [...lives].sort((a, b) => a - b)[20];
    expect(median).toBeGreaterThanOrEqual(15);
  });

  it('один и тот же журнал воспроизводится байт в байт', () => {
    const first = createRaceLevel(2, 4242);
    let a = first;
    let b = first;
    const journal: Array<[MoveDx, MoveDy]> = [
      [0, 1],
      [1, 0],
      [-1, -1],
      [0, 1],
      [1, 1],
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, 1],
      [-1, 1],
    ];
    for (const [dx, dy] of journal) {
      if (a.status !== 'playing' || b.status !== 'playing') break;
      a = move(a, dx, dy);
      b = move(b, dx, dy);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.tier).toBe(raceTierForMoves(a.score));
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
