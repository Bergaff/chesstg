import { describe, expect, it } from 'vitest';
import {
  AD_COINS_DAILY_LIMIT,
  COINS_PRICE_STEP,
  DEFAULT_ECON,
  PAID_SKINS,
  SHARE_FEE_STARS,
  SKIN_COINS,
  SKIN_SET_COINS,
  SKIN_SET_STARS,
  SKIN_STARS,
  UNDO_MAX_HELD,
  coinEconomy,
  coinEconomyMarkdown,
  skinCoinPrice,
  undoTopUp,
  undoTokensFor,
  MAX_BUYER_RATE,
  bestOffer,
  buyerRateAt,
  calibrateEcon,
  econMarkdown,
  offerAt,
  offerLadder,
  priceSweep,
  projectShop,
  publishEconomics,
} from './index';

describe('прогноз магазина', () => {
  it('при эластичности 1 выручка почти не зависит от цены', () => {
    const flat = projectShop({ elasticity: 1, anchorPrice: 0, visitors: 1000, buyerRate: 0.04, refPrice: 20 }).sweep;
    const cents = flat.map((row) => row.cents);
    const spread = (Math.max(...cents) - Math.min(...cents)) / Math.max(...cents);
    expect(spread).toBeLessThan(0.02);
  });

  it('оптимум лежит внутри диапазона и уползает вправо при низком e', () => {
    const soft = bestOffer(priceSweep({ ...DEFAULT_ECON, elasticity: 1.15 }))!;
    const hard = bestOffer(priceSweep({ ...DEFAULT_ECON, elasticity: 2.2 }))!;
    expect(soft.price).toBeGreaterThan(hard.price);
    const rows = priceSweep({ ...DEFAULT_ECON, elasticity: 1.6 });
    const peak = rows.reduce((bestIndex, row, index, all) => (row.cents > all[bestIndex].cents ? index : bestIndex), 0);
    const before = rows.slice(0, peak + 1).every((row, index, all) => index === 0 || row.cents >= all[index - 1].cents);
    const after = rows.slice(peak).every((row, index, all) => index === 0 || row.cents <= all[index - 1].cents);
    expect(before && after).toBe(true);
  });

  it('доля покупателей не превышает потолок, а ноль в базе не даёт NaN', () => {
    expect(buyerRateAt({ ...DEFAULT_ECON, buyerRate: 1, refPrice: 1, elasticity: 0.2 }, 1)).toBeLessThanOrEqual(MAX_BUYER_RATE);
    const dead = offerAt({ ...DEFAULT_ECON, visitors: 0, buyerRate: 0, refPrice: 0 }, 20);
    expect(Number.isFinite(dead.cents)).toBe(true);
    expect(dead.buyers).toBe(0);
    expect(buyerRateAt({ ...DEFAULT_ECON, refPrice: 0 }, 20)).toBe(0);
    expect(buyerRateAt(DEFAULT_ECON, 0)).toBe(0);
    expect(buyerRateAt(DEFAULT_ECON, -5)).toBe(0);
  });

  it('набор сравнивается с поштучной продажей на одном спросе', () => {
    const ladder = offerLadder({ ...DEFAULT_ECON, singlePrice: 20, setPrice: 50, setShare: 1 });
    const [single, setOnly] = ladder;
    expect(setOnly.name).toBe('только набор');
    expect(single.point.buyers).toBeGreaterThan(setOnly.point.buyers);
    // При setShare = 1 связка вырождается в набор, и их цифры обязаны совпасть.
    expect(ladder[2].point.cents).toBeCloseTo(setOnly.point.cents, 1);
  });

  it('связка лежит между двумя чистыми предложениями', () => {
    const [single, setOnly, combo] = offerLadder({ ...DEFAULT_ECON, singlePrice: 20, setPrice: 50, setShare: 0.5 });
    expect(combo.blendedPrice).toBe(35);
    expect(combo.point.buyers).toBeLessThan(single.point.buyers);
    expect(combo.point.buyers).toBeGreaterThan(setOnly.point.buyers);
    // Чем чаще берут набор, тем ближе связка к «только набору» - по обоим краям.
    const often = offerLadder({ ...DEFAULT_ECON, singlePrice: 20, setPrice: 50, setShare: 0.95 });
    expect(often[2].point.buyers).toBeLessThan(combo.point.buyers);
    expect(often[2].blendedPrice).toBeGreaterThan(combo.blendedPrice);
  });

  it('взнос режет и спам, и часть авторов: обе кривые монотонны', () => {
    const at = (fee: number) => publishEconomics({ ...DEFAULT_ECON, shareFee: fee });
    const zero = at(0);
    const mid = at(100);
    const high = at(900);
    expect(mid.submissions).toBeLessThan(zero.submissions);
    expect(high.submissions).toBeLessThan(mid.submissions);
    expect(high.seriousLost).toBeGreaterThan(mid.seriousLost);
    expect(mid.filtered).toBeGreaterThan(0);
    expect(zero.stars).toBe(0);
    // При нулевом взносе выручки нет, а труд есть - значит минус.
    expect(zero.netCents).toBeLessThan(0);
    expect(mid.netCents).toBeGreaterThan(zero.netCents);
  });

  it('окупаемость находится только если она внутри сетки', () => {
    const cheap = publishEconomics({ ...DEFAULT_ECON, hourCostCents: 100, reviewMinutes: 1, shareFee: 300 });
    expect(cheap.breakEvenFee).not.toBeNull();
    const expensive = publishEconomics({ ...DEFAULT_ECON, hourCostCents: 100_000, reviewMinutes: 60, shareFee: 10 });
    expect(expensive.breakEvenFee).toBeNull();
  });

  it('калибровка требует данных и не выдумывает ноль', () => {
    expect(calibrateEcon({ shopOpens: 0, players: 10, paidCount: 3, paidStars: 60, refundedCount: 0 })).toBeNull();
    expect(calibrateEcon({ shopOpens: 100, players: 10, paidCount: 0, paidStars: 0, refundedCount: 0 })).toBeNull();
    const cal = calibrateEcon({ shopOpens: 500, players: 900, paidCount: 10, paidStars: 250, refundedCount: 1 });
    expect(cal?.buyerRate).toBeCloseTo(0.02, 4);
    expect(cal?.refPrice).toBeCloseTo(25, 1);
    expect(cal?.refundRate).toBeCloseTo(0.1, 3);
  });

  it('выводы считаются из цифр и отчёт печатается таблицами', () => {
    const report = projectShop({ visitors: 5000, buyerRate: 0.03, refPrice: 20 });
    expect(report.verdicts.length).toBeGreaterThanOrEqual(3);
    expect(report.verdicts.join(' ')).toContain('Оптимум');
    const md = econMarkdown(report, { date: '24.10.2026', calibrated: false });
    expect(md).toContain('| Цена, звёзд |');
    expect(md).toContain('допущения вручную');
    expect(md.split('\n').filter((line) => line.startsWith('| ')).length).toBeGreaterThan(10);
    expect(md).not.toMatch(/NaN|Infinity/);
  });

  it('на пустых допущениях модель не роняет отчёт', () => {
    const report = projectShop({ visitors: 0, creatorRate: 0, publisherRate: 0, shareFee: 0, buyerRate: 0 });
    expect(report.best?.cents ?? 0).toBe(0);
    expect(report.publish.submissions).toBe(0);
    expect(report.publish.filtered).toBe(0);
    expect(report.money.cents).toBe(0);
    expect(report.verdicts.length).toBeGreaterThan(0);
  });

  it('монетные цены тем следуют курсу и не спорят с набором', () => {
    expect(skinCoinPrice(SKIN_STARS)).toBe(SKIN_COINS);
    expect(skinCoinPrice(SKIN_SET_STARS)).toBe(SKIN_SET_COINS);
    expect(SKIN_COINS % COINS_PRICE_STEP).toBe(0);
    expect(skinCoinPrice(0)).toBe(0);
    // Набор монетами выгоднее трёх одиночных тем - как и в звёздах.
    expect(SKIN_SET_COINS).toBeLessThan(SKIN_COINS * PAID_SKINS.length);
    // Взнос за публикацию за монеты не отдаём: он оплачивает чужую работу.
    expect(skinCoinPrice(SHARE_FEE_STARS)).toBeGreaterThan(0);
  });

  it('бесплатный откат капается в два и не трогает покупные', () => {
    expect(undoTokensFor(4)).toBe(0);
    expect(undoTokensFor(5)).toBe(1);
    expect(undoTokensFor(11)).toBe(2);
    expect(undoTopUp(0, 1)).toBe(1);
    expect(undoTopUp(1, 1)).toBe(1);
    expect(undoTopUp(UNDO_MAX_HELD, 1)).toBe(0);
    // Перескочил пять уровней разом - всё равно не больше потолка.
    expect(undoTopUp(0, 9)).toBe(UNDO_MAX_HELD);
    // Купленные откаты не сгорают и не уменьшаются: доплата не отменяет покупку.
    expect(undoTopUp(5, 1)).toBe(0);
    expect(undoTopUp(5, 0)).toBe(0);
  });

  it('экономика монет держит тему в пределах недели-двух, а не в одном вечере', () => {
    const farm = coinEconomy({ adViewsPerDay: 99 });
    const quiet = coinEconomy({ adViewsPerDay: 0 });
    for (const row of farm) {
      // Даже тот, кто выжимает рекламный потолок, получает тему не раньше,
      // чем за четыре дня игры: иначе монеты обнуляют продажу за звёзды.
      expect(row.daysForSkin).toBeGreaterThanOrEqual(4);
    }
    for (const row of quiet) {
      expect(row.daysForSkin).toBeGreaterThanOrEqual(4);
      expect(row.daysForSkin).toBeLessThanOrEqual(40);
    }
    // Реклама ограничена суточным потолком - без него «4 дня» превращаются в минуты.
    expect(AD_COINS_DAILY_LIMIT).toBe(5);
    const md = coinEconomyMarkdown();
    expect(md).toContain('| Уровень |');
    expect(md).not.toMatch(/NaN|Infinity/);
  });
});
