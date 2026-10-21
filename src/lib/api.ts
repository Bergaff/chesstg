const GUEST_KEY = 'pva.guest.v1';

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function randomGuestId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* ignore */
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function guestId(): string {
  try {
    const existing = localStorage.getItem(GUEST_KEY);
    if (existing && /^[a-f0-9]{32}$/i.test(existing)) return existing;
    const id = randomGuestId();
    localStorage.setItem(GUEST_KEY, id);
    return id;
  } catch {
    return randomGuestId();
  }
}

export function authHeaders(): Record<string, string> {
  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  if (tg?.initData) return { Authorization: `tma ${tg.initData}` };
  return { 'X-Guest-Id': guestId() };
}

interface ApiOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, { method: options.method ?? (body ? 'POST' : 'GET'), headers, body, signal: options.signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError(0, 'network', 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.');
  }

  let data: Record<string, unknown> = {};
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    /* пустой ответ */
  }

  if (!response.ok) {
    const code = typeof data.error === 'string' ? data.error : `http_${response.status}`;
    const message =
      typeof data.message === 'string' && data.message
        ? data.message
        : response.status === 401
          ? 'Открой игру через Telegram'
          : 'Что-то пошло не так';
    throw new ApiError(response.status, code, message, data);
  }

  return data as T;
}

/**
 * Повторять можно только сетевые сбои и 5xx от платформы.
 * 401, конфликты хода и неготовая база от повторных попыток не меняются.
 */
function retryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === 'network') return true;
  if (error.code === 'db_not_ready' || error.code === 'db_unavailable') return false;
  return error.status >= 500 && error.status < 600;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Запрос с короткими повторами. Холодный воркер и мобильная сеть дают
 * таймауты чаще, чем настоящую ошибку, поэтому молча пробуем ещё пару раз.
 */
export async function apiWithRetry<T>(
  path: string,
  options: ApiOptions = {},
  attempts = 3,
  baseDelayMs = 400,
): Promise<T> {
  let lastError: unknown = new Error('unreachable');
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await api<T>(path, options);
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted || !retryable(error) || attempt === attempts - 1) throw error;
      await wait(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Сохранение при закрытии страницы: запрос не должен отменяться. */
export function saveOnExit(path: string, body: unknown): void {
  try {
    fetch(path, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}
