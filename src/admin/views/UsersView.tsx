import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AdminError, fetchUser, fetchUsers } from '../api';
import type { UserDetailResponse, UserRunRow, UsersResponse } from '../types';
import { Panel, StatusLine, Table, formatDateTime, formatNumber, modeTitle } from '../ui';

const BONUS_TITLES: Record<string, string> = { hint: 'Подсказка', freeze: 'Заморозка', undo: 'Отмена' };
const SOURCE_TITLES: Record<string, string> = {
  purchase: 'покупка',
  ad: 'реклама',
  reward: 'награда',
  level: 'уровень',
  welcome: 'приветствие',
};
const AD_TITLES: Record<string, string> = { life: 'жизнь', coins: 'монеты', reward: 'награда' };
const PIECE_TITLES: Record<string, string> = {
  pawn: 'пешка',
  rook: 'ладья',
  bishop: 'слон',
  knight: 'конь',
  queen: 'ферзь',
};

function bonusTitle(kind: string): string {
  return BONUS_TITLES[kind] ?? kind;
}

function sourceTitle(source: string): string {
  return SOURCE_TITLES[source] ?? source;
}

function adTitle(kind: string): string {
  return AD_TITLES[kind] ?? kind;
}

function pieceTitle(type: string): string {
  return PIECE_TITLES[type] ?? type;
}

/** Итог забега одним словом: «выигран», «пойман (ферзь)», «тупик поля», «в процессе». */
function runOutcome(row: UserRunRow): ReactNode {
  const status = String(row.status);
  if (status === 'active') return <span className="adm-muted">в процессе</span>;
  if (status === 'won') return 'выигран';
  if (status === 'quit') return 'свернут';
  if (row.stuck) return 'тупик поля';
  const captured = row.capturedBy ? String(row.capturedBy) : '';
  return captured ? `пойман (${pieceTitle(captured)})` : 'проигран';
}

/** Уровень режима: «текущий из лучшего», при отсутствии колонки «нет данных». */
function levelCell(current: number | null, best: number | null): ReactNode {
  if (current === null || best === null) return <small className="adm-muted">нет данных</small>;
  if (current === best) return <span>{current}</span>;
  return (
    <span>
      {current}
      <small className="adm-muted"> из {best}</small>
    </span>
  );
}

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

        {data?.degraded && (
          <StatusLine kind="info">
            Прогресс «Парковки» и «Гонок» не виден: в базе нет колонки mode_levels. Примените
            миграцию 0004_mode_levels в SQL консоли D1.
          </StatusLine>
        )}

        <Table
          head={[
            'Игрок',
            'Кампания',
            'Парковка',
            'Гонки',
            'Рекорд',
            'Монеты',
            'Забеги',
            'Покупки',
            'Активность',
          ]}
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
              <td>{levelCell(row.jamLevel, row.jamMax)}</td>
              <td>{levelCell(row.raceLevel, row.raceMax)}</td>
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

          {selected.progress && (
            <>
              <h3 className="adm-subtitle">Прогресс по режимам</h3>
              <div className="adm-metrics is-compact">
                {(['campaign', 'jam', 'race', 'endless'] as const).map((mode) => {
                  const entry = selected.progress?.[mode];
                  if (!entry) return null;
                  return (
                    <div key={mode} className="adm-metric">
                      <span className="adm-metric-label">{modeTitle(mode)}</span>
                      <span className="adm-metric-value">
                        {mode === 'endless'
                          ? String(selected.user.endless_best ?? 0)
                          : `${entry.level} из ${entry.maxLevel}`}
                      </span>
                      <small className="adm-muted">
                        {entry.unlocked ? 'открыт' : `откроется на ${entry.unlockAtLevel} уровне кампании`}
                      </small>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="adm-grid">
            <div>
              <h3 className="adm-subtitle">Какие уровни проходил</h3>
              <Table
                head={['Режим', 'Уровень', 'Попыток', 'Выиграно', 'Проиграно', 'Брошено', 'Ходов', 'Первый', 'Последний']}
                empty="Уровни не запускались"
              >
                {(selected.history ?? []).map((row) => (
                  <tr key={`${row.mode}-${row.level}`}>
                    <td>{modeTitle(row.mode)}</td>
                    <td>{row.level}</td>
                    <td>{row.played}</td>
                    <td>{row.won}</td>
                    <td>{row.lost}</td>
                    <td>{row.quit}</td>
                    <td>{row.avgMoves.toFixed(1)}</td>
                    <td>{formatDateTime(row.firstAt)}</td>
                    <td>{formatDateTime(row.lastAt)}</td>
                  </tr>
                ))}
              </Table>
            </div>

            <div>
              <h3 className="adm-subtitle">Бонусы и реклама</h3>
              <Table head={['Бонус', 'Откуда', 'Раз', 'Последний раз']} empty="Бонусов нет">
                {(selected.grants ?? []).map((row, index) => (
                  <tr key={`${row.kind}-${row.source}-${index}`}>
                    <td>{bonusTitle(row.kind)}</td>
                    <td>{sourceTitle(row.source)}</td>
                    <td>{row.n}</td>
                    <td>{formatDateTime(row.lastAt)}</td>
                  </tr>
                ))}
              </Table>
              <Table head={['Реклама', 'Просмотров']} empty="Реклама не показывалась">
                {(selected.ads ?? []).map((row) => (
                  <tr key={row.kind}>
                    <td>{adTitle(row.kind)}</td>
                    <td>{row.n}</td>
                  </tr>
                ))}
              </Table>
              <Table head={['Режим', 'Забегов']} empty="Забегов нет">
                {(selected.byMode ?? []).map((row) => (
                  <tr key={row.mode}>
                    <td>{modeTitle(row.mode)}</td>
                    <td>{row.n}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </div>

          <div className="adm-grid">
            <div>
              <h3 className="adm-subtitle">Последние забеги</h3>
              <Table
                head={['Режим', 'Уровень', 'Ходы', 'Итог', 'Монеты', 'Зерно', 'Обновлён']}
                empty="Забегов нет"
              >
                {selected.runs.map((row) => (
                  <tr key={String(row.id)}>
                    <td>{modeTitle(String(row.mode))}</td>
                    <td>{String(row.level)}</td>
                    <td>{String(row.moves)}</td>
                    <td>{runOutcome(row)}</td>
                    <td>{formatNumber(row.coinsEarned)}</td>
                    <td>
                      <small className="adm-muted">{String(row.seed)}</small>
                    </td>
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
