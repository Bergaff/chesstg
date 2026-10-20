import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AdminError, fetchPayments } from '../api';
import type { PaymentsResponse } from '../types';
import { Metric, Panel, StatusLine, Table, formatDateTime, formatNumber } from '../ui';

const RANGES = [7, 30, 90, 365];

const SKU_TITLE: Record<string, string> = {
  lives: 'Пять жизней',
  noads: 'Без рекламы',
  skins: 'Набор скинов',
};

const STATUS_TITLE: Record<string, string> = {
  pending: 'ожидает',
  paid: 'оплачен',
  failed: 'ошибка',
  refunded: 'возврат',
};

export function PaymentsView({ onUnauthorized }: { onUnauthorized: (message: string) => void }): ReactNode {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<PaymentsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchPayments(days));
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось загрузить платежи');
    } finally {
      setLoading(false);
    }
  }, [days, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  const paid = (data?.summary ?? []).filter((row) => row.status === 'paid');
  const paidCount = paid.reduce((sum, row) => sum + Number(row.n), 0);
  const refunded = (data?.summary ?? []).filter((row) => row.status === 'refunded');
  const refundedStars = refunded.reduce((sum, row) => sum + Number(row.stars), 0);

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
          <Panel title="Выручка" note="Telegram Stars, только оплаченные счета">
            <div className="adm-metrics">
              <Metric label="Звёзд" value={formatNumber(data.stars)} tone="accent" />
              <Metric label="Покупок" value={formatNumber(paidCount)} />
              <Metric label="Средний чек" value={paidCount ? (data.stars / paidCount).toFixed(1) : '0'} hint="звёзд" />
              <Metric label="Возвратов" value={formatNumber(refundedStars)} tone="danger" hint="звёзд" />
            </div>
          </Panel>

          <Panel title="По товарам" note="Сводка за период">
            <Table head={['Товар', 'Статус', 'Покупок', 'Звёзд']} empty="Платежей пока нет">
              {(data.summary ?? []).map((row) => (
                <tr key={`${row.sku}-${row.status}`}>
                  <td>{SKU_TITLE[row.sku] ?? row.sku}</td>
                  <td>{STATUS_TITLE[row.status] ?? row.status}</td>
                  <td>{formatNumber(row.n)}</td>
                  <td>{formatNumber(row.stars)}</td>
                </tr>
              ))}
            </Table>
          </Panel>

          <Panel title="Последние счета" note="Не больше 100 строк">
            <Table head={['Игрок', 'Товар', 'Звёзды', 'Статус', 'Создан', 'Оплачен']} empty="Счетов пока нет">
              {(data.rows ?? []).map((row) => (
                <tr key={row.chargeId}>
                  <td>{row.username ? `@${row.username}` : row.name || row.userId.slice(0, 14)}</td>
                  <td>{SKU_TITLE[row.sku] ?? row.sku}</td>
                  <td>{row.stars}</td>
                  <td>{STATUS_TITLE[row.status] ?? row.status}</td>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{row.paidAt ? formatDateTime(row.paidAt) : 'нет'}</td>
                </tr>
              ))}
            </Table>
          </Panel>

          <p className="adm-note">
            Если бот не настроен, счета не создаются и таблица останется пустой. Возвраты приходят вебхуком
            Telegram и откатывают покупку.
          </p>
        </>
      )}
    </div>
  );
}
