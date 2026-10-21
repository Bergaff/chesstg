import type {
  AdminStatus,
  BotSetupResponse,
  BotStatusResponse, DiagResponse,
  HealthResponse,
  LevelsResponse,
  LevelCheckReport,
  OverviewResponse,
  PaymentsResponse,
  UserDetailResponse,
  UsersResponse,
} from './types';

/**
 * Токен админки живёт в sessionStorage: закрыл вкладку, снова вводишь пароль.
 * В localStorage не кладём, чтобы доступ не переживал сессию браузера.
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
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function getExpiresAt(): number {
  try {
    return Number(sessionStorage.getItem(EXPIRES_KEY) ?? 0);
  } catch {
    return 0;
  }
}

export function saveSession(token: string, expiresAt: number): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(EXPIRES_KEY, String(expiresAt));
  } catch {
    // приватный режим: токен останется только в памяти страницы
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
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
  return request<AdminStatus>('/status', { method: 'GET' }, false);
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
