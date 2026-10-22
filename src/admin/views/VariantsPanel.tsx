import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MODE_ORDER,
  analyzeVariant,
  boardForMode,
  modeDef,
  modeFamily,
  type JamMeasure,
  type ModeId,
  type VariantReport,
} from '../../engine';
import { Panel, StatusLine, Table, formatPercent } from '../ui';
import { runJamSuite, runVariantSuite } from '../variantsClient';

/**
 * Сравнение вариантов правил одним прогоном.
 *
 * Отвечает на вопросы, которые нельзя задать одиночным расстановкой: сколько
 * держится король под притоком фигур, что даёт уход фигур с площадки и что меняет
 * запрет свободной диагонали. Отмечаете режимы, считаете, забираете текст таблицы
 * целиком.
 *
 * «Парковка» в этом списке гостит на правах отдельного замера: боевой режим это
 * головоломка из `jam.ts`, и её метрика длина плана решателя, а не доля побед.
 * Для неё внизу свой блок, он считает те же зерна, что и игра.
 */

const DEFAULT_SAMPLES = 16;
const DEFAULT_SEED = 20261022;
const SAMPLE_PRESETS = [16, 64, 100, 250, 1000];
const MIN_SAMPLES = 4;
const MAX_SAMPLES = 2000;
const DEFAULT_PICKS: ModeId[] = ['jam', 'jamExit2', 'jamExit4', 'race', 'raceDodge', 'campaign', 'campaignStrictDiag'];
/** Лестница уровней для замера «Парковки»: те же срезы, что и в `docs/modes.md`. */
const JAM_LADDER = '1,3,8,12,20,30,40';

interface Group {
  id: string;
  title: string;
  note: string;
  modes: ModeId[];
}

/** Группы только для того, чтобы список режимов читался по families. */
const GROUPS: Group[] = [
  {
    id: 'playable',
    title: 'Боевые режимы',
    note: 'Те, что уже в игре. Нужны как база сравнения: без неё цифры вариантов ничего не значат. У «Бесконечного» цели нет, разбор до финиша к нему не применим.',
    modes: ['campaign', 'endless'],
  },
  {
    id: 'jam',
    title: '«Парковка» и уход фигур',
    note: 'Пешечный движок на тех же флагах: стена фигур, право уходить с площадки в два или четыре направления, запрет свободной диагонали. Боевая «Парковка» считается в блоке внизу.',
    modes: ['jam', 'jamExit2', 'jamExit4', 'jamStrictDiag'],
  },
  {
    id: 'race',
    title: '«Гонки» и уклонение',
    note: 'Боевые «Гонки» это король против фигур, приходящих с двух верхних рядов: счёт в пережитых ходах, длина забега меряется прогоном жадного бота. Во втором варианте бегает пешка, верхний ряд переливает её в нижний.',
    modes: ['race', 'raceDodge'],
  },
  {
    id: 'diag',
    title: 'Диагональ',
    note: 'Тот же генератор и та же доска, менялось только право вставать на пустую диагональ.',
    modes: ['campaignFreeDiag', 'campaignStrictDiag'],
  },
];

const HEAD = [
  'Режим',
  'Поле',
  'С решением',
  'Оценка',
  'Шаги',
  'Взятий',
  'Ушло',
  'Выбор',
  'Форс',
  'Жизнь',
  'Разных досок',
  'Отличие соседних',
  'Реиграбельность',
];

/** В бесконечном режиме победы нет, поэтому разбор до финиша к нему не применим. */
const NO_GOAL: ModeId[] = ['endless'];

export function VariantsPanel({ level }: { level: number }): ReactNode {
  const [picks, setPicks] = useState<ModeId[]>(DEFAULT_PICKS);
  const [samples, setSamples] = useState(DEFAULT_SAMPLES);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [sample, setSample] = useState<{ mode: ModeId; done: number; total: number } | null>(null);
  const [reports, setReports] = useState<VariantReport[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [stopped, setStopped] = useState(false);
  const [jamLevels, setJamLevels] = useState(JAM_LADDER);
  const [jamRows, setJamRows] = useState<JamMeasure[]>([]);
  const [jamRunning, setJamRunning] = useState(false);
  const [jamDone, setJamDone] = useState({ done: 0, total: 0 });
  const [jamError, setJamError] = useState('');
  const busyRef = useRef(false);
  const jamBusyRef = useRef(false);
  const jamSuiteRef = useRef<{ cancel: () => void } | null>(null);
  const stopRef = useRef(false);
  const suiteRef = useRef<{ cancel: () => void } | null>(null);

  const ordered = useMemo(
    () => picks.slice().sort((a, b) => MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b)),
    [picks],
  );
  const byMode = useMemo(() => new Map(reports.map((report) => [report.mode, report])), [reports]);

  const toggle = (mode: ModeId) => {
    setPicks((current) => (current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode]));
  };

  const toggleGroup = (group: Group) => {
    setPicks((current) => {
      const all = group.modes.every((mode) => current.includes(mode));
      const rest = current.filter((mode) => !group.modes.includes(mode));
      return all ? rest : [...rest, ...group.modes];
    });
  };

  const run = () => {
    if (busyRef.current || ordered.length === 0) return;
    busyRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setError('');
    setCopied('');
    setDone(0);
    setStopped(false);
    setSample({ done: 0, total: samples, mode: ordered[0] });
    setReports([]);
    const suite = runVariantSuite(
      { modes: ordered, level, samples, seed },
      {
        onSample: (mode, sampleDone, sampleTotal) => setSample({ done: sampleDone, total: sampleTotal, mode }),
        onReport: (item) => {
          setReports((current) => [...current, item]);
          setDone((current) => current + 1);
        },
      },
    );
    suiteRef.current = suite;
    suite.done
      .catch((error: unknown) => {
        if (!stopRef.current) setError(error instanceof Error ? error.message : 'Прогон не удался');
      })
      .finally(() => {
        setRunning(false);
        busyRef.current = false;
        suiteRef.current = null;
        setSample(null);
      });
  };

  const parsedLevels = useMemo(
    () =>
      jamLevels
        .split(',')
        .map((value) => Math.max(1, Math.min(120, Number(value.trim()) || 0)))
        .filter((value) => value > 0)
        .slice(0, 12),
    [jamLevels],
  );

  const runJam = () => {
    if (jamBusyRef.current || parsedLevels.length === 0) return;
    jamBusyRef.current = true;
    setJamRunning(true);
    setJamError('');
    setJamRows([]);
    setJamDone({ done: 0, total: parsedLevels.length });
    const suite = runJamSuite(
      { levels: parsedLevels, samples, seed },
      { onRow: (row, doneRows, totalRows) => {
          setJamRows((current) => [...current, row]);
          setJamDone({ done: doneRows, total: totalRows });
        } },
    );
    jamSuiteRef.current = suite;
    suite.done
      .catch((error: unknown) => {
        if (!stopRef.current) setJamError(error instanceof Error ? error.message : 'Замер не удался');
      })
      .finally(() => {
        setJamRunning(false);
        jamBusyRef.current = false;
        jamSuiteRef.current = null;
      });
  };

  const stopJam = () => {
    stopRef.current = true;
    jamSuiteRef.current?.cancel();
  };

  const stop = () => {
    stopRef.current = true;
    setStopped(true);
    suiteRef.current?.cancel();
  };

  const report = useMemo(() => buildText(reports, { level, samples, seed }), [reports, level, samples, seed]);

  const copy = async () => {
    const ok = await writeClipboard(report);
    setCopied(ok ? 'Скопировано. Вставляй прямо в чат.' : 'Буфер обмена недоступен, выдели текст и скопируй вручную.');
  };

  const copyJam = async () => {
    const ok = await writeClipboard(jamText(jamRows, { samples, seed }));
    setCopied(ok ? 'Таблица парковки скопирована.' : 'Буфер обмена недоступен, выдели текст и скопируй вручную.');
  };

  return (
    <Panel
      title="Прогон сравнений"
      note={`Уровень ${level}: доска и число фигур из его полос, отбор по полосе режима. 1000 досок на вариант: лёгкие режимы считаются секунды, «Гонки на уклонение» и строгая диагональ до полуминуты, на 24 уровне дольше`}
    >
      <div className="adm-variant-groups">
        {GROUPS.map((group) => (
          <div key={group.id} className="adm-variant-group">
            <label className="adm-check is-group">
              <GroupCheck
                group={group}
                picks={picks}
                onToggle={() => toggleGroup(group)}
              />
              <span>{group.title}</span>
            </label>
            <p className="adm-note">{group.note}</p>
            <div className="adm-checks">
              {group.modes.map((mode) => (
                <label key={mode} className={`adm-check${modeFamily(mode) === mode ? '' : ' is-variant'}`}>
                  <input type="checkbox" checked={picks.includes(mode)} onChange={() => toggle(mode)} />
                  <span>{modeDef(mode).name}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="adm-row-actions">
        <label className="adm-field is-inline">
          <span className="adm-label">Досок на вариант</span>
          <input
            type="number"
            min={MIN_SAMPLES}
            max={MAX_SAMPLES}
            step={4}
            value={samples}
            onChange={(event) =>
              setSamples(Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Number(event.target.value) || MIN_SAMPLES)))
            }
          />
        </label>
        <label className="adm-field is-inline">
          <span className="adm-label">Зерно</span>
          <input
            type="number"
            min={1}
            max={4294967295}
            value={seed}
            onChange={(event) => setSeed(Math.abs(Number(event.target.value)) || 1)}
          />
        </label>
      </div>

      <div className="adm-checks">
        {SAMPLE_PRESETS.map((value) => (
          <button
            key={value}
            type="button"
            className={`adm-chip${samples === value ? ' is-active' : ''}`}
            onClick={() => setSamples(value)}
            disabled={running}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="adm-row-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={run}
          disabled={running || ordered.length === 0}
        >
          {running ? `Вариант ${done + 1} из ${ordered.length}` : `Сравнить (${ordered.length})`}
        </button>
        {running && (
          <button type="button" className="btn btn-outline" onClick={stop}>
            Остановить
          </button>
        )}
        <button type="button" className="btn btn-quiet" onClick={() => setPicks(DEFAULT_PICKS)} disabled={running}>
          Сбросить выбор
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => setPicks([])}
          disabled={running || picks.length === 0}
        >
          Снять все
        </button>
        {reports.length > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => void copy()}>
            Скопировать текст
          </button>
        )}
      </div>

      {running && sample && (
        <p className="adm-progress" aria-live="polite">
          {modeDef(sample.mode).name}: {sample.done} из {sample.total}
        </p>
      )}

      {error && <StatusLine kind="error">{error}</StatusLine>}
      {copied && <StatusLine kind="ok">{copied}</StatusLine>}

      <Table head={HEAD} empty="Отметь режимы галочками выше и нажми «Сравнить»">
        {ordered.map((mode) => {
          const item = byMode.get(mode);
          const geo = boardForMode(mode, level);
          if (!item) {
            return (
              <tr key={mode}>
                <td>{modeDef(mode).name}</td>
                <td className="is-mono">
                  {geo.width}×{geo.height}
                </td>
                <td colSpan={HEAD.length - 2} className="adm-muted">
                  {running ? 'считаем' : 'нет данных'}
                </td>
              </tr>
            );
          }
          return (
            <tr key={mode}>
              <td>{modeDef(mode).name}</td>
              <td className="is-mono">
                {geo.width}×{geo.height}
              </td>
              <td>{NO_GOAL.includes(mode) ? 'нет цели' : formatPercent(item.solvableShare, 1)}</td>
              <td>{item.avgScore}</td>
              <td>{item.avgSteps.toFixed(2)}</td>
              <td>{item.avgCaptures.toFixed(2)}</td>
              <td>{item.avgEscapes.toFixed(2)}</td>
              <td>{item.avgChoiceSteps.toFixed(2)}</td>
              <td>{formatPercent(item.forcedShare, 0)}</td>
              <td className="is-mono">{survivalText(item)}</td>
              <td>
                {item.uniqueLayouts} из {item.samples}
                {item.fallbacks > 0 ? `, откатов ${item.fallbacks}` : ''}
              </td>
              <td>{formatPercent(item.layoutDistance, 1)}</td>
              <td>{item.replayIndex}</td>
            </tr>
          );
        })}
      </Table>

      {reports.length > 0 && (
        <>
          <div className="adm-row-actions">
            <span className="adm-muted">
              {stopped ? 'Остановлено на' : 'Готово:'} {reports.length} из {ordered.length} вариантов, {samples} досок
              каждый{running ? ', считаем дальше' : ''}
            </span>
          </div>
          <pre className="adm-code adm-copyable">{report}</pre>
        </>
      )}

      <div className="adm-variant-jam">
        <div className="adm-row-actions">
          <label className="adm-field is-inline">
            <span className="adm-label">Уровни «Парковки»</span>
            <input
              type="text"
              value={jamLevels}
              onChange={(event) => setJamLevels(event.target.value)}
              disabled={jamRunning}
              placeholder={JAM_LADDER}
            />
          </label>
          <button type="button" className="btn btn-outline" onClick={runJam} disabled={jamRunning || parsedLevels.length === 0}>
            {jamRunning ? `Уровень ${jamDone.done} из ${jamDone.total || parsedLevels.length}` : `Замерить генератор (${parsedLevels.length})`}
          </button>
          {jamRunning && (
            <button type="button" className="btn btn-quiet" onClick={stopJam}>
              Остановить
            </button>
          )}
          {jamRows.length > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => void copyJam()}>
              Скопировать таблицу
            </button>
          )}
        </div>
        {jamError && <StatusLine kind="error">{jamError}</StatusLine>}
        <Table
          head={['Уровень', 'Поле', 'Фигур', 'План, ходы', 'Разброс', 'Решаемых', 'Сверх бюджета']}
          empty="Замер считает расстановки тем же генератором, что выдаёт бою: длина плана решателя и доля полей, которые решатель взял"
        >
          {parsedLevels.map((value) => {
            const item = jamRows.find((row) => row.level === value);
            if (!item) {
              return (
                <tr key={value}>
                  <td>{value}</td>
                  <td colSpan={6} className="adm-muted">
                    {jamRunning ? 'считаем' : 'нет данных'}
                  </td>
                </tr>
              );
            }
            return (
              <tr key={value}>
                <td>{value}</td>
                <td className="is-mono">
                  {item.width}×{item.height}
                </td>
                <td>{item.avgPieces}</td>
                <td className="is-mono">{item.avgCost}</td>
                <td className="is-mono">
                  {item.minCost}-{item.maxCost}
                </td>
                <td>{formatPercent(item.solvedShare, 1)}</td>
                <td className={item.overBudget > 0 ? 'is-warn' : undefined}>{item.overBudget}</td>
              </tr>
            );
          })}
        </Table>
      </div>

      <p className="adm-note">
        Индекс реиграбельности это 40% разнообразия генератора, 25% отличия соседних уровней, 25% шагов с
        выбором и 10% отсутствия безальтернативных ходов. «Ушло» это сколько фигур покинуло поле по пути
        решения, «Жизнь» средняя длина забега в ходах: у короля её считает прогон жадного бота, потому что
        деревом поиска восемь направлений на двенадцати рядах не перебираются,
        «откаты» сколько досок генератор сдал без отбора по полосе.
      </p>
    </Panel>
  );
}

/** Групповой чекбокс показывает неполный выбор полосы, иначе он вводит в заблуждение. */
function GroupCheck({ group, picks, onToggle }: { group: Group; picks: ModeId[]; onToggle: () => void }): ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  const all = group.modes.every((mode) => picks.includes(mode));
  const some = group.modes.some((mode) => picks.includes(mode));
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !all && some;
  }, [all, some]);
  return <input ref={ref} type="checkbox" checked={all} onChange={onToggle} />;
}

/** Текст замера генератора: его же вставляем в `docs/modes.md`, поэтому формат markdown. */
function jamText(rows: JamMeasure[], meta: { samples: number; seed: number }): string {
  const head = ['Уровень', 'Поле', 'Фигур', 'План, ходы', 'Мин', 'Макс', 'Решаемых', 'Сверх бюджета'];
  const lines = [`Замер генератора «Парковки», по ${meta.samples} полей на уровень, зерно ${meta.seed}`, ''];
  lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(
      `| ${row.level} | ${row.width}x${row.height} | ${row.avgPieces} | ${row.avgCost} | ${row.minCost} | ${row.maxCost} | ${(row.solvedShare * 100).toFixed(1)}% | ${row.overBudget} |`,
    );
  }
  lines.push('');
  lines.push('«План, ходы» длина решения, которое нашёл решатель, «Сверх бюджета» поля, где план не влез в данный бюджет.');
  return lines.join('\n');
}

function survivalText(report: VariantReport): string {
  if (!report.survival) return 'н/д';
  const { avg, min, max, capped } = report.survival;
  return `${avg} (${min}-${max})${capped > 0 ? `, упор ${capped}` : ''}`;
}

function buildText(
  reports: VariantReport[],
  meta: { level: number; samples: number; seed: number },
): string {
  const lines: string[] = [
    `Прогон сравнений, уровень ${meta.level}, по ${meta.samples} досок на вариант, зерно ${meta.seed}`,
    '',
    `| ${HEAD.join(' | ')} |`,
    `| ${HEAD.map(() => '---').join(' | ')} |`,
  ];
  for (const item of reports) {
    const geo = boardForMode(item.mode, meta.level);
    const cells = [
      modeDef(item.mode).name,
      `${geo.width}x${geo.height}`,
      NO_GOAL.includes(item.mode) ? 'нет цели' : `${(item.solvableShare * 100).toFixed(1)}%`,
      `${item.avgScore}`,
      item.avgSteps.toFixed(2),
      item.avgCaptures.toFixed(2),
      item.avgEscapes.toFixed(2),
      item.avgChoiceSteps.toFixed(2),
      `${(item.forcedShare * 100).toFixed(0)}%`,
      survivalText(item),
      `${item.uniqueLayouts}/${item.samples}${item.fallbacks > 0 ? ` (откатов ${item.fallbacks})` : ''}`,
      `${(item.layoutDistance * 100).toFixed(1)}%`,
      `${item.replayIndex}`,
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push(
    'Индекс реиграбельности: 40% разнообразия генератора, 25% отличия соседних уровней, 25% шагов с выбором, 10% отсутствия безальтернативных ходов.',
  );
  lines.push(
    '«Ушло» это сколько фигур покинуло поле по пути решения, «Жизнь» средняя длина уклонения в ходах, «откатов» сколько досок генератор сдал без отбора по полосе.',
  );
  if (reports.some((item) => NO_GOAL.includes(item.mode))) {
    lines.push('«Бесконечный» помечен как «нет цели»: победы в нём нет, поэтому нули это не дефект, а отсутствие финиша.');
  }
  return lines.join('\n');
}

/** Clipboard API есть не везде, поэтому с запасным вариантом через скрытое поле. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* переходим к запасному варианту */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
