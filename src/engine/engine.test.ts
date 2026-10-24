import { describe, expect, it } from 'vitest';
import {
  analyzeState,
  anyEnemyAttacksPlayer,
  applyAction,
  campaignCoinReward,
  chooseEnemyMove,
  createCampaignLevel,
  createEndlessRun,
  enemyMoves,
  ENDLESS_GROWTH,
  ensureEndlessSpace,
  hasLivingMove,
  legalMoves,
  materializeLives,
  msUntilNextLife,
  projectHint,
  sizeForLevel,
  LIFE_REGEN_MS,
  MAX_LIVES,
  type Enemy,
  type GameState,
  type PieceType,
  rulesFor,
} from './index';

function state(partial: Partial<GameState> = {}): GameState {
  return {
    version: 1,
    mode: 'campaign',
    width: 3,
    height: 3,
    player: { x: 1, y: 0 },
    enemies: [],
    status: 'playing',
    moves: 0,
    score: 0,
    level: 1,
    tier: 1,
    freeze: 0,
    shield: 0,
    rng: 42,
    seed: 42,
    ...partial,
  };
}

function enemy(type: PieceType, x: number, y: number, id = 'e0'): Enemy {
  return { id, type, x, y };
}

describe('правила хода', () => {
  it('пешка не ходит назад и вбок', () => {
    const s = state({ player: { x: 1, y: 1 } });
    const targets = legalMoves(s).map((m) => `${m.x},${m.y}`);
    expect(targets).toEqual(expect.arrayContaining(['0,2', '1,2', '2,2']));
    expect(targets).not.toContain('0,1');
    expect(targets).not.toContain('1,0');
  });

  it('нельзя встать на фигуру', () => {
    const s = state({ player: { x: 1, y: 0 }, enemies: [enemy('rook', 1, 1)] });
    expect(legalMoves(s).map((m) => m.dx)).toEqual([-1, 1]);
    expect(() => applyAction(s, { type: 'move', dx: 0 })).toThrow();
  });

  it('победа на верхнем ряду до хода врагов', () => {
    const s = state({ player: { x: 1, y: 1 }, enemies: [enemy('rook', 0, 2)] });
    const next = applyAction(s, { type: 'move', dx: 0 });
    expect(next.status).toBe('won');
    expect(next.player.y).toBe(2);
  });

  it('блокировка: когда ходить некуда, пропуск бесплатен', () => {
    // Поле шириной в одну колонку: впереди фигура, косить нечего, остаётся ждать.
    const s = state({ width: 1, player: { x: 0, y: 0 }, enemies: [enemy('rook', 0, 1, 'a')] });
    expect(legalMoves(s)).toHaveLength(0);
    const next = applyAction(s, { type: 'skip' });
    expect(next.moves).toBe(1);
    expect(next.skips ?? 0).toBe(0);
  });

  it('взятие по диагонали снимает фигуру', () => {
    const s = state({ enemies: [enemy('pawn', 2, 1, 'a')] });
    const moves = legalMoves(s);
    expect(moves.some((m) => m.dx === 1 && m.takes === 'pawn')).toBe(true);
    const next = applyAction(s, { type: 'move', dx: 1 });
    expect(next.player).toEqual({ x: 2, y: 1 });
    expect(next.enemies).toHaveLength(0);
    expect(next.captures).toBe(1);
    expect(next.lastEvent).toBe('capture');
  });

  it('прямо на фигуру ходить нельзя', () => {
    const s = state({ enemies: [enemy('pawn', 1, 1, 'a')] });
    expect(legalMoves(s).some((m) => m.dx === 0)).toBe(false);
    expect(() => applyAction(s, { type: 'move', dx: 0 })).toThrow('Клетка занята');
  });

  it('двойной ход доступен только первым ходом', () => {
    const s = state();
    expect(legalMoves(s).some((m) => m.dy === 2)).toBe(true);
    const after = applyAction(s, { type: 'move', dx: 0, dy: 2 });
    expect(after.player).toEqual({ x: 1, y: 2 });
    expect(legalMoves(after).some((m) => m.dy === 2)).toBe(false);
    // Перекрытая промежуточная клетка двойной ход отменяет.
    const blocked = state({ enemies: [enemy('pawn', 1, 1, 'a')] });
    expect(legalMoves(blocked).some((m) => m.dy === 2)).toBe(false);
  });

  it('добровольный пропуск тратит квоту режима', () => {
    let s = state();
    s = applyAction(s, { type: 'skip' });
    s = applyAction(s, { type: 'skip' });
    expect(s.skips).toBe(2);
    expect(() => applyAction(s, { type: 'skip' })).toThrow('Добровольные пропуски закончились');
  });
});

describe('вражеские фигуры', () => {
  it('вражеская пешка бьёт по диагонали вниз', () => {
    const s = state({
      width: 4,
      height: 4,
      player: { x: 0, y: 0 },
      enemies: [enemy('pawn', 1, 2)],
    });
    const afterMove = applyAction(s, { type: 'move', dx: 0 });
    expect(afterMove.player).toEqual({ x: 0, y: 1 });
    expect(afterMove.status).toBe('lost');
    expect(afterMove.capturedBy).toBe('pawn');
  });

  it('вражеская пешка не бьёт вперёд', () => {
    const s = state({ player: { x: 1, y: 0 }, enemies: [enemy('pawn', 1, 1)] });
    const moves = enemyMoves(s, s.enemies[0]);
    expect(moves).not.toEqual(expect.arrayContaining([{ x: 1, y: 0 }]));
  });

  it('ладья не проходит сквозь фигуры и бьёт по линии', () => {
    const s = state({
      width: 4,
      height: 4,
      player: { x: 0, y: 0 },
      enemies: [enemy('rook', 3, 0, 'r'), enemy('pawn', 1, 0, 'p')],
    });
    const rookMoves = enemyMoves(s, s.enemies[0]);
    expect(rookMoves).not.toContainEqual({ x: 0, y: 0 });
    expect(rookMoves).toContainEqual({ x: 2, y: 0 });
  });

  it('щит не даёт врагу встать на клетку игрока', () => {
    const s = state({
      width: 4,
      height: 4,
      player: { x: 0, y: 1 },
      enemies: [enemy('rook', 2, 1)],
      shield: 3,
    });
    const choice = chooseEnemyMove(s, s.enemies[0])!;
    expect(choice).not.toEqual({ x: 0, y: 1 });
    const next = applyAction(s, { type: 'move', dx: 0 });
    expect(next.status).toBe('playing');
    expect(next.shield).toBe(2);
  });

  it('заморозка останавливает врагов', () => {
    const s = state({
      width: 4,
      height: 4,
      player: { x: 0, y: 0 },
      enemies: [enemy('rook', 3, 0)],
      freeze: 2,
    });
    const next = applyAction(s, { type: 'move', dx: 1 });
    expect(next.enemies[0]).toEqual({ id: 'e0', type: 'rook', x: 3, y: 0 });
    expect(next.freeze).toBe(1);
    expect(next.status).toBe('playing');
  });
});

describe('генерация кампании', () => {
  const levels = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16, 20, 23, 26, 30, 31, 35];

  it('каждый уровень решаем и не бьёт старт', () => {
    for (const level of levels) {
      for (const seed of [100 + level, 7000 + level]) {
        const board = createCampaignLevel(level, seed);
        expect(board.width).toBe(sizeForLevel(level));
        expect(board.player.y).toBe(0);
        expect(legalMoves(board).length).toBeGreaterThan(0);
        expect(anyEnemyAttacksPlayer(board)).toBe(false);
        for (const e of board.enemies) {
          expect(e.y).toBeGreaterThanOrEqual(1);
          expect(e.y).toBeLessThanOrEqual(board.height - 2);
        }
        const analysis = analyzeState(board, { maxDepth: board.height + 2, maxNodes: 8000 });
        expect(analysis.solvable, `level ${level} seed ${seed}`).toBe(true);
      }
    }
  });

  it('одинаковый seed даёт одинаковое поле', () => {
    const a = createCampaignLevel(12, 123456);
    const b = createCampaignLevel(12, 123456);
    expect(a).toEqual(b);
  });

  it('подсказка возвращает не больше двух клеток и ведёт к победе', () => {
    const board = createCampaignLevel(7, 4321);
    const analysis = analyzeState(board, { maxDepth: 8, maxNodes: 8000 });
    const cells = projectHint(board, analysis.path, 2);
    expect(cells.length).toBe(2);
    expect(cells[0].y).toBe(1);
    expect(cells[1].y).toBeGreaterThanOrEqual(2);
  });
});

describe('бесконечный режим', () => {
  it('стартовое поле безопасно', () => {
    for (let seed = 1; seed < 20; seed++) {
      const run = createEndlessRun(seed);
      expect(run.width).toBe(6);
      expect(run.height).toBe(9);
      expect(run.player.y).toBe(0);
      expect(legalMoves(run).length).toBeGreaterThan(0);
      expect(anyEnemyAttacksPlayer(run)).toBe(false);
    }
  });

  /**
   * Мёртвая позиция - не сложность, а лотерея: партия кончается раньше, чем
   * игрок успевает что-то решить. Случайный рой на старте закрывал все три
   * направления примерно в 4% забегов, поэтому отбор старта проверяет живой
   * ход, а не только «пешке есть куда ступить».
   */
  it('старт бесконечного режима оставляет живой ход', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = createEndlessRun(seed * 104729);
      expect(hasLivingMove(run)).toBe(true);
    }
  });

  it('свежая полоса поля не отнимает последний живой ход', () => {
    let pruned = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const base = createEndlessRun(seed * 31337);
      // Пешку ставим в самый верхний ряд, старые фигуры убираем: полоса
      // достраивается ровно над головой, и это единственный момент, когда рост
      // поля может закрыть выход целиком. Tier 5 - плотность 5 фигур на полосу.
      const run: GameState = {
        ...base,
        tier: 5,
        enemies: [],
        player: { x: base.player.x, y: base.height - 1 },
      };
      const heightBefore = run.height;
      ensureEndlessSpace(run);
      expect(run.height).toBe(heightBefore + ENDLESS_GROWTH);
      expect(hasLivingMove(run)).toBe(true);
      // Полоса ставит пять фигур; меньше - значит выход закрывали, и охрана
      // сработала. Без этой проверки тест мог бы ничего не проверять.
      const spawned = run.enemies.filter((e) => e.y >= heightBefore).length;
      if (spawned < 5) pruned++;
    }
    expect(pruned).toBeGreaterThan(0);
  });

  it('поле достраивается вверх и заполняется врагами', () => {
    let run = state({
      mode: 'endless',
      width: 6,
      height: 9,
      player: { x: 2, y: 5 },
      enemies: [],
      moves: 5,
      score: 5,
      tier: 2,
      freeze: 2,
    });
    run = applyAction(run, { type: 'move', dx: 0 });
    expect(run.player.y).toBe(6);
    expect(run.height).toBe(14);
    expect(run.enemies.length).toBeGreaterThan(0);
    for (const e of run.enemies) expect(e.y).toBeGreaterThanOrEqual(9);
    expect(run.score).toBe(6);
  });
});

describe('баланс и жизни', () => {
  it('жизни копятся каждые 30 минут', () => {
    const start = 1_000_000;
    expect(materializeLives(0, start, start + LIFE_REGEN_MS - 1).lives).toBe(0);
    expect(materializeLives(0, start, start + LIFE_REGEN_MS).lives).toBe(1);
    expect(materializeLives(0, start, start + LIFE_REGEN_MS * 3.5).lives).toBe(3);
    const almost = materializeLives(3, start, start + LIFE_REGEN_MS / 2);
    expect(msUntilNextLife(almost.lives, almost.livesAt, start + LIFE_REGEN_MS / 2)).toBe(LIFE_REGEN_MS / 2);
    const full = materializeLives(MAX_LIVES, start, start + 10 * LIFE_REGEN_MS);
    expect(full.lives).toBe(MAX_LIVES);
  });

  it('награда за уровень в пределах 10–50', () => {
    for (let level = 1; level <= 60; level++) {
      const reward = campaignCoinReward(level);
      expect(reward).toBeGreaterThanOrEqual(10);
      expect(reward).toBeLessThanOrEqual(50);
    }
  });
});

describe('превращение вражеской пешки у края', () => {
  // Пешка на нулевом ряду бьёт в пустоту и идти ей некуда: без правила она
  // оставалась бы на доске навсегда. С правилом - становится ферзём на следующий
  // такт, и этот такт она не ходит, то есть игрок видит превращание заранее.
  const stuck = (mode: GameState['mode']): GameState =>
    state({ mode, width: 5, height: 4, player: { x: 0, y: 1 }, enemies: [enemy('pawn', 4, 1)] });

  it('пешка доезжает до нижнего ряда и на следующем такту становится ферзём', () => {
    const arrived = applyAction(stuck('campaign'), { type: 'skip' });
    expect(arrived.enemies[0]).toMatchObject({ type: 'pawn', x: 4, y: 0 });
    const promoted = applyAction(arrived, { type: 'skip' });
    // Кем именно стать - решает зерно уровня, поэтому здесь проверяется класс
    // фигуры, а не конкретный род: пешкой или королём она остаться не вправе.
    expect(['knight', 'bishop', 'rook', 'queen']).toContain(promoted.enemies[0].type);
    expect(promoted.enemies[0].x).toBe(4);
    expect(promoted.enemies[0].y).toBe(0);
    expect(promoted.lastEvent).toBe('promoted');
    expect(promoted.promoted).toBe(1);
    // Превращение стоило такта: фигура не сдвинулась.
    expect(arrived.player).toEqual({ x: 0, y: 1 });
    // Дальше новый ферзь играет по-своему и второй раз не превращается.
    const next = applyAction(promoted, { type: 'move', dx: 0 });
    expect(next.enemies[0].type).toBe(promoted.enemies[0].type);
    expect(next.promoted).toBe(1);
    expect([next.enemies[0].x, next.enemies[0].y]).not.toEqual([4, 0]);
  });

  it('зерно уровня фиксирует превращение: переигровка даёт ту же фигуру', () => {
    const pick = (seed: number): string => {
      const s = stuck('campaign');
      s.seed = seed;
      s.rng = seed;
      const first = applyAction(s, { type: 'skip' });
      return applyAction(first, { type: 'skip' }).enemies[0].type;
    };
    // Тот же seed - та же фигура: сервер воспроизводит партию шаг в шаг, и
    // «нарисовать» себе коня вместо ферзя клиент не может.
    expect(pick(7)).toBe(pick(7));
    const seen = new Set([pick(7), pick(11), pick(13), pick(19), pick(23), pick(29), pick(31), pick(37)]);
    // Разные зёрна дают разные фигуры: иначе «превращение» было бы ферзём всегда.
    expect(seen.size).toBeGreaterThan(1);
    for (const type of seen) expect(['knight', 'bishop', 'rook', 'queen']).toContain(type);
  });

  it('на той же доске без правила пешка замирает навсегда', () => {
    const arrived = applyAction(stuck('campaignNoPromote'), { type: 'skip' });
    expect(arrived.enemies[0]).toMatchObject({ type: 'pawn', x: 4, y: 0 });
    const again = applyAction(arrived, { type: 'skip' });
    expect(again.enemies[0]).toMatchObject({ type: 'pawn', x: 4, y: 0 });
    expect(again.promoted ?? 0).toBe(0);
    // Мёртвая пешка не бьёт и не грозит: поле с ней просто меньше.
    expect(enemyMoves(again, again.enemies[0]).length).toBe(0);
  });

  it('правило включено только там, где фигуры застревают', () => {
    expect(rulesFor('campaign').promoteAtBottom).toBe(true);
    expect(rulesFor('endless').promoteAtBottom).toBe(true);
    // В «Гонках» нижний ряд это выход с поля, в «Парковке» фигуры стоят.
    expect(rulesFor('race').promoteAtBottom).toBe(false);
    expect(rulesFor('jam').promoteAtBottom).toBe(false);
    expect(rulesFor('campaignPromote').promoteAtBottom).toBe(true);
    expect(rulesFor('campaignNoPromote').promoteAtBottom).toBe(false);
  });
});

describe('такт в два кадра', () => {
  it('playerOnly отдаёт позицию сразу после хода игрока, до ответа фигур', () => {
    const s = state({ player: { x: 0, y: 0 }, enemies: [enemy('rook', 2, 2)] });
    const interim = applyAction(s, { type: 'move', dx: 1 }, { playerOnly: true });
    const full = applyAction(s, { type: 'move', dx: 1 });
    expect(interim.player).toEqual({ x: 1, y: 1 });
    expect(interim.moves).toBe(1);
    expect(interim.status).toBe('playing');
    // Фазы противника в этом кадре не было: ни одна фигура не сдвинулась и
    // никто не родился. Иначе пауза врала бы про угрозу, которую игрок читает.
    expect(interim.enemies.map((e) => `${e.type}${e.x},${e.y}`)).toEqual(['rook2,2']);
    // Настоящий кадр того же хода - с ответом фигур, и пешку он не двигает.
    expect(full.player).toEqual(interim.player);
  });

  it('победу кадр паузы не прячет', () => {
    const s = state({ player: { x: 1, y: 1 }, enemies: [enemy('rook', 0, 2)] });
    expect(applyAction(s, { type: 'move', dx: 0 }, { playerOnly: true }).status).toBe('won');
  });
});
