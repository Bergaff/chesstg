// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiWithRetry, ApiError } from './api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('таймаут запроса', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('отпускает кнопку, когда сервер молчит', async () => {
    // Запрос, который никогда не завершится, - ровно то, что игрок описывает как
    // «тема подвисает»: кнопка стоит занятой, пока браузер сам не сдался.
    const fetchMock = vi.fn(
      (_path: string, init: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/api/profile/skin', { method: 'POST', body: { skin: 'gold' }, timeoutMs: 25 })).rejects.toMatchObject(
      { code: 'timeout' },
    );
    expect(vi.isMockFunction(fetchMock)).toBe(true);
  });
});

describe('повторы запросов', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('повторяет после сетевого сбоя и возвращает данные', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, { profile: { id: 'u1' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiWithRetry('/api/session', { method: 'POST', body: {} }, 3, 1)).resolves.toEqual({
      profile: { id: 'u1' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('не повторяет 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid_init_data' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiWithRetry('/api/session', {}, 3, 1)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('не ждёт от неготовой базы', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'db_not_ready' }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await apiWithRetry('/api/session', {}, 3, 1).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('db_not_ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('дожимает 500 до успеха', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: 'internal' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiWithRetry('/api/config', {}, 3, 1)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('прекращает попытки после лимита', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiWithRetry('/api/session', { method: 'POST', body: {} }, 2, 1)).rejects.toThrow(/Нет связи/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
