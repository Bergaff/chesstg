// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const overview = {
  generatedAt: Date.now(),
  days: 14,
  totals: {
    users: 12,
    guests: 3,
    telegram: 9,
    adFree: 1,
    coins: 420,
    played: 10,
    endlessUnlocked: 2,
    endlessPlayed: 4,
    topLevel: 17,
    topEndless: 23,
  },
  series: {
    newUsers: [{ day: '2026-10-19', value: 4 }],
    activeUsers: [{ day: '2026-10-19', value: 6 }],
    runs: [{ day: '2026-10-19', started: 8, won: 5, lost: 2, quit: 1 }],
  },
  retention: { cohort: 10, d1: 4, d7: 1, d1Rate: 0.4, d7Rate: 0.1 },
  runs: { total: 20, ended: 18, won: 12, winRate: 0.67, campaign: [], endless: [] },
  economy: {
    coinsEarned: 300,
    coinsSpent: 120,
    livesLost: 7,
    purchases: 2,
    starsEarned: 175,
    refunds: 0,
    bonusesUsed: 9,
    adEvents: [{ kind: 'coins', n: 4 }],
  },
  payments: [{ sku: 'noads', status: 'paid', n: 1, stars: 150 }],
  funnel: [{ level: 1, n: 5 }],
  levels: [{ level: 1, played: 6, won: 5, winRate: 0.83 }],
  endlessBuckets: [{ bucket: '0', n: 8 }],
  topPlayers: [{ id: 'u1', name: 'Игрок', username: 'pawn', level: 17, best: 23, coins: 90 }],
  recentUsers: [
    { id: 'u2', name: 'Новый', username: null, isGuest: 1, level: 1, best: 0, createdAt: Date.now() },
  ],
};

const levels = { checks: [], reports: [] };

let statusResponse: unknown = { configured: true, authenticated: false, expiresAt: null };
let loginResponse: () => Response = () => jsonResponse({ token: 'token-1', expiresAt: Date.now() + 3_600_000 });

beforeEach(() => {
  statusResponse = { configured: true, authenticated: false, expiresAt: null };
  loginResponse = () => jsonResponse({ token: 'token-1', expiresAt: Date.now() + 3_600_000 });
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/admin/status')) return jsonResponse(statusResponse);
      if (url.endsWith('/api/admin/login')) return loginResponse();
      if (url.includes('/api/admin/overview')) return jsonResponse(overview);
      if (url.includes('/api/admin/levels')) return jsonResponse(levels);
      return jsonResponse({ ok: true });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  const { default: AdminApp } = await import('../src/admin/AdminApp');
  render(createElement(AdminApp));
}

describe('админка', () => {
  it('показывает предупреждение, когда доступ не настроен', async () => {
    statusResponse = { configured: false, authenticated: false, expiresAt: null };
    await mount();
    expect(await screen.findByText('Доступ не настроен')).toBeTruthy();
    expect(screen.getAllByText(/ADMIN_PASSWORD/).length).toBeGreaterThan(0);
  });

  it('пускает только по паролю и показывает статистику', async () => {
    await mount();
    expect(await screen.findByText('Вход в админку')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Введите пароль'), { target: { value: 'pawn-admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Обзор')).toBeTruthy();
    expect(screen.getByText('Админка')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Игроков').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Побед').length).toBeGreaterThan(0);
  });

  it('сообщает об ошибке пароля', async () => {
    loginResponse = () =>
      jsonResponse({ error: 'bad_password', message: 'Неверный пароль', attemptsLeft: 6 }, 401);
    await mount();
    await screen.findByText('Вход в админку');

    fireEvent.change(screen.getByPlaceholderText('Введите пароль'), { target: { value: 'неверный' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Неверный пароль');
    expect(screen.queryByText('Обзор')).toBeNull();
  });

  it('переключается на вкладку уровней', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Уровни' }));
    expect(await screen.findByText('Проверка генератора')).toBeTruthy();
    expect(screen.queryByText('Лаборатория расстановок')).toBeNull();
  });

  it('держит лабораторию отдельной вкладкой', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));
    expect(await screen.findByText('Лаборатория расстановок')).toBeTruthy();
    expect(screen.getByText('Запустить разбор')).toBeTruthy();
    expect(screen.getByText('Сохранённые отчёты')).toBeTruthy();
  });
});
