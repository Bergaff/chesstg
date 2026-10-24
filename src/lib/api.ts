const GUEST_KEY = 'pva.guest.v1';
export const SESSION_KEY = 'pva.session.v1';
const LINK_KEY = 'pva.link.v1';
const LINK_RE = /^[a-z2-9]{16}$/;

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

/** Токен сеанса после входа через Telegram. На сайте он и есть сохранение прогресса. */
export function sessionToken(): string {
  try {
    return localStorage.getItem(SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(SESSION_KEY, token);
  } catch {
    /* приватный режим */
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function isLinked(): boolean {
  return Boolean(sessionToken());
}

/** Код привязки из ссылки, по которой Telegram вернул игрока на сайт. */
export function storedLinkCode(): string {
  try {
    const value = localStorage.getItem(LINK_KEY);
    return value && LINK_RE.test(value) ? value : '';
  } catch {
    return '';
  }
}

export function setLinkCode(code: string): void {
  try {
    if (code) localStorage.setItem(LINK_KEY, code);
    else localStorage.removeItem(LINK_KEY);
  } catch {
    /* приватный режим */
  }
}

/**
 * Забирает `?link=<код>` из адреса. Строку убираем сразу, чтобы код не остался
 * в истории и не был отправлен повторно при перезагрузке.
 */
export function takeLinkFromUrl(): string {
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('link') ?? '';
    if (!LINK_RE.test(code)) return '';
    url.searchParams.delete('link');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setLinkCode(code);
    return code;
  } catch {
    return '';
  }
}

export function authHeaders(): Record<string, string> {
  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  if (tg?.initData) return { Authorization: `tma ${tg.initData}` };
  const token = sessionToken();
  if (token) return { Authorization: `Bearer ${token}`, 'X-Guest-Id': guestId() };
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
    // Протухший или подделанный сеанс не должен блокировать игру: сбрасываем его,
    // дальше клиент снова работает как гость и сможет войти заново.
    if (code === 'session_expired' || code === 'session_unknown' || code === 'session_secret_missing') {
      clearSessionToken();
    }
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
