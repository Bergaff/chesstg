import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AdminError, fetchStatus, login, logout } from './api';
import { OverviewView } from './views/OverviewView';
import { LevelsView } from './views/LevelsView';
import { UsersView } from './views/UsersView';
import { PaymentsView } from './views/PaymentsView';
import { formatDateTime } from './ui';

type Tab = 'overview' | 'levels' | 'users' | 'payments';

const TABS: Array<{ id: Tab; title: string }> = [
  { id: 'overview', title: 'Обзор' },
  { id: 'levels', title: 'Уровни' },
  { id: 'users', title: 'Игроки' },
  { id: 'payments', title: 'Платежи' },
];

type Phase = 'loading' | 'login' | 'panel' | 'disabled';

export default function AdminApp(): ReactNode {
  const [phase, setPhase] = useState<Phase>('loading');
  const [tab, setTab] = useState<Tab>('overview');
  const [expiresAt, setExpiresAt] = useState(0);
  const [reason, setReason] = useState('');

  const boot = useCallback(async () => {
    try {
      const status = await fetchStatus();
      if (!status.configured) {
        setPhase('disabled');
        return;
      }
      if (status.authenticated) {
        setExpiresAt(status.expiresAt ?? 0);
        setPhase('panel');
      } else {
        setPhase('login');
      }
    } catch (error) {
      if (error instanceof AdminError && error.status === 503) {
        setPhase('disabled');
        return;
      }
      setReason(error instanceof Error ? error.message : 'Сервер недоступен');
      setPhase('login');
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const onAuthorized = useCallback((until: number) => {
    setExpiresAt(until);
    setReason('');
    setPhase('panel');
  }, []);

  const onUnauthorized = useCallback((message: string) => {
    setReason(message);
    setPhase('login');
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setReason('Сеанс завершён');
    setPhase('login');
  }, []);

  if (phase === 'loading') {
    return (
      <div className="adm-shell">
        <p className="adm-boot">Проверяем доступ</p>
      </div>
    );
  }

  if (phase === 'disabled') {
    return (
      <div className="adm-shell">
        <div className="adm-gate">
          <span className="adm-label">Админка</span>
          <h1 className="adm-gate-title">Доступ не настроен</h1>
          <p className="adm-gate-text">
            Задайте секреты воркера: <code>ADMIN_PASSWORD</code> (или <code>ADMIN_PASSWORD_HASH</code>) и{' '}
            <code>ADMIN_SECRET</code>. После этого перезапустите воркер или задеплойте заново.
          </p>
          <pre className="adm-code">npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SECRET</pre>
          <p className="adm-gate-text">
            Для локальной разработки те же значения кладутся в <code>.dev.vars</code>.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'login') {
    return <LoginGate reason={reason} onAuthorized={onAuthorized} />;
  }

  return (
    <div className="adm-shell">
      <header className="adm-header">
        <div className="adm-brand">
          <span className="adm-label">Пешка против всех</span>
          <h1 className="adm-title">Админка</h1>
        </div>
        <div className="adm-header-side">
          <span className="adm-expiry">Доступ до {formatDateTime(expiresAt)}</span>
          <button type="button" className="adm-btn adm-btn-quiet" onClick={() => void signOut()}>
            Выйти
          </button>
        </div>
      </header>

      <nav className="adm-tabs" aria-label="Разделы админки">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`adm-tab${tab === item.id ? ' is-active' : ''}`}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.title}
          </button>
        ))}
      </nav>

      <main className="adm-main">
        {tab === 'overview' && <OverviewView onUnauthorized={onUnauthorized} />}
        {tab === 'levels' && <LevelsView onUnauthorized={onUnauthorized} />}
        {tab === 'users' && <UsersView onUnauthorized={onUnauthorized} />}
        {tab === 'payments' && <PaymentsView onUnauthorized={onUnauthorized} />}
      </main>

      <footer className="adm-footer">
        <span>Закрытый раздел. Данные живут в Cloudflare D1.</span>
        <a href="/">Открыть игру</a>
      </footer>
    </div>
  );
}

function LoginGate({
  reason,
  onAuthorized,
}: {
  reason: string;
  onAuthorized: (expiresAt: number) => void;
}): ReactNode {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(reason);
  const [left, setLeft] = useState<number | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError('');
    try {
      const expiresAt = await login(password);
      setPassword('');
      onAuthorized(expiresAt);
    } catch (err) {
      if (err instanceof AdminError) {
        setError(err.message);
        const attempts = err.details.attemptsLeft;
        setLeft(typeof attempts === 'number' ? attempts : null);
      } else {
        setError('Не удалось войти');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-shell">
      <div className="adm-gate">
        <span className="adm-label">Закрытый раздел</span>
        <h1 className="adm-gate-title">Вход в админку</h1>
        <p className="adm-gate-text">
          Пароль проверяется на сервере, в браузере не хранится. Сеанс живёт 12 часов и закрывается вместе
          с вкладкой.
        </p>
        <form className="adm-form" onSubmit={(event) => void submit(event)}>
          <label className="adm-field">
            <span className="adm-label">Пароль</span>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введите пароль"
            />
          </label>
          {error && (
            <p className="adm-status is-error" role="alert">
              {error}
              {left !== null && left > 0 ? `. Осталось попыток: ${left}` : ''}
            </p>
          )}
          <button type="submit" className="adm-btn adm-btn-primary" disabled={busy || !password}>
            {busy ? 'Проверяем' : 'Войти'}
          </button>
        </form>
        <p className="adm-gate-foot">
          После восьми неверных попыток вход блокируется на 15 минут.
        </p>
      </div>
    </div>
  );
}
