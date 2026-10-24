import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { heightForLevel, sizeForLevel } from '../../engine';
import { AdminError, checkLevel, fetchLevels } from '../api';
import type { LevelCheckReport, LevelCheckRow, LevelsResponse } from '../types';
import { Metric, Panel, StatusLine, Table, formatDateTime } from '../ui';

const SEED_OPTIONS = [2, 4, 6, 8];

export function LevelsView({ onUnauthorized }: { onUnauthorized: (message: string) => void }): ReactNode {
  const [data, setData] = useState<LevelsResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [level, setLevel] = useState(1);
  const [seeds, setSeeds] = useState(4);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<LevelCheckReport | null>(null);
  const [sweep, setSweep] = useState<{ active: boolean; done: number; total: number }>({
    active: false,
    done: 0,
    total: 0,
  });
  const sweepStop = useRef(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchLevels());
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось загрузить проверки');
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  const runCheck = useCallback(
    async (target: number, seedCount: number) => {
      setChecking(true);
      setError('');
      setNotice('');
      try {
        const response = await checkLevel(target, seedCount);
        setReport(response.report);
        setLevel(target);
        await load();
      } catch (err) {
        if (err instanceof AdminError && err.status === 401) {
          onUnauthorized('Сеанс истёк, войдите снова');
          return;
        }
        setError(err instanceof Error ? err.message : 'Проверка не удалась');
      } finally {
        setChecking(false);
      }
    },
    [load, onUnauthorized],
  );

  const runSweep = useCallback(async () => {
    if (sweep.active) return;
    sweepStop.current = false;
    setError('');
    setNotice('');
    const levels = Array.from({ length: 60 }, (_, index) => index + 1);
    setSweep({ active: true, done: 0, total: levels.length });
    let failed = 0;
    for (const target of levels) {
      if (sweepStop.current) break;
      try {
        await checkLevel(target, 3);
      } catch (err) {
        if (err instanceof AdminError && err.status === 401) {
          onUnauthorized('Сеанс истёк, войдите снова');
          return;
        }
        failed += 1;
      }
      setSweep((current) => ({ ...current, done: current.done + 1 }));
    }
    setSweep({ active: false, done: 0, total: 0 });
    await load();
    setNotice(failed > 0 ? `Проверка завершена, ошибок: ${failed}` : 'Проверка всех уровней завершена');
  }, [load, onUnauthorized, sweep.active]);

  const checks = data?.checks ?? [];
  const selected = useMemo(() => {
    const row = checks.find((item) => item.level === level);
    if (!row) return null;
    try {
      return JSON.parse(row.payload) as LevelCheckReport;
    } catch {
      return null;
    }
  }, [checks, level]);

  return (
    <div className="adm-stack">
      {error && <StatusLine kind="error">{error}</StatusLine>}
      {notice && <StatusLine kind="ok">{notice}</StatusLine>}

      <Panel
        title="Проверка генератора"
        note="Сервер собирает уровни и прогоняет разбор решения: оценка, попадание в полосу, состав фигур"
        actions={
          <button type="button" className="adm-btn adm-btn-outline" onClick={() => void load()}>
            Обновить
          </button>
        }
      >
        <div className="adm-toolbar is-tight">
          <label className="adm-field is-inline">
            <span className="adm-label">Уровень</span>
            <input
              type="number"
              min={1}
              max={60}
              value={level}
              onChange={(event) => {
                const next = Math.min(60, Math.max(1, Math.round(Number(event.target.value) || 1)));
                setLevel(next);
              }}
            />
          </label>
          <label className="adm-field is-inline">
            <span className="adm-label">Сид-вариантов</span>
            <select value={seeds} onChange={(event) => setSeeds(Number(event.target.value))}>
              {SEED_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="adm-btn adm-btn-primary"
            disabled={checking || sweep.active}
            onClick={() => void runCheck(level, seeds)}
          >
            {checking ? 'Считаем' : 'Проверить уровень'}
          </button>
          <button
            type="button"
            className="adm-btn adm-btn-outline"
            disabled={checking || sweep.active}
            onClick={() => void runSweep()}
          >
            Проверить 1–60
          </button>
          {sweep.active && (
            <button
              type="button"
              className="adm-btn adm-btn-quiet"
              onClick={() => {
                sweepStop.current = true;
              }}
            >
              Остановить
            </button>
          )}
        </div>

        {sweep.active && (
          <p className="adm-progress">
            Проверено {sweep.done} из {sweep.total}
          </p>
        )}

        {report && (
          <div className="adm-report">
            <div className="adm-metrics is-compact">
              <Metric label="Уровень" value={report.level} hint={`поле ${report.size}×${report.height ?? report.size}`} />
              <Metric label="Средняя оценка" value={report.avgScore} hint={`полоса ${report.band.min}–${report.band.max}`} />
              <Metric label="Разброс" value={`${report.minScore}–${report.maxScore}`} />
              <Metric
                label="В полосе"
                value={`${report.inBand} из ${report.total}`}
                tone={report.inBand === report.total ? 'ok' : 'danger'}
              />
              <Metric label="Фигур в среднем" value={report.avgPieces.toFixed(1)} hint={`цель ${report.targetPieces}`} />
              <Metric label="Время" value={`${report.elapsedMs} мс`} />
            </div>
            <Table head={['Сид', 'Оценка', 'Ходов', 'Первых ходов', 'Фигур', 'Решаем', 'Время']}>
              {report.results.map((row) => (
                <tr key={row.seed}>
                  <td className="is-mono">{row.seed}</td>
                  <td>{row.score}</td>
                  <td>{row.steps}</td>
                  <td>{row.firstMoves}</td>
                  <td>{row.pieces}</td>
                  <td>{row.solvable ? 'да' : 'нет'}</td>
                  <td>{row.ms} мс</td>
                </tr>
              ))}
            </Table>
          </div>
        )}

        {!report && selected && (
          <p className="adm-note">Последняя проверка уровня {selected.level}: средняя оценка {selected.avgScore}.</p>
        )}
      </Panel>

      <Panel title="Кэш проверок" note="Сохраняется в D1, повторный прогон перезаписывает строку">
        <Table
          head={['Уровень', 'Поле', 'Средняя', 'Разброс', 'В полосе', 'Фигур', 'Проверено']}
          empty="Проверок пока нет"
        >
          {checks.map((row) => (
            <CheckRow key={row.level} row={row} onPick={() => setLevel(Number(row.level))} />
          ))}
        </Table>
      </Panel>

    </div>
  );
}

function CheckRow({ row, onPick }: { row: LevelCheckRow; onPick: () => void }): ReactNode {
  let band = { min: 0, max: 100, target: 0 };
  try {
    band = (JSON.parse(row.payload) as LevelCheckReport).band;
  } catch {
    // оставляем полосу по умолчанию
  }
  const inBand = Number(row.avg_score) >= band.min && Number(row.avg_score) <= band.max;
  return (
    <tr className="is-clickable" onClick={onPick}>
      <td>{row.level}</td>
      <td>
        {sizeForLevel(Number(row.level))}×{heightForLevel(Number(row.level))}
      </td>
      <td>{row.avg_score}</td>
      <td className="is-mono">
        {row.min_score}–{row.max_score}
      </td>
      <td>{inBand ? 'да' : 'нет'}</td>
      <td>{Number(row.avg_pieces).toFixed(1)}</td>
      <td>{formatDateTime(Number(row.checked_at))}</td>
    </tr>
  );
}
