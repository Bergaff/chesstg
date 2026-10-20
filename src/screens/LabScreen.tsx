import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  PIECE_GLYPH,
  applyAction,
  auditPlacements,
  availablePieceTypes,
  describeSolution,
  difficultyBand,
  pieceCountForLevel,
  sizeForLevel,
  type AuditResult,
  type BatchReport,
  type BatchOptions,
  type GameState,
  type PlacementSpec,
  type PlacementReport,
} from '../engine';
import { useApp } from '../context/AppContext';
import { cn, formatNumber } from '../lib/format';

interface LabScreenProps {
  onBack: () => void;
}

interface Progress {
  checked: number;
  total: number;
}

const LIMITS = [1500, 4000, 12000];

function maxPiecesFor(level: number): number {
  const size = sizeForLevel(level);
  const cells = (size - 2) * size - 1;
  return Math.max(1, Math.min(pieceCountForLevel(level), cells));
}

export function LabScreen({ onBack }: LabScreenProps): ReactNode {
  const { profile } = useApp();
  const [level, setLevel] = useState(() => Math.min(60, Math.max(1, profile.level)));
  const [pieces, setPieces] = useState(() => maxPiecesFor(Math.min(60, Math.max(1, profile.level))));
  const [limit, setLimit] = useState(LIMITS[0]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<BatchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const maxPieces = maxPiecesFor(level);
  const band = useMemo(() => difficultyBand(level), [level]);
  const size = sizeForLevel(level);
  const types = useMemo(() => availablePieceTypes(level), [level]);

  const changeLevel = useCallback((next: number) => {
    const safe = Math.min(60, Math.max(1, Math.round(next) || 1));
    setLevel(safe);
    setPieces(maxPiecesFor(safe));
    setReport(null);
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    const spec: PlacementSpec = {
      width: size,
      height: size,
      count: Math.min(pieces, maxPieces),
      types,
    };
    const options: Omit<BatchOptions, 'onProgress'> = {
      limit,
      seed: level * 7919,
      band,
      maxDepth: size + 3,
    };

    setRunning(true);
    setError(null);
    setReport(null);
    setOpenKey(null);
    setProgress({ checked: 0, total: 0 });

    try {
      const result = await new Promise<BatchReport>((resolve, reject) => {
        if (typeof Worker === 'undefined') {
          // Тесты и старые браузеры: считаем на месте, но без блокировки старта.
          window.setTimeout(() => {
            try {
              resolve(
                auditPlacements(spec, {
                  ...options,
                  onProgress: (checked, total) => setProgress({ checked, total }),
                }),
              );
            } catch (err) {
              reject(err);
            }
          }, 20);
          return;
        }

        const worker = new Worker(new URL('../workers/audit.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (event: MessageEvent) => {
          const data = event.data as
            | { type: 'progress'; checked: number; total: number }
            | { type: 'done'; report: BatchReport }
            | { type: 'error'; message: string };
          if (data.type === 'progress') {
            setProgress({ checked: data.checked, total: data.total });
          } else if (data.type === 'done') {
            worker.terminate();
            resolve(data.report);
          } else {
            worker.terminate();
            reject(new Error(data.message));
          }
        };
        worker.onerror = () => {
          worker.terminate();
          reject(new Error('worker_failed'));
        };
        worker.postMessage({ id: 1, spec, options });
      });

      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить разбор');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [band, level, limit, maxPieces, pieces, running, size, types]);

  return (
    <div className="screen lab-screen">
      <div className="page-top">
        <button type="button" className="back-btn" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <div className="page-heading">
          <span className="label">Разбор</span>
          <h1 className="page-title">Лаборатория</h1>
        </div>
        <div className="page-side">
          <span className="label">Поле</span>
          <b>
            {size}×{size}
          </b>
        </div>
      </div>

      <p className="lede">
        Перебор расстановок уровня с проверкой решения. Для каждой расстановки считается оценка
        требовательности: плотность фигур, шаги под боем, число безопасных ходов и длина решения.
      </p>

      <div className="lab-form">
        <label className="lab-field">
          <span className="label">Уровень</span>
          <input
            type="number"
            min={1}
            max={60}
            value={level}
            onChange={(event) => changeLevel(Number(event.target.value))}
            aria-label="Уровень"
          />
        </label>
        <label className="lab-field">
          <span className="label">Фигур</span>
          <select
            value={Math.min(pieces, maxPieces)}
            onChange={(event) => setPieces(Number(event.target.value))}
            aria-label="Число фигур"
          >
            {Array.from({ length: maxPieces }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <label className="lab-field">
          <span className="label">Проверок</span>
          <select
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            aria-label="Сколько расстановок проверить"
          >
            {LIMITS.map((value) => (
              <option key={value} value={value}>
                {formatNumber(value)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <dl className="lab-band">
        <div>
          <dt>Целевая оценка</dt>
          <dd>{band.target}</dd>
        </div>
        <div>
          <dt>Полоса отбора</dt>
          <dd>
            {band.min}–{band.max}
          </dd>
        </div>
        <div>
          <dt>Типы фигур</dt>
          <dd>{types.map((type) => PIECE_GLYPH[type]).join(' ')}</dd>
        </div>
      </dl>

      <button type="button" className="btn btn-primary btn-block" onClick={() => void run()} disabled={running}>
        {running ? 'Проверяем' : 'Проверить расстановки'}
      </button>

      {running && (
        <p className="lab-progress" aria-live="polite">
          Разобрано {formatNumber(progress?.checked ?? 0)}
          {progress && progress.total > 0 ? ` из ${formatNumber(progress.total)}` : ''}
        </p>
      )}

      {error && <p className="lab-error">{error}</p>}

      {report && (
        <div className="lab-report">
          <div className="section-head">
            <span className="label">Итог</span>
            <span className="label">
              {report.exhaustive ? 'полный перебор' : 'выборка'} · {formatNumber(report.checked)}
            </span>
          </div>

          <dl className="metric-list">
            <div className="metric-row">
              <dt className="metric-key">В пространстве уровня</dt>
              <dd className="metric-val">{formatNumber(report.space.total)}</dd>
            </div>
            <div className="metric-row">
              <dt className="metric-key">Проверено</dt>
              <dd className="metric-val">
                {formatNumber(report.checked)}
                {report.exhaustive ? '' : ` из ${formatNumber(report.space.total)}`}
              </dd>
            </div>
            <div className="metric-row">
              <dt className="metric-key">С решением</dt>
              <dd className="metric-val">{Math.round(report.solveRate * 100)}%</dd>
            </div>
            <div className="metric-row">
              <dt className="metric-key">Средняя оценка</dt>
              <dd className="metric-val">{report.averageScore}</dd>
            </div>
            <div className="metric-row">
              <dt className="metric-key">В полосе отбора</dt>
              <dd className="metric-val">{report.fair}</dd>
            </div>
            <div className="metric-row">
              <dt className="metric-key">Проще полосы</dt>
              <dd className="metric-val">{report.simple}</dd>
            </div>
            <div className="metric-row">
              <dt className="metric-key">Жёстче полосы</dt>
              <dd className="metric-val">{report.brutal}</dd>
            </div>
          </dl>

          <div className="section-head">
            <span className="label">Сильнейшие расстановки</span>
            <span className="label">{report.best.length}</span>
          </div>

          {report.best.length === 0 && (
            <p className="empty-state">
              Ни одна проверенная расстановка не проходима. Уменьшите число фигур или выберите другой
              уровень.
            </p>
          )}

          <ul className="lab-list">
            {report.best.map((item) => (
              <LabCard
                key={item.placement.key}
                item={item}
                expanded={openKey === item.placement.key}
                onToggle={() =>
                  setOpenKey((current) => (current === item.placement.key ? null : item.placement.key))
                }
              />
            ))}
          </ul>

          <p className="lab-note">
            Оценка 0–100 складывается из плотности фигур, доли шагов под боем, числа безопасных первых
            ходов и редкости победных линий. Полный перебор идёт до {formatNumber(12000)} расстановок,
            дальше используется детерминированная выборка с тем же пространством.
          </p>
        </div>
      )}
    </div>
  );
}

function LabCard({
  item,
  expanded,
  onToggle,
}: {
  item: PlacementReport;
  expanded: boolean;
  onToggle: () => void;
}): ReactNode {
  const { audit, placement } = item;
  const steps = describeSolution(audit.solution);

  return (
    <li className="lab-card">
      <div className="lab-card-top">
        <MiniBoard state={placement.state} solution={audit.solution} />
        <div className="lab-card-body">
          <span className="lab-score">
            <b>{audit.score}</b>
            <small>оценка</small>
          </span>
          <span className="lab-facts">
            {audit.steps} ход{audit.steps === 1 ? '' : audit.steps < 5 ? 'а' : 'ов'} · безопасных первых:{' '}
            {audit.firstMoves} · под боем {Math.round(audit.pressure * audit.steps)} из {audit.steps}
          </span>
          <button type="button" className="lab-toggle" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? 'Скрыть решение' : 'Показать решение'}
          </button>
        </div>
      </div>
      {expanded && (
        <ol className="lab-solution">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </li>
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

  const rows: ReactNode[] = [];
  for (let y = state.height - 1; y >= 0; y--) {
    for (let x = 0; x < state.width; x++) {
      const enemy = state.enemies.find((piece) => piece.x === x && piece.y === y);
      const player = state.player.x === x && state.player.y === y;
      rows.push(
        <span
          key={`${x}:${y}`}
          className={cn(
            'lab-cell',
            (x + y) % 2 === 0 ? 'lab-cell-dark' : 'lab-cell-light',
            path.has(`${x}:${y}`) && 'lab-cell-path',
          )}
        >
          {enemy && <span className="lab-enemy">{PIECE_GLYPH[enemy.type]}</span>}
          {player && <span className="lab-player">{PIECE_GLYPH.pawn}</span>}
        </span>,
      );
    }
  }

  return (
    <div
      className="lab-board"
      style={{ gridTemplateColumns: `repeat(${state.width}, 18px)` }}
      role="img"
      aria-label={`Поле ${state.width} на ${state.height}, фигур ${state.enemies.length}`}
    >
      {rows}
    </div>
  );
}
