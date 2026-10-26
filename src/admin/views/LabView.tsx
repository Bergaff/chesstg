import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  PIECE_GLYPH,
  applyAction,
  describeSolution,
  pieceCountForLevel,
  heightForLevel,
  sizeForLevel,
  type AuditResult,
  type BatchReport,
  type GameState,
  type PlacementReport,
  MODE_ORDER,
  modeDef,
  placementSpace,
  pluralRu,
  summarizeRange,
  type ModeId,
  type RangeReport,
} from '../../engine';
import { labLevel, labSpec } from '../labSpec';
import { AdminError, deleteReport, fetchLevels, saveReport } from '../api';
import type { AuditReportRow, LevelsResponse } from '../types';
import { runPlacementAudit, runRangeAudit, type RangeHandle, type RangeProgress } from '../auditClient';
import { VariantsPanel } from './VariantsPanel';
import { ShopModelPanel } from './ShopModelPanel';
import { Metric, Panel, StatusLine, Table, formatDateTime, formatNumber, formatPercent } from '../ui';
import { cn } from '../../lib/format';

const LIMITS = [1500, 4000, 12000];
/** Потолок уровня в лаборатории: дальше генератор не растёт, а поле упирается. */
const MAX_LAB_LEVEL = 60;
/** Проверок на уровень в прогоне диапазона: 60 уровней по 12 000 - это часы. */
const RANGE_LIMITS = [150, 400, 1200];

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/**
 * Покрытие выборки одним числом: «1 : 10¹⁸» читается быстрее, чем
 * «1 : 1 300 000 000 000 000 000», а смысл тот же - во сколько раз пространство
 * больше того, что успели проверить.
 */
function coverageLabel(exhaustive: boolean, ratio: number): string {
  if (exhaustive) return 'полный перебор';
  if (!(ratio > 1)) return 'после разбора';
  if (ratio < 1e5) return `1 : ${formatNumber(Math.round(ratio))}`;
  const power = Math.round(Math.log10(ratio));
  const digits = String(power)
    .split('')
    .map((char) => SUPERSCRIPT[Number(char)] ?? char)
    .join('');
  return `1 : 10${digits}`;
}

export function LabView({ onUnauthorized }: { onUnauthorized: (message: string) => void }): ReactNode {
  const [data, setData] = useState<LevelsResponse | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await fetchLevels());
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось загрузить отчёты');
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="adm-stack">
      {error && <StatusLine kind="error">{error}</StatusLine>}

      <PlacementLab onUnauthorized={onUnauthorized} onSaved={() => void load()} />

      <PlacementRange onUnauthorized={onUnauthorized} onSaved={() => void load()} />

      <ShopModelPanel onUnauthorized={onUnauthorized} />

      <Panel title="Сохранённые отчёты" note="Результаты запусков лаборатории">
        {data && data.reports.length > 0 ? (
          <ul className="adm-reports">
            {data.reports.map((row) => (
              <ReportRow key={row.id} row={row} onDeleted={() => void load()} onUnauthorized={onUnauthorized} />
            ))}
          </ul>
        ) : (
          <p className="adm-empty">Отчётов нет. Запустите разбор расстановок и сохраните результат.</p>
        )}
      </Panel>
    </div>
  );
}

function ReportRow({
  row,
  onDeleted,
  onUnauthorized,
}: {
  row: AuditReportRow;
  onDeleted: () => void;
  onUnauthorized: (message: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <li className="adm-report-row">
      <div className="adm-report-head">
        <span className="adm-report-kind">{row.kind === 'placements' ? 'Расстановки' : 'Уровни'}</span>
        <span className="adm-report-date">{formatDateTime(Number(row.createdAt))}</span>
        <button type="button" className="adm-link" onClick={() => setOpen((value) => !value)}>
          {open ? 'Скрыть' : 'Подробнее'}
        </button>
        <button
          type="button"
          className="adm-link is-danger"
          onClick={async () => {
            try {
              await deleteReport(row.id);
              onDeleted();
            } catch (err) {
              if (err instanceof AdminError && err.status === 401) onUnauthorized('Сеанс истёк, войдите снова');
            }
          }}
        >
          Удалить
        </button>
      </div>
      {open && (
        <div className="adm-report-body">
          <pre className="adm-code">{pretty(row.spec)}</pre>
          <pre className="adm-code">{pretty(row.summary)}</pre>
        </div>
      )}
    </li>
  );
}

function pretty(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/* ─────────────────────────── лаборатория расстановок ─────────────────────────── */

function PlacementLab({
  onUnauthorized,
  onSaved,
}: {
  onUnauthorized: (message: string) => void;
  onSaved: () => void;
}): ReactNode {
  const [level, setLevel] = useState(10);
  const [limit, setLimit] = useState(LIMITS[0]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null);
  const [report, setReport] = useState<BatchReport | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);

  // Поле, фигуры и полоса уровня - из `labLevel`: та же формула, что у прогона
  // диапазона, иначе два инструмента лаборатории меряли бы разное.
  const [mode, setMode] = useState<ModeId>('campaign');
  const { width: size, height, types, maxPieces, band } = useMemo(
    () => labLevel(mode, level),
    [level, mode],
  );
  const [pieces, setPieces] = useState(maxPieces);

  useEffect(() => {
    setPieces(maxPieces);
  }, [maxPieces]);

  /**
   * Сравнение режимов по одному уровню: объём пространства и время, за которое
   * его можно прогнать при текущем лимите. Это ответ на вопрос «насколько
   * масштабирование лабораторией терпимое».
   */
  const scale = useMemo(
    () =>
      MODE_ORDER.map((id) => {
        const entry = labLevel(id, level);
        const geo = { width: entry.width, height: entry.height };
        const space = placementSpace({
          width: entry.width,
          height: entry.height,
          count: entry.maxPieces,
          types: entry.types,
          mode: id,
        });
        const rate = report && report.checked > 0 ? elapsedMs / report.checked : 0;
        const checked = Math.min(space.total, limit);
        return {
          id,
          name: modeDef(id).name,
          playable: modeDef(id).playable,
          note: modeDef(id).note,
          geo,
          count: entry.maxPieces,
          total: space.total,
          exhaustive: space.total <= limit,
          /** Одна проверенная расстановка на сколько-то вариантов: то, что
              отличает доказательство от оценки. */
          ratio: checked > 0 ? space.total / checked : 0,
          seconds: rate > 0 ? (checked * rate) / 1000 : 0,
        };
      }),
    [elapsedMs, level, limit, report],
  );

  const run = useCallback(async () => {
    if (running) return;
    const startedAt = performance.now();
    setRunning(true);
    setError('');
    setSaved('');
    setReport(null);
    setProgress({ checked: 0, total: 0 });
    try {
      const built = labSpec(mode, level, Math.min(pieces, maxPieces));
      const result = await runPlacementAudit(
        built.spec,
        { limit, seed: level * 7919, band: built.band, maxDepth: built.spec.height + 3 },
        (next) => setProgress(next),
      );
      setReport(result);
      setElapsedMs(performance.now() - startedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Разбор не удался');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [band, height, level, limit, maxPieces, mode, pieces, running, size, types]);

  const save = useCallback(async () => {
    if (!report || saving) return;
    setSaving(true);
    setError('');
    try {
      await saveReport(
        'placements',
        { level, mode, size, height, pieces: Math.min(pieces, maxPieces), types, limit, band },
        {
          checked: report.checked,
          exhaustive: report.exhaustive,
          space: report.space.total,
          solveRate: report.solveRate,
          averageScore: report.averageScore,
          medianScore: report.medianScore,
          fair: report.fair,
          simple: report.simple,
          brutal: report.brutal,
          top: report.best.slice(0, 3).map((item) => ({ score: item.audit.score, steps: item.audit.steps })),
        },
      );
      setSaved('Отчёт сохранён');
      onSaved();
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось сохранить отчёт');
    } finally {
      setSaving(false);
    }
  }, [band, height, level, limit, maxPieces, mode, onSaved, onUnauthorized, pieces, report, saving, size, types]);

  return (
    <Panel
      title="Лаборатория расстановок"
      note="Полный перебор вариантов уровня: решение, оценка, попадание в полосу"
      actions={
        <button type="button" className="adm-btn adm-btn-outline" onClick={() => void save()} disabled={!report || saving}>
          {saving ? 'Сохраняем' : 'Сохранить отчёт'}
        </button>
      }
    >
      <div className="adm-toolbar is-tight">
        <label className="adm-field is-inline">
          <span className="adm-label">Режим</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as ModeId)}>
            {MODE_ORDER.map((id) => (
              <option key={id} value={id}>
                {modeDef(id).name}
                {modeDef(id).playable ? '' : ' (лаборатория)'}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field is-inline">
          <span className="adm-label">Уровень</span>
          <input
            type="number"
            min={1}
            max={60}
            value={level}
            onChange={(event) => setLevel(Math.min(60, Math.max(1, Math.round(Number(event.target.value) || 1))))}
          />
        </label>
        <label className="adm-field is-inline">
          <span className="adm-label">Фигур</span>
          <select value={Math.min(pieces, maxPieces)} onChange={(event) => setPieces(Number(event.target.value))}>
            {Array.from({ length: maxPieces }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field is-inline">
          <span className="adm-label">Проверок</span>
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            {LIMITS.map((value) => (
              <option key={value} value={value}>
                {formatNumber(value)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="adm-btn adm-btn-primary" onClick={() => void run()} disabled={running}>
          {running ? 'Считаем' : 'Запустить разбор'}
        </button>
      </div>

      <p className="adm-note">
        Режим «{modeDef(mode).name}»: {modeDef(mode).note} Поле {size}×{height}, фигуры:{' '}
        {types.map((type) => PIECE_GLYPH[type]).join(' ')}. Полоса уровня{' '}
        {band.min}–{band.max}, цель {band.target}.
      </p>

      {running && (
        <p className="adm-progress" aria-live="polite">
          Разобрано {formatNumber(progress?.checked ?? 0)}
          {progress && progress.total > 0 ? ` из ${formatNumber(progress.total)}` : ''}
        </p>
      )}
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3 className="adm-panel-title">Масштаб режимов на уровне {level}</h3>
        </div>
        <Table head={['Режим', 'Поле', 'Фигур', 'Вариантов', 'Покрытие', 'Прогон']} empty="Нет данных">
          {scale.map((row) => (
            <tr key={row.id} className={row.id === mode ? 'is-active' : undefined}>
              <td>{row.name}</td>
              <td className="is-mono">
                {row.geo.width}×{row.geo.height}
              </td>
              <td>{row.count}</td>
              <td className="is-mono">{formatNumber(row.total)}</td>
              <td className={row.exhaustive ? 'is-mono' : 'is-mono is-thin'}>
                {coverageLabel(row.exhaustive, row.ratio)}
              </td>
              <td className="is-mono">
                {row.seconds > 0
                  ? `${formatNumber(Math.min(row.total, limit))} расстановок, ~${row.seconds.toFixed(1)} c`
                  : 'после разбора'}
              </td>
            </tr>
          ))}
        </Table>
        <p className="adm-note">
          Время пересчитано из последнего прогона в этом окне: {formatNumber(Math.min(report?.checked ?? 0, limit))}{' '}
          расстановок за {(elapsedMs / 1000).toFixed(2)} c в потоке браузера. Прогресса в сервере здесь нет
          намеренно: перебор остаётся на устройстве, а сервер только хранит отчёты.
        </p>
        <p className="adm-note">
          «Покрытие» - одна проверенная расстановка на сколько-то вариантов. «Полный перебор» означает, что
          вывод по режиму является доказательством: решаемость проверена для всех расстановок уровня. Остальные
          строки - оценка по случайной выборке: каждая расстановка в ней проверена точно, но отсутствие решения
          среди 12 000 ещё не значит, что уровня нет. Поэтому астрономическое число вариантов - не приговор режиму:
          оно отнимает доказательность, а не смысл проверки. Приговор - другая строка: если полосу сложности
          режима приходится спорить с соседним режимом, а не мерить перебором, править нечем.
        </p>
      </div>

      <VariantsPanel level={level} />

      {error && <StatusLine kind="error">{error}</StatusLine>}
      {saved && <StatusLine kind="ok">{saved}</StatusLine>}

      {report && (
        <div className="adm-report">
          <div className="adm-metrics is-compact">
            <Metric label="Вариантов" value={formatNumber(report.space.total)} />
            <Metric
              label="Проверено"
              value={formatNumber(report.checked)}
              hint={report.exhaustive ? 'полный перебор' : 'выборка'}
            />
            <Metric label="С решением" value={formatPercent(report.solveRate, 1)} />
            <Metric label="Средняя" value={report.averageScore} hint={`медиана ${report.medianScore}`} />
            <Metric label="В полосе" value={report.fair} tone="ok" />
            <Metric label="Жёстче" value={report.brutal} tone="danger" />
          </div>

          <Table head={['Оценка', 'Ходов', 'Первых ходов', 'Под боем', 'Фигур', 'Решение']}>
            {report.best.map((item) => (
              <tr key={item.placement.key}>
                <td>{item.audit.score}</td>
                <td>{item.audit.steps}</td>
                <td>{item.audit.firstMoves}</td>
                <td>{formatPercent(item.audit.pressure)}</td>
                <td>{item.placement.state.enemies.length}</td>
                <td>{describeSolution(item.audit.solution).join(', ')}</td>
              </tr>
            ))}
          </Table>

          <div className="adm-boards">
            {report.best.slice(0, 4).map((item) => (
              <PlacementCard key={item.placement.key} item={item} />
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}


/* ─────────────────────────── прогон всего диапазона ─────────────────────────── */

/**
 * Разбор всех уровней разом.
 *
 * Одиночный прогон отвечает на вопрос «как устроен этот уровень», и на нём
 * легко поймать ровно тот уровень, который сам набрал. Диапазон отвечает на
 * другой вопрос: держит ли генератор полосу от L1 до L60 и где он из неё
 * выпадает. Поэтому строки не прореживаются: пропуск в таблице читался бы как
 * «проверили, всё в порядке».
 *
 * Считает воркер, строка за строкой: 60 уровней по несколько сотен
 * расстановок - минуты, и без отдачи по частям страница выглядела бы зависшей.
 * Прогон можно оборвать, уже собранные строки остаются на экране.
 */
function PlacementRange({
  onUnauthorized,
  onSaved,
}: {
  onUnauthorized: (message: string) => void;
  onSaved: () => void;
}): ReactNode {
  const [mode, setMode] = useState<ModeId>('campaign');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(MAX_LAB_LEVEL);
  const [perLevel, setPerLevel] = useState(RANGE_LIMITS[1]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RangeProgress | null>(null);
  const [rows, setRows] = useState<Array<BatchReport | null>>([]);
  const [stopped, setStopped] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const handleRef = useRef<RangeHandle | null>(null);

  const levels = useMemo(() => {
    const first = Math.min(MAX_LAB_LEVEL, Math.max(1, Math.round(from) || 1));
    const last = Math.min(MAX_LAB_LEVEL, Math.max(first, Math.round(to) || first));
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }, [from, to]);

  const report = useMemo<RangeReport | null>(() => {
    if (rows.length === 0) return null;
    const filled = rows
      .map((row, index) => {
        if (!row) return null;
        const entry = labLevel(mode, levels[index]);
        return { level: levels[index], width: entry.width, height: entry.height, pieces: entry.maxPieces, band: entry.band, report: row };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    return summarizeRange({
      mode,
      from: levels[0] ?? 1,
      to: levels[levels.length - 1] ?? 1,
      perLevelLimit: perLevel,
      rows: filled,
    });
  }, [levels, mode, perLevel, rows]);

  const start = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError('');
    setSaved('');
    setStopped(false);
    setRows(levels.map(() => null));
    const jobs = levels.map((level) => {
      const built = labSpec(mode, level);
      return {
        spec: built.spec,
        options: { limit: perLevel, seed: level * 7919, band: built.band, maxDepth: built.spec.height + 3 },
      };
    });
    const handle = runRangeAudit(jobs, {
      onProgress: setProgress,
      onRow: (index, row) =>
        setRows((prev) => {
          const next = [...prev];
          next[index] = row;
          return next;
        }),
    });
    handleRef.current = handle;
    const startedAt = performance.now();
    try {
      const result = await handle.promise;
      setStopped(result.aborted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Прогон не удался');
    } finally {
      handleRef.current = null;
      setProgress(null);
      setRunning(false);
      setElapsed(performance.now() - startedAt);
    }
  }, [levels, mode, perLevel, running]);

  const save = useCallback(async () => {
    if (!report || saving) return;
    setSaving(true);
    setError('');
    try {
      // kind='placements': в списке это прогон расстановок, а не замер
      // генератора; различает их поле `kind` внутри spec.
      await saveReport(
        'placements',
        { kind: 'range', mode, from: report.from, to: report.to, perLevel: report.perLevelLimit },
        {
          levels: report.rows.length,
          checked: report.checked,
          solved: report.solved,
          solveRate: report.solveRate,
          exhaustiveLevels: report.exhaustiveLevels,
          thin: report.thin,
          offBand: report.offBand,
          rows: report.rows.map((row) => ({
            level: row.level,
            solveRate: row.solveRate,
            average: row.averageScore,
            median: row.medianScore,
            inBand: row.fair,
            harder: row.brutal,
            offBand: row.offBand,
          })),
          verdicts: report.verdicts,
        },
      );
      setSaved('Отчёт сохранён');
      onSaved();
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        onUnauthorized('Сеанс истёк, войдите снова');
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось сохранить отчёт');
    } finally {
      setSaving(false);
    }
  }, [onSaved, onUnauthorized, report, saving]);

  const done = report?.rows.length ?? 0;

  return (
    <Panel
      title="Прогон всего диапазона"
      note="Каждый уровень от первого до последнего: решаемость, средняя оценка и попадание в полосу"
      actions={
        <>
          <button type="button" className="adm-btn adm-btn-outline" onClick={() => void save()} disabled={!report || saving}>
            {saving ? 'Сохраняем' : 'Сохранить отчёт'}
          </button>
          {running ? (
            <button
              type="button"
              className="adm-btn adm-btn-outline"
              onClick={() => handleRef.current?.abort()}
            >
              Остановить
            </button>
          ) : (
            <button type="button" className="adm-btn adm-btn-primary" onClick={() => void start()}>
              Прогнать L{levels[0]}-L{levels[levels.length - 1]}
            </button>
          )}
        </>
      }
    >
      <div className="adm-toolbar is-tight">
        <label className="adm-field is-inline">
          <span className="adm-label">Режим</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as ModeId)}>
            {MODE_ORDER.map((id) => (
              <option key={id} value={id}>
                {modeDef(id).name}
                {modeDef(id).playable ? '' : ' (лаборатория)'}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field is-inline">
          <span className="adm-label">С</span>
          <input
            type="number"
            min={1}
            max={MAX_LAB_LEVEL}
            value={from}
            onChange={(event) => setFrom(Math.min(MAX_LAB_LEVEL, Math.max(1, Math.round(Number(event.target.value) || 1))))}
          />
        </label>
        <label className="adm-field is-inline">
          <span className="adm-label">По</span>
          <input
            type="number"
            min={1}
            max={MAX_LAB_LEVEL}
            value={to}
            onChange={(event) => setTo(Math.min(MAX_LAB_LEVEL, Math.max(1, Math.round(Number(event.target.value) || 1))))}
          />
        </label>
        <label className="adm-field is-inline">
          <span className="adm-label">Проверок на уровень</span>
          <select value={perLevel} onChange={(event) => setPerLevel(Number(event.target.value))}>
            {RANGE_LIMITS.map((value) => (
              <option key={value} value={value}>
                {formatNumber(value)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="adm-note">
        {levels.length} {pluralRu(levels.length, ['уровень', 'уровня', 'уровней'])} × {formatNumber(perLevel)} = до{' '}
        {formatNumber(levels.length * perLevel)}{' '}
        {pluralRu(levels.length * perLevel, ['расстановка', 'расстановки', 'расстановок'])}.{' '}
        {levels.length * perLevel > 40_000
          ? 'Многовато для одного клика - уменьшите проверку на уровень или берите кусками.'
          : 'Фигур на уровень берётся максимум, что влезает в поле: прогон мерит генератор, а не подбор полегче.'}
      </p>

      {running && (
        <p className="adm-progress" aria-live="polite">
          Уровень {(progress?.index ?? 0) + 1} из {progress?.levelTotal ?? levels.length} · разобрано{' '}
          {formatNumber(progress?.checked ?? 0)} из {formatNumber(progress?.of ?? perLevel)}
        </p>
      )}
      {stopped && !running && <StatusLine kind="info">Прогон оборван: ниже то, что успело собраться.</StatusLine>}
      {error && <StatusLine kind="error">{error}</StatusLine>}
      {saved && <StatusLine kind="ok">{saved}</StatusLine>}

      {report && (
        <div className="adm-report">
          <div className="adm-metrics is-compact">
            <Metric label="Уровней разобрано" value={`${done} / ${levels.length}`} />
            <Metric label="Расстановок" value={formatNumber(report.checked)} />
            <Metric
              label="Время"
              value={`${(elapsed / 1000).toFixed(1)} c`}
              hint={report.checked > 0 ? `${(elapsed / report.checked).toFixed(2)} мс на расстановку` : undefined}
            />
            <Metric
              label="С решением"
              value={formatPercent(report.solveRate, 1)}
              hint={`${formatNumber(report.solved)} из ${formatNumber(report.checked)}`}
            />
            <Metric
              label="Полный перебор"
              value={`${report.exhaustiveLevels} ур.`}
              hint="остальные - выборка"
              tone={report.exhaustiveLevels === done && done > 0 ? 'ok' : undefined}
            />
            <Metric
              label="С тупиками"
              value={report.thin.length === 0 ? 'нет' : `${report.thin.length} ур.`}
              tone={report.thin.length > 0 ? 'danger' : 'ok'}
              hint={report.thin.length > 0 ? report.thin.map((level) => `L${level}`).join(' ') : undefined}
            />
            <Metric
              label="Вне полосы"
              value={report.offBand.length === 0 ? 'нет' : `${report.offBand.length} ур.`}
              tone={report.offBand.length > 0 ? 'danger' : 'ok'}
              hint={report.offBand.length > 0 ? report.offBand.slice(0, 8).map((level) => `L${level}`).join(' ') : undefined}
            />
          </div>

          <Table
            head={['Уровень', 'Поле', 'Фигур', 'Вариантов', 'Проверено', 'С решением', 'Средняя', 'Полоса', 'В полосе', 'Жёстче']}
            empty="Прогон ещё не запускался"
          >
            {levels.map((level, index) => {
              const row = report.rows.find((entry) => entry.level === level);
              if (!row) {
                return (
                  <tr key={level} className="is-queued">
                    <td className="adm-num">L{level}</td>
                    <td colSpan={9}>{running ? 'в очереди' : 'нет данных'}</td>
                  </tr>
                );
              }
              const thin = row.checked > 0 && row.solveRate < 0.5;
              return (
                <tr key={level} className={row.offBand > 0 ? 'is-off' : thin ? 'is-thin' : undefined}>
                  <td className="adm-num">L{level}</td>
                  <td className="is-mono">
                    {row.width}×{row.height}
                  </td>
                  <td>{row.pieces}</td>
                  <td className="is-mono">{formatNumber(row.space)}</td>
                  <td className="is-mono">
                    {formatNumber(row.checked)}
                    {row.exhaustive ? '' : ' *'}
                  </td>
                  <td className={thin ? 'is-danger' : 'is-mono'}>{formatPercent(row.solveRate, 1)}</td>
                  <td>{row.averageScore}</td>
                  <td className="is-mono">
                    {row.band.min}-{row.band.max}
                  </td>
                  <td>{row.fair}</td>
                  <td>{row.brutal}</td>
                </tr>
              );
            })}
          </Table>
          <p className="adm-note">
            «*» - неполный перебор уровня: доля решаемых измерена на выборке, и «ноль решений» такой строкой не
            доказывается. Строка без подсветки значит, что средняя оценка уровня лежит в его полосе.
          </p>

          <ul className="adm-verdicts">
            {report.verdicts.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function PlacementCard({ item }: { item: PlacementReport }): ReactNode {
  return (
    <div className="adm-card">
      <span className="adm-card-score">{item.audit.score}</span>
      <MiniBoard state={item.placement.state} solution={item.audit.solution} />
      <span className="adm-card-meta">
        {item.audit.steps} ход(ов), первых безопасных {item.audit.firstMoves}
      </span>
    </div>
  );
}

function MiniBoard({ state, solution }: { state: GameState; solution: AuditResult['solution'] }): ReactNode {
  const path = new Set<string>();
  let cursor = state;
  for (const action of solution) {
    try {
      cursor = applyAction(cursor, action);
    } catch {
      break;
    }
    path.add(`${cursor.player.x}:${cursor.player.y}`);
  }

  const cells: ReactNode[] = [];
  for (let y = state.height - 1; y >= 0; y--) {
    for (let x = 0; x < state.width; x++) {
      const enemy = state.enemies.find((piece) => piece.x === x && piece.y === y);
      const player = state.player.x === x && state.player.y === y;
      cells.push(
        <span
          key={`${x}:${y}`}
          className={cn(
            'adm-cell',
            (x + y) % 2 === 0 ? 'is-dark' : 'is-light',
            path.has(`${x}:${y}`) && 'is-path',
          )}
        >
          {enemy && <span className="adm-cell-enemy">{PIECE_GLYPH[enemy.type]}</span>}
          {player && <span className="adm-cell-player">{PIECE_GLYPH.pawn}</span>}
        </span>,
      );
    }
  }

  return (
    <div
      className="adm-board"
      style={{ gridTemplateColumns: `repeat(${state.width}, 16px)` }}
      role="img"
      aria-label={`Поле ${state.width} на ${state.height}`}
    >
      {cells}
    </div>
  );
}
