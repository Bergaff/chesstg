import { describe, expect, it } from 'vitest';
import { parseModeLevels, profileModes, serializeModeLevels, modeProgress, toProfile } from './db';
import { parseRunMode } from './http';
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
});
