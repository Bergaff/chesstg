import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AdminError,
  disableBotWebhook,
  fetchBotStatus,
  setupBot,
} from '../api';
import type { BotStatusResponse, BotStep } from '../types';
import { Metric, Panel, StatusLine, Table, formatDateTime } from '../ui';

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function BotView({ onUnauthorized }: { onUnauthorized: (message: string) => void }): ReactNode {
  const [status, setStatus] = useState<BotStatusResponse | null>(null);
  const [error, setError] = useState('');
  const [steps, setSteps] = useState<BotStep[]>([]);
  const [busy, setBusy] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [commands, setCommands] = useState(true);
  const [menuButton, setMenuButton] = useState(true);

  const handleAuth = useCallback(
    (err: unknown): boolean => {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return true;
      }
      return false;
    },
    [onUnauthorized],
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const next = await fetchBotStatus();
      setStatus(next);
      setAppUrl((current) => current || next.appUrl || window.location.origin);
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Не удалось получить состояние бота');
    }
  }, [handleAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = useCallback(async () => {
    if (busy) return;
    setBusy('setup');
    setError('');
    setSteps([]);
    try {
      const result = await setupBot({ appUrl, secret, commands, menuButton });
      setStatus(result.status);
      setSteps(result.steps);
      setSecret('');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Не удалось настроить бота');
    } finally {
      setBusy('');
    }
  }, [appUrl, busy, commands, handleAuth, menuButton, secret]);

  const disconnect = useCallback(async () => {
    if (busy) return;
    setBusy('off');
    setError('');
    setSteps([]);
    try {
      const result = await disableBotWebhook();
      setStatus(result.status);
      setSteps([{ name: 'Вебхук', ok: true, detail: 'отключён' }]);
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Не удалось отключить вебхук');
    } finally {
      setBusy('');
    }
  }, [busy, handleAuth]);

  return (
    <div className="adm-stack">
      {error && <StatusLine kind="error">{error}</StatusLine>}

      <Panel
        title="Бот и вебхук"
        note="Связь с Telegram, адрес приложения и настройка кнопки меню"
        actions={
          <button type="button" className="adm-btn adm-btn-outline" onClick={() => void load()} disabled={busy !== ''}>
            Проверить снова
          </button>
        }
      >
        {!status && <p className="adm-empty">Проверяем состояние</p>}

        {status && !status.configured && (
          <>
            <StatusLine kind="info">
              Токен бота не задан. Пока его нет, вебхук не поднять, а напоминания и покупки в боте работать не
              будут. Мини-приложение при этом уже доступно по прямой ссылке.
            </StatusLine>
            <pre className="adm-code">npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npm run deploy</pre>
            <p className="adm-note">
              Токен выдаёт BotFather. После добавления секрета перезагрузите эту страницу.
            </p>
          </>
        )}

        {status && status.configured && (
          <>
            {status.botError && <StatusLine kind="error">Telegram не подтвердил токен: {status.botError}</StatusLine>}

            <div className="adm-metrics">
              <Metric label="Бот" value={status.username ? `@${status.username}` : 'без имени'} />
              <Metric
                label="Вебхук"
                value={status.webhook?.url ? 'поднят' : 'не задан'}
                hint={status.webhook?.url || 'нет адреса'}
                tone={status.webhook?.url ? 'ok' : undefined}
              />
              <Metric
                label="Ожидают доставки"
                value={status.webhook?.pending ?? 0}
                hint="обновлений в очереди"
                tone={(status.webhook?.pending ?? 0) > 20 ? 'danger' : undefined}
              />
              <Metric
                label="Секрет"
                value={status.secretSet ? 'задан' : 'нет'}
                hint="WEBHOOK_SECRET воркера"
              />
            </div>

            {status.webhook?.url && status.webhook.url !== status.expectedUrl && (
              <StatusLine kind="error">
                Вебхук смотрит на {status.webhook.url}, а страница открыта на {status.expectedUrl}. Обновите
                адрес, иначе Telegram будет стучаться в другое место.
              </StatusLine>
            )}

            {status.webhook?.lastError && (
              <StatusLine kind="error">
                Последняя ошибка доставки: {status.webhook.lastError}
                {status.webhook.lastErrorAt ? ` (${formatDateTime(status.webhook.lastErrorAt)})` : ''}
              </StatusLine>
            )}

            {!status.webappUrlOk && (
              <StatusLine kind="info">
                В wrangler.jsonc стоит WEBAPP_URL = {status.webappUrl || 'пусто'}, а страница открыта на{' '}
                {status.appUrl || window.location.origin}. Ссылки в сообщениях бота будут вести не туда, поправьте
                переменную и задеплойте заново.
              </StatusLine>
            )}

            {status.devMode && (
              <StatusLine kind="info">
                Сейчас DEV_MODE = true: реклама показывается заглушкой, а вебхук принимает запросы без секрета.
                Для продакшена поставьте false.
              </StatusLine>
            )}

            <div className="adm-toolbar is-tight">
              <label className="adm-field is-grow">
                <span className="adm-label">Адрес приложения</span>
                <input
                  type="url"
                  value={appUrl}
                  placeholder="https://pawn-vs-all.example.workers.dev"
                  onChange={(event) => setAppUrl(event.target.value)}
                />
              </label>
              <label className="adm-field is-grow">
                <span className="adm-label">Секрет вебхука</span>
                <input
                  type="text"
                  value={secret}
                  placeholder={status.secretSet ? 'оставьте пустым, чтобы не менять' : 'необязательно'}
                  onChange={(event) => setSecret(event.target.value)}
                />
              </label>
              <button type="button" className="adm-btn adm-btn-outline" onClick={() => setSecret(randomSecret())}>
                Сгенерировать
              </button>
            </div>

            {!appUrl.trim().startsWith('https://') && (
              <StatusLine kind="info">
                Telegram принимает только https. Локально вебхук не поднять, укажите адрес задеплоенного
                воркера.
              </StatusLine>
            )}

            {status.secretSet && !secret.trim() && (
              <StatusLine kind="error">
                В воркере уже задан WEBHOOK_SECRET. Вставьте то же значение в поле секрета, иначе Telegram
                будет присылать запросы без заголовка и получит отказ 403. Если секрет утерян, задайте новый:
                впишите его здесь, сохраните, затем выполните wrangler secret put WEBHOOK_SECRET с тем же
                значением.
              </StatusLine>
            )}

            <div className="adm-checks">
              <label className="adm-check">
                <input type="checkbox" checked={commands} onChange={(event) => setCommands(event.target.checked)} />
                <span>Команды start, play, help</span>
              </label>
              <label className="adm-check">
                <input
                  type="checkbox"
                  checked={menuButton}
                  onChange={(event) => setMenuButton(event.target.checked)}
                />
                <span>Кнопка меню «Играть»</span>
              </label>
            </div>

            <div className="adm-toolbar is-tight">
              <button
                type="button"
                className="adm-btn adm-btn-primary"
                onClick={() => void connect()}
                disabled={busy !== '' || !appUrl.trim() || (status.secretSet && !secret.trim())}
              >
                {busy === 'setup' ? 'Подключаем' : 'Подключить бота'}
              </button>
              <button
                type="button"
                className="adm-btn adm-btn-quiet"
                onClick={() => void disconnect()}
                disabled={busy !== '' || !status.webhook?.url}
              >
                {busy === 'off' ? 'Отключаем' : 'Отключить вебхук'}
              </button>
            </div>

            <p className="adm-note">
              Вебхук ставится на {status.expectedUrl}. Если задать новый секрет, его же нужно записать в секрет
              воркера командой <code>npx wrangler secret put WEBHOOK_SECRET</code>, иначе Telegram получит отказ
              403 и повторит доставку позже. Секрет показывается только здесь, после сохранения его не прочитать.
            </p>
          </>
        )}
      </Panel>

      {steps.length > 0 && (
        <Panel title="Что сделали" note="Ответ Telegram по каждому шагу">
          <Table head={['Шаг', 'Итог', 'Подробности']} empty="Пока пусто">
            {steps.map((step) => (
              <tr key={step.name}>
                <td>{step.name}</td>
                <td>{step.ok ? 'готово' : 'ошибка'}</td>
                <td className="is-mono">{step.detail}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      <Panel title="Как проверить" note="После подключения">
        <ol className="adm-list">
          <li>Откройте бота по ссылке t.me/{status?.username || '<username>'} и отправьте /start.</li>
          <li>Кнопка «Играть» внизу чата должна открыть мини-приложение.</li>
          <li>
            Вернитесь сюда и нажмите «Проверить снова»: в очереди не должно быть застрявших обновлений, а в
            последней ошибке пусто.
          </li>
        </ol>
        <p className="adm-note">
          Если Telegram отвечает ошибкой 401, токен неверный или отозван в BotFather. Если ошибка 403, секрет
          вебхука не совпадает с WEBHOOK_SECRET воркера.
        </p>
      </Panel>
    </div>
  );
}
