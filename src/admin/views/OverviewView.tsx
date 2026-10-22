import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AdminError, fetchOverview } from '../api';
import type { OverviewResponse } from '../types';
import { Bars, Metric, Panel, StatusLine, Table, formatDateTime, formatNumber, formatPercent, modeTitle } from '../ui';

const RANGES = [7, 14, 30, 90];

export function OverviewView({ onUnauthorized }: { onUnauthorized: (message: string) => void }): ReactNode {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchOverview(days);
      setData(response);
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось загрузить статистику');
    } finally {
      setLoading(false);
    }
  }, [days, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="adm-stack">
      <div className="adm-toolbar">
        <div className="adm-range" role="group" aria-label="Период">
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              className={`adm-chip${days === value ? ' is-active' : ''}`}
              onClick={() => setDays(value)}
            >
              {value} дней
            </button>
          ))}
        </div>
        <button type="button" className="adm-btn adm-btn-outline" onClick={() => void load()} disabled={loading}>
          {loading ? 'Обновляем' : 'Обновить'}
        </button>
      </div>

      {error && <StatusLine kind="error">{error}</StatusLine>}

      {data && (
        <>
          <p className="adm-stamp">
            Срез на {formatDateTime(data.generatedAt)}. Период: {data.days} дней.
          </p>

          <div className="adm-metrics">
            <Metric label="Игроков" value={formatNumber(data.totals.users)} hint={`гостей ${formatNumber(data.totals.guests)}`} />
            <Metric
              label="Играли хотя бы раз"
              value={formatNumber(data.totals.played)}
              hint={`${formatPercent(data.totals.played / Math.max(1, data.totals.users))} от всех`}
            />
            <Metric label="Забегов за период" value={formatNumber(data.runs.total)} hint={`завершено ${formatNumber(data.runs.ended)}`} />
            <Metric
              label="Побед"
              value={formatPercent(data.runs.winRate)}
              hint={`${formatNumber(data.runs.won)} побед`}
              tone="ok"
            />
            <Metric label="Максимальный уровень" value={formatNumber(data.totals.topLevel)} />
            <Metric label="Лучший рекорд" value={formatNumber(data.totals.topEndless)} hint="клеток" />
            <Metric label="Монет в игре" value={formatNumber(data.totals.coins)} tone="accent" />
            <Metric label="Звёзд за период" value={formatNumber(data.economy.starsEarned)} tone="accent" />
          </div>

          <div className="adm-grid">
            <Panel title="Новые игроки" note="Регистрации по дням">
              <Bars data={data.series.newUsers} label="Новые игроки" />
            </Panel>
            <Panel title="Активность" note="Уникальные игроки с забегами">
              <Bars data={data.series.activeUsers} label="Активные игроки" />
            </Panel>
          </div>

          <Panel title="Забеги по дням" note="Старты, победы, поражения">
            <div className="adm-legend">
              <span><i className="adm-dot is-muted" />старты</span>
              <span><i className="adm-dot is-ok" />победы</span>
              <span><i className="adm-dot is-danger" />поражения</span>
            </div>
            <div className="adm-run-bars">
              {data.series.runs.map((point) => {
                const max = Math.max(1, ...data.series.runs.map((row) => row.started));
                const won = (point.won / max) * 100;
                const lost = (point.lost / max) * 100;
                const quit = (point.quit / max) * 100;
                return (
                  <div className="adm-run-slot" key={point.day} title={`${point.day}: стартов ${point.started}, побед ${point.won}`}>
                    <div className="adm-run-stack">
                      <span className="adm-run-seg is-quit" style={{ height: `${quit}%` }} />
                      <span className="adm-run-seg is-lost" style={{ height: `${lost}%` }} />
                      <span className="adm-run-seg is-won" style={{ height: `${won}%` }} />
                    </div>
                    <span className="adm-bar-day">{point.day.slice(8)}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <div className="adm-grid">
            <Panel title="Возврат" note={`Когорта ${formatNumber(data.retention.cohort)} игроков`}>
              <div className="adm-metrics is-compact">
                <Metric label="На второй день" value={formatPercent(data.retention.d1Rate)} hint={`${data.retention.d1} игроков`} />
                <Metric label="Через неделю" value={formatPercent(data.retention.d7Rate)} hint={`${data.retention.d7} игроков`} />
              </div>
              <p className="adm-note">
                Считается по активности в забегах: игрок вернулся, если после регистрации у него был
                забег на следующий день или позже.
              </p>
            </Panel>

            <Panel title="Экономика" note="За выбранный период">
              <div className="adm-metrics is-compact">
                <Metric label="Монет начислено" value={formatNumber(data.economy.coinsEarned)} />
                <Metric label="Монет потрачено" value={formatNumber(data.economy.coinsSpent)} />
                <Metric label="Жизней потеряно" value={formatNumber(data.economy.livesLost)} tone="danger" />
                <Metric label="Бонусов применено" value={formatNumber(data.economy.bonusesUsed)} />
              </div>
              <p className="adm-note">
                Реклама: {data.economy.adEvents.map((row) => `${row.kind} ${formatNumber(row.n)}`).join(', ') || 'показов нет'}.
                Покупок {formatNumber(data.economy.purchases)}, возвратов {formatNumber(data.economy.refunds)}.
              </p>
            </Panel>
          </div>

          <Panel title="Режимы за период" note="Кто во что играет: забегов, игроков и доля побед">
            <Table head={['Режим', 'Игроков', 'Забегов', 'Побед', 'Проигрышей', 'Доля побед', 'Ходов в среднем']} empty="Забегов пока нет">
              {(data.modes ?? []).map((row) => (
                <tr key={row.mode}>
                  <td>{modeTitle(row.mode)}</td>
                  <td>{formatNumber(row.players)}</td>
                  <td>{formatNumber(row.n)}</td>
                  <td>{formatNumber(row.won)}</td>
                  <td>{formatNumber(row.lost)}</td>
                  <td>{formatPercent(row.winRate, 1)}</td>
                  <td>{row.avgMoves.toFixed(1)}</td>
                </tr>
              ))}
            </Table>
            <p className="adm-note">
              Прогресс каждого игрока по уровням и прохождения по конкретному уровню во вкладках
              «Игроки» и «Прохождения».
            </p>
          </Panel>

          <Panel title="Воронка по уровням" note="Сколько игроков дошли до уровня">
            <Table head={['Уровень', 'Игроков', 'Доля']} empty="Данных пока нет">
              {data.funnel.map((row) => (
                <tr key={row.level}>
                  <td>{row.level}</td>
                  <td>{formatNumber(row.n)}</td>
                  <td>{formatPercent(row.n / Math.max(1, data.totals.users), 1)}</td>
                </tr>
              ))}
            </Table>
          </Panel>

          <div className="adm-grid">
            <Panel title="Попытки по уровням" note="Кампания, все забеги">
              <Table head={['Уровень', 'Забегов', 'Побед', 'Винрейт']} empty="Забегов пока нет">
                {data.levels.slice(0, 20).map((row) => (
                  <tr key={row.level}>
                    <td>{row.level}</td>
                    <td>{formatNumber(row.played)}</td>
                    <td>{formatNumber(row.won)}</td>
                    <td>{formatPercent(row.winRate)}</td>
                  </tr>
                ))}
              </Table>
            </Panel>

            <Panel title="Бесконечный режим" note="Распределение рекордов">
              <Table head={['Клеток', 'Игроков']} empty="Рекордов пока нет">
                {data.endlessBuckets.map((row) => (
                  <tr key={row.bucket}>
                    <td>{row.bucket}</td>
                    <td>{formatNumber(row.n)}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
          </div>

          <div className="adm-grid">
            <Panel title="Сильнейшие игроки" note="По уровню и рекорду">
              <Table head={['Игрок', 'Уровень', 'Рекорд']} empty="Пока пусто">
                {data.topPlayers.map((row) => (
                  <tr key={row.id}>
                    <td>{row.username ? `@${row.username}` : row.name || 'Без имени'}</td>
                    <td>{row.level}</td>
                    <td>{row.best}</td>
                  </tr>
                ))}
              </Table>
            </Panel>

            <Panel title="Новые игроки" note="Последние регистрации">
              <Table head={['Игрок', 'Уровень', 'Регистрация']} empty="Пока пусто">
                {data.recentUsers.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.username ? `@${row.username}` : row.name || 'Без имени'}
                      {row.isGuest ? ' (гость)' : ''}
                    </td>
                    <td>{row.level}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
