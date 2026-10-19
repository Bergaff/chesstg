import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../context/AppContext';
import { api, ApiError } from '../lib/api';
import { cn, formatNumber, initialOf } from '../lib/format';
import { shareContent } from '../lib/telegram';
import type { LeaderboardResponse, LeaderboardRow } from '../lib/types';
import { Icon } from '../components/Icon';

interface RecordsScreenProps {
  onBack: () => void;
}

type Metric = 'endless' | 'campaign';
type Scope = 'global' | 'friends';

export function RecordsScreen({ onBack }: RecordsScreenProps): ReactNode {
  const { profile, config, invitedCount, toast, goShop } = useApp();
  const [metric, setMetric] = useState<Metric>('endless');
  const [scope, setScope] = useState<Scope>('global');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await api<LeaderboardResponse>(`/api/leaderboard?metric=${metric}&scope=${scope}`);
      if (requestId === requestRef.current) setData(response);
    } catch (err) {
      if (requestId === requestRef.current) {
        setError(err instanceof ApiError ? err.message : 'Не удалось загрузить рекорды');
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [metric, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function shareInvite() {
    const link = data?.inviteLink ?? config.webappUrl;
    const text = 'Сыграй в «Пешку против всех»: проведи пешку через поле и не попадись фигурам. У меня уже есть рекорд — попробуй побить.';
    const status = await shareContent(text, link);
    if (status === 'copied') toast('Ссылка скопирована', 'success');
    if (status === 'failed') toast('Не удалось поделиться', 'error');
  }

  async function shareRecord() {
    const bot = config.botUsername;
    const payload =
      metric === 'endless' ? `ch_0_${profile.endlessBest}` : `ch_${profile.maxLevel}_${profile.maxLevel}`;
    const url = bot ? `https://t.me/${bot}?startapp=${payload}` : config.webappUrl;
    const text =
      metric === 'endless'
        ? `Мой рекорд в «Пешке против всех» — ${profile.endlessBest} клеток. Слабо выше?`
        : `Я дошёл до ${profile.maxLevel} уровня в «Пешке против всех». Сможешь лучше?`;
    const status = await shareContent(text, url);
    if (status === 'copied') toast('Ссылка скопирована', 'success');
    if (status === 'failed') toast('Не удалось поделиться', 'error');
  }

  const rows = data?.rows ?? [];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const myRank = data?.myRank ?? 0;
  const valueFor = (row: LeaderboardRow) =>
    metric === 'endless' ? `${formatNumber(row.endlessBest)} клеток` : `уровень ${row.maxLevel}`;

  return (
    <div className="screen records-screen">
      <header className="page-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Назад">
          <Icon name="back" size={20} />
        </button>
        <div className="page-title">
          <span>Таблица лидеров</span>
          <b>Рекорды</b>
        </div>
        <button type="button" className="icon-btn" onClick={() => void shareRecord()} aria-label="Поделиться рекордом">
          <Icon name="share" size={19} />
        </button>
      </header>

      <div className="records-stats">
        <div className="record-stat">
          <span className="record-stat-icon icon-infinity"><Icon name="infinity" size={17} /></span>
          <b>{formatNumber(profile.endlessBest)}</b>
          <span>клеток</span>
        </div>
        <div className="record-stat">
          <span className="record-stat-icon icon-trophy"><Icon name="trophy" size={17} /></span>
          <b>{profile.maxLevel}</b>
          <span>уровень</span>
        </div>
        <div className="record-stat">
          <span className="record-stat-icon icon-users"><Icon name="users" size={17} /></span>
          <b>{invitedCount}</b>
          <span>друзей</span>
        </div>
      </div>

      <div className="segmented metric-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={metric === 'endless'} className={metric === 'endless' ? 'active' : ''} onClick={() => setMetric('endless')}>
          <Icon name="infinity" size={15} />
          Бесконечный
        </button>
        <button type="button" role="tab" aria-selected={metric === 'campaign'} className={metric === 'campaign' ? 'active' : ''} onClick={() => setMetric('campaign')}>
          <Icon name="trophy" size={15} />
          Кампания
        </button>
      </div>

      <div className="scope-row">
        <button type="button" className={scope === 'global' ? 'scope-pill active' : 'scope-pill'} onClick={() => setScope('global')}>
          <Icon name="spark" size={13} />
          Глобально
        </button>
        <button type="button" className={scope === 'friends' ? 'scope-pill active' : 'scope-pill'} onClick={() => setScope('friends')}>
          <Icon name="users" size={13} />
          Друзья
        </button>
        {myRank > 0 && <span className="my-rank">твоё место #{myRank}</span>}
      </div>

      {loading && (
        <div className="leader-skeleton">
          {Array.from({ length: 5 }).map((_, index) => (
            <span key={index} className="skeleton-row" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="empty-state">
          <div className="empty-orb"><Icon name="close" size={26} /></div>
          <h3>Рекорды не загрузились</h3>
          <p>{error}</p>
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="empty-state">
          <div className="empty-orb"><Icon name="trophy" size={28} /></div>
          <h3>{scope === 'friends' ? 'Пока только ты' : 'Рекордов ещё нет'}</h3>
          <p>
            {scope === 'friends'
              ? 'Пригласи друга — он появится в этом списке. Telegram не отдаёт контакты без разрешения, поэтому друзья считаются по твоей ссылке.'
              : 'Пройди первый уровень или заверши забег — и твоё имя появится в таблице.'}
          </p>
          {scope === 'friends' && (
            <button type="button" className="btn btn-gold" onClick={() => void shareInvite()}>
              <Icon name="users" size={17} />
              Пригласить друга
            </button>
          )}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="podium">
            {[1, 0, 2].map((index) => {
              const row = podium[index];
              if (!row) return <div key={`empty-${index}`} className={cn('podium-card', 'podium-empty', `place-${index + 1}`)} />;
              return (
                <div key={row.rank} className={cn('podium-card', `place-${index + 1}`, row.isMe && 'is-me')}>
                  {index === 0 && <span className="podium-crown"><Icon name="crown" size={18} /></span>}
                  <span className={cn('podium-avatar', `place-${index + 1}`)}>
                    {initialOf(row.name)}
                  </span>
                  <span className="podium-name">{row.isMe ? 'Ты' : row.name}</span>
                  <span className="podium-value">{valueFor(row)}</span>
                  <span className="podium-place">{index + 1}</span>
                </div>
              );
            })}
          </div>

          <div className="leader-list">
            {rest.map((row) => (
              <div key={`${row.rank}-${row.name}`} className={cn('leader-row', row.isMe && 'is-me')}>
                <span className="leader-rank">{row.rank}</span>
                <span className="leader-avatar">{initialOf(row.name)}</span>
                <span className="leader-name">
                  {row.name}
                  {row.isMe && <em>ты</em>}
                </span>
                <span className="leader-value">{valueFor(row)}</span>
              </div>
            ))}
          </div>

          {myRank > 0 && (
            <div className="my-rank-row">
              <Icon name="spark" size={15} />
              Твоё место: <b>#{myRank}</b>
            </div>
          )}
        </>
      )}

      {scope === 'friends' && rows.length > 0 && (
        <div className="invite-card">
          <div className="invite-art"><Icon name="users" size={24} /></div>
          <div>
            <b>Позови друга</b>
            <p>Он появится в таблице друзей, а вы оба получите по 25 🪙.</p>
          </div>
          <button type="button" className="btn btn-gold" onClick={() => void shareInvite()}>
            <Icon name="share" size={15} />
            Позвать
          </button>
        </div>
      )}

      <p className="records-footnote">
        {scope === 'friends'
          ? 'Друзья — те, кто пришёл по твоей ссылке. Контакты Telegram игра не запрашивает.'
          : 'Рекорд фиксируется после завершения забега. Гости в мировой таблице не участвуют.'}
      </p>

      <button type="button" className="records-shop-link" onClick={goShop}>
        <Icon name="bag" size={15} />
        Заглянуть в магазин
      </button>
    </div>
  );
}
