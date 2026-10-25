import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../context/AppContext';
import { modeDef } from '../engine';
import { api, ApiError } from '../lib/api';
import { appBaseUrl, cn, formatNumber } from '../lib/format';
import { shareContent } from '../lib/telegram';
import type { LeaderboardResponse, LeaderboardRow } from '../lib/types';
import { tr, trf } from '../lib/i18n';

interface RecordsScreenProps {
  onBack: () => void;
}

type Metric = 'endless' | 'campaign' | 'jam' | 'race';
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
        setError(err instanceof ApiError ? err.message : tr('Не удалось загрузить рекорды'));
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
    const text = tr('Загляните в «Край доски»: там три режима на одной доске и фигуры, которые охотятся. У меня уже есть рекорд, попробуйте побить.');
    const status = await shareContent(text, link);
    if (status === 'copied') toast(tr('Ссылка скопирована'), 'success');
    if (status === 'failed') toast(tr('Не удалось поделиться'), 'error');
  }

  async function shareRecord() {
    const bot = config.botUsername;
    const levelMetric = metric === 'campaign' || metric === 'jam' || metric === 'race';
    const payload =
      metric === 'endless'
        ? `ch_0_${profile.endlessBest}`
        : metric === 'campaign'
          ? `ch_${profile.maxLevel}_${profile.maxLevel}`
          : 'play';
    const url = bot ? `https://t.me/${bot}?startapp=${payload}` : appBaseUrl(config.webappUrl);
    const level = metric === 'campaign' ? profile.maxLevel : profile.modes?.[metric]?.level ?? 1;
    const text =
      metric === 'endless'
        ? trf('Мой рекорд в «Крае доски», {0} клеток. Слабо выше?', [profile.endlessBest])
        : metric === 'campaign'
          ? trf('Я дошёл до {0} уровня в «Крае доски». Сможешь лучше?', [profile.maxLevel])
          : trf('В режиме «{0}» я на {1} уровне {2}.', [tr(modeDef(metric).name), level, levelMetric ? tr(', дойдите и вы') : '']);
    const status = await shareContent(text, url);
    if (status === 'copied') toast(tr('Ссылка скопирована'), 'success');
    if (status === 'failed') toast(tr('Не удалось поделиться'), 'error');
  }

  const rows = data?.rows ?? [];
  const myRank = data?.myRank ?? 0;
  const valueFor = (row: LeaderboardRow) =>
    metric === 'endless'
      ? trf('{0} клеток', [formatNumber(row.endlessBest)])
      : metric === 'campaign'
        ? trf('уровень {0}', [row.maxLevel])
        : metric === 'race'
          ? trf('{0} ходов, уровень {1}', [row.modeBest ?? 0, row.modeLevel])
          : trf('уровень {0}', [row.modeLevel]);

  return (
    <div className="screen records-screen">
      <header className="page-top">
        <button type="button" className="back-btn" onClick={onBack} aria-label={tr('Назад')}>
          ←
        </button>
        <div className="page-heading" style={{ flex: 1 }}>
          <span className="label">{tr('Таблица лидеров')}</span>
          <h1 className="page-title">{tr('Рекорды')}</h1>
        </div>
      </header>

      <div className="metric-row">
        <span className="metric-key">{tr('Рекорд высоты')}</span>
        <span className="metric-val">{formatNumber(profile.endlessBest)}</span>
      </div>
      <div className="metric-row">
        <span className="metric-key">{tr('Достигнутый уровень')}</span>
        <span className="metric-val">{profile.maxLevel}</span>
      </div>
      <div className="metric-row">
        <span className="metric-key">{tr('Приглашено друзей')}</span>
        <span className="metric-val">{invitedCount}</span>
      </div>

      <div className="tabs" role="tablist" style={{ marginTop: 20 }}>
        <button type="button" role="tab" aria-selected={metric === 'endless'} className={cn('tab', metric === 'endless' && 'active')} onClick={() => setMetric('endless')}>
          {tr('Бесконечный')}
        </button>
        <button type="button" role="tab" aria-selected={metric === 'campaign'} className={cn('tab', metric === 'campaign' && 'active')} onClick={() => setMetric('campaign')}>
          {tr('Кампания')}
        </button>
        <button type="button" role="tab" aria-selected={metric === 'jam'} className={cn('tab', metric === 'jam' && 'active')} onClick={() => setMetric('jam')}>
          {tr('Парковка')}
        </button>
        <button type="button" role="tab" aria-selected={metric === 'race'} className={cn('tab', metric === 'race' && 'active')} onClick={() => setMetric('race')}>
          {tr('Гонки')}
        </button>
      </div>

      <div className="filter-row">
        <button type="button" className={cn('filter', scope === 'global' && 'active')} onClick={() => setScope('global')}>
          {tr('Мировая таблица')}
        </button>
        <button type="button" className={cn('filter', scope === 'friends' && 'active')} onClick={() => setScope('friends')}>
          {tr('Друзья')}
        </button>
        {/*
            Поделиться стоит в строке фильтра, между «Друзьями» и «вашим местом»:
            в шапке кнопка спорила с заголовком, а результат таблицы смотрят вот
            здесь - делиться тем, что видно рядом.
          */}
        <button type="button" className="btn btn-outline records-share" onClick={() => void shareRecord()}>
          {tr('Поделиться')}
        </button>
        {myRank > 0 && <span className="my-rank">{tr('ваше место:')} {myRank}</span>}
      </div>

      {loading && <p className="loading-line">{tr('Загружаем таблицу.')}</p>}

      {!loading && error && (
        <div className="empty-state">
          <h3>{tr('Рекорды не загрузились')}</h3>
          <p>{error}</p>
          <button type="button" className="btn btn-outline" onClick={() => void load()}>
            {tr('Повторить')}
          </button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="empty-state">
          <h3>{scope === 'friends' ? tr('Пока только вы') : tr('Рекордов ещё нет')}</h3>
          <p>
            {scope === 'friends'
              ? tr('Пригласите друга, и он появится в этом списке. Telegram не отдаёт контакты без разрешения, поэтому друзья считаются по вашей ссылке.')
              : tr('Пройдите первый уровень или завершите забег, и имя появится в таблице.')}
          </p>
          {scope === 'friends' && (
            <button type="button" className="btn btn-primary" onClick={() => void shareInvite()}>
              {tr('Пригласить друга')}
            </button>
          )}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="rank-head">
            <span className="label">{metric === 'endless' ? tr('Клеток') : tr('Уровень')}</span>
            <span className="label">{scope === 'friends' ? tr('Друзья') : tr('Все игроки')}</span>
          </div>
          <div className="rank-list">
            {rows.map((row) => (
              <div key={`${row.rank}-${row.name}`} className={cn('rank-row', row.isMe && 'is-me')}>
                <span className="rank-no">{row.rank}</span>
                <span className="rank-name">
                  {row.name}
                  {row.isMe && <em>{tr('вы')}</em>}
                </span>
                <span className="rank-value">{valueFor(row)}</span>
              </div>
            ))}
          </div>

          {myRank > 0 && (
            <div className="rank-head">
              <span className="label">{tr('Ваше место')}</span>
              <span className="rank-value">{myRank}</span>
            </div>
          )}
        </>
      )}

      {scope === 'friends' && rows.length > 0 && (
        <div className="invite-block">
          <b>{tr('Позвать друга')}</b>
          <p>{tr('Он появится в таблице друзей, а вы оба получите по 25 монет.')}</p>
          <button type="button" className="btn btn-outline" onClick={() => void shareInvite()}>
            {tr('Отправить ссылку')}
          </button>
        </div>
      )}

      <p className="records-footnote">
        {scope === 'friends'
          ? tr('Друзья это те, кто пришёл по вашей ссылке. Контакты Telegram игра не запрашивает.')
          : tr('Рекорд фиксируется после завершения забега. Гости в мировой таблице не участвуют.')}
      </p>

      <button type="button" className="records-shop-link" onClick={goShop}>
        {tr('Заглянуть в магазин')}
      </button>
    </div>
  );
}
