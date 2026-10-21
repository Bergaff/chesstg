import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  PIECE_GLYPH,
  applyAction,
  availablePieceTypes,
  describeSolution,
  difficultyBand,
  pieceCountForLevel,
  heightForLevel,
  sizeForLevel,
  type AuditResult,
  type BatchReport,
  type GameState,
  type PlacementReport,
  MODE_ORDER,
  boardForMode,
  modeDef,
  piecesFor,
  placementSpace,
  type ModeId,
  type PieceType,
} from '../../engine';
import { PIECE_UNLOCKS } from '../../engine';
import { AdminError, deleteReport, fetchLevels, saveReport } from '../api';
import type { AuditReportRow, LevelsResponse } from '../types';
import { runPlacementAudit } from '../auditClient';
import { Metric, Panel, StatusLine, Table, formatDateTime, formatNumber, formatPercent } from '../ui';
import { cn } from '../../lib/format';

const LIMITS = [1500, 4000, 12000];

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

  const [mode, setMode] = useState<ModeId>('campaign');
  const { width: size, height } = boardForMode(mode, level);
  const labTypes: PieceType[] = PIECE_UNLOCKS.map((entry) => entry.type);
  const types = useMemo(
    () => (mode === 'campaign' || mode === 'endless' ? availablePieceTypes(level) : labTypes),
    [labTypes, level, mode],
  );
  const maxPieces = Math.max(1, Math.min(piecesFor(mode, level), (height - 2) * size - 1));
  const [pieces, setPieces] = useState(maxPieces);

  useEffect(() => {
    setPieces(maxPieces);
  }, [maxPieces]);

  const band = useMemo(() => difficultyBand(level), [level]);

  /**
   * Сравнение режимов по одному уровню: объём пространства и время, за которое
   * его можно прогнать при текущем лимите. Это ответ на вопрос «насколько
   * масштабирование лабораторией терпимое».
   */
  const scale = useMemo(
    () =>
      MODE_ORDER.map((id) => {
        const geo = boardForMode(id, level);
        const count = Math.max(1, Math.min(piecesFor(id, level), (geo.height - 2) * geo.width - 1));
        const typesForMode = id === 'campaign' || id === 'endless' ? availablePieceTypes(level) : PIECE_UNLOCKS.map((entry) => entry.type);
        const space = placementSpace({ width: geo.width, height: geo.height, count, types: typesForMode, mode: id });
        const rate = report && report.checked > 0 ? elapsedMs / report.checked : 0;
        return {
          id,
          name: modeDef(id).name,
          playable: modeDef(id).playable,
          note: modeDef(id).note,
          geo,
          count,
          total: space.total,
          seconds: rate > 0 ? (Math.min(space.total, limit) * rate) / 1000 : 0,
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
      const result = await runPlacementAudit(
        { width: size, height, count: Math.min(pieces, maxPieces), types, mode },
        { limit, seed: level * 7919, band, maxDepth: height + 3 },
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
        <Table head={['Режим', 'Поле', 'Фигур', 'Вариантов', 'Прогон']} empty="Нет данных">
          {scale.map((row) => (
            <tr key={row.id} className={row.id === mode ? 'is-active' : undefined}>
              <td>{row.name}</td>
              <td className="is-mono">
                {row.geo.width}×{row.geo.height}
              </td>
              <td>{row.count}</td>
              <td className="is-mono">{formatNumber(row.total)}</td>
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
      </div>

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
