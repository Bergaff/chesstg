// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createCampaignLevel, legalMoves, type GameState } from '../src/engine';
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
  inviteCode: 'abc12345',
  createdAt: Date.now(),
  prices: { hint: 20, freeze: 30, undo: 15 },
};

const config: AppConfig = {
  botUsername: 'pawn_vs_all_bot',
  webappUrl: 'https://example.com',
  allowGuests: true,
  devMode: true,
  demoAds: false,
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
  initial = createCampaignLevel(1, SEED);
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
      if (url === '/api/run/start') return jsonResponse({ resumed: false, run: { ...run, initial } });
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

  it('запускает забег, рисует поле и делает ход', async () => {
    await boot();
    expect(legalMoves(initial).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText(/^(Продолжить|Играть)$/).closest('button')!);
    expect(await screen.findByText('Начать')).toBeTruthy();
    expect(screen.getAllByText('Уровень 1').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Начать'));
    const grid = await screen.findByRole('grid', { name: 'Игровое поле' });
    expect(grid.querySelectorAll('[role="gridcell"]').length).toBe(9);
    expect(screen.getByText('Ход 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }));
    await waitFor(() => expect(screen.getByText('Ход 2')).toBeTruthy());
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
    fireEvent.click(screen.getByRole('button', { name: 'Вправо-вперёд' }));

    expect(await screen.findByText('Пешка поймана', undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText(/Минус одна жизнь/)).toBeTruthy();
    expect(screen.getByText('Ещё раз')).toBeTruthy();
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
