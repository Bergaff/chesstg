import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../context/AppContext';
import { api, ApiError } from '../lib/api';
import { appBaseUrl, cn, formatNumber } from '../lib/format';
import { shareContent } from '../lib/telegram';
import type { LeaderboardResponse, LeaderboardRow } from '../lib/types';

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
    const link = data?.inviteLink ?? appBaseUrl(config.webappUrl);
    const text = 'Загляните в «Пешку против всех»: пешка идёт через поле, фигуры охотятся. У меня уже есть рекорд, попробуйте побить.';
    const status = await shareContent(text, link);
    if (status === 'copied') toast('Ссылка скопирована', 'success');
    if (status === 'failed') toast('Не удалось поделиться', 'error');
  }

  async function shareRecord() {
    const bot = config.botUsername;
    const payload =
      metric === 'endless' ? `ch_0_${profile.endlessBest}` : `ch_${profile.maxLevel}_${profile.maxLevel}`;
    const url = bot ? `https://t.me/${bot}?startapp=${payload}` : appBaseUrl(config.webappUrl);
    const text =
      metric === 'endless'
        ? `Мой рекорд в «Пешке против всех», ${profile.endlessBest} клеток. Слабо выше?`
        : `Я дошёл до ${profile.maxLevel} уровня в «Пешке против всех». Сможешь лучше?`;
    const status = await shareContent(text, url);
    if (status === 'copied') toast('Ссылка скопирована', 'success');
    if (status === 'failed') toast('Не удалось поделиться', 'error');
  }

  const rows = data?.rows ?? [];
  const myRank = data?.myRank ?? 0;
  const valueFor = (row: LeaderboardRow) =>
    metric === 'endless' ? `${formatNumber(row.endlessBest)} клеток` : `уровень ${row.maxLevel}`;

  return (
    <div className="screen records-screen">
      <header className="page-top">
        <button type="button" className="back-btn" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <div className="page-heading" style={{ flex: 1 }}>
          <span className="label">Таблица лидеров</span>
          <h1 className="page-title">Рекорды</h1>
        </div>
        <button type="button" className="btn btn-quiet" style={{ minHeight: 30, padding: '0 4px', fontSize: 11 }} onClick={() => void shareRecord()}>
          Поделиться
        </button>
      </header>

      <div className="metric-row">
        <span className="metric-key">Рекорд высоты</span>
        <span className="metric-val">{formatNumber(profile.endlessBest)}</span>
      </div>
      <div className="metric-row">
        <span className="metric-key">Достигнутый уровень</span>
        <span className="metric-val">{profile.maxLevel}</span>
      </div>
      <div className="metric-row">
        <span className="metric-key">Приглашено друзей</span>
        <span className="metric-val">{invitedCount}</span>
      </div>

      <div className="tabs" role="tablist" style={{ marginTop: 20 }}>
        <button type="button" role="tab" aria-selected={metric === 'endless'} className={cn('tab', metric === 'endless' && 'active')} onClick={() => setMetric('endless')}>
          Бесконечный
        </button>
        <button type="button" role="tab" aria-selected={metric === 'campaign'} className={cn('tab', metric === 'campaign' && 'active')} onClick={() => setMetric('campaign')}>
          Кампания
        </button>
      </div>

      <div className="filter-row">
        <button type="button" className={cn('filter', scope === 'global' && 'active')} onClick={() => setScope('global')}>
          Мировая таблица
        </button>
        <button type="button" className={cn('filter', scope === 'friends' && 'active')} onClick={() => setScope('friends')}>
          Друзья
        </button>
        {myRank > 0 && <span className="my-rank">ваше место: {myRank}</span>}
      </div>

      {loading && <p className="loading-line">Загружаем таблицу.</p>}

      {!loading && error && (
        <div className="empty-state">
          <h3>Рекорды не загрузились</h3>
          <p>{error}</p>
          <button type="button" className="btn btn-outline" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="empty-state">
          <h3>{scope === 'friends' ? 'Пока только вы' : 'Рекордов ещё нет'}</h3>
          <p>
            {scope === 'friends'
              ? 'Пригласите друга, и он появится в этом списке. Telegram не отдаёт контакты без разрешения, поэтому друзья считаются по вашей ссылке.'
              : 'Пройдите первый уровень или завершите забег, и имя появится в таблице.'}
          </p>
          {scope === 'friends' && (
            <button type="button" className="btn btn-primary" onClick={() => void shareInvite()}>
              Пригласить друга
            </button>
          )}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="rank-head">
            <span className="label">{metric === 'endless' ? 'Клеток' : 'Уровень'}</span>
            <span className="label">{scope === 'friends' ? 'Друзья' : 'Все игроки'}</span>
          </div>
          <div className="rank-list">
            {rows.map((row) => (
              <div key={`${row.rank}-${row.name}`} className={cn('rank-row', row.isMe && 'is-me')}>
                <span className="rank-no">{row.rank}</span>
                <span className="rank-name">
                  {row.name}
                  {row.isMe && <em>вы</em>}
                </span>
                <span className="rank-value">{valueFor(row)}</span>
              </div>
            ))}
          </div>

          {myRank > 0 && (
            <div className="rank-head">
              <span className="label">Ваше место</span>
              <span className="rank-value">{myRank}</span>
            </div>
          )}
        </>
      )}

      {scope === 'friends' && rows.length > 0 && (
        <div className="invite-block">
          <b>Позвать друга</b>
          <p>Он появится в таблице друзей, а вы оба получите по 25 монет.</p>
          <button type="button" className="btn btn-outline" onClick={() => void shareInvite()}>
            Отправить ссылку
          </button>
        </div>
      )}

      <p className="records-footnote">
        {scope === 'friends'
          ? 'Друзья это те, кто пришёл по вашей ссылке. Контакты Telegram игра не запрашивает.'
          : 'Рекорд фиксируется после завершения забега. Гости в мировой таблице не участвуют.'}
      </p>

      <button type="button" className="records-shop-link" onClick={goShop}>
        Заглянуть в магазин
      </button>
    </div>
  );
}
