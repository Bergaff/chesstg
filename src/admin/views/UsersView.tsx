import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AdminError, fetchUser, fetchUsers } from '../api';
import type { UserDetailResponse, UsersResponse } from '../types';
import { Panel, StatusLine, Table, formatDateTime, formatNumber } from '../ui';

const SORTS = [
  { id: 'recent', title: 'По активности' },
  { id: 'level', title: 'По уровню' },
  { id: 'best', title: 'По рекорду' },
  { id: 'coins', title: 'По монетам' },
];

export function UsersView({ onUnauthorized }: { onUnauthorized: (message: string) => void }): ReactNode {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<UsersResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserDetailResponse | null>(null);
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchUsers(query, page, sort));
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось загрузить игроков');
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized, page, query, sort]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const openUser = useCallback(
    async (id: string) => {
      setDetailError('');
      try {
        setSelected(await fetchUser(id));
      } catch (err) {
        if (err instanceof AdminError && err.status === 401) {
          onUnauthorized('Сеанс истёк, войдите снова');
          return;
        }
        setDetailError(err instanceof Error ? err.message : 'Не удалось открыть игрока');
      }
    },
    [onUnauthorized],
  );

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="adm-stack">
      <Panel
        title="Игроки"
        note="Поиск по имени, username и идентификатору"
        actions={
          <button type="button" className="adm-btn adm-btn-outline" onClick={() => void load()} disabled={loading}>
            {loading ? 'Обновляем' : 'Обновить'}
          </button>
        }
      >
        <div className="adm-toolbar is-tight">
          <label className="adm-field is-grow">
            <span className="adm-label">Поиск</span>
            <input
              type="search"
              value={query}
              placeholder="Имя, @username или id"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label className="adm-field is-inline">
            <span className="adm-label">Сортировка</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(0);
              }}
            >
              {SORTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <StatusLine kind="error">{error}</StatusLine>}

        <Table
          head={['Игрок', 'Уровень', 'Рекорд', 'Монеты', 'Забеги', 'Покупки', 'Активность']}
          empty="Никого не нашли"
        >
          {(data?.rows ?? []).map((row) => (
            <tr key={row.id} className="is-clickable" onClick={() => void openUser(row.id)}>
              <td>
                <span className="adm-user">
                  <b>{row.username ? `@${row.username}` : row.name || 'Без имени'}</b>
                  <small>
                    {row.isGuest ? 'гость' : 'telegram'} · {row.id.slice(0, 14)}
                  </small>
                </span>
              </td>
              <td>{row.maxLevel}</td>
              <td>{row.best}</td>
              <td>{formatNumber(row.coins)}</td>
              <td>{row.runs}</td>
              <td>{row.purchases}</td>
              <td>{formatDateTime(row.updatedAt)}</td>
            </tr>
          ))}
        </Table>

        <div className="adm-pager">
          <button
            type="button"
            className="adm-btn adm-btn-quiet"
            disabled={page <= 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            Назад
          </button>
          <span>
            Страница {page + 1} из {pages} · всего {formatNumber(data?.total ?? 0)}
          </span>
          <button
            type="button"
            className="adm-btn adm-btn-quiet"
            disabled={page + 1 >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            Вперёд
          </button>
        </div>
      </Panel>

      {detailError && <StatusLine kind="error">{detailError}</StatusLine>}

      {selected && (
        <Panel
          title="Карточка игрока"
          note={String(selected.user.first_name ?? '') || 'Без имени'}
          actions={
            <button type="button" className="adm-btn adm-btn-quiet" onClick={() => setSelected(null)}>
              Закрыть
            </button>
          }
        >
          <div className="adm-metrics is-compact">
            <div className="adm-metric">
              <span className="adm-metric-label">Уровень</span>
              <span className="adm-metric-value">{String(selected.user.level ?? 0)}</span>
            </div>
            <div className="adm-metric">
              <span className="adm-metric-label">Максимум</span>
              <span className="adm-metric-value">{String(selected.user.max_level ?? 0)}</span>
            </div>
            <div className="adm-metric">
              <span className="adm-metric-label">Монеты</span>
              <span className="adm-metric-value">{formatNumber(Number(selected.user.coins ?? 0))}</span>
            </div>
            <div className="adm-metric">
              <span className="adm-metric-label">Жизни</span>
              <span className="adm-metric-value">{String(selected.user.lives ?? 0)}</span>
            </div>
            <div className="adm-metric">
              <span className="adm-metric-label">Рекорд</span>
              <span className="adm-metric-value">{String(selected.user.endless_best ?? 0)}</span>
            </div>
            <div className="adm-metric">
              <span className="adm-metric-label">Регистрация</span>
              <span className="adm-metric-value is-small">
                {formatDateTime(Number(selected.user.created_at ?? 0))}
              </span>
            </div>
          </div>

          <div className="adm-grid">
            <div>
              <h3 className="adm-subtitle">Забеги</h3>
              <Table head={['Режим', 'Уровень', 'Ходы', 'Итог', 'Обновлён']} empty="Забегов нет">
                {selected.runs.map((row) => (
                  <tr key={String(row.id)}>
                    <td>{String(row.mode)}</td>
                    <td>{String(row.level)}</td>
                    <td>{String(row.moves)}</td>
                    <td>{String(row.status)}</td>
                    <td>{formatDateTime(Number(row.updatedAt ?? 0))}</td>
                  </tr>
                ))}
              </Table>
            </div>
            <div>
              <h3 className="adm-subtitle">Покупки</h3>
              <Table head={['Товар', 'Звёзды', 'Статус', 'Дата']} empty="Покупок нет">
                {selected.payments.map((row) => (
                  <tr key={String(row.chargeId)}>
                    <td>{String(row.sku)}</td>
                    <td>{String(row.stars)}</td>
                    <td>{String(row.status)}</td>
                    <td>{formatDateTime(Number(row.createdAt ?? 0))}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </div>

          <h3 className="adm-subtitle">События</h3>
          <Table head={['Тип', 'Значение', 'Когда']} empty="Событий нет">
            {selected.events.map((row, index) => (
              <tr key={`${String(row.kind)}-${index}`}>
                <td>{String(row.kind)}</td>
                <td>{String(row.value)}</td>
                <td>{formatDateTime(Number(row.createdAt ?? 0))}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </div>
  );
}
