import { describe, expect, it } from 'vitest';
import {
  RACE_FIGURES_PER_COLUMN,
  RACE_KING_ROW,
  RACE_KING_ROWS,
  RACE_MIN_WIDTH,
  RACE_MOVES_PER_LEVEL,
  RACE_ROWS,
  RACE_SPAWN_ROWS,
  RACE_STRIKE_ROWS,
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

describe('Гонки: темп ответа фигур', () => {
  /**
   * Ладья стоит на колонке короля и доезжает до него за такт, конь_far стоит в
   * углу и догонять не может: на этой паре видно, кто именно сдвинулся за такт.
   */
  const pair = (mode: string, moves = 0) =>
    open({
      mode,
      moves,
      player: { x: 3, y: 1 },
      enemies: [
        { id: 'e0', type: 'rook', x: 3, y: 5 },
        { id: 'e1', type: 'knight', x: 0, y: 7 },
      ],
    } as Partial<GameState> & { player: GameState['player'] });

  const at = (state: GameState, id: string) => {
    const enemy = state.enemies.find((e) => e.id === id);
    return enemy ? `${enemy.x},${enemy.y}` : 'нет на поле';
  };

  it('все сразу и по одной - разные правила, а не разный генератор', () => {
    expect(rulesFor('race').enemyTempo).toBe('all');
    expect(rulesFor('raceTempoOne')).toMatchObject({ enemyTempo: 'one', strike: RACE_STRIKE_ROWS });
    expect(rulesFor('raceTempoCycle')).toMatchObject({ enemyTempo: 'cycle' });
    // Variant отличается ровно флагом: те же доски, приток, полоса и рост поля.
    for (const mode of ['raceTempoOne', 'raceTempoCycle'] as const) {
      const rules = rulesFor(mode);
      expect(rules).toMatchObject({
        motion: 'greedy',
        goal: 'survive',
        player: 'king',
        exitAtBottom: true,
        kingRows: RACE_KING_ROWS,
        slideCap: 2,
        grow: true,
      });
    }
  });

  it('при one за такт сдвигается одна фигура, вторая стоит', () => {
    const all = move(pair('race'), 1, 0);
    const one = move(pair('raceTempoOne'), 1, 0);
    // Ладья едет в обоих правилах: она ближайшая угроза. `slideCap: 2` - значит
    // с (3,5) она доезжает до (3,3), а не до клетки у самого короля.
    expect(at(all, 'e0')).toBe('3,3');
    expect(at(one, 'e0')).toBe('3,3');
    // Конь при общем темпе подтягивается, при `one` - нет: он не атакующий.
    expect(at(all, 'e1')).toBe('1,5');
    expect(at(one, 'e1')).toBe('0,7');
    // Значит и ходов у короля в этом такту было меньше: темп меняет позицию,
    // а не только красиво замедляет поле.
    expect(one.enemies.length).toBe(all.enemies.length);
  });

  it('атакующей считается та фигура, что бьёт короля', () => {
    // Король сам заходит на линию ладьи. Конь ближе по клеткам, но бьёт ладья:
    // темп `one` обязан выбрать её, иначе «одна фигура за такт» превращается в
    // «фигура, которая не мешает».
    const state = open({
      mode: 'raceTempoOne',
      player: { x: 2, y: 1 },
      enemies: [
        { id: 'e0', type: 'knight', x: 1, y: 4 },
        { id: 'e1', type: 'rook', x: 3, y: 3 },
      ],
    } as Partial<GameState> & { player: GameState['player'] });
    const after = move(state, 1, 0);
    expect(after.status).toBe('lost');
    expect(after.capturedBy).toBe('rook');
    expect(after.lastEvent).toBe('captured');
    // Конь в этом такту не тронулся: двигается ровно одна фигура.
    expect(at(after, 'e0')).toBe('1,4');
  });

  it('при cycle фигуры ходят по очереди, каждая ровно раз за два такта', () => {
    let state = pair('raceTempoCycle');
    state = move(state, 1, 0);
    const first = { rook: at(state, 'e0'), knight: at(state, 'e1') };
    state = move(state, -1, 0);
    const second = { rook: at(state, 'e0'), knight: at(state, 'e1') };
    // Первый такт - вторая в списке фигура, второй - первая. Ни одна не сходила
    // дважды и ни одна не осталась в стороне за два такта.
    expect(first.knight).not.toBe('0,7');
    expect(first.rook).toBe('3,5');
    expect(second.rook).not.toBe('3,5');
    expect(second.knight).toBe(first.knight);
  });

  it('нижний ряд чистится в любом темпе: очередь ждёт, край - нет', () => {
    // Пешечный низ: ладья у короля на колонке, вторая фигура стоит на нулевом
    // ряду и никого не бьёт - она обязана уйти, даже когда такт не её.
    const state = open({
      mode: 'raceTempoOne',
      player: { x: 3, y: 1 },
      enemies: [
        { id: 'e0', type: 'rook', x: 3, y: 6 },
        { id: 'e1', type: 'rook', x: 0, y: 0 },
      ],
    } as Partial<GameState> & { player: GameState['player'] });
    const after = move(state, 1, 0);
    expect(at(after, 'e1')).toBe('нет на поле');
    // А та, что бьёт, осталась и сходила: уход с края не отменяет угрозу.
    expect(after.enemies.some((enemy) => enemy.id === 'e0')).toBe(true);
  });

  it('темп детерминирован: тот же журнал даёт то же состояние', () => {
    // Ответ фигур без притока рандома обязан совпадать у клиента и сервера:
    // выбор атакующей идёт по позиции до ходов, а не по «как получилось».
    for (const mode of ['race', 'raceTempoOne', 'raceTempoCycle'] as const) {
      const a = move(pair(mode), -1, 0);
      const b = move(pair(mode), -1, 0);
      expect(JSON.stringify(a.enemies)).toBe(JSON.stringify(b.enemies));
      expect(a.lastEvent).toBe(b.lastEvent);
    }
  });
});

describe('Гонки: король против фигур сверху', () => {
  it('режим собран на короле и узком стартовом поле', () => {
    const rules = rulesFor('race');
    expect(rules).toMatchObject({
      motion: 'greedy',
      goal: 'survive',
      player: 'king',
      wrapOnTop: false,
      // Поле не бежит: у режима нет ни сдвига ряда, ни смерти от него.
      exitAtBottom: true,
      strike: RACE_STRIKE_ROWS,
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

  it('поле не едет: фигура за такт делает ровно свой ход', () => {
    // Конь стоит в четырёх рядах над королём. Раньше за такт он получал прыжок
    // плюс сдвиг поля, и это читалось как «три клетки вперёд». Теперь смещение
    // обязано быть буквой Г: 1 по одной оси и 2 по другой.
    const home = open({ player: { x: 1, y: 1 }, enemies: [{ id: 'h', type: 'knight', x: 4, y: 5 }] });
    const next = move(home, 1, 0);
    const horse = next.enemies.find((e) => e.id === 'h')!;
    const dx = Math.abs(horse.x - 4);
    const dy = Math.abs(horse.y - 5);
    expect([dx, dy].sort((a, b) => a - b)).toEqual([1, 2]);
    // Король стоит там, куда сходил: полоса никуда не уезжает, ряд сам не меняется.
    expect(next.player).toEqual({ x: 2, y: 1 });

    // Ладья далеко от короля тоже тратит ровно один свой ход: сдвиг ряда ей не
    // доплачивается. Она пошла по горизонтали и осталась на своём ряду - прямое
    // доказательство, что поля никто не сдвигает: с лентой y обязан был уменьшиться.
    const rookHome = open({ player: { x: 0, y: 1 }, enemies: [{ id: 'r', type: 'rook', x: 7, y: 6 }] });
    const rookNext = move(rookHome, 1, 0);
    const rook = rookNext.enemies.find((e) => e.id === 'r')!;
    expect(Math.abs(rook.x - 7) + Math.abs(rook.y - 6)).toBeLessThanOrEqual(2);
    expect(rook.y).toBe(6);
    // Ни одного события «ряд унёс»: такого хода движок больше не производит.
    expect(rookNext.lastEvent).not.toBe('swept');
  });

  it('фигура, дошедшая до нижнего ряда, уходит с поля', () => {
    // Раз лента не уносит, фигуры сходят сами: нижний ряд для них это край.
    const edge = open({ player: { x: 4, y: 1 }, enemies: [{ id: 'r', type: 'rook', x: 1, y: 0 }] });
    const after = move(edge, 1, 0);
    expect(after.enemies.some((e) => e.id === 'r')).toBe(false);
    expect(after.lastEvent).toBe('escaped');
    expect(after.status).toBe('playing');

    // Бьющая короля фигура с поля не уходит: сначала взятие. Король становится на
    // ряд ладьи - и ладья доезжает до него своим ходом.
    const killer = open({ player: { x: 0, y: 0 }, enemies: [{ id: 'r', type: 'rook', x: 3, y: 0 }] });
    const dead = move(killer, 1, 0);
    expect(dead.status).toBe('lost');
    expect(dead.capturedBy).toBe('rook');
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

  it('выпад через линию: бьёт фигуру у границы и оставляет короля на месте', () => {
    const rules = rulesFor('race');
    // Фигура встала впритык к границе полосы: над линией. Шагнуть туда нельзя,
    // а бить можно - и король после взятия остаётся на своей клетке.
    const home = open({
      player: { x: 3, y: RACE_KING_ROWS - 1 },
      enemies: [{ id: 'r', type: 'rook', x: 3, y: RACE_KING_ROWS }],
    });
    const option = legalMoves(home).find((m) => m.strike);
    expect(option, 'клетка над линией обязана отдаваться как взятие').toBeTruthy();
    expect(option!.y).toBe(RACE_KING_ROWS);
    expect(option!.takes).toBe('rook');

    const strike = move(home, 0, 1);
    expect(strike.player).toEqual({ x: 3, y: RACE_KING_ROWS - 1 });
    expect(strike.enemies.some((e) => e.id === 'r')).toBe(false);
    expect(strike.captures).toBe(1);
    expect(strike.lastEvent).toBe('strike');
    // Выпад стоит хода: счёт и номер хода выросли, как после обычного шага.
    expect(strike.moves).toBe(1);
    expect(strike.score).toBe(1);
    expect(rules.strike).toBe(RACE_STRIKE_ROWS);

    // С нижнего ряда выпад не бьёт: до линии ещё один ряд, и это был бы прыжок.
    const low = open({ player: { x: 3, y: 0 }, enemies: [{ id: 'r', type: 'rook', x: 3, y: RACE_KING_ROWS }] });
    const fromBelow = legalMoves(low);
    expect(fromBelow.some((m) => m.strike)).toBe(false);
    // Все ходы с нижнего ряда остаются в полосе: до линии ещё один ряд, и бить
    // через неё может только тот, кто стоит на верхнем ряду полосы.
    expect(fromBelow.every((m) => m.y < RACE_KING_ROWS)).toBe(true);

    // Пустая клетка над линией не даётся ни как шаг, ни как выпад: бить нечего.
    const empty = open({ player: { x: 3, y: RACE_KING_ROWS - 1 } });
    expect(legalMoves(empty).some((m) => m.strike)).toBe(false);
    expect(legalMoves(empty).every((m) => m.y < RACE_KING_ROWS)).toBe(true);
    expect(() => move(empty, 0, 1)).toThrow(/полос/);

    // Без права на выпад клетка над линией исчезает и из ходов, и из подсказки:
    // на этом варианте лаборатория и сверяет, что даёт правило.
    const plain = { ...home, mode: 'raceNoStrike' as const };
    expect(legalMoves(plain).some((m) => m.strike)).toBe(false);
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
      enemies: [{ id: 'r', type: 'rook', x: 2, y: 1 }],
    });
    // Король сам заходит на колонку ладьи, и ладья тратит свой ход на взятие.
    const doomed = move(lined, 1, 0);
    expect(doomed.status).toBe('lost');
    expect(doomed.capturedBy).toBe('rook');
    // Отход в другой ряд той же полосы спасает: ладье нужно время на перестроение.
    expect(move(lined, 1, -1).status).toBe('playing');
  });

  it('заморозка держит ответ фигур и приток', () => {
    const home = open({
      width: RACE_MIN_WIDTH,
      player: { x: 0, y: 0 },
      enemies: [{ id: 'r', type: 'rook', x: 2, y: 2 }],
    });
    const frozen = move({ ...home, freeze: 1 }, 1, 1);
    // Ладья не поехала, притока нет: заморозка - передышка в ход.
    expect(frozen.player).toEqual({ x: 1, y: 1 });
    expect(frozen.enemies.find((e) => e.id === 'r')!.y).toBe(2);
    expect(frozen.enemies.filter((e) => e.id.startsWith('s')).length).toBe(0);
    // Без заморозки ладья спускается к королю.
    const thawed = move(home, 1, 1);
    expect(thawed.player).toEqual({ x: 1, y: 1 });
    expect(thawed.enemies.find((e) => e.id === 'r')!.y).toBeLessThan(2);
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
      // Игрок стоит ровно там, куда сходил: ни лента, ни выпад ряд не меняют
      // (выпад возвращает короля на исходную клетку).
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
        // Подсказка не имеет права звать короля за красную линию: выше полосы
        // допускается только клетка выпада, то есть взятие через границу.
        expect(cell.y).toBeLessThan(RACE_KING_ROWS + RACE_STRIKE_ROWS);
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
