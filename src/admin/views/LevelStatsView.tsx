import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AdminError, fetchLevelStats } from '../api';
import type { LevelStatRow, LevelStatsResponse } from '../types';
import { Panel, StatusLine, Table, formatNumber, formatPercent } from '../ui';

const MODES = [
  { id: 'campaign', title: 'Кампания' },
  { id: 'jam', title: 'Парковка' },
  { id: 'race', title: 'Гонки' },
] as const;

const RANGES = [7, 30, 90];

type Mode = (typeof MODES)[number]['id'];

/**
 * Сколько уровней режима люди реально играют и где встают. Отдельно помечены
 * уровни с тупиками (генератор выдал поле без хода) и «край» самый дальний
 * уровень, до которого кто-то дошёл в выбранном окне.
 */
export function LevelStatsView({ onUnauthorized }: { onUnauthorized: (message: string) => void }): ReactNode {
  const [mode, setMode] = useState<Mode>('campaign');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<LevelStatsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchLevelStats(mode, days));
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось загрузить статистику уровней');
    } finally {
      setLoading(false);
    }
  }, [days, mode, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const busy = rows.filter((row) => row.played >= 10);
  const edge = rows.reduce<LevelStatRow | null>(
    (best, row) => (row.played > 0 && (!best || row.level > best.level) ? row : best),
    null,
  );
  const stuckLevels = rows.filter((row) => row.stuck > 0).length;
  const stuckLabel = data?.stuckLabel ?? 'Тупиков';
  const jam = (data?.mode ?? mode) === 'jam';
  // «Гонки» уровня не выигрывают: там тяжело считается по длине забега, а не
  // по доле побед.
  const recordMode = data?.recordMode === true;
  const hardLevels = recordMode
    ? busy.filter((row) => row.avgScore < 10).length
    : busy.filter((row) => row.winRate < 0.25).length;

  return (
    <div className="adm-stack">
      <div className="adm-toolbar">
        <div className="adm-range" role="group" aria-label="Режим">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`adm-chip${mode === item.id ? ' is-active' : ''}`}
              onClick={() => setMode(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>
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
      </div>

      {error && <StatusLine kind="error">{error}</StatusLine>}
      {loading && <StatusLine kind="info">Считаем прохождения.</StatusLine>}

      <Panel
        title="Прохождения по уровням"
        note={`Уровни режима «${MODES.find((item) => item.id === mode)?.title}» за ${days} дней`}
        actions={
          <button type="button" className="adm-btn adm-btn-outline" onClick={() => void load()} disabled={loading}>
            {loading ? 'Считаем' : 'Обновить'}
          </button>
        }
      >
        <div className="adm-stats-note">
          <span>
            уровней в выборке <b>{rows.length}</b>
          </span>
          <span>
            забегов <b>{formatNumber(rows.reduce((sum, row) => sum + row.played, 0))}</b>
          </span>
          <span>
            игроков <b>{formatNumber(rows.reduce((sum, row) => sum + row.players, 0))}</b>
          </span>
          <span>
            уровней с провалами <b>{stuckLevels}</b>
          </span>
          <span>
            {recordMode ? 'уровней со средним рядом ниже 10' : 'уровней с долей побед ниже 25%'} <b>{hardLevels}</b>
          </span>
          {edge && (
            <span>
              край прохождения <b>уровень {edge.level}</b>
            </span>
          )}
        </div>

        <Table
          head={[
            'Уровень',
            'Игроков',
            'Забегов',
            ...(recordMode ? ['Лучший ряд', 'Средний ряд'] : ['Побед', 'Доля']),
            'Проигрышей',
            stuckLabel,
            'Брошено',
            'Активно',
            'Попыток на игрока',
            'Ходов',
            ...(recordMode ? [] : ['Средний счёт']),
            'Подсказок',
            'Заморозок',
            'Отмен',
            'Первый забег',
            'Последний',
          ]}
          empty="За это время уровней не запускали"
        >
          {rows.map((row) => (
            <tr key={row.level}>
              <td>
                {row.level}
                {edge?.level === row.level && <small className="adm-muted"> край</small>}
                {!recordMode && row.played >= 10 && row.winRate < 0.25 && <small className="adm-row-flag"> тяжело</small>}
              </td>
              <td>{row.players}</td>
              <td>{row.played}</td>
              {recordMode ? (
                <>
                  <td>{row.bestScore ?? 0}</td>
                  <td>{row.avgScore.toFixed(1)}</td>
                </>
              ) : (
                <>
                  <td>{row.won}</td>
                  <td>{formatPercent(row.winRate, 1)}</td>
                </>
              )}
              <td>{row.lost}</td>
              <td>
                {row.stuck > 0 ? <span className="adm-row-flag">{row.stuck}</span> : 0}
              </td>
              <td>{row.quit}</td>
              <td>{row.active}</td>
              <td>{row.attemptsPerPlayer.toFixed(2)}</td>
              <td>{row.avgMoves.toFixed(1)}</td>
              {!recordMode && <td>{row.avgScore.toFixed(1)}</td>}
              <td>{row.hints}</td>
              <td>{row.freezes}</td>
              <td>{row.undos}</td>
              <td>{formatDateOnly(row.firstAt)}</td>
              <td>{formatDateOnly(row.lastAt)}</td>
            </tr>
          ))}
        </Table>

        <p className="adm-note">
          {jam
            ? 'Провал в «Парковке» это кончившийся бюджет ходов: уровень либо слишком плотный для данного числа перестановок, либо игрок пробовал один раз и бросил. «Попыток на игрока» выше трёх значит, что уровни переставляют наугад.'
            : '«Тупик» это поражение, где фигуры не сделали ни одного взятия: такое поле обязан перебрать генератор, а не игрок. «Попыток на игрока» выше двух говорит, что уровень проходят с пятого раза, и это уже про сложность, а не про интерес.'}
        </p>
      </Panel>
    </div>
  );
}

function formatDateOnly(ms: number): string {
  if (!ms) return 'нет';
  return new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
