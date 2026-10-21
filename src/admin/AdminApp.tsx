import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { build as BUILD } from '../../version.json';
import { AdminError, fetchHealth, fetchStatus, login, logout } from './api';
import type { HealthResponse } from './types';
import { OverviewView } from './views/OverviewView';
import { LevelsView } from './views/LevelsView';
import { LabView } from './views/LabView';
import { BotView } from './views/BotView';
import { UsersView } from './views/UsersView';
import { PaymentsView } from './views/PaymentsView';
import { StatusLine, formatDateTime } from './ui';

type Tab = 'overview' | 'levels' | 'lab' | 'users' | 'payments' | 'bot';

const TABS: Array<{ id: Tab; title: string }> = [
  { id: 'overview', title: 'Обзор' },
  { id: 'levels', title: 'Уровни' },
  { id: 'lab', title: 'Лаборатория' },
  { id: 'users', title: 'Игроки' },
  { id: 'payments', title: 'Платежи' },
  { id: 'bot', title: 'Бот' },
];

type Phase = 'loading' | 'login' | 'panel' | 'disabled' | 'broken';

export default function AdminApp(): ReactNode {
  const [phase, setPhase] = useState<Phase>('loading');
  const [tab, setTab] = useState<Tab>('overview');
  const [expiresAt, setExpiresAt] = useState(0);
  const [reason, setReason] = useState('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const serverBuild = typeof health?.build === 'number' ? health.build : null;

  const boot = useCallback(async () => {
    // Сначала смотрим на базу. Если миграции не применены, входить бессмысленно:
    // логин и все разделы всё равно упрутся в отсутствующие таблицы.
    try {
      const next = await fetchHealth();
      setHealth(next);
      if (next.error === 'db_not_ready' || next.error === 'db_unavailable') {
        setPhase('broken');
        return;
      }
    } catch {
      setHealth(null);
    }

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

  if (phase === 'broken') {
    return <DatabaseGate health={health} onRetry={() => void boot()} />;
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
          <span className={`adm-build${serverBuild !== null && serverBuild !== BUILD ? ' is-mismatch' : ''}`}>
            сборка {BUILD}
            {serverBuild === null ? '' : ` · воркер ${serverBuild}`}
            {serverBuild !== null && serverBuild !== BUILD ? ' · соберите заново' : ''}
          </span>
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
        {health?.warnings?.includes('admin_tables_missing') && (
          <StatusLine kind="error">
            В базе нет таблиц админки, поэтому статистика, события и защита входа работают вхолостую.
            Примените миграции: npm run db:remote.
          </StatusLine>
        )}
        {tab === 'overview' && <OverviewView onUnauthorized={onUnauthorized} />}
        {tab === 'levels' && <LevelsView onUnauthorized={onUnauthorized} />}
        {tab === 'lab' && <LabView onUnauthorized={onUnauthorized} />}
        {tab === 'users' && <UsersView onUnauthorized={onUnauthorized} />}
        {tab === 'payments' && <PaymentsView onUnauthorized={onUnauthorized} />}
        {tab === 'bot' && <BotView onUnauthorized={onUnauthorized} />}
      </main>

      <footer className="adm-footer">
        <span>Закрытый раздел. Данные живут в Cloudflare D1.</span>
        <a href="/">Открыть игру</a>
      </footer>
    </div>
  );
}

function DatabaseGate({
  health,
  onRetry,
}: {
  health: HealthResponse | null;
  onRetry: () => void;
}): ReactNode {
  const missing = health?.missing ?? [];
  const unavailable = health?.error === 'db_unavailable';
  return (
    <div className="adm-shell">
      <div className="adm-gate is-wide">
        <span className="adm-label">Админка</span>
        <h1 className="adm-gate-title">{unavailable ? 'База не отвечает' : 'База не готова'}</h1>
        <p className="adm-gate-text">
          {unavailable
            ? 'Воркер не может достучаться до D1. Проверьте привязку DB и database_id в wrangler.jsonc.'
            : 'В боевой базе нет нужных таблиц, поэтому игра отвечает ошибкой на первом же запросе сессии.'}
        </p>

        {missing.length > 0 && (
          <>
            <p className="adm-gate-text">Не хватает таблиц:</p>
            <pre className="adm-code">{missing.join('\n')}</pre>
          </>
        )}

        <p className="adm-gate-text">Примените миграции к боевой базе и обновите страницу:</p>
        <pre className="adm-code">npx wrangler d1 migrations apply pawn-vs-all --remote
# или
npm run db:remote</pre>
        <p className="adm-gate-foot">
          Если база только что создана в панели Cloudflare с другим именем, проверьте, что в wrangler.jsonc
          указан её database_id. Локальные миграции на боевую базу не влияют.
        </p>

        {health && (
          <pre className="adm-code">
            {JSON.stringify(
              {
                error: health.error,
                schemaVersion: health.schemaVersion,
                origin: health.origin,
                warnings: health.warnings,
                tables: health.tables,
              },
              null,
              2,
            )}
          </pre>
        )}

        <div className="adm-toolbar is-tight" style={{ marginTop: 14 }}>
          <button type="button" className="adm-btn adm-btn-primary" onClick={onRetry}>
            Проверить снова
          </button>
          <a className="adm-btn adm-btn-quiet" href="/">
            Открыть игру
          </a>
        </div>
      </div>
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
