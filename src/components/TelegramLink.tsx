import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, setSessionToken } from '../lib/api';
import { cn } from '../lib/format';

/**
 * Привязка прогресса на сайте через бота.
 *
 * Браузер не знает, кто перед ним, поэтому код живёт на сервере пять минут:
 * игрок открывает чат бота, нажимает «Да», и вкладка с игрой забирает токен
 * сеанса. Никаких настроек домена в BotFather для этого не нужно.
 */

const LINK_KEY = 'pva.link.v1';
const POLL_MS = 2000;

interface LinkResponse {
  code: string;
  link: string;
  botUsername: string;
  expiresIn: number;
}

interface StatusResponse {
  status: 'pending' | 'linked' | 'rejected' | 'expired' | 'used' | 'unknown';
  token?: string;
  merged?: boolean;
}

interface TelegramLinkProps {
  className?: string;
  onLinked?: (info: { merged: boolean }) => void;
}

function readStoredCode(): string {
  try {
    const value = localStorage.getItem(LINK_KEY);
    return value && /^[a-z2-9]{16}$/.test(value) ? value : '';
  } catch {
    return '';
  }
}

function storeCode(code: string): void {
  try {
    if (code) localStorage.setItem(LINK_KEY, code);
    else localStorage.removeItem(LINK_KEY);
  } catch {
    /* приватный режим: просто не восстановим запрос после перезагрузки */
  }
}

export function TelegramLink({ className, onLinked }: TelegramLinkProps): ReactNode {
  const [code, setCode] = useState(readStoredCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const startedRef = useRef(false);

  const check = useCallback(
    async (activeCode: string): Promise<void> => {
      if (!activeCode) return;
      try {
        const response = await api<StatusResponse>(`/api/auth/link?code=${encodeURIComponent(activeCode)}`);
        if (response.status === 'linked' && response.token) {
          setSessionToken(response.token);
          storeCode('');
          setCode('');
          setError('');
          setHint('');
          onLinked?.({ merged: Boolean(response.merged) });
          return;
        }
        if (response.status === 'pending') {
          setHint('Ждём подтверждения в чате бота');
          return;
        }
        storeCode('');
        setCode('');
        setHint('');
        setError(
          response.status === 'expired'
            ? 'Ссылка устарела, она живёт пять минут. Попробуй ещё раз.'
            : response.status === 'rejected'
              ? 'Ты отклонил привязку в чате бота.'
              : 'Подтверждение не найдено. Запусти привязку заново.',
        );
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'auth_not_ready') {
          setError('На сервере ещё нет таблицы привязки, попроси разработчика применить миграцию.');
          storeCode('');
          setCode('');
          return;
        }
        // Сеть могла пропасть: пробуем дальше, пока код живой.
        setError('');
      }
    },
    [onLinked],
  );

  // Опрос нужен, только когда есть незакрытый запрос. Фоновые вкладки браузер
  // притормаживает, поэтому проверяем и сразу при возврате на страницу.
  useEffect(() => {
    if (!code) return;
    void check(code);
    const timer = window.setInterval(() => {
      void check(code);
    }, POLL_MS);
    const onFocus = () => {
      void check(code);
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [code, check]);

  async function start(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await api<LinkResponse>('/api/auth/link', { method: 'POST' });
      storeCode(response.code);
      setCode(response.code);
      setHint(`Открылся чат ${response.botUsername}, нажми «Да, привязать»`);
      const opened = window.open(response.link, '_blank', 'noopener');
      if (!opened) window.location.href = response.link;
    } catch (caught) {
      setHint('');
      setError(caught instanceof Error ? caught.message : 'Не удалось начать привязку');
    } finally {
      setBusy(false);
      startedRef.current = true;
    }
  }

  function cancel(): void {
    storeCode('');
    setCode('');
    setHint('');
    setError('');
  }

  return (
    <div className={cn('tg-link', className)}>
      <div className="tg-link-actions">
        {code ? (
          <>
            <button type="button" className="btn btn-quiet" onClick={() => void check(code)} disabled={busy}>
              Проверить сейчас
            </button>
            <button type="button" className="btn btn-quiet" onClick={cancel}>
              Отменить
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={busy}>
            {busy ? 'Открываем бота' : 'Привязать Telegram'}
          </button>
        )}
      </div>
      {hint ? <span className="note">{hint}</span> : null}
      {error ? <span className="note note-error">{error}</span> : null}
    </div>
  );
}
