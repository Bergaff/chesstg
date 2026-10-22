import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, setSessionToken } from '../lib/api';
import { cn } from '../lib/format';

/**
 * Кнопка «Войти через Telegram» для сайта.
 *
 * Виджет отдаёт профиль с подписью, воркер её проверяет и выдаёт токен сеанса.
 * Домен, с которого работает страница, должен быть добавлен боту в BotFather
 * командой /setdomain, иначе Telegram покажет ошибку на своей стороне.
 */

interface TelegramLoginProps {
  /** Имя бота без @, из конфигурации воркера. */
  botUsername: string;
  className?: string;
  /** Вызывается после успешной привязки, чтобы интерфейс обновил профиль. */
  onLinked?: (info: { merged: boolean }) => void;
  label?: string;
}

type Status = 'idle' | 'loading' | 'ready' | 'sending' | 'failed';

const LOGIN_PATH = '/api/auth/telegram';

export function TelegramLogin({ botUsername, className, onLinked, label }: TelegramLoginProps): ReactNode {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !botUsername) return;
    let cancelled = false;

    async function send(user: TelegramLoginUser) {
      if (cancelled) return;
      setStatus('sending');
      setError('');
      const fields: Record<string, string> = {};
      // Отдаём ровно те поля, что прислал виджет, без правок: подпись Telegram
      // считается по строке "ключ=значение" от всех полей кроме hash.
      for (const [key, value] of Object.entries(user)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          fields[key] = String(value);
        }
      }
      try {
        const response = await api<{ token: string; merged: boolean }>(LOGIN_PATH, { method: 'POST', body: fields });
        if (cancelled) return;
        setSessionToken(response.token);
        setStatus('ready');
        onLinked?.({ merged: Boolean(response.merged) });
      } catch (caught) {
        if (cancelled) return;
        setStatus('failed');
        setError(caught instanceof Error ? caught.message : 'Не удалось войти через Telegram');
      }
    }

    function render(): void {
      host!.innerHTML = '';
      const widget = window.Telegram?.LoginWidget;
      if (widget?.createButton) {
        widget.createButton(host!, {
          telegram: botUsername,
          button_text: label ?? 'Войти через Telegram',
          size: 'large',
          radius: '2',
          user_is_bot: false,
          request_access: false,
          onTelegramLogin: (user) => {
            void send(user);
          },
        });
        setStatus('ready');
        return;
      }
      // Запасной вариант: виджет умеет монтироваться скриптом по data-атрибутам.
      window.onTelegramLogin = (user) => {
        void send(user);
      };
      const script = document.createElement('script');
      script.src = 'https://telegram.org/js/telegram-widget.js?22';
      script.async = true;
      script.setAttribute('data-telegram-login', botUsername);
      script.setAttribute('data-size', 'large');
      script.setAttribute('data-radius', '2');
      script.setAttribute('data-userpic', 'false');
      script.setAttribute('data-request-access', 'write');
      script.setAttribute('data-onauth', 'onTelegramLogin(user)');
      script.onerror = () => {
        if (cancelled) return;
        setStatus('failed');
        setError('Не удалось загрузить кнопку Telegram. Похоже, его закрыли блокировщики или сеть.');
      };
      host!.appendChild(script);
      setStatus('ready');
    }

    setStatus('loading');
    if (window.Telegram?.LoginWidget) {
      render();
    } else {
      const src = 'https://telegram.org/js/telegram-widget.js?22';
      const existing = document.querySelector<HTMLScriptElement>(`script[src^="${src}"]`);
      const onLoad = () => {
        if (!cancelled) render();
      };
      if (existing && existing.dataset.loaded === '1') {
        onLoad();
      } else {
        const script = existing ?? document.createElement('script');
        script.src = src;
        script.async = true;
        script.addEventListener('load', () => {
          script.dataset.loaded = '1';
          onLoad();
        });
        script.addEventListener('error', () => {
          if (cancelled) return;
          setStatus('failed');
          setError('Telegram не отдал скрипт кнопки. Попробуй обновить страницу.');
        });
        if (!existing) document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (hostRef.current) hostRef.current.innerHTML = '';
      delete window.onTelegramLogin;
    };
  }, [botUsername, label, onLinked]);

  if (!botUsername) {
    return <p className="note">Бот ещё не настроен, вход через Telegram появится после настройки.</p>;
  }

  return (
    <div className={cn('tg-login', className)}>
      <span ref={hostRef} className="tg-login-host" />
      {status === 'loading' ? <span className="note">Загружаем кнопку Telegram</span> : null}
      {status === 'sending' ? <span className="note">Проверяем подпись Telegram</span> : null}
      {error ? <span className="note note-error">{error}</span> : null}
    </div>
  );
}
