// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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

/** Тема, которую автоматическая проверка пропускает: контраст и плашка в норме. */
const readableTokens = {
  piece: '#ffd9a0',
  plate: '#2b1a12',
  edge: '#c9762f',
  cellLight: '#2b2018',
  cellDark: '#221911',
  frame: '#191009',
  backdrop: '#140c07',
  wash: '#3b2416',
};

const skinQueue = {
  status: 'pending',
  items: [
    {
      id: 1,
      name: 'Закат',
      author: '@sunset',
      userId: 'u1',
      chargeId: 'charge-1',
      installs: 2,
      createdAt: 1_760_000_000_000,
      reviewedAt: null,
      note: '',
      broken: false,
      skin: { name: 'Закат', glyph: '♟', tokens: readableTokens },
      readability: { glyph: 9.4, board: 7.1, ok: true },
    },
    {
      id: 2,
      name: 'Клякса',
      author: '@ink',
      userId: 'u2',
      chargeId: 'charge-2',
      installs: 0,
      createdAt: 1_760_000_100_000,
      reviewedAt: null,
      note: '',
      broken: false,
      skin: null,
      readability: { glyph: 1.2, board: 1.4, ok: false },
    },
    {
      id: 3,
      name: 'Сломанная',
      author: '@broken',
      userId: 'u3',
      chargeId: null,
      installs: 0,
      createdAt: 1_760_000_200_000,
      reviewedAt: null,
      note: '',
      broken: true,
      skin: null,
      readability: null,
    },
  ],
  counts: [
    { status: 'pending', n: 3, installs: 2 },
    { status: 'approved', n: 4, installs: 11 },
  ],
};

/**
 * Темы игроков по слотам: у проверяющего здесь все купленные места, а не только
 * те, что автор принёс в очередь.
 */
const ownedSkins = {
  items: [
    {
      userId: 'u1',
      tgId: 11,
      author: '@sunset',
      slot: 1,
      active: true,
      worn: true,
      blocked: false,
      name: 'Гроза',
      skin: { name: 'Гроза', glyph: '♟', tokens: readableTokens },
      readability: { glyph: 9.4, board: 7.1, ok: true },
      published: 1,
      queued: 0,
      updatedAt: 1_760_000_300_000,
    },
  ],
  query: '',
  summary: { players: 40, owners: 6, blocked: 1, shown: 1 },
};

const shopEcon = {
  days: 30,
  shopOpens: 600,
  newPlayers: 120,
  paidCount: 18,
  paidStars: 420,
  payers: 14,
  refundedCount: 1,
  bySku: [
    { sku: 'skins', n: 6, stars: 300 },
    { sku: 'lives', n: 12, stars: 120 },
  ],
  queue: [
    { status: 'pending', n: 3, installs: 2 },
    { status: 'approved', n: 4, installs: 11 },
  ],
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
      if (url.includes('/api/admin/skins/review')) return jsonResponse({ ok: true, updated: 1 });
      if (url.includes('/api/admin/skins/block')) return jsonResponse({ ok: true, blocked: true });
      if (url.includes('/api/admin/skins/owned')) return jsonResponse(ownedSkins);
      if (url.includes('/api/admin/skins')) return jsonResponse(skinQueue);
      if (url.includes('/api/admin/shop/econ')) return jsonResponse(shopEcon);
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

/**
 * Занятые ячейки расчёта. Раньше искали по тексту всего документа - и любая
 * проза со словом «считаем» в соседней панели вешала waitFor на свои 30 секунд,
 * потому что «занято» выглядело сказанным. Смотрим туда, где мигает настоящий
 * статус перебора: клетки таблиц и кнопки запуска.
 */
function busyCells(): Element[] {
  return Array.from(document.querySelectorAll('.adm-table td, .adm-table th, .adm-btn')).filter((node) =>
    /^считаем/i.test(node.textContent ?? ''),
  );
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
    expect(screen.getByRole('button', { name: 'Движение и темп' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Парковка' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Гонки' })).toBeTruthy();
    expect(screen.getByText('Кампания: три направления против «только вперёд», темп «все» против «одна»')).toBeTruthy();
    // Подпись запуска показывает число прогонов: четыре правила на каждый из
    // семи уровней лесенки, а не семь.
    expect(screen.getByRole('button', { name: /^Сравнить движение и темп \(28\)/ })).toBeTruthy();
    // Две другие таблицы скрыты, пока на них не перешли: окон больше одного нет.
    expect(screen.queryByText('Парковка: сложность и реиграбельность')).toBeNull();
    expect(screen.queryByText('Гонки: сколько можно играть до нерешаемой позиции')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Парковка' }));
    expect(screen.getByText('Парковка: сложность и реиграбельность')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Замерить генератор (7)' })).toBeTruthy();
    expect(screen.queryByText('Кампания: три направления против «только вперёд», темп «все» против «одна»')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Гонки' }));
    expect(screen.getByText('Гонки: сколько можно играть до нерешаемой позиции')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Прогнать гонки (7)' })).toBeTruthy();
    // Списка режимов с галочками больше нет: варианты фиксированы прогонами.
    expect(screen.queryByRole('checkbox', { name: 'Гонки на уклонение' })).toBeNull();

    // «Правила гонок» - четвёртый прогон в том же окне: новой карточки он не
    // заводит, и окно по-прежнему одно (пользователь просил не плодить секции).
    fireEvent.click(screen.getByRole('button', { name: 'Правила гонок' }));
    expect(screen.getByText('Гонки: темп ответа фигур и вскрытые взятия')).toBeTruthy();
    expect(document.querySelectorAll('.adm-suite').length).toBe(1);
    // Строка на пару «уровень × правило»: семь уровней по четыре правила.
    expect(screen.getByRole('button', { name: /^Сравнить правила \(28\)/ })).toBeTruthy();
    // Ставка награды за взятие живёт рядом с досками и зерном, а не в новом окне.
    expect(screen.getByLabelText('Монет за взятие')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Движение и темп' }));
    expect(screen.queryByLabelText('Монет за взятие')).toBeNull();
  });

  it('меряет правила «Гонок» и проектирует награду за взятие', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));

    fireEvent.change(screen.getByLabelText('Досок на вариант'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Лестница уровней'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Правила гонок' }));
    fireEvent.change(screen.getByLabelText('Монет за взятие'), { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Сравнить правила \(4\)/ }));

    const text = await screen.findByText(/^Отчёт лаборатории: Гонки: темп ответа/, undefined, { timeout: 120_000 });
    // Правило стало строкой таблицы: без колонки «Правило» четыре набора слиплись бы.
    expect(text.textContent).toContain('| Уровень | Правило |');
    for (const name of [
      'Гонки',
      'Гонки: одна фигура за такт',
      'Гонки: фигуры по кругу',
      'Гонки: вскрытые взятия разрешены',
    ]) {
      expect(text.textContent).toContain(name);
    }
    // Потолок длины прогона печатается в шапке: медленный темп партии не кончает,
    // и цифра «240 хода» без потолка выглядела бы как длина партии.
    expect(text.textContent).toContain('потолок длины забега 240 ходов');
    expect(text.textContent).toContain('Сводка по правилам');
    // Проекция награды: ставка 3 монеты за взятие обязана дать стрелку «было → стало».
    expect(text.textContent).toMatch(/\d+ → \d+/);
    const items = screen.getAllByRole('listitem');
    expect(items.some((item) => /фигур за такт/.test(item.textContent ?? ''))).toBe(true);
    expect(
      items.some((item) => /потолок \d+ ходов|потолок длины/.test(item.textContent ?? '')),
    ).toBe(true);
    await waitFor(
      () => {
        const stuck = busyCells();
        if (stuck.length > 0) throw new Error(`полоса прогресса не ушла: ${stuck.map((node) => node.textContent).join(' / ')}`);
      },
      { timeout: 30_000 },
    );
  }, 180_000);

  it('сравнивает движение и темп и отдаёт текст одним блоком', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));
    // Два уровня и минимум досок: прогон обязан закончиться внутри теста. На
    // каждом уровне считаются четыре правила, поэтому кнопок не семь, а восемь.
    fireEvent.change(screen.getByLabelText('Досок на вариант'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Лестница уровней'), { target: { value: '6,20' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Сравнить движение и темп \(8\)/ }));

    // Отчёт начинается с шапки, а строки таблиц ищутся внутри неё.
    const text = await screen.findByText(/^Отчёт лаборатории: Кампания/, undefined, { timeout: 60_000 });
    expect(text.textContent).toContain('Кампания: три направления или только вперёд');
    expect(text.textContent).toContain('уровни 6,20');
    expect(text.textContent).toContain('| Уровень | Режим | Поле | С решением |');
    // Правило сравнивается на каждом уровне лесенки: четыре строки на уровень,
    // поле 6-го уровня - 4x6, поле 20-го - 5x8, а не одно 4x6 на весь прогон.
    expect(text.textContent).toMatch(/\| 6 \| Кампания \| 4x6 \|/);
    expect(text.textContent).toMatch(/\| 20 \| Кампания: только вперёд, темп одна \| 5x8 \|/);
    // Выводы панель показывает и под таблицей списком, и в отчёте - проверяем
    // именно список: он начинается с того, на скольких уровнях снято сравнение.
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items[0].textContent).toContain('Сравнение снято на 2 уровнях');
    await waitFor(() => expect(busyCells()).toHaveLength(0), { timeout: 30_000 });
  }, 60_000);

  it('тяжёлый расчёт на 1000 досок отдаёт отчёт с выводами', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));

    // Гонки: самый дешёвый из трёх прогонов, 1000 досок на правило считается
    // секунды. Один уровень, иначе тест ждёт лестницу.
    fireEvent.click(await screen.findByRole('button', { name: 'Гонки' }));
    fireEvent.change(screen.getByLabelText('Лестница уровней'), { target: { value: '10' } });
    fireEvent.click(await screen.findByRole('button', { name: /Расчёт на 1000 досок/ }));

    const text = await screen.findByText(/^Отчёт лаборатории: Гонки/, undefined, { timeout: 120_000 });
    expect(text.textContent).toContain('по 1000 забегов на уровень и на правило');
    expect(text.textContent).toContain('тяжёлый расчёт на 1000 досок');
    expect(text.textContent).toContain('считалось');
    // Выводы панель считает из цифр прогона: без них отчёт в чате приходится
    // дописывать руками, и первое, что в нём появляется, - ожидание автора.
    expect(text.textContent).toContain('Выводы:');
    expect(text.textContent).toContain('Длина решаемой партии от уровня не зависит');
    expect(text.textContent).toContain('Выпад через линию');
    expect(text.textContent).toContain('Исходы 1000 забегов');
    await waitFor(
      () => {
        const stuck = busyCells();
        if (stuck.length > 0) throw new Error(`полоса прогресса не ушла: ${stuck.map((node) => node.textContent).join(' / ')}`);
      },
      { timeout: 30_000 },
    );
  }, 180_000);

  it('меряет боевую «Парковку» длиной плана решателя', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));

    // У боевого режима своя метрика: не доля побед, а длина плана, развилки и
    // разнообразие расстановок. Окно прогонов одно, поэтому сначала вкладка.
    fireEvent.click(await screen.findByRole('button', { name: 'Парковка' }));
    expect(screen.getByLabelText('Лестница уровней')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Сверх бюджета' })).toBeTruthy();
    // Таблица одна на все прогоны: колонка реиграбельности встречается один раз,
    // а не по разу на каждую карточку.
    expect(screen.getAllByRole('columnheader', { name: 'Реиграбельность' })).toHaveLength(1);
    expect(screen.getByRole('columnheader', { name: 'Развилка' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Прощение' })).toBeTruthy();
    // Два уровня и минимум досок: прогон обязан закончиться внутри теста, иначе
    // панель допишет состояние уже после разборки окружения.
    fireEvent.change(screen.getByLabelText('Лестница уровней'), { target: { value: '1,6' } });
    fireEvent.change(screen.getByLabelText('Досок на вариант'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Замерить генератор (2)' }));

    const text = await screen.findByText(/^Отчёт лаборатории: Парковка/, undefined, { timeout: 30_000 });
    expect(text.textContent).toContain('Замер генератора «Парковки»');
    expect(text.textContent).toContain('«План, ходы» - длина решения решателя');
    await waitFor(() => expect(busyCells()).toHaveLength(0), { timeout: 30_000 });
    // Решаемость у генератора обязана быть полной: план ищет решатель, а не удача.
    expect(screen.getAllByText('100.0%').length).toBe(2);
  }, 60_000);

  it('держит прогон диапазона собранным до запуска', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));

    // Панель обязана показывать замысел до первой строки отчёта: без этого
    // «Прогнать» выглядит как кнопка, которая неизвестно что считает.
    expect(await screen.findByText('Прогон всего диапазона')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Прогнать L1-L60/ })).toBeTruthy();
    expect(screen.getByText(/60 уровней × 400 = до 24\s?000 расстановок/)).toBeTruthy();
    expect(screen.queryByText('Уровней разобрано')).toBeNull();

    // Подпись кнопки обязана следовать за полями: «Прогнать L1-L60» на
    // диапазоне 1-5 означало бы, что кнопка и прогон разные вещи.
    fireEvent.change(screen.getByLabelText('По'), { target: { value: '5' } });
    expect(screen.getByRole('button', { name: /Прогнать L1-L5/ })).toBeTruthy();
    expect(screen.getByText(/5 уровней × 400 = до 2\s?000 расстановок/)).toBeTruthy();
    // Кнопок «Сохранить отчёт» на странице две (одиночный разбор и диапазон):
    // проверяем ту, что внутри этой панели.
    const panel = (await screen.findByText('Прогон всего диапазона')).closest('section') as HTMLElement;
    const save = within(panel).getByRole('button', { name: 'Сохранить отчёт' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('прогоняет диапазон уровней и показывает сводку', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));
    const panel = (await screen.findByText('Прогон всего диапазона')).closest('section') as HTMLElement;

    // Два уровня: в jsdom нет Worker, и это как раз проверка запасного пути -
    // цикла с уступкой потока. На L1-L2 перебор полный и заканчивается сам.
    fireEvent.change(screen.getByLabelText('По'), { target: { value: '2' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Прогнать L1-L2/ }));

    expect(await within(panel).findByText(/Диапазон L1-L2: 2 уровня, 6\d расстановки/, undefined, { timeout: 60_000 })).toBeTruthy();
    expect(within(panel).getByText('2 / 2')).toBeTruthy();
    // Ни одна строка не осталась «в очереди»: прогон обязан закрыть все уровни.
    expect(within(panel).queryByText('в очереди')).toBeNull();
    expect(within(panel).getAllByText('L1').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('L2').length).toBeGreaterThan(0);
    // Сохранение разблокируется только когда есть что сохранять.
    expect((within(panel).getByRole('button', { name: 'Сохранить отчёт' }) as HTMLButtonElement).disabled).toBe(false);
  }, 90_000);

  it('меряет «Гонки» длиной партии до нерешаемой позиции', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Гонки' }));
    fireEvent.change(screen.getByLabelText('Лестница уровней'), { target: { value: '10' } });
    // Обе ветки сравнения считают ровно столько досок, сколько запрошено: делить
    // запрос пополам - значит соврать в заголовке отчёта.
    fireEvent.change(screen.getByLabelText('Досок на вариант'), { target: { value: '8' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Прогнать гонки (1)' }));

    const text = await screen.findByText(/^Отчёт лаборатории: Гонки/, undefined, { timeout: 60_000 });
    expect(text.textContent).toContain('Прогон «Гонок»');
    // Метрика - ходы до позиции, где перебор не оставляет ни одного спасения.
    expect(text.textContent).toContain('До нерешаемой (медиана)');
    expect(text.textContent).toContain('Чем кончились');
    expect(text.textContent).toContain('по 8 забегов на уровень и на правило');
    // Причины считаются по тем же забегам, что и вся строка: без знаменателя
    // «поимка 4» читается как потерянная половина прогона.
    expect(text.textContent).toMatch(/\d+ из 8/);
    await waitFor(() => expect(screen.getAllByText(/из 8/).length).toBeGreaterThan(0));
  }, 90_000);

  it('разбирает очередь тем: пропускает читаемую и не даёт одобрить битую', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Темы' }));
    expect(await screen.findByText('Публикации тем')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Закат')).toBeTruthy());

    // Метрики очереди: три заявки ждут проверки, четыре уже опубликованы.
    expect(screen.getByText('Ждут проверки · 3')).toBeTruthy();
    expect(screen.getByText('В галерее · 4')).toBeTruthy();

    const approves = screen.getAllByRole('button', { name: 'Одобрить' });
    const rejects = screen.getAllByRole('button', { name: 'Отклонить' });
    expect(approves).toHaveLength(3);
    expect(rejects).toHaveLength(3);
    expect((approves[0] as HTMLButtonElement).disabled).toBe(false);
    // «Клякса» не проходит проверку контраста, «Сломанная» - payload не читается.
    expect((approves[1] as HTMLButtonElement).disabled).toBe(true);
    expect((approves[2] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('автоматическая проверка не прошла')).toBeTruthy();
    expect(screen.getByText('запись повреждена - одобрить нельзя')).toBeTruthy();
    // Битые строки показывают заглушку доски, а не пустую клетку.
    expect(document.querySelectorAll('.skin-preview.is-broken')).toHaveLength(2);
    // Превью живое: в каждой строке 2x2 клетки и чужая фигура рядом. Четвёртая
    // пара - строка «Темы игроков по слотам»: свой блок тоже показывает образец,
    // потому что оценивать нужно рисунок, а не имя.
    expect(document.querySelectorAll('.skin-preview .sp-cell')).toHaveLength(16);
    expect(document.querySelectorAll('.skin-preview .sp-enemy')).toHaveLength(4);

    // Очередь ловит только то, что автор принёс сам. Жалоба же приходит и на
    // тему, которую человек надел себе, - поэтому вторым блоком идут слоты.
    expect(await screen.findByText('Темы игроков по слотам')).toBeTruthy();
    expect(screen.getByText('Владельцы слотов')).toBeTruthy();
    // Строка «номера слота + автор» - то, по чему модератор и находит аккаунт.
    expect(screen.getByText('Гроза')).toBeTruthy();
    expect(screen.getByText(/id 11/)).toBeTruthy();
    expect(screen.getByText('Тем на полях')).toBeTruthy();
    const block = screen.getByRole('button', { name: 'Заморозить' });
    const blockCalls = () =>
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([url, init]) => String(url).includes('/api/admin/skins/block') && (init as RequestInit)?.method === 'POST',
      );
    fireEvent.click(block);
    await waitFor(() => expect(blockCalls()).toHaveLength(1));
    expect(JSON.parse(String((blockCalls()[0] as [string, RequestInit])[1].body))).toEqual({
      userId: 'u1',
      blocked: true,
      note: 'заморожено модератором',
    });

    const reviewCalls = () =>
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([url, init]) => String(url).includes('/api/admin/skins/review') && (init as RequestInit)?.method === 'POST',
      );
    const sentBody = (call: unknown) => JSON.parse(String((call as [string, RequestInit])[1].body));

    fireEvent.click(approves[0]);
    await waitFor(() => expect(reviewCalls().length).toBe(1));
    expect(sentBody(reviewCalls()[0])).toMatchObject({ id: 1, decision: 'approve', note: '' });

    // Отказ без причины - тоже отказ, но причину игрок увидит, поэтому она в поле.
    fireEvent.change(screen.getAllByPlaceholderText('причина отказа')[2], { target: { value: 'нечего читать' } });
    fireEvent.click(rejects[2]);
    await waitFor(() => expect(reviewCalls().length).toBe(2));
    expect(sentBody(reviewCalls()[1])).toMatchObject({
      id: 3,
      decision: 'reject',
      note: 'нечего читать',
    });
  });

  it('подставляет измерения базы в модель экономики магазина', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));
    expect(await screen.findByText('Что подставляет база')).toBeTruthy();
    // Сама панель в базу не ходит: иначе каждая перерисовка лаборатории = запрос.
    expect(screen.getByText('Цифр за период нет - модель считает на допущениях.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Взять из базы' }));
    const notice = await screen.findByText(/Подставлено из базы за 30 дней/);
    expect(notice.textContent).toContain('открытий 600');
    expect(notice.textContent).toContain('платящих 14');
    expect(notice.textContent).toMatch(/средний чек \d+(\.\d)? звёзд/);
    expect(notice.textContent).toMatch(/доля покупателей .*%/);

    expect(screen.getByText('Открытий витрины')).toBeTruthy();
    // Товары из платежей подписаны так же, как в магазине, а не техническим sku.
    expect(screen.getAllByText('skins').length).toBeGreaterThan(0);

    // Строка лучшей цены подсвечена - иначе таблицу читают глазами по цифрам.
    await waitFor(() => expect(document.querySelector('.adm-table tr.is-best')).not.toBeNull());
    const markdown = document.querySelector('.adm-econ-md pre');
    expect(markdown?.textContent).toContain('Прогноз магазина от');
    expect(markdown?.textContent).toContain('калибровано по базе');
    expect(markdown?.textContent).toContain('Публикации: заявок');
  });

  it('пресет допущений меняет взгляд целиком, а ручная правка помечает расчёт своими', async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText('Введите пароль'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лаборатория' }));

    const elasticity = () => screen.getByLabelText(/Эластичность спроса/) as HTMLInputElement;
    const anchor = () => screen.getByLabelText(/Якорь позиционирования/) as HTMLInputElement;
    const minutes = () => screen.getByLabelText(/Минут на проверку/) as HTMLInputElement;
    // База - это то, что записано в README: панель не держит второй комплект цифр.
    expect(elasticity().value).toBe('1.3');
    expect(anchor().value).toBe('15');

    fireEvent.click(screen.getByRole('button', { name: 'Пессимист' }));
    await waitFor(() => expect(elasticity().value).toBe('1.8'));
    // Пресет - связка, а не одна цифра: якорь и труд над галереей уехали вместе.
    expect(anchor().value).toBe('10');
    expect(minutes().value).toBe('6');
    // Выбранное руками пресет не трогает: цена темы осталась ценой витрины.
    // Ищем точным именем поля простого блока - в «тонких настройках» есть своё,
    // с суффиксом «, звёзд».
    expect((screen.getByLabelText(/^Тема поштучно$/) as HTMLInputElement).value).toBe('20');

    fireEvent.change(elasticity(), { target: { value: '2.4' } });
    expect(await screen.findByText(/Свои допущения/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть базу' }));
    await waitFor(() => expect(elasticity().value).toBe('1.3'));
    expect(screen.queryByText(/Свои допущения/)).toBeNull();
  });
});
