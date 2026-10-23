// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  RACE_ROWS,
  createCampaignLevel,
  createJamPuzzle,
  createRaceLevel,
  jamPieceMoves,
  legalMoves,
  type GameState,
  type JamState,
} from '../src/engine';
import type { AppConfig, FinishResult, Profile, SessionResponse } from '../src/lib/types';

const SEED = 20261019;

const profile: Profile = {
  id: 'guest-1',
  name: 'Гость',
  isGuest: true,
  level: 1,
  maxLevel: 1,
  levelsCleared: 0,
  coins: 30,
  lives: 5,
  maxLives: 5,
  nextLifeAt: null,
  nextLifeInMs: 0,
  serverNow: Date.now(),
  endlessBest: 0,
  endlessBestTier: 1,
  endlessBestMoves: 0,
  endlessUnlocked: false,
  adFree: false,
  skins: ['classic'],
  skin: 'classic',
  inventory: { hint: 0, freeze: 0, undo: 0 },
  modes: {
    campaign: { level: 1, maxLevel: 1, unlocked: true, unlockAtLevel: 1 },
    jam: { level: 1, maxLevel: 1, unlocked: false, unlockAtLevel: 3 },
    race: { level: 1, maxLevel: 1, unlocked: false, unlockAtLevel: 5 },
    endless: { level: 0, maxLevel: 0, unlocked: false, unlockAtLevel: 11 },
  },
  inviteCode: 'abc12345',
  createdAt: Date.now(),
  prices: { hint: 20, freeze: 30, undo: 15 },
};

/** Исходный прогресс: тесты меняют profile.modes, а потом возвращают как было. */
const baseProfile = structuredClone(profile);

const config: AppConfig = {
  botUsername: 'pawn_vs_all_bot',
  webappUrl: 'https://example.com',
  allowGuests: true,
  devMode: true,
  demoAds: false,
  adsEnabled: true,
  paymentsEnabled: false,
  environment: 'test',
  adsgram: { blockId: '', src: '' },
};

function session(): SessionResponse {
  return {
    profile,
    config,
    active: {},
    invitedCount: 0,
    challenge: null,
    referral: null,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let initial: GameState = createCampaignLevel(1, SEED);
/** Поле «Парковки» сервер отдаёт другой формы, поэтому оно в своей переменной. */
let jamInitial: JamState | null = null;
let finishOutcome: FinishResult = {
  outcome: 'won',
  mode: 'campaign',
  level: 1,
  score: 1,
  moves: 1,
  coinsEarned: 10,
  levelUp: true,
  nextLevel: 2,
  maxLevel: 2,
  lives: 5,
  capturedBy: null,
  newBest: false,
  bestScore: null,
  endlessUnlockedNow: false,
};
const run = {
  id: 'run-1',
  mode: 'campaign' as const,
  level: 1,
  seed: SEED,
  initial,
  actions: [],
  moves: 0,
  score: 0,
  status: 'playing',
  result: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

let calls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  calls = [];
  localStorage.clear();
  Object.assign(profile, structuredClone(baseProfile));
  initial = createCampaignLevel(1, SEED);
  jamInitial = null;
  finishOutcome = { ...finishOutcome, outcome: 'won', capturedBy: null, lives: 5, coinsEarned: 10 };
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
  class FakeResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width: 340, height: 340 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, body });
      if (url === '/api/session') return jsonResponse(session());
      if (url === '/api/run/start') {
        // Сервер сам решает уровень, а режим только эхо запроса: тест сверяет id режима.
        const requested = (body as { mode?: string } | undefined)?.mode ?? 'campaign';
        const payload = requested === 'jam' && jamInitial ? jamInitial : initial;
        return jsonResponse({ resumed: false, run: { ...run, mode: requested, initial: payload } });
      }
      if (url.endsWith('/save')) return jsonResponse({ ok: true });
      if (url.includes('/finish')) {
        return jsonResponse({
          result: finishOutcome,
          profile: {
            ...profile,
            lives: finishOutcome.lives,
            level: finishOutcome.nextLevel,
            maxLevel: finishOutcome.maxLevel,
            coins: profile.coins + finishOutcome.coinsEarned,
          },
        });
      }
      if (url.startsWith('/api/leaderboard')) {
        return jsonResponse({
          metric: 'endless',
          scope: 'global',
          rows: [
            { rank: 1, name: 'Гроссмейстер', isMe: false, endlessBest: 42, maxLevel: 18, level: 18 },
            { rank: 2, name: 'Ты', isMe: true, endlessBest: 7, maxLevel: 2, level: 2 },
          ],
          myRank: 2,
          invitedCount: 0,
          inviteLink: null,
        });
      }
      if (url === '/api/bonus/use') {
        return jsonResponse({
          ok: true,
          kind: 'hint',
          source: 'coins',
          price: 20,
          coins: 80,
          inventory: { ...profile.inventory },
          grant: null,
        });
      }
      if (url === '/api/shop/bonus') {
        return jsonResponse({ profile: { ...profile, coins: 10, inventory: { ...profile.inventory, hint: 1 } } });
      }
      return jsonResponse({ ok: true });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function boot() {
  const { default: App } = await import('../src/App');
  const view = render(createElement(App));
  await screen.findByText('Пешка');
  return view;
}

describe('UI smoke', () => {
  it('на сайте предлагает привязать Telegram', async () => {
    await boot();
    expect(screen.getByText(/Сохранение прогресса/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Привязать Telegram' })).toBeTruthy();
    expect(screen.getByText(/Без входа прогресс живёт в этом браузере/)).toBeTruthy();
  });

  it('загружает меню и показывает ключевые блоки', async () => {
    await boot();
    expect(screen.getByText('против всех')).toBeTruthy();
    expect(screen.getByText(/Продолжить|Играть/)).toBeTruthy();
    expect(screen.getByText(/Бонусы за монеты/)).toBeTruthy();
    expect(screen.getByText(/Мировая таблица и друзья/)).toBeTruthy();
    expect(screen.getByText(/Гостевой режим/)).toBeTruthy();
    expect(screen.getByText('Реклама за монеты')).toBeTruthy();
    const lab = screen.getByText('Лаборатория').closest('a');
    expect(lab?.getAttribute('href')).toBe('/admin');
  });

  it('открывает правила и закрывает их', async () => {
    await boot();
    fireEvent.click(screen.getAllByRole('button', { name: 'Правила игры' })[0]);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Только вперёд')).toBeTruthy();
    expect(screen.getByText(/Появляется на пятнадцатом уровне/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ходит по экранам магазина и рекордов', async () => {
    await boot();
    fireEvent.click(screen.getByText(/Бонусы за монеты/).closest('button')!);
    expect(await screen.findByText('Бонусы на партию')).toBeTruthy();
    expect(screen.getByText('Подсказка')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Скины' }));
    expect(await screen.findByText('Другой образ пешки')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));

    fireEvent.click(await screen.findByText(/Мировая таблица и друзья/));
    expect(await screen.findByText('Таблица лидеров')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Гроссмейстер')).toBeTruthy());
    expect(screen.getAllByText(/клеток/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('против всех')).toBeTruthy();

    // Сердечки ведут сразу на вкладку Stars — там продаются жизни.
    fireEvent.click(screen.getByRole('button', { name: 'Жизни: 5 из 5' }));
    expect(await screen.findByText('Поддержать игру')).toBeTruthy();
  });

  it('меню показывает «Парковку» и «Гонки» с условиями открытия', async () => {
    await boot();
    expect(screen.getByText('Парковка')).toBeTruthy();
    expect(screen.getByText('Гонки')).toBeTruthy();
    expect(screen.getByText(/Откроется на 3 уровне кампании/)).toBeTruthy();
    expect(screen.getByText(/Откроется на 5 уровне кампании/)).toBeTruthy();
    expect(screen.getByText(/Уровень в «Парковке»/)).toBeTruthy();
    // Режимы входят той же кнопкой, что кампания: заголовок-действие на карточке,
    // а не тонкая строка в «Разделах», где её легко не заметить. Обе карточки
    // закрыты - значит на них «Закрыт», а не пустое место.
    expect(screen.getByText('Кампания').closest('button')?.textContent).toContain('Играть');
    expect(screen.getAllByText('Закрыт').length).toBe(2);
    expect(screen.getByText('Парковка').closest('button')?.className).toContain('cta-block');
    expect(screen.getByText('Гонки').closest('button')?.className).toContain('cta-block');
    expect(document.querySelector('.mode-cards')).not.toBeNull();
  });

  it('открытый режим зовёт в забег через карточку, а не через список', async () => {
    profile.maxLevel = 9;
    profile.level = 9;
    profile.modes.campaign = { level: 9, maxLevel: 9, unlocked: true, unlockAtLevel: 1 };
    profile.modes.race = { level: 3, maxLevel: 4, unlocked: true, unlockAtLevel: 5, bestMoves: 41 };
    await boot();

    const card = screen.getByText('Гонки').closest('button')!;
    // В открытой карточке есть куда расти: уровень режима и рекорд забега.
    expect(card.textContent).toContain('Играть');
    expect(card.textContent).toContain('Уровень 3');
    expect(card.textContent).toContain('41');
    // Строки того же режима в «Разделах» больше нет: дубль плодит два входа.
    expect(screen.queryByText(/Считаются пережитые ходы/)).toBeNull();
  });

  it('закрытый режим не запускает забег', async () => {
    await boot();
    fireEvent.click(screen.getByText('Гонки').closest('button')!);
    expect(await screen.findByText(/режим откроется на 5 уровне кампании/)).toBeTruthy();
    expect(calls.some((call) => call.url === '/api/run/start')).toBe(false);
  });

  it('«Парковка» открывает головоломку про перегон фигур', async () => {
    profile.maxLevel = 6;
    profile.level = 4;
    profile.modes.campaign = { level: 4, maxLevel: 6, unlocked: true, unlockAtLevel: 1 };
    profile.modes.jam = { level: 4, maxLevel: 5, unlocked: true, unlockAtLevel: 3 };
    jamInitial = createJamPuzzle(4, SEED);
    await boot();

    fireEvent.click(screen.getByText('Парковка').closest('button')!);
    expect(await screen.findByText('Начать')).toBeTruthy();
    const start = calls.find((call) => call.url === '/api/run/start');
    expect((start?.body as { mode?: string } | undefined)?.mode).toBe('jam');
    // В предпросмотре видно бюджет перестановок: без него уровень не спланировать.
    expect(screen.getByText('Перестановок дано')).toBeTruthy();
    expect(screen.getByText(String(jamInitial.budget))).toBeTruthy();

    fireEvent.click(screen.getByText('Начать'));
    const grid = await screen.findByRole('grid', { name: 'Поле парковки' });
    expect(grid.querySelectorAll('[role="gridcell"]').length).toBe(jamInitial.width * jamInitial.height);
    expect(screen.getByText(`ходов ${jamInitial.budget}`)).toBeTruthy();
    expect(screen.getByText(new RegExp(`уведено 0 из ${jamInitial.pieces.length}`))).toBeTruthy();
    // Крайние ряды помечены всегда, до выбора фигуры: они и есть выход, и поле
    // не должно менять геометрию на каждом тапе.
    const edge = grid.querySelectorAll('.cell-edge-top, .cell-edge-bottom');
    expect(edge.length).toBe(jamInitial.width * 2);
    // Отдельных полос ухода нет: увод фигуры это обычный ход на свой край.
    expect(document.querySelectorAll('.jam-lane-cell').length).toBe(0);

    // Тап по фигуре подсвечивает клетки, тап по клетке делает перестановку.
    const first = jamInitial.pieces.find((piece) => jamPieceMoves(jamInitial!, piece).length > 0)!;
    const target = jamPieceMoves(jamInitial, first)[0];
    const source = grid.querySelectorAll('[role="gridcell"]')[
      (jamInitial.height - 1 - first.y) * jamInitial.width + first.x
    ] as HTMLButtonElement;
    fireEvent.click(source);
    const dest = grid.querySelectorAll('[role="gridcell"]')[
      (jamInitial.height - 1 - target.y) * jamInitial.width + target.x
    ] as HTMLButtonElement;
    fireEvent.click(dest);

    await waitFor(() => expect(screen.getByText(`ходов ${jamInitial!.budget - 1}`)).toBeTruthy());

    // Выход просит подтверждение и сохраняет позицию: пробку можно продолжить позже.
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('Выйти в меню')).toBeTruthy();
    fireEvent.click(screen.getByText('Выйти'));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/save'))).toBe(true));
    const saved = calls.filter((call) => call.url.endsWith('/save')).at(-1);
    expect((saved?.body as { actions?: unknown[] } | undefined)?.actions?.length).toBe(1);
  });

  it('«Гонки» ходят по клеткам поля и считают пережитые ходы', async () => {
    profile.maxLevel = 6;
    profile.modes.campaign = { level: 6, maxLevel: 6, unlocked: true, unlockAtLevel: 1 };
    profile.modes.race = { level: 2, maxLevel: 2, unlocked: true, unlockAtLevel: 5, best: 14, bestMoves: 16 };
    initial = createRaceLevel(2, SEED);
    await boot();

    fireEvent.click(screen.getByText('Гонки').closest('button')!);
    expect(await screen.findByText('Начать')).toBeTruthy();
    const start = calls.find((call) => call.url === '/api/run/start');
    expect((start?.body as { mode?: string } | undefined)?.mode).toBe('race');
    // Поле старает узким: три колонки при восьми рядах, король на втором ряду от
    // низа. Шире оно станет внутри забега, по числу пришедших фигур.
    expect(screen.getByText('рекорд 14')).toBeTruthy();
    const grid = await screen.findByRole('grid', { name: 'Игровое поле' });
    expect(initial.width).toBe(3);
    expect(grid.querySelectorAll('[role=\"gridcell\"]').length).toBe(initial.width * RACE_ROWS);
    // Нижней навигации в «Гонках» больше нет: ходят тапом по подсвеченной клетке.
    // Полосу притока и линию уходящего ряда тоже убрали - вместо них движение.
    expect(document.querySelectorAll('.move-pad').length).toBe(0);
    expect(document.querySelectorAll('.flow-in, .flow-out').length).toBe(0);
    expect(document.querySelectorAll('.cell-pin').length).toBe(0);

    fireEvent.click(screen.getByText('Начать'));
    // Подсказка в режиме без финиша ищет не путь, а следующий ход: за 20 монет
    // она обязана подсветить клетки, а не выдавать «безопасного пути не видно».
    fireEvent.click(screen.getByRole('button', { name: /Подсказка/ }));
    await waitFor(() => expect(document.querySelectorAll('.cell-hint').length).toBeGreaterThan(0));
    const hintCall = calls.find((call) => call.url === '/api/bonus/use');
    expect((hintCall?.body as { kind?: string } | undefined)?.kind).toBe('hint');
    expect(screen.getByText('Ходы 0')).toBeTruthy();

    const options = legalMoves(initial);
    // Полоса: все подсвеченные клетки хода лежат в двух нижних рядах, и доска
    // рисует её границу. Отметок поля больше нет, линия - единственная.
    // Выпад - единственная клетка вне полосы, и она помечена: на неё не встают.
    expect(options.every((move) => move.y < 2 || move.strike === true)).toBe(true);
    expect(options.some((move) => move.strike)).toBe(false);
    expect(document.querySelectorAll('.board-bandline').length).toBe(1);
    // Клетка хода берётся по координатам, а не по подписи: подпись меняется,
    // когда ход взятие. Ряды в разметке идут сверху вниз, поэтому индекс ряда
    // считается от верхнего края поля. Любой легальный ход теперь безопасен по
    // краю: сдвиг ряда короля не трогает.
    const picked = options[0];
    const target = { x: initial.player.x + picked.dx, y: initial.player.y + (picked.dy ?? 1) };
    const cells = [...grid.querySelectorAll('[role=\"gridcell\"]')] as HTMLButtonElement[];
    const cell = cells[(initial.height - 1 - target.y) * initial.width + target.x];
    expect(cell.disabled).toBe(false);
    fireEvent.click(cell);
    await waitFor(() => expect(screen.getByText('Ходы 1')).toBeTruthy());
    // Журнал уходит на сервер пачкой с задержкой: ждём именно вызов сохранения.
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/save'))).toBe(true));
    const sent = calls.filter((call) => call.url.endsWith('/save')).at(-1);
    const action = (sent?.body as { actions?: { dx?: number; dy?: number }[] } | undefined)?.actions?.[0];
    expect(action?.dx).toBe(picked.dx);
    // Шаг вверх в журнале пишется без dy: прежние партии от этого не разъезжаются.
    expect(action?.dy).toBe(picked.dy === 1 ? undefined : picked.dy);
  });

  it('запускает забег, рисует поле и делает ход', async () => {
    await boot();
    expect(legalMoves(initial).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText(/^(Продолжить|Играть)$/).closest('button')!);
    expect(await screen.findByText('Начать')).toBeTruthy();
    expect(screen.getAllByText('Уровень 1').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Начать'));
    const grid = await screen.findByRole('grid', { name: 'Игровое поле' });
    // Поле первого уровня 3×4: ряд запаса нужен, чтобы забег не кончался за два хода.
    expect(grid.querySelectorAll('[role="gridcell"]').length).toBe(12);
    expect(screen.getByText('Ход 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }));
    // На время хода фигур кнопки остаются на месте и только блокируются,
    // иначе доска то сжимается, то растягивается под каждым нажатием.
    const row = document.querySelector('.move-row');
    const buttons = [...(row?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
    expect(buttons.length).toBe(3);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    await waitFor(() => expect(screen.getByText('Ход 2')).toBeTruthy());
    expect([...(document.querySelectorAll('.move-row button') ?? [])].length).toBe(3);
    expect(calls.some((call) => call.url === '/api/run/start')).toBe(true);
  });

  it('показывает экран победы с наградой', async () => {
    initial = {
      ...initial,
      width: 3,
      height: 3,
      player: { x: 1, y: 1 },
      enemies: [],
      moves: 1,
      status: 'playing',
    };
    await boot();
    fireEvent.click(screen.getByText(/^(Продолжить|Играть)$/).closest('button')!);
    fireEvent.click(await screen.findByText('Начать'));
    await screen.findByRole('grid', { name: 'Игровое поле' });
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }));

    expect(await screen.findByText('Пешка дошла', undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getAllByText('Следующий уровень').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+10').length).toBeGreaterThan(0);
    expect(screen.getByText('Бросить вызов')).toBeTruthy();
  });

  it('показывает поражение и предложение рекламы', async () => {
    finishOutcome = {
      ...finishOutcome,
      outcome: 'lost',
      capturedBy: 'rook',
      lives: 4,
      coinsEarned: 0,
      levelUp: false,
      nextLevel: 1,
      maxLevel: 1,
      score: 0,
    };
    initial = {
      ...initial,
      width: 4,
      height: 4,
      player: { x: 1, y: 0 },
      enemies: [{ id: 'rook-1', type: 'rook', x: 0, y: 1 }],
      moves: 0,
      status: 'playing',
    };
    await boot();
    fireEvent.click(screen.getByText(/^(Продолжить|Играть)$/).closest('button')!);
    fireEvent.click(await screen.findByText('Начать'));
    await screen.findByRole('grid', { name: 'Игровое поле' });
    fireEvent.click(screen.getByRole('button', { name: 'Вправо' }));

    expect(await screen.findByText('Пешка поймана', undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText(/Минус одна жизнь/)).toBeTruthy();
    expect(screen.getByText('Переиграть это поле')).toBeTruthy();
    expect(screen.getByText('Новый уровень')).toBeTruthy();
    expect(screen.getByText('Смотреть рекламу за жизнь')).toBeTruthy();
  });

  it('открывает условия и политику из меню и магазина', async () => {
    await boot();
    fireEvent.click(screen.getByRole('button', { name: 'Условия' }));
    expect(await screen.findByText('Условия использования')).toBeTruthy();
    expect(screen.getByText('1. О сервисе')).toBeTruthy();
    expect(screen.getByText(/Виртуальные ценности/)).toBeTruthy();

    // переключение внутри правового экрана
    fireEvent.click(screen.getByRole('button', { name: 'Политика конфиденциальности' }));
    expect(await screen.findByText('Политика конфиденциальности')).toBeTruthy();
    expect(screen.getByText('1. Какие данные мы получаем')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('против всех')).toBeTruthy();

    fireEvent.click(screen.getByText(/Бонусы за монеты/).closest('button')!);
    expect(await screen.findByText('Бонусы на партию')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Конфиденциальность' }));
    expect(await screen.findByText('Политика конфиденциальности')).toBeTruthy();
    expect(screen.getByText('5. Где хранятся данные')).toBeTruthy();
  });

  it('покупает бонус в магазине', async () => {
    await boot();
    fireEvent.click(screen.getByText(/Бонусы за монеты/).closest('button')!);
    await screen.findByText('Бонусы на партию');
    fireEvent.click(screen.getAllByRole('button', { name: 'Купить' })[0]);
    await waitFor(() => expect(screen.getByText(/в запасе 1/)).toBeTruthy());
    expect(screen.getByText('10')).toBeTruthy();
    expect(calls.some((call) => call.url === '/api/shop/bonus')).toBe(true);
  });
});
