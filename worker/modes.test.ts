import { describe, expect, it } from 'vitest';
import {
  eternalLives,
  parseModeLevels,
  profileModes,
  resumableRun,
  runShapeMatchesMode,
  serializeModeLevels,
  modeProgress,
  toProfile,
} from './db';
import { RACE_KING_ROW, RACE_KING_ROWS, RACE_MIN_WIDTH, RACE_ROWS, RACE_WIDTH } from '../src/engine';
import { replayRun } from '../src/engine';
import { isPrefix, jsonAction, parseActions, parseRunMode } from './http';
import type { GameState } from '../src/engine';
import type { UserRow } from './types';

/** Строка игрока с минимальным набором полей: остальные для прогресса не важны. */
function user(patch: Partial<UserRow> = {}): UserRow {
  return {
    id: 'u1',
    tg_id: 1,
    first_name: 'Игрок',
    username: null,
    is_guest: 0,
    level: 1,
    max_level: 1,
    coins: 0,
    lives: 5,
    lives_at: 0,
    endless_best: 0,
    endless_best_tier: 1,
    endless_best_moves: 0,
    ad_free: 0,
    skins: '[]',
    skin: 'classic',
    inv_hint: 0,
    inv_freeze: 0,
    inv_undo: 0,
    invite_code: 'code',
    referred_by: null,
    mode_levels: null,
    created_at: 0,
    updated_at: 0,
    ...patch,
  };
}

describe('журнал режима «Гонки»', () => {
  it('различает шаг в своём ряду и ход вперёд', () => {
    const stay = parseActions([{ type: 'move', dx: 0, dy: 0 }], 'race');
    expect(stay).toEqual([{ type: 'move', dx: 0, dy: 0 }]);
    // Отсутствие dy это прежний ход вперёд: канон у них обязан различаться.
    const forward = parseActions([{ type: 'move', dx: 0 }], 'race');
    expect(jsonAction(stay[0])).not.toBe(jsonAction(forward[0]));
    expect(isPrefix(stay, forward)).toBe(false);
    expect(isPrefix(stay, stay)).toBe(true);
    expect(() => parseActions([{ type: 'move', dx: 0, dy: 3 }], 'race')).toThrow();
  });
});

describe('режимы в запросах клиента', () => {
  it('принимает боевые режимы и отсекает лабораторные', () => {
    expect(parseRunMode('campaign')).toBe('campaign');
    expect(parseRunMode('jam')).toBe('jam');
    expect(parseRunMode('race')).toBe('race');
    expect(parseRunMode('endless')).toBe('endless');
    expect(parseRunMode('jamDiag')).toBeNull();
    expect(parseRunMode(undefined)).toBeNull();
    expect(parseRunMode(42)).toBeNull();
  });
});

describe('прогресс режимов в JSON-колонке', () => {
  it('терпит пустоту и мусор', () => {
    expect(parseModeLevels(null)).toEqual({});
    expect(parseModeLevels('')).toEqual({});
    expect(parseModeLevels('не json')).toEqual({});
    expect(parseModeLevels('[]')).toEqual({});
    // Мусор вместо объекта не должен уронить профиль: режим откатывается к первому уровню.
    expect(parseModeLevels('{"jam":"строка"}')).toEqual({ jam: { level: 1, maxLevel: 1 } });
    // Уровень должен быть целым и не нулевым: ноль сломал бы награду.
    expect(parseModeLevels('{"jam":{"level":2.4,"maxLevel":"9"}}').jam).toEqual({ level: 2, maxLevel: 9 });
    // Пройденный уровень не может быть меньше текущего.
    expect(parseModeLevels('{"jam":{"level":6,"maxLevel":2}}').jam).toEqual({ level: 6, maxLevel: 6 });
  });

  it('возвращает только режимы с уровнем из этой колонки', () => {
    const parsed = parseModeLevels(
      '{"jam":{"level":3,"maxLevel":5},"hack":{"level":99,"maxLevel":99},"campaign":{"level":99,"maxLevel":99}}',
    );
    expect(Object.keys(parsed)).toEqual(['jam']);
  });

  it('пишется и читается обратно', () => {
    const raw = serializeModeLevels({ jam: { level: 4, maxLevel: 6 }, race: { level: 1, maxLevel: 1 } });
    expect(JSON.parse(raw)).toEqual({ jam: { level: 4, maxLevel: 6 }, race: { level: 1, maxLevel: 1 } });
    expect(parseModeLevels(raw).race).toEqual({ level: 1, maxLevel: 1 });
  });

  it('хранит рекорд рядов у «Гонок» и не выдумывает его у «Парковки»', () => {
    const parsed = parseModeLevels('{"race":{"level":4,"maxLevel":4,"best":37,"bestMoves":41},"jam":{"level":2,"maxLevel":2}}');
    expect(parsed.race).toEqual({ level: 4, maxLevel: 4, best: 37, bestMoves: 41 });
    expect(parsed.jam).toEqual({ level: 2, maxLevel: 2 });
    // Мусор вместо числа не должен уезжать в профиль: лучше уж без рекорда.
    expect(parseModeLevels('{"race":{"level":1,"maxLevel":1,"best":"много"}}').race).toEqual({ level: 1, maxLevel: 1 });
    const row = user({ max_level: 6, mode_levels: serializeModeLevels(parsed) });
    expect(profileModes(row).race).toMatchObject({ level: 4, best: 37, bestMoves: 41 });
    expect(profileModes(row).jam.best).toBeUndefined();
  });

  it('кампания живёт в своих колонках, а не в JSON', () => {
    const row = user({ level: 7, max_level: 9, mode_levels: JSON.stringify({ jam: { level: 2, maxLevel: 4 } }) });
    expect(modeProgress(row, 'campaign')).toEqual({ level: 7, maxLevel: 9 });
    expect(modeProgress(row, 'jam')).toEqual({ level: 2, maxLevel: 4 });
    // Режим без записи начинается с первого уровня.
    expect(modeProgress(row, 'race')).toEqual({ level: 1, maxLevel: 1 });
    // У бесконечного режима уровня нет: счёт это рекорд.
    expect(modeProgress(row, 'endless')).toEqual({ level: 0, maxLevel: 0 });
  });

  it('профиль отдаёт все четыре режима с гейтами', () => {
    const row = user({ max_level: 5, mode_levels: JSON.stringify({ jam: { level: 3, maxLevel: 3 } }) });
    const modes = profileModes(row);
    expect(modes.campaign).toEqual({ level: 1, maxLevel: 5, unlocked: true, unlockAtLevel: 1 });
    expect(modes.jam).toEqual({ level: 3, maxLevel: 3, unlocked: true, unlockAtLevel: 3 });
    expect(modes.race).toEqual({ level: 1, maxLevel: 1, unlocked: true, unlockAtLevel: 5 });
    expect(modes.endless).toEqual({ level: 0, maxLevel: 0, unlocked: false, unlockAtLevel: 11 });
    expect(toProfile(row).modes).toEqual(modes);
  });

  it('гейты: парковка с 3 уровня, гонки с 5, бесконечный с 11', () => {
    const early = profileModes(user({ max_level: 2 }));
    expect(early.jam.unlocked).toBe(false);
    expect(early.race.unlocked).toBe(false);
    const middle = profileModes(user({ max_level: 5 }));
    expect(middle.jam.unlocked).toBe(true);
    expect(middle.race.unlocked).toBe(true);
    expect(middle.endless.unlocked).toBe(false);
    expect(toProfile(user({ max_level: 5 })).endlessUnlocked).toBe(false);
    expect(profileModes(user({ max_level: 11 })).endless.unlocked).toBe(true);
  });

  it('список QA_LIVES_IDS держит сердца полными', () => {
    const env = { QA_LIVES_IDS: '42, 777' } as never;
    expect(eternalLives(env, user({ tg_id: 777 }))).toBe(true);
    expect(eternalLives(env, user({ tg_id: 42 }))).toBe(true);
    expect(eternalLives(env, user({ tg_id: 4242 }))).toBe(false);
    // Гостю список не назначить: `tg_id` пустой, и вечных сердец нет.
    expect(eternalLives(env, user({ tg_id: null }))).toBe(false);
    // Пустая переменная - режима нет вовсе.
    expect(eternalLives({} as never, user({ tg_id: 42 }))).toBe(false);
    expect(eternalLives({ QA_LIVES_IDS: '  ' } as never, user({ tg_id: 42 }))).toBe(false);
    // Профиль вечного аккаунта: полные сердца, флаг, без таймера регенерации.
    const row = user({ lives: 1, lives_at: Date.now() });
    expect(toProfile(row, 1000, true)).toMatchObject({ lives: 5, eternalLives: true, nextLifeAt: null });
    expect(toProfile(row, 1000, false).eternalLives).toBe(false);
  });
});

describe('активная партия и поле прежней сборки', () => {
  /** Головоломка «Парковки»: фигуры и счёт уведённых, пешки нет. */
  const puzzle = {
    mode: 'jam',
    version: 3,
    width: 5,
    height: 7,
    pieces: [{ id: 'w1', type: 'rook', x: 0, y: 0, side: 'white' }],
    moves: 0,
    budget: 20,
    total: 1,
    removed: 0,
    status: 'playing',
  };
  /** Прежняя песочница того же режима: пешка, враги, ни фигур, ни счёта. */
  const sandbox = {
    mode: 'jam',
    width: 5,
    height: 7,
    level: 1,
    seed: 1,
    tier: 1,
    player: { x: 1, y: 1 },
    enemies: [],
    moves: 0,
    score: 0,
    skips: 0,
    freeze: 0,
    shield: 0,
    status: 'playing',
  };
  const king = {
    ...sandbox,
    mode: 'race',
    width: RACE_MIN_WIDTH,
    height: RACE_ROWS,
    player: { x: 1, y: RACE_KING_ROW },
  };
  const runRow = (patch: Partial<{ mode: string; initial_state: string; actions: string }> = {}) => ({
    mode: 'jam',
    initial_state: JSON.stringify(puzzle),
    actions: '[]',
    ...patch,
  });

  it('головоломку отличает от прежней песочницы с тем же mode', () => {
    expect(runShapeMatchesMode(runRow())).toBe(true);
    expect(runShapeMatchesMode(runRow({ initial_state: JSON.stringify(sandbox) }))).toBe(false);
  });

  it('журнал прежних правил не проигрывается: такую партию старт закрывает', () => {
    // До правила полосы король ехал вместе с рядом, и шаг вверх из второго ряда
    // был легален. Теперь он выводит за границу полосы, реплей падает, и `app.ts`
    // через `resumableByReplay` закрывает такую партию как выход - игроку не
    // нужно ничего обнулять руками в базе.
    const actions = parseActions([{ type: 'move', dx: 0, dy: 1 }], 'race');
    expect(actions.length).toBe(1);
    expect(() => replayRun(king as unknown as GameState, actions)).toThrow(/полос/);
    // Тот же журнал разбирался и в прежних правилах: отказывает только воспроизведение
    // по новым, поэтому проверка формы (`runShapeMatchesMode`) тут проходит.
    expect(runShapeMatchesMode({ mode: 'race', initial_state: JSON.stringify(king) })).toBe(true);
  });

  it('выпад через линию сервер воспроизводит, и журнал для него не новый', () => {
    // Выпад - это обычный `{type:'move', dx, dy}`: протокол не менялся, поэтому
    // сервер обязан принять тот же журнал и снять фигуру, не двигая короля. Если
    // здесь появится «неизвестное действие», значит клиент и сервер разошлись.
    const lined = {
      ...king,
      enemies: [{ id: 'e0', type: 'rook', x: 1, y: RACE_KING_ROWS }],
    };
    const actions = parseActions([{ type: 'move', dx: 0, dy: 1 }], 'race');
    const after = replayRun(lined as unknown as GameState, actions) as unknown as GameState;
    expect(after.moves).toBe(1);
    expect(after.score).toBe(1);
    expect(after.captures).toBe(1);
    expect(after.enemies.some((e) => e.id === 'e0')).toBe(false);
    expect(after.player).toEqual({ x: 1, y: RACE_KING_ROW });
    expect(after.lastEvent).toBe('strike');
    expect(after.status).toBe('playing');

    // Та же запись журнала без фигуры над линией остаётся незаконным шагом за
    // границу полосы: сервер не даёт «двигаться вне полосы» ни при каких данных.
    expect(() => replayRun(king as unknown as GameState, actions)).toThrow(/полос/);
  });

  it('у гонок требует короля в стартовом ряду', () => {
    expect(runShapeMatchesMode(runRow({ mode: 'race', initial_state: JSON.stringify(king) }))).toBe(true);
    expect(
      runShapeMatchesMode(
        runRow({ mode: 'race', initial_state: JSON.stringify({ ...king, player: { x: 3, y: 0 } }) }),
      ),
    ).toBe(false);
    // Поле прежней сборки (восемь на двенадцать, ряды считались конвейером) новым
    // правилом не играется: такая партия закрывается, а не продолжается.
    expect(
      runShapeMatchesMode(runRow({ mode: 'race', initial_state: JSON.stringify({ ...king, height: 12 }) })),
    ).toBe(false);
    expect(RACE_WIDTH).toBe(RACE_MIN_WIDTH + 5);
    expect(RACE_ROWS).toBe(8);
  });

  it('журнал чужого режима партию не продолжает', () => {
    expect(resumableRun(runRow({ actions: JSON.stringify([{ type: 'move', dx: 1 }]) }))).toBe(false);
    expect(resumableRun(runRow({ actions: JSON.stringify([{ type: 'piece', id: 'w1', to: { x: 1, y: 1 } }]) }))).toBe(true);
  });

  it('увод фигуры на свой край попадает в журнал и партию не ломает', () => {
    // Ухода отдельной клеткой больше нет: фигура становится на ряд своего края,
    // то есть журнал состоит только из клеток поля. Нулевой ряд в поле 7 рядов
    // это и есть уход, а всё, что вылезает за рамку, валидатор отбивает.
    expect(resumableRun(runRow({ actions: JSON.stringify([{ type: 'piece', id: 'w1', to: { x: 0, y: 0 } }]) }))).toBe(true);
    expect(resumableRun(runRow({ actions: JSON.stringify([{ type: 'piece', id: 'w1', to: { x: 2, y: 6 } }]) }))).toBe(true);
    expect(resumableRun(runRow({ actions: JSON.stringify([{ type: 'piece', id: 'w1', to: { x: -1, y: 0 } }]) }))).toBe(false);
    expect(resumableRun(runRow({ actions: JSON.stringify([{ type: 'piece', id: 'w1', to: { x: 0, y: 42 } }]) }))).toBe(false);
  });

  it('битое поле и пустая строка не продолжаются, но и не падают', () => {
    expect(resumableRun(runRow({ initial_state: '{' }))).toBe(false);
    expect(resumableRun(null)).toBe(false);
    expect(resumableRun(undefined)).toBe(false);
  });
});
