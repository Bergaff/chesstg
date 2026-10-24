import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { SkinPreview } from '../../components/SkinPreview';
import { AdminError, fetchSkins, reviewSkin } from '../api';
import type { SkinShareItem, SkinsResponse } from '../types';
import { Metric, Panel, StatusLine, Table, formatDateTime, formatNumber } from '../ui';

/**
 * Очередь тем.
 *
 * Игрок делает тему для себя бесплатно, и в галерею она попадает только после
 * ручного «да»: автоматическая проверка подтверждает контраст, а не то, что
 * картинка не оскорбительная и не залитый квадрат. Здесь ровно то, что нужно
 * увидеть руками, - образец доски, цифры читаемости и кто автор.
 */

const STATUSES = [
  { id: 'pending', title: 'Ждут проверки' },
  { id: 'approved', title: 'В галерее' },
  { id: 'rejected', title: 'Отклонены' },
  { id: 'draft', title: 'Черновики' },
] as const;

type StatusId = (typeof STATUSES)[number]['id'];

export function SkinsView({ onUnauthorized }: { onUnauthorized: (message: string) => void }): ReactNode {
  const [status, setStatus] = useState<StatusId>('pending');
  const [data, setData] = useState<SkinsResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchSkins(status));
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось загрузить очередь');
    } finally {
      setLoading(false);
    }
  }, [status, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: SkinShareItem, decision: 'approve' | 'reject') {
    setBusy(item.id);
    setError('');
    try {
      await reviewSkin(item.id, decision, note[item.id] ?? '');
      setNote((prev) => ({ ...prev, [item.id]: '' }));
      await load();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'Заявка не разобрана');
    } finally {
      setBusy(null);
    }
  }

  const countOf = (id: StatusId) => Number((data?.counts ?? []).find((row) => row.status === id)?.n ?? 0);
  const installs = (data?.counts ?? [])
    .filter((row) => row.status === 'approved')
    .reduce((sum, row) => sum + Number(row.installs), 0);
  const broken = (data?.items ?? []).filter((item) => !item.skin).length;

  return (
    <div className="adm-stack">
      <div className="adm-toolbar">
        <div className="adm-range" role="group" aria-label="Статус заявок">
          {STATUSES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`adm-chip${status === item.id ? ' is-active' : ''}`}
              onClick={() => setStatus(item.id)}
            >
              {item.title} · {countOf(item.id)}
            </button>
          ))}
        </div>
        <button type="button" className="adm-btn adm-btn-outline" onClick={() => void load()} disabled={loading}>
          {loading ? 'Обновляем' : 'Обновить'}
        </button>
      </div>

      {error && <StatusLine kind="error">{error}</StatusLine>}

      <Panel title="Публикации тем" note="Своя тема бесплатна, платит тот, кто хочет показать её другим">
        <div className="adm-metrics">
          <Metric label="В очереди" value={formatNumber(countOf('pending'))} tone="accent" />
          <Metric label="В галерее" value={formatNumber(countOf('approved'))} />
          <Metric label="Установков" value={formatNumber(installs)} hint="сколько раз чужие темы надели" />
          <Metric label="Без разбора" value={formatNumber(broken)} tone={broken > 0 ? 'danger' : undefined} hint="запись не читается" />
        </div>
      </Panel>

      <Panel
        title={STATUSES.find((item) => item.id === status)?.title ?? ''}
        note="Одобрить можно только заявку из очереди; отклонить - и уже опубликованную"
      >
        <Table
          head={['Образец', 'Тема', 'Автор', 'Читаемость', 'Установок', 'Заявка', 'Решение']}
          empty={
            status === 'pending'
              ? 'Очередь пуста: тем, за которые заплатили взнос, сейчас нет.'
              : 'Строк нет.'
          }
        >
          {(data?.items ?? []).map((item) => (
            <tr key={item.id}>
              <td>
                {item.skin ? (
                  <SkinPreview skin={item.skin ?? undefined} cell={20} />
                ) : (
                  <SkinPreview cell={20} className="is-broken" />
                )}
              </td>
              <td>
                <b>{item.name}</b>
                {item.broken && <div className="adm-note">запись повреждена - одобрить нельзя</div>}
              </td>
              <td>{item.author}</td>
              <td>
                {item.readability
                  ? `${item.readability.glyph.toFixed(1)}:1 / ${item.readability.board.toFixed(1)}:1 ${item.readability.ok ? '' : '· мимо'}`
                  : 'нет данных'}
                {item.readability && !item.readability.ok && <div className="adm-note">автоматическая проверка не прошла</div>}
              </td>
              <td>{formatNumber(item.installs)}</td>
              <td>{formatDateTime(item.createdAt)}</td>
              <td>
                <div className="adm-skin-actions">
                  <input
                    className="adm-skin-note"
                    type="text"
                    value={note[item.id] ?? ''}
                    placeholder="причина отказа"
                    onChange={(event) => setNote((prev) => ({ ...prev, [item.id]: event.target.value }))}
                  />
                  {/* Кнопки повторяют правила сервера: одобрить можно только
                      заявку из очереди, отклонить - и то, что уже в галерее. */}
                  {status === 'pending' && (
                    <button
                      type="button"
                      className="adm-btn adm-btn-primary"
                      onClick={() => void decide(item, 'approve')}
                      disabled={busy === item.id || !item.skin || (item.readability ? !item.readability.ok : true)}
                    >
                      Одобрить
                    </button>
                  )}
                  {status !== 'rejected' && (
                    <button
                      type="button"
                      className="adm-btn adm-btn-quiet"
                      onClick={() => void decide(item, 'reject')}
                      disabled={busy === item.id}
                    >
                      Отклонить
                    </button>
                  )}
                </div>
                {item.note && <div className="adm-note">заметка: {item.note}</div>}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      <p className="adm-note">
        Тема в галерее устанавливается игроками бесплатно и навсегда: взнос платится один раз за то, что
        её поставили в общий список, а не за каждую примерку. Отключение темы у тех, кто её уже надел,
        не откатывается - поэтому в отказе стоит писать причину.
      </p>
    </div>
  );
}
