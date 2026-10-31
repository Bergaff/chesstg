import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { SkinPreview } from '../../components/SkinPreview';
import { AdminError, blockSkinAuthor, fetchOwnedSkins, fetchSkins, reviewSkin } from '../api';
import type { OwnedSkinsResponse, SkinShareItem, SkinsResponse } from '../types';
import { Metric, Panel, StatusLine, Table, formatDateTime, formatNumber } from '../ui';

/**
 * Очередь тем и то, что игроки носят.
 *
 * Место под свою тему куплено, править её бесплатно, и в галерею она попадает
 * только после ручного «да»: автоматическая проверка подтверждает контраст, а не
 * то, что картинка не оскорбительная и не залитый квадрат. Здесь ровно то, что
 * нужно увидеть руками, - образец доски, цифры читаемости и кто автор.
 *
 * Вторым блоком идут слоты игроков: очередь ловит только тех, кто сам принёс
 * тему на просмотр, а жалоба приходит и на рисунок, который человек надел себе
 * и показал друзьям кодом. Заморозка гасит носку, правку и публикацию, но не
 * отнимает купленное место - иначе модератор решал бы вопрос ценой работы.
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
  const [owned, setOwned] = useState<OwnedSkinsResponse | null>(null);
  const [ownedQuery, setOwnedQuery] = useState('');
  const [ownedLoading, setOwnedLoading] = useState(false);
  const [blockBusy, setBlockBusy] = useState<string | null>(null);

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

  const loadOwned = useCallback(
    async (query: string) => {
      setOwnedLoading(true);
      setError('');
      try {
        setOwned(await fetchOwnedSkins(query));
      } catch (err) {
        if (err instanceof AdminError && err.status === 401) {
          onUnauthorized('Сеанс истёк, войдите снова');
          return;
        }
        setError(err instanceof Error ? err.message : 'Не удалось загрузить темы игроков');
      } finally {
        setOwnedLoading(false);
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    void load();
    void loadOwned('');
  }, [load, loadOwned]);

  async function decideBlock(userId: string, blocked: boolean) {
    setBlockBusy(userId);
    setError('');
    try {
      await blockSkinAuthor(userId, blocked, blocked ? 'заморожено модератором' : '');
      await loadOwned(ownedQuery);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'Решение не записано');
    } finally {
      setBlockBusy(null);
    }
  }

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

      <Panel title="Публикации тем" note="Место под тему куплено, показ в галерее бесплатный: очередь держит только то, что авторы принесли на проверку">
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
          empty={status === 'pending' ? 'Очередь пуста: заявок на показ сейчас нет.' : 'Строк нет.'}
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

      <Panel
        title="Темы игроков по слотам"
        note="Что надето и что лежит в купленных местах. Здесь строк всегда больше, чем в очереди: свою тему можно не показывать никому"
        actions={
          <button
            type="button"
            className="adm-btn adm-btn-outline"
            onClick={() => void loadOwned(ownedQuery)}
            disabled={ownedLoading}
          >
            {ownedLoading ? 'Обновляем' : 'Обновить'}
          </button>
        }
      >
        <div className="adm-toolbar is-tight">
          <label className="adm-field is-grow">
            <span className="adm-label">Поиск</span>
            <input
              type="search"
              value={ownedQuery}
              placeholder="Имя, @username или tg_id"
              onChange={(event) => setOwnedQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void loadOwned(ownedQuery);
              }}
            />
          </label>
        </div>
        <div className="adm-metrics">
          {/* `summary` может и не прийти: ответ старого воркера или ошибка
              прокси не имеют права ронять вкладку, где сидит вся модерация тем. */}
          <Metric label="Владельцы слотов" value={formatNumber(owned?.summary?.owners ?? 0)} hint="из всех игроков" />
          <Metric label="Тем на полях" value={formatNumber(owned?.summary?.shown ?? 0)} />
          <Metric
            label="Заморожено"
            value={formatNumber(owned?.summary?.blocked ?? 0)}
            tone={(owned?.summary?.blocked ?? 0) > 0 ? 'danger' : undefined}
            hint="темы не надеются, не правятся и не публикуются"
          />
        </div>
        <Table
          head={['Образец', 'Слот', 'Тема', 'Автор', 'Состояние', 'Галерея', 'Правка', 'Решение']}
          empty="Ни у кого своей темы пока нет: слоты не куплены."
        >
          {(owned?.items ?? []).map((item) => (
            <tr key={`${item.userId}:${item.slot}`}>
              <td>
                {item.skin ? <SkinPreview skin={item.skin} cell={20} /> : <SkinPreview cell={20} className="is-broken" />}
              </td>
              <td>
                №{item.slot}
                {item.active && <div className="adm-note">активный</div>}
              </td>
              <td>
                <b>{item.name}</b>
                {!item.skin && <div className="adm-note">запись не читается - сервер носит вместо неё «Кость»</div>}
              </td>
              <td>
                {item.author}
                {item.tgId !== null && <div className="adm-note">id {item.tgId}</div>}
              </td>
              <td>{item.worn ? 'надета' : item.blocked ? 'заморожена' : 'не надета'}</td>
              <td>
                {formatNumber(item.published)}
                {item.queued > 0 && <div className="adm-note">в очереди: {item.queued}</div>}
              </td>
              <td>{formatDateTime(item.updatedAt)}</td>
              <td>
                <button
                  type="button"
                  className={item.blocked ? 'adm-btn adm-btn-primary' : 'adm-btn adm-btn-quiet'}
                  onClick={() => void decideBlock(item.userId, !item.blocked)}
                  disabled={blockBusy === item.userId}
                >
                  {item.blocked ? 'Разморозить' : 'Заморозить'}
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      <p className="adm-note">
        Публикация ничего не стоит: платят за слот, а не за то, что чужие увидели рисунок. Поэтому в
        галерее тема живёт, пока её не отклонили, а заморозка аккаунта снимает показ и гасит носку у того,
        кто её уже надел, - причину отказа стоит писать в заметку.
      </p>
    </div>
  );
}
