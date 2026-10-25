import type {
  AdminStatus,
  BotSetupResponse,
  BotStatusResponse, DiagResponse,
  HealthResponse,
  LevelStatsResponse,
  LevelsResponse,
  LevelCheckReport,
  OverviewResponse,
  PaymentsResponse,
  ShopEconResponse,
  OwnedSkinsResponse,
  SkinsResponse,
  UserDetailResponse,
  UsersResponse,
} from './types';

/**
 * Токен админки живёт в localStorage и сам истекает через 12 часов, поэтому
 * перезагрузка страницы не требует пароля. Выход чистит хранилище.
 */

const TOKEN_KEY = 'pawn.admin.token';
const EXPIRES_KEY = 'pawn.admin.expires';

export class AdminError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AdminError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function getExpiresAt(): number {
  try {
    return Number(localStorage.getItem(EXPIRES_KEY) ?? 0);
  } catch {
    return 0;
  }
}

export function saveSession(token: string, expiresAt: number): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXPIRES_KEY, String(expiresAt));
  } catch {
    // приватный режим: токен останется только в памяти страницы
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  } catch {
    // ignore
  }
}

async function request<T>(path: string, init: RequestInit = {}, withAuth = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (withAuth) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`/api/admin${path}`, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new AdminError(0, 'network', 'Нет связи с сервером');
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const payload = (data ?? {}) as Record<string, unknown>;
    const message =
      typeof payload.message === 'string' ? payload.message : `Ошибка ${response.status}`;
    throw new AdminError(response.status, String(payload.error ?? 'error'), message, payload);
  }

  return (data ?? {}) as T;
}

export async function fetchStatus(): Promise<AdminStatus> {
  // С токоном в заголовке: иначе /status всегда отвечает «не авторизован»,
  // и перезагрузка страницы выкидывает на форму входа, даже когда токен жив.
  return request<AdminStatus>('/status', { method: 'GET' });
}

export async function login(password: string): Promise<number> {
  const data = await request<{ token: string; expiresAt: number }>(
    '/login',
    { method: 'POST', body: JSON.stringify({ password }) },
    false,
  );
  saveSession(data.token, data.expiresAt);
  return data.expiresAt;
}

export async function logout(): Promise<void> {
  try {
    await request('/logout', { method: 'POST' });
  } catch {
    // выход локальный, ошибку сети игнорируем
  }
  clearSession();
}

export function fetchOverview(days: number): Promise<OverviewResponse> {
  return request<OverviewResponse>(`/overview?days=${days}`);
}

export function fetchUsers(query: string, page: number, sort: string): Promise<UsersResponse> {
  const params = new URLSearchParams({ query, page: String(page), sort });
  return request<UsersResponse>(`/users?${params.toString()}`);
}

export function fetchUser(id: string): Promise<UserDetailResponse> {
  return request<UserDetailResponse>(`/users/${encodeURIComponent(id)}`);
}

/** Прохождения по уровням режима: где игроки встают и сколько пробуют. */
export function fetchLevelStats(mode: 'campaign' | 'jam' | 'race', days: number): Promise<LevelStatsResponse> {
  const params = new URLSearchParams({ mode, days: String(days) });
  return request<LevelStatsResponse>(`/levels/stats?${params.toString()}`);
}

export function fetchPayments(days: number): Promise<PaymentsResponse> {
  return request<PaymentsResponse>(`/payments?days=${days}`);
}

export function fetchLevels(): Promise<LevelsResponse> {
  return request<LevelsResponse>('/levels');
}

export function checkLevel(level: number, seeds: number): Promise<{ report: LevelCheckReport }> {
  return request<{ report: LevelCheckReport }>('/levels/check', {
    method: 'POST',
    body: JSON.stringify({ level, seeds }),
  });
}

export function saveReport(kind: 'placements' | 'levels', spec: unknown, summary: unknown): Promise<{ id: string }> {
  return request<{ id: string }>('/reports', {
    method: 'POST',
    body: JSON.stringify({ kind, spec, summary }),
  });
}

export function deleteReport(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function fetchBotStatus(): Promise<BotStatusResponse> {
  return request<BotStatusResponse>('/bot');
}

export function setupBot(payload: {
  appUrl: string;
  secret: string;
  commands: boolean;
  menuButton: boolean;
  dropPending?: boolean;
}): Promise<BotSetupResponse> {
  return request<BotSetupResponse>('/bot/setup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Очередь публикаций тем: черновики, заявка, галерея, отклонённые. */
export function fetchSkins(status: string): Promise<SkinsResponse> {
  return request<SkinsResponse>(`/skins?status=${encodeURIComponent(status)}`);
}

/**
 * Свои темы игроков по слотам. Очередь показывает только то, что автор принёс
 * на проверку, а жалоба чаще приходит на то, что человек надел себе и показал
 * друзьям кодом - здесь все купленные места, включая пустые.
 */
export function fetchOwnedSkins(query = ''): Promise<OwnedSkinsResponse> {
  const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  return request<OwnedSkinsResponse>(`/skins/owned${suffix}`);
}

/**
 * Заморозить или разморозить темы игрока: права рисовать флаг не касается, но
 * надеть, сохранить и отправить в галерею замороженная тема не может.
 */
export function blockSkinAuthor(userId: string, blocked: boolean, note = ''): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/skins/block', {
    method: 'POST',
    body: JSON.stringify({ userId, blocked, note }),
  });
}

export function reviewSkin(id: number, decision: 'approve' | 'reject', note: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/skins/review', {
    method: 'POST',
    body: JSON.stringify({ id, decision, note }),
  });
}

/** Что модель магазина может взять из базы, а не из головы. */
export function fetchShopEcon(days: number): Promise<ShopEconResponse> {
  return request<ShopEconResponse>(`/shop/econ?days=${days}`);
}

export function fetchDiag(): Promise<DiagResponse> {
  return request<DiagResponse>('/diag');
}

export function disableBotWebhook(): Promise<{ status: BotStatusResponse }> {
  return request<{ status: BotStatusResponse }>('/bot/webhook/off', { method: 'POST' });
}

/** Публичная проверка сервера: база, конфиг, предупреждения. Без токена. */
export async function fetchHealth(): Promise<HealthResponse> {
  let response: Response;
  try {
    response = await fetch('/api/health', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    throw new AdminError(0, 'network', 'Нет связи с сервером');
  }
  try {
    return (await response.json()) as HealthResponse;
  } catch {
    throw new AdminError(response.status, 'bad_response', 'Сервер вернул не JSON');
  }
}
