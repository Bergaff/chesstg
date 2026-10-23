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

const botStatus = {
  configured: true,
  expectedUrl: 'https://pawn.workers.dev/api/telegram/webhook',
  appUrl: 'https://pawn.workers.dev',
  webappUrl: 'https://pawn.workers.dev',
  webappUrlOk: true,
  secretSet: true,
  devMode: false,
  checkedAt: Date.now(),
  username: 'pawn_vs_all_bot',
  webhook: { url: 'https://pawn.workers.dev/api/telegram/webhook', pending: 0, lastError: '', lastErrorAt: null },
  botError: '',
};

const levelStats = {
  mode: 'jam',
  days: 30,
  rows: [
    {
      level: 1,
      played: 30,
      players: 21,
      won: 24,
      lost: 5,
      quit: 1,
      active: 0,
      stuck: 0,
      winRate: 0.8,
      attemptsPerPlayer: 1.43,
      avgMoves: 6.2,
      avgScore: 12,
      hints: 4,
      freezes: 0,
      undos: 1,
      firstAt: Date.now() - 86_400_000,
      lastAt: Date.now(),
    },
    {
      level: 2,
      played: 24,
      players: 12,
      won: 5,
      lost: 18,
      quit: 1,
      active: 0,
      stuck: 3,
      winRate: 0.208,
      attemptsPerPlayer: 2,
      avgMoves: 9.4,
      avgScore: 8,
      hints: 11,
      freezes: 2,
      undos: 6,
      firstAt: Date.now() - 3 * 86_400_000,
      lastAt: Date.now() - 60_000,
    },
  ],
};

const usersList = {
  total: 2,
  page: 0,
  pageSize: 25,
  degraded: false,
  rows: [
    {
      id: 'u1',
      name: 'Игрок',
      username: 'pawn',
      isGuest: 0,
      level: 6,
      maxLevel: 6,
      coins: 120,
      lives: 4,
      best: 18,
      adFree: 0,
      createdAt: Date.now() - 86_400_000,
      updatedAt: Date.now(),
      skin: 'classic',
      runs: 14,
      purchases: 1,
      jamLevel: 3,
      jamMax: 4,
      raceLevel: 2,
      raceMax: 2,
    },
  ],
};

const userDetail = {
  user: {
    id: 'u1',
    first_name: 'Игрок',
    username: 'pawn',
    level: 6,
    max_level: 6,
    coins: 120,
    lives: 4,
    endless_best: 18,
    created_at: Date.now() - 86_400_000,
    mode_levels: JSON.stringify({ jam: { level: 3, maxLevel: 4 }, race: { level: 2, maxLevel: 2 } }),
  },
  progress: {
    campaign: { level: 6, maxLevel: 6, unlocked: true, unlockAtLevel: 1 },
    jam: { level: 3, maxLevel: 4, unlocked: true, unlockAtLevel: 3 },
    race: { level: 2, maxLevel: 2, unlocked: true, unlockAtLevel: 5 },
    endless: { level: 0, maxLevel: 0, unlocked: false, unlockAtLevel: 11 },
  },
  runs: [
    {
      id: 'r1',
      mode: 'jam',
      level: 3,
      seed: 4242,
      moves: 9,
      score: 0,
      status: 'lost',
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now() - 30_000,
      outcome: 'lost',
      capturedBy: 'rook',
      stuck: false,
      coinsEarned: 0,
      levelUp: false,
      modeLevel: 3,
    },
  ],
  history: [
    { mode: 'jam', level: 3, played: 4, won: 1, lost: 2, quit: 1, avgMoves: 8.5, firstAt: Date.now() - 4000, lastAt: Date.now() - 1000 },
    { mode: 'jam', level: 2, played: 2, won: 2, lost: 0, quit: 0, avgMoves: 5, firstAt: Date.now() - 9000, lastAt: Date.now() - 8000 },
  ],
  grants: [{ kind: 'hint', source: 'purchase', n: 3, firstAt: Date.now() - 5000, lastAt: Date.now() - 1000 }],
  ads: [{ kind: 'life', n: 2 }],
  byMode: [{ mode: 'jam', n: 6 }, { mode: 'campaign', n: 8 }],
  payments: [{ chargeId: 'p1', sku: 'lives', stars: 25, status: 'paid', createdAt: Date.now(), paidAt: Date.now() }],
  events: [{ kind: 'run_finish', value: '{}', createdAt: Date.now() }],
};

let statusResponse: unknown = { configured: true, authenticated: false, expiresAt: null };
let healthResponse: unknown = { ok: true, schemaVersion: 2, warnings: [], tables: { users: true } };
let loginResponse: () => Response = () => jsonResponse({ token: 'token-1', expiresAt: Date.now() + 3_600_000 });

beforeEach(() => {
  statusResponse = { configured: true, authenticated: false, expiresAt: null };
  healthResponse = { ok: true, schemaVersion: 2, warnings: [], tables: { users: true } };
  loginResponse = () => jsonResponse({ token: 'token-1', expiresAt: Date.now() + 3_600_000 });
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/health')) return jsonResponse(healthResponse);
      if (url.endsWith('/api/admin/status')) return jsonResponse(statusResponse);
      if (url.endsWith('/api/admin/login')) return loginResponse();
      if (url.includes('/api/admin/overview')) return jsonResponse(overview);
      if (url.includes('/api/admin/levels/stats')) return jsonResponse(levelStats);
      if (url.includes('/api/admin/levels')) return jsonResponse(levels);
      if (url.includes('/api/admin/users/')) return jsonResponse(userDetail);
      if (url.includes('/api/admin/users')) return jsonResponse(usersList);
      if (url.includes('/api/admin/bot')) return jsonResponse(botStatus);
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

  it('не пускает в админку, пока в базе нет таблиц', async () => {
    healthResponse = {
      ok: false,
      error: 'db_not_ready',
      missing: ['users', 'runs'],
      schemaVersion: 2,
      warnings: [],
    };
    await mount();
    expect(await screen.findByText('База не готова')).toBeTruthy();
    expect(screen.getAllByText(/npm run db:remote/).length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText('Введите пароль')).toBeNull();
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

  it('показывает прохождения по уровням и помечает сложные', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Прохождения' }));
    expect(await screen.findByText('Прохождения по уровням')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Забегов').length).toBeGreaterThan(0));
    // Второй уровень: 20.8% побед и три тупика.
    expect(screen.getByText('тяжело')).toBeTruthy();
    expect(screen.getByText('край')).toBeTruthy();
    const note = screen.getByText((_content, element) => element?.classList.contains('adm-stats-note') === true);
    expect(note.textContent).toContain('уровней с провалами 1');
    expect(note.textContent).toContain('уровней с долей побед ниже 25% 1');
    expect(note.textContent).toContain('край прохождения уровень 2');
  });

  it('в карточке игрока видно прогресс режимов и пройденные уровни', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Игроки' }));
    expect(await screen.findByText('@pawn')).toBeTruthy();
    // В списке колонки прогресса: 3 из 4 в «Парковке».
    expect(screen.getByText(/из 4/)).toBeTruthy();

    fireEvent.click(screen.getByText('@pawn').closest('tr')!);
    expect(await screen.findByText('Прогресс по режимам')).toBeTruthy();
    expect(screen.getByText('3 из 4')).toBeTruthy();
    expect(screen.getByText('откроется на 11 уровне кампании')).toBeTruthy();
    expect(await screen.findByText('Какие уровни проходил')).toBeTruthy();
    expect(screen.getAllByText('Парковка').length).toBeGreaterThan(0);
    // Итог забега разворачивается в слово, а не в сырой JSON результата.
    expect(screen.getByText('пойман (ладья)')).toBeTruthy();
    expect(screen.getByText('Бонусы и реклама')).toBeTruthy();
    expect(screen.getByText('Просмотров')).toBeTruthy();
    expect(screen.getByText('жизнь')).toBeTruthy();
  });

  it('переключается на вкладку уровней', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Уровни' }));
    expect(await screen.findByText('Проверка генератора')).toBeTruthy();
    expect(screen.queryByText('Лаборатория расстановок')).toBeNull();
  });

  it('показывает состояние бота и предупреждает о выключенном токене', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Бот' }));
    expect(await screen.findByText('@pawn_vs_all_bot')).toBeTruthy();
    expect(screen.getByText('Подключить бота')).toBeTruthy();
  });

  it('держит лабораторию отдельной вкладкой', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));
    expect(await screen.findByText('Лаборатория расстановок')).toBeTruthy();
    expect(screen.getByText('Запустить разбор')).toBeTruthy();
    expect(screen.getByText('Сохранённые отчёты')).toBeTruthy();
    // Прогоны это часть лаборатории, и окно у них одно: вкладки переключают
    // таблицу и подпись запуска, а не плодят карточки.
    expect(screen.getByText('Прогоны: кампания, парковка, гонки')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Диагональ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Парковка' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Гонки' })).toBeTruthy();
    expect(screen.getByText('Кампания: диагональ только бить или свободно')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сравнить диагональ' })).toBeTruthy();
    // Две другие таблицы скрыты, пока на них не перешли: окон больше одного нет.
    expect(screen.queryByText('Парковка: сложность и реиграбельность')).toBeNull();
    expect(screen.queryByText('Гонки: сколько можно играть до нерешаемой позиции')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Парковка' }));
    expect(screen.getByText('Парковка: сложность и реиграбельность')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Замерить генератор (7)' })).toBeTruthy();
    expect(screen.queryByText('Кампания: диагональ только бить или свободно')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Гонки' }));
    expect(screen.getByText('Гонки: сколько можно играть до нерешаемой позиции')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Прогнать гонки (7)' })).toBeTruthy();
    // Списка режимов с галочками больше нет: варианты фиксированы прогонами.
    expect(screen.queryByRole('checkbox', { name: 'Гонки на уклонение' })).toBeNull();
  });

  it('сравнивает диагональ и отдаёт текст одним блоком', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));
    // Минимум досок: прогон обязан закончиться внутри теста.
    fireEvent.change(screen.getByLabelText('Досок на вариант'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Сравнить диагональ' }));

    const text = await screen.findByText(/^Кампания: диагональ свободно или только бить/, undefined, { timeout: 30_000 });
    expect(text.textContent).toContain('| Режим | Поле | С решением |');
    expect(text.textContent).toContain('Кампания, диагональ свободна');
    expect(text.textContent).toContain('Кампания, диагональ только для взятия');
    await waitFor(() => expect(screen.queryByText('считаем')).toBeNull(), { timeout: 30_000 });
  }, 60_000);

  it('меряет боевую «Парковку» длиной плана решателя', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));

    // У боевого режима своя метрика: не доля побед, а длина плана, развилки и
    // разнообразие расстановок. Окно прогонов одно, поэтому сначала вкладка.
    fireEvent.click(await screen.findByRole('button', { name: 'Парковка' }));
    expect(screen.getByLabelText('Уровни для «Парковки» и «Гонок»')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Сверх бюджета' })).toBeTruthy();
    // Таблица одна на все прогоны: колонка реиграбельности встречается один раз,
    // а не по разу на каждую карточку.
    expect(screen.getAllByRole('columnheader', { name: 'Реиграбельность' })).toHaveLength(1);
    expect(screen.getByRole('columnheader', { name: 'Развилка' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Прощение' })).toBeTruthy();
    // Два уровня и минимум досок: прогон обязан закончиться внутри теста, иначе
    // панель допишет состояние уже после разборки окружения.
    fireEvent.change(screen.getByLabelText('Уровни для «Парковки» и «Гонок»'), { target: { value: '1,6' } });
    fireEvent.change(screen.getByLabelText('Досок на вариант'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Замерить генератор (2)' }));

    const text = await screen.findByText(/^Замер генератора «Парковки»/, undefined, { timeout: 30_000 });
    expect(text.textContent).toContain('«План, ходы» - длина решения решателя');
    await waitFor(() => expect(screen.queryByText('считаем')).toBeNull(), { timeout: 30_000 });
    // Решаемость у генератора обязана быть полной: план ищет решатель, а не удача.
    expect(screen.getAllByText('100.0%').length).toBe(2);
  }, 60_000);

  it('меряет «Гонки» длиной партии до нерешаемой позиции', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Гонки' }));
    fireEvent.change(screen.getByLabelText('Уровни для «Парковки» и «Гонок»'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Досок на вариант'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Прогнать гонки (1)' }));

    const text = await screen.findByText(/^Прогон «Гонок»/, undefined, { timeout: 60_000 });
    // Метрика - ходы до позиции, где перебор не оставляет ни одного спасения.
    expect(text.textContent).toContain('До нерешаемой (медиана)');
    expect(text.textContent).toContain('Чем кончились');
  }, 90_000);
});
