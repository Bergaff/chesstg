import { describe, expect, it } from 'vitest';
import {
  ASH_RECORD_MOVES,
  GLYPH_CHOICES,
  MIN_BOARD_CONTRAST,
  MIN_GLYPH_CONTRAST,
  PAID_SKINS,
  PRODUCTS,
  SKINS,
  SKIN_ORDER,
  SKIN_SET_STARS,
  SKIN_STARS,
  checkSkin,
  contrastRatio,
  parseHex,
  decodeSkinCode,
  encodeSkinCode,
  resolveSkin,
  showcaseEndsAt,
  showcaseSkin,
  skinAppVars,
  skinIsLight,
  skinTokens,
  skinReadability,
  skinUnlocked,
} from './index';

/** Все темы магазина должны читаться на доске - иначе продаётся невидимка. */
describe('темы поля', () => {
  it('каждая встроенная тема проходит проверку читаемости', () => {
    for (const id of SKIN_ORDER) {
      const read = skinReadability(skinTokens(SKINS[id]));
      expect(read.ok, `${id}: ${read.why}`).toBe(true);
      expect(read.glyph).toBeGreaterThanOrEqual(MIN_GLYPH_CONTRAST);
      expect(read.board).toBeGreaterThanOrEqual(MIN_BOARD_CONTRAST);
    }
  });

  it('чёрная фигура без плашки и белая на светлой плашке не проходят', () => {
    // Поле тёмное, поэтому «белая тема» сама по себе видима - а вот «просто
    // сделать фигуру чёрной» на нём и исчезает, и тонет в светлой плашке.
    const white = skinReadability({ ...skinTokens(SKINS.classic), piece: '#f7f4ec', plate: '#efe9dc' });
    expect(white.ok).toBe(false);
    expect(white.glyph).toBeLessThan(2);
    const black = skinReadability({ ...skinTokens(SKINS.classic), piece: '#0a0a0a', plate: '' });
    expect(black.ok).toBe(false);
    // Та же чёрная фигура на светлой плашке уже видна: решает посадка, не цвет.
    const onPlate = skinReadability({ ...skinTokens(SKINS.classic), piece: '#0a0a0a', plate: '#efe9dc' });
    expect(onPlate.ok).toBe(true);
  });

  it('цена набора дешевле трёх тем поштучно, но не вдвое', () => {
    expect(SKIN_STARS * PAID_SKINS.length).toBeGreaterThan(SKIN_SET_STARS);
    expect(SKIN_SET_STARS).toBeGreaterThan(SKIN_STARS);
    expect(SKINS[PAID_SKINS[0]].stars).toBe(SKIN_STARS);
    expect(PRODUCTS.skins.stars).toBe(SKIN_SET_STARS);
    expect(PRODUCTS['skin:gold'].sku).toBe('skin:gold');
    expect(PRODUCTS.share.kind).toBe('fee');
  });

  it('витрина сезона отдаёт платную тему бесплатно и только на квартал', () => {
    const moment = Date.UTC(2026, 1, 1);
    const shown = showcaseSkin(moment);
    expect(PAID_SKINS).toContain(shown);
    expect(skinUnlocked(shown, [], moment)).toBe(true);
    const other = PAID_SKINS.find((id) => id !== shown);
    if (other) expect(skinUnlocked(other, [], moment)).toBe(false);
    expect(skinUnlocked(other ?? 'classic', [other ?? 'classic'], moment)).toBe(true);
    expect(showcaseEndsAt(moment)).toBeGreaterThan(moment);
    // Награда не продаётся, не зависит от витрины и не выдаётся просто так.
    expect(skinUnlocked('ash', [], moment)).toBe(false);
    expect(skinUnlocked('ash', ['ash'], moment)).toBe(true);
    expect(SKINS.ash.reward).toBe(true);
    expect(SKINS.ash.stars).toBe(0);
    expect(ASH_RECORD_MOVES).toBe(100);
  });

  it('код темы переживает пересылку туда и обратно', () => {
    const skin = {
      name: 'Медь и дёготь',
      glyph: '❖',
      tokens: { ...skinTokens(SKINS.gold), piece: '#ff9d5c' },
      path: 'M 1 1 L 30 1 L 30 30 Z',
    };
    const decoded = decodeSkinCode(encodeSkinCode(skin));
    expect(decoded).not.toBeNull();
    expect(decoded?.name).toBe('Медь и дёготь');
    expect(decoded?.glyph).toBe('❖');
    expect(decoded?.tokens.piece).toBe('#ff9d5c');
    expect(decoded?.path).toBe('M 1 1 L 30 1 L 30 30 Z');
    expect(encodeSkinCode(skin).startsWith('kd1:')).toBe(true);
  });

  it('чужой код не может протащить ничего, кроме цвета, глифа и контура', () => {
    const forged = 'kd1:' + btoa(
      JSON.stringify({
        n: '<img src=x onerror=alert(1)>name',
        g: '<script>',
        t: { ...skinTokens(SKINS.classic), piece: 'red; background:url(http://x)' },
        p: 'M 0 0" onload="alert(1)',
      }),
    );
    expect(decodeSkinCode(forged)).toBeNull();
  });

  it('проверка темы отбивает мусор и нечитаемое', () => {
    const ok = checkSkin({ name: 'Ночь', tokens: skinTokens(SKINS.neon), glyph: '♟' });
    expect(ok.ok).toBe(true);
    expect(ok.skin.name).toBe('Ночь');
    expect(GLYPH_CHOICES).toContain(ok.skin.glyph);

    const badColor = checkSkin({ name: 'х', tokens: { ...skinTokens(SKINS.neon), piece: 'red' }, glyph: '♟' });
    expect(badColor.ok).toBe(false);
    expect(badColor.error).toContain('#rrggbb');

    const invisible = checkSkin({ name: 'х', tokens: { ...skinTokens(SKINS.neon), piece: '#0b1416', plate: '' }, glyph: '♟' });
    expect(invisible.ok).toBe(false);
    expect(invisible.error).toContain('не видно');

    // Имя режут по управляющим символам и по длине: оно попадёт в подпись доски.
    const named = checkSkin({ name: `а\r\n${'б'.repeat(60)}`, tokens: skinTokens(SKINS.neon), glyph: '♟' });
    expect(named.skin.name).toHaveLength(24);
    expect(named.skin.name).not.toContain('\n');
  });

  it('без своей темы слот «custom» откатывается на кость', () => {
    expect(resolveSkin('custom', null).id).toBe('classic');
    const custom = checkSkin({ name: 'Ночь', tokens: skinTokens(SKINS.neon), glyph: '✜' }).skin;
    const resolved = resolveSkin('custom', custom);
    expect(resolved.id).toBe('custom');
    expect(resolved.name).toBe('Ночь');
    expect(resolved.piece).toBe(SKINS.neon.piece);
    expect(resolveSkin('нет-такой-темы', null).id).toBe('classic');
  });

  /**
   * Тема обязана доходить до меню и магазина: игрок надевает её для аккаунта, а
   * не для одной партии. Проверки ниже держат две вещи - что «Латунь» остаётся
   * заводским экраном (иначе дефолт уехал бы у всех) и что ни на одной теме
   * текст не перестаёт читаться.
   */
  it('палитра экрана на «Латуни» остаётся заводской', () => {
    const vars = skinAppVars(skinTokens(SKINS.classic));
    expect(vars['--bg']).toBe('#17160f');
    expect(vars['--bg-deep']).toBe('#12110b');
    expect(vars['--accent']).toBe('#c6a45e');
    expect(vars['--on-accent']).toBe('#1a1508');
    expect(vars['--accent-wash']).toBe('#2a2517');
    expect(vars['--ink']).toBe('#e9e2d1');

    // Остальное - смеси, и они обязаны уложиться в пару-тройку каналов: линии и
    // приглушённый текст глаз замечает, а уползание на десятки уже выглядит так,
    // будто тему включили против воли.
    const roots: Record<string, string> = {
      '--panel': '#1c1a13',
      '--panel-2': '#222017',
      '--line': '#353126',
      '--line-strong': '#4b4537',
      '--muted': '#a69e8c',
      '--dim': '#7e7664',
      '--accent-dim': '#8e7541',
    };
    for (const [name, want] of Object.entries(roots)) {
      const got = parseHex(vars[name]);
      const expected = parseHex(want);
      expect(got, name).not.toBeNull();
      expect(expected, want).not.toBeNull();
      for (let i = 0; i < 3; i++) {
        expect(Math.abs((got![i] ?? 0) - (expected![i] ?? 0)), `${name} канал ${i}`).toBeLessThanOrEqual(16);
      }
    }
  });

  it('на любой теме текст экрана читается', () => {
    for (const id of SKIN_ORDER) {
      const vars = skinAppVars(skinTokens(SKINS[id]));
      const ratio = (a: string, b: string): number => contrastRatio(a, b) ?? 0;
      expect(ratio(vars['--ink']!, vars['--bg']!), `${id}: основной текст`).toBeGreaterThanOrEqual(7);
      expect(ratio(vars['--muted']!, vars['--bg']!), `${id}: приглушённый текст`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(vars['--dim']!, vars['--bg']!), `${id}: подпись`).toBeGreaterThanOrEqual(3);
      expect(ratio(vars['--accent']!, vars['--bg']!), `${id}: акцент`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(vars['--on-accent']!, vars['--accent-solid']!), `${id}: надпись на кнопке`).toBeGreaterThanOrEqual(4.5);
      // Подложка - фон карточек и вкладок: акцент на ней это стрелка и засветка,
      // поэтому планка графики, а не текста.
      expect(ratio(vars['--accent']!, vars['--accent-wash']!), `${id}: акцент на подложке`).toBeGreaterThanOrEqual(3);
      expect(ratio(vars['--danger']!, vars['--bg']!), `${id}: ошибка`).toBeGreaterThanOrEqual(3);
      expect(ratio(vars['--ok']!, vars['--bg']!), `${id}: успех`).toBeGreaterThanOrEqual(3);
    }
  });

  it('светлая тема получает тёмные чернила, тёмная - костяные', () => {
    expect(skinIsLight(skinTokens(SKINS.royal))).toBe(true);
    expect(skinAppVars(skinTokens(SKINS.royal))['--ink']).toBe('#17160f');
    expect(skinIsLight(skinTokens(SKINS.classic))).toBe(false);
    expect(skinAppVars(skinTokens(SKINS.classic))['--ink']).toBe('#e9e2d1');
  });

  it('мусорный цвет темы не оставляет экран без красок', () => {
    const vars = skinAppVars({ ...skinTokens(SKINS.classic), backdrop: 'картон', edge: '#zzz' });
    expect(vars['--bg']).toBe('#17160f');
    expect(vars['--accent']).toBe('#c6a45e');
    for (const [name, value] of Object.entries(vars)) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('контраст считает по WCAG и не врет на мусоре', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 2);
    expect(contrastRatio('#abc', '#abc')).toBeCloseTo(1, 2);
    expect(contrastRatio('красный', '#abc')).toBeNull();
  });
});
