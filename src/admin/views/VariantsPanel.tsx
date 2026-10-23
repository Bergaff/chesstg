import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  boardForMode,
  modeDef,
  RACE_MIN_WIDTH,
  RACE_ROWS,
  RACE_WIDTH,
  type JamMeasure,
  type ModeId,
  type RaceMeasure,
  type VariantReport,
} from '../../engine';
import { Panel, StatusLine, Table, formatPercent } from '../ui';
import { runJamSuite, runRaceSuite, runVariantSuite } from '../variantsClient';

/**
 * Лаборатория прогонов: одно окно, три прогона.
 *
 * Вкладки переключают то, что показано в таблице, и меняют подпись запуска.
 * Данные каждого прогона живут отдельно, поэтому результат предыдущего не
 * теряется, пока считаешь следующий, и между ними можно ходить туда-сюда.
 *
 * 1. «Кампания»: что меняет право вставать на пустую диагональ. Те же доски,
 *    два варианта правил, и мы смотрим, где задача интереснее.
 * 2. «Парковка»: насколько генератор вообще даёт разные задачи и сколько в них
 *    выбора. Победа тут тривиальна (план есть почти всегда), поэтому меряется
 *    длина плана, развилки на нём и отличия расстановок.
 * 3. «Гонки»: сколько ходов партия остаётся решаемой. Игрок заперт в полосе из
 *    двух нижних рядов, и финал забега - позиция, где от фигуры не уйти.
 *
 * Всё считается в воркере (см. `variantsClient`): перебор на каждый ход короля
 * занимает секунды на доску, и на главном потоке вкладка бы встала.
 */

type SuiteId = 'diagonal' | 'jam' | 'race';

const DEFAULT_SAMPLES = 16;
const DEFAULT_SEED = 20261022;
const SAMPLE_PRESETS = [16, 64, 100, 250];
const MIN_SAMPLES = 4;
const MAX_SAMPLES = 2000;
/** Кампания сравнивается двумя вариантами одних и тех же досок. */
const DIAGONAL_PAIR: ModeId[] = ['campaignFreeDiag', 'campaignStrictDiag'];
/** Лестница уровней для «Парковки» и «Гонок»: те же срезы, что и в `docs/modes.md`. */
const LEVELS_LADDER = '1,3,8,12,20,30,40';

const DIAGONAL_HEAD = [
  'Режим',
  'Поле',
  'С решением',
  'Оценка',
  'Шаги',
  'Взятий',
  'Выбор',
  'Разных досок',
  'Отличие соседних',
  'Реиграбельность',
];

interface SuiteMeta {
  /** Подпись вкладки. */
  tab: string;
  /** Заголовок прогона в шапке окна. */
  title: string;
  /** Что меряем и как это читать - коротко, по одной строке. */
  note: string;
  /** Подпись кнопки запуска. */
  run: string;
  /** Сноска под таблицей: формулы сводных индексов. */
  footnote: string;
}

const SUITE: Record<SuiteId, SuiteMeta> = {
  diagonal: {
    tab: 'Диагональ',
    title: 'Кампания: диагональ только бить или свободно',
    note: 'Один генератор, две версии права на пустую диагональ. Если «только бить» не хуже по цифрам, правило можно оставлять как есть.',
    run: 'Сравнить диагональ',
    footnote:
      '«Реиграбельность» это 40% разнообразия генератора, 25% отличия соседних досок, 25% шагов с выбором и 10% отсутствия безальтернативных ходов. «Выбор» - средняя развилка на пути решения.',
  },
  jam: {
    tab: 'Парковка',
    title: 'Парковка: сложность и реиграбельность',
    note: 'Головоломка без финиша по времени: важна длина плана, число развилок и различие досок. «Прощение» - доля первых ходов вне плана, после которых задача всё ещё решаема: низкое значит «один неверный ход, и всё».',
    run: `Замерить генератор`,
    footnote:
      '«Запас» - сколько ходов бюджета остаётся после плана: бюджет около двух длин плана, поэтому различают уровни именно план и запас, а не прощение.',
  },
  race: {
    tab: 'Гонки',
    title: 'Гонки: сколько можно играть до нерешаемой позиции',
    note: `Король заперт в двух нижних рядах (${RACE_MIN_WIDTH}×${RACE_ROWS} на старте, рост вширь до ${RACE_WIDTH} колонок), сдвиг поля его не убивает. Жадный бот играет и на каждом ходе перебирает ответы фигур: «до нерешаемой» - номер хода, после которого от фигуры не уйти.`,
    run: 'Прогнать гонки',
    footnote:
      '«Решаемых до конца» - доля забегов, где партия кончилась прежде, чем позиция стала нерешаемой: ноль означает, что игрок всегда умирает в позиции, где ходить было некуда.',
  },
};

const SUITE_ORDER: SuiteId[] = ['diagonal', 'jam', 'race'];

export function VariantsPanel({ level }: { level: number }): ReactNode {
  const [samples, setSamples] = useState(DEFAULT_SAMPLES);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [levels, setLevels] = useState(LEVELS_LADDER);
  const [active, setActive] = useState<SuiteId>('diagonal');

  const [reports, setReports] = useState<VariantReport[]>([]);
  const [jamRows, setJamRows] = useState<JamMeasure[]>([]);
  const [raceRows, setRaceRows] = useState<RaceMeasure[]>([]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const busyRef = useRef(false);
  const suiteRef = useRef<{ cancel: () => void } | null>(null);
  const stopRef = useRef(false);

  const parsedLevels = useMemo(
    () =>
      levels
        .split(',')
        .map((value) => Math.max(1, Math.min(120, Number(value.trim()) || 0)))
        .filter((value) => value > 0)
        .slice(0, 12),
    [levels],
  );

  const byMode = useMemo(() => new Map(reports.map((report) => [report.mode, report])), [reports]);
  const conclusion = useMemo(() => diagonalConclusion(reports), [reports]);
  const meta = SUITE[active];

  /** Один прогон за раз: кнопка блокируется, а результат предыдущего остаётся. */
  function start(run: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setError('');
    setNote('');
    void run()
      .catch((runError: unknown) => {
        if (!stopRef.current) setError(runError instanceof Error ? runError.message : 'Прогон не удался');
      })
      .finally(() => {
        setRunning(false);
        setProgress('');
        busyRef.current = false;
        suiteRef.current = null;
      });
  }

  const runDiagonal = () =>
    start(async () => {
      setReports([]);
      setProgress(`${modeDef(DIAGONAL_PAIR[0]).name}: 0 из ${samples}`);
      const suite = runVariantSuite(
        { modes: DIAGONAL_PAIR, level, samples, seed },
        {
          onSample: (mode, done, total) => setProgress(`${modeDef(mode).name}: ${done} из ${total}`),
          onReport: (item) => setReports((current) => [...current, item]),
        },
      );
      suiteRef.current = suite;
      await suite.done;
    });

  const runJam = () =>
    start(async () => {
      if (parsedLevels.length === 0) return;
      setJamRows([]);
      setProgress(`Уровень 0 из ${parsedLevels.length}`);
      const suite = runJamSuite(
        { levels: parsedLevels, samples, seed },
        {
          onRow: (row, done, total) => {
            setJamRows((current) => [...current, row]);
            setProgress(`Уровень ${done} из ${total}`);
          },
        },
      );
      suiteRef.current = suite;
      await suite.done;
    });

  const runRace = () =>
    start(async () => {
      if (parsedLevels.length === 0) return;
      setRaceRows([]);
      setProgress(`Уровень 0 из ${parsedLevels.length}`);
      const suite = runRaceSuite(
        { levels: parsedLevels, samples: Math.max(MIN_SAMPLES, Math.min(120, Math.round(samples / 2))), seed },
        {
          onRow: (row, done, total) => {
            setRaceRows((current) => [...current, row]);
            setProgress(`Уровень ${done} из ${total}`);
          },
        },
      );
      suiteRef.current = suite;
      await suite.done;
    });

  const runActive = () => {
    if (active === 'diagonal') runDiagonal();
    else if (active === 'jam') runJam();
    else runRace();
  };

  const stop = () => {
    stopRef.current = true;
    suiteRef.current?.cancel();
  };

  const count = active === 'diagonal' ? reports.length : active === 'jam' ? jamRows.length : raceRows.length;
  const canRun = active === 'diagonal' || parsedLevels.length > 0;

  const copy = async () => {
    const text =
      active === 'diagonal'
        ? diagonalText(reports, { level, samples, seed })
        : active === 'jam'
          ? jamText(jamRows, { samples, seed })
          : raceText(raceRows, { samples, seed });
    const ok = await writeClipboard(text);
    setNote(ok ? 'Скопировано. Вставляй прямо в чат или в `docs/modes.md`.' : 'Буфер обмена недоступен, выдели текст вручную.');
  };

  return (
    <Panel
      title="Прогоны: кампания, парковка, гонки"
      note={`Уровень ${level} задаёт доску и число фигур для кампании, «Парковка» и «Гонки» считают свою лестницу уровней. Перебор живёт в воркере, поэтому вкладка не замирает`}
    >
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
            disabled={running}
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
            disabled={running}
          />
        </label>
        <label className="adm-field is-inline">
          <span className="adm-label">Уровни для «Парковки» и «Гонок»</span>
          <input
            type="text"
            value={levels}
            onChange={(event) => setLevels(event.target.value)}
            placeholder={LEVELS_LADDER}
            disabled={running}
          />
        </label>
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

      <section className="adm-suite">
        <div className="adm-suite-tabs">
          <span className="adm-label">Прогон</span>
          {SUITE_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className={`adm-chip${active === id ? ' is-active' : ''}`}
              onClick={() => setActive(id)}
              aria-pressed={active === id}
            >
              {SUITE[id].tab}
            </button>
          ))}
          {running && (
            <button type="button" className="btn btn-quiet" onClick={stop}>
              Остановить
            </button>
          )}
        </div>

        <div className="adm-suite-head">
          <h3 className="adm-suite-title">{meta.title}</h3>
          <p className="adm-note">{meta.note}</p>
        </div>

        <div className="adm-row-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={runActive}
            disabled={running || !canRun}
          >
            {running && progress
              ? progress
              : `${meta.run}${active === 'diagonal' ? '' : ` (${parsedLevels.length})`}`}
          </button>
          {count > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => void copy()}>
              Скопировать
            </button>
          )}
        </div>

        {error && <StatusLine kind="error">{error}</StatusLine>}
        {note && <StatusLine kind="ok">{note}</StatusLine>}

        {active === 'diagonal' && <DiagonalTable reports={reports} byMode={byMode} level={level} running={running} />}
        {active === 'jam' && <JamTable rows={jamRows} levels={parsedLevels} running={running} />}
        {active === 'race' && <RaceTable rows={raceRows} levels={parsedLevels} running={running} />}

        <p className="adm-suite-note">{meta.footnote}</p>
        {conclusion && active === 'diagonal' && <p className="adm-suite-note">{conclusion}</p>}
        {count > 0 && (
          <pre className="adm-code adm-copyable">
            {active === 'diagonal'
              ? diagonalText(reports, { level, samples, seed })
              : active === 'jam'
                ? jamText(jamRows, { samples, seed })
                : raceText(raceRows, { samples, seed })}
          </pre>
        )}
      </section>
    </Panel>
  );
}

function DiagonalTable({
  reports,
  byMode,
  level,
  running,
}: {
  reports: VariantReport[];
  byMode: Map<ModeId, VariantReport>;
  level: number;
  running: boolean;
}): ReactNode {
  return (
    <Table head={DIAGONAL_HEAD} empty="Нажми «Сравнить диагональ»: отчёт появится строками по мере прогона вариантов">
      {DIAGONAL_PAIR.map((mode) => {
        const item = byMode.get(mode);
        const geo = boardForMode(mode, level);
        if (!item) {
          return (
            <tr key={mode}>
              <td>{modeDef(mode).name}</td>
              <td className="is-mono">
                {geo.width}×{geo.height}
              </td>
              <td colSpan={DIAGONAL_HEAD.length - 2} className="adm-muted">
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
            <td>{formatPercent(item.solvableShare, 1)}</td>
            <td>{item.avgScore}</td>
            <td>{item.avgSteps.toFixed(2)}</td>
            <td>{item.avgCaptures.toFixed(2)}</td>
            <td>{item.avgChoiceSteps.toFixed(2)}</td>
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
  );
}

function JamTable({ rows, levels, running }: { rows: JamMeasure[]; levels: number[]; running: boolean }): ReactNode {
  return (
    <Table
      head={[
        'Уровень',
        'Поле',
        'Фигур',
        'План, ходы',
        'Разброс',
        'Решаемых',
        'Сверх бюджета',
        'Развилка',
        'Прощение',
        'Запас',
        'Уникальных',
        'Отличие досок',
        'Сложность',
        'Реиграбельность',
      ]}
      empty="Замер берёт расстановки тем же генератором, что выдаёт бою"
    >
      {levels.map((value) => {
        const item = rows.find((row) => row.level === value);
        if (!item) {
          return (
            <tr key={value}>
              <td>{value}</td>
              <td colSpan={13} className="adm-muted">
                {running ? 'считаем' : 'нет данных'}
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
            <td>{item.avgChoice}</td>
            <td>{formatPercent(item.forgiveness, 0)}</td>
            <td className="is-mono">
              {item.slackAvg} из {item.budgetAvg}
            </td>
            <td>
              {item.uniqueLayouts} из {item.samples}
            </td>
            <td>{formatPercent(item.layoutDistance, 1)}</td>
            <td>{item.difficulty}</td>
            <td>{item.replayIndex}</td>
          </tr>
        );
      })}
    </Table>
  );
}

function RaceTable({ rows, levels, running }: { rows: RaceMeasure[]; levels: number[]; running: boolean }): ReactNode {
  return (
    <Table
      head={[
        'Уровень',
        'Ширина в конце',
        'Ходов до нерешаемой',
        'Разброс',
        'Партия, ходов',
        'Решаемых до конца',
        'Взятий',
        'Чем кончились',
      ]}
      empty="Прогон считает перебором: ход, после которого любой ответ фигур ведёт к смерти"
    >
      {levels.map((value) => {
        const item = rows.find((row) => row.level === value);
        if (!item) {
          return (
            <tr key={value}>
              <td>{value}</td>
              <td colSpan={7} className="adm-muted">
                {running ? 'считаем' : 'нет данных'}
              </td>
            </tr>
          );
        }
        return (
          <tr key={value}>
            <td>{value}</td>
            <td className="is-mono">{item.widthEnd.toFixed(1)}</td>
            <td className="is-mono">
              {item.doomMedian} (в среднем {item.doomAvg.toFixed(1)})
            </td>
            <td className="is-mono">
              {item.doomMin}-{item.doomMax}
            </td>
            <td className="is-mono">
              {item.lengthMedian} (в среднем {item.lengthAvg.toFixed(1)})
            </td>
            <td>{formatPercent(1 - item.doomShare, 0)}</td>
            <td>{item.capturesAvg.toFixed(1)}</td>
            <td className="adm-muted">
              {causesText(item.causes)}
              {item.capped > 0 ? `, потолок ${item.capped}` : ''}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

/** Короткий вывод по двум вариантам диагонали: что лучше, и насколько. */
function diagonalConclusion(reports: VariantReport[]): string {
  if (reports.length < 2) return '';
  const byIndex = [...reports].sort((a, b) => b.replayIndex - a.replayIndex);
  const best = byIndex[0];
  const worst = byIndex[byIndex.length - 1];
  const delta = +(best.replayIndex - worst.replayIndex).toFixed(3);
  if (delta < 0.02) {
    return `Разницы по реиграбельности почти нет (${delta}): вариант с диагональю можно выбирать по вкусу, а не по цифрам.`;
  }
  const steps = best.avgSteps - worst.avgSteps;
  return (
    `Выигрыш у «${modeDef(best.mode).name}» (+${delta} к реиграбельности, решение ${
      best.avgSteps
    } хода против ${worst.avgSteps}, ${steps >= 0 ? 'длиннее' : 'короче'}). ` +
    `Разных досок: ${best.uniqueLayouts}/${best.samples} против ${worst.uniqueLayouts}/${worst.samples}.`
  );
}

/** Причины конца забега человеческим языком: ключи `lastEvent` админу ничего не говорят. */
const CAUSE_NAME: Record<string, string> = {
  captured: 'поимка',
  stuck: 'тупик',
  swept: 'унесло ряд',
  won: 'победа',
  capped: 'потолок просчёта',
};

function causesText(causes: Record<string, number>): string {
  const entries = Object.entries(causes);
  if (entries.length === 0) return 'нет данных';
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([cause, count]) => `${CAUSE_NAME[cause] ?? cause} ${count}`)
    .join(', ');
}

/** Текст замера генератора «Парковки»: его же вставляем в `docs/modes.md`. */
function jamText(rows: JamMeasure[], meta: { samples: number; seed: number }): string {
  const head = [
    'Уровень',
    'Поле',
    'Фигур',
    'План, ходы',
    'Мин',
    'Макс',
    'Решаемых',
    'Сверх бюджета',
    'Развилка',
    'Прощение',
    'Запас',
    'Уникальных',
    'Сложность',
    'Реиграб.',
  ];
  const lines = [`Замер генератора «Парковки», по ${meta.samples} полей на уровень, зерно ${meta.seed}`, ''];
  lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(
      `| ${row.level} | ${row.width}x${row.height} | ${row.avgPieces} | ${row.avgCost} | ${row.minCost} | ${row.maxCost} | ${(row.solvedShare * 100).toFixed(1)}% | ${row.overBudget} | ${row.avgChoice} | ${(row.forgiveness * 100).toFixed(0)}% | ${row.slackAvg}/${row.budgetAvg} | ${row.uniqueLayouts}/${row.samples} | ${row.difficulty} | ${row.replayIndex} |`,
    );
  }
  lines.push('');
  lines.push(
    '«План, ходы» - длина решения решателя, «Сверх бюджета» - поля, где план не влез в бюджет, «Развилка» - среднее число легальных ходов на шаге, «Прощение» - доля первых ходов вне плана, после которых задача всё ещё решаема, «Запас» - сколько ходов бюджета остаётся после плана, «Сложность» и «Реиграб.» - сводные индексы 0..1.',
  );
  return lines.join('\n');
}

/** Текст прогона «Гонок»: длина партии до нерешаемой позиции. */
function raceText(rows: RaceMeasure[], meta: { samples: number; seed: number }): string {
  const head = [
    'Уровень',
    'Старт',
    'Ширина в конце',
    'До нерешаемой (медиана)',
    'среднее',
    'разброс',
    'Партия (медиана)',
    'Взятий',
    'Чем кончились',
  ];
  const lines = [
    `Прогон «Гонок», поле ${RACE_MIN_WIDTH}x${RACE_ROWS} с ростом вширь до ${RACE_WIDTH}, полоса короля - два нижних ряда; по ${meta.samples} забегов на уровень, зерно ${meta.seed}`,
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.level} | ${row.widthStart} | ${row.widthEnd.toFixed(1)} | ${row.doomMedian} | ${row.doomAvg.toFixed(1)} | ${row.doomMin}-${row.doomMax} | ${row.lengthMedian} (avg ${row.lengthAvg.toFixed(1)}) | ${row.capturesAvg.toFixed(1)} | ${causesText(row.causes)} |`,
    );
  }
  lines.push('');
  lines.push(
    '«До нерешаемой» - ход, после которого перебор не находит ни одного хода, уводящего от смерти в ближайшие три полухода. «Взятий» - сколько фигур снял бот: без взятий полоса забивается раньше.',
  );
  return lines.join('\n');
}

/** Текст сравнения диагонали в markdown. */
function diagonalText(
  reports: VariantReport[],
  meta: { level: number; samples: number; seed: number },
): string {
  const lines = [
    `Кампания: диагональ свободно или только бить, уровень ${meta.level}, по ${meta.samples} досок, зерно ${meta.seed}`,
    '',
    `| ${DIAGONAL_HEAD.join(' | ')} |`,
    `| ${DIAGONAL_HEAD.map(() => '---').join(' | ')} |`,
  ];
  for (const item of reports) {
    const geo = boardForMode(item.mode, meta.level);
    lines.push(
      `| ${[
        modeDef(item.mode).name,
        `${geo.width}x${geo.height}`,
        `${(item.solvableShare * 100).toFixed(1)}%`,
        `${item.avgScore}`,
        item.avgSteps.toFixed(2),
        item.avgCaptures.toFixed(2),
        item.avgChoiceSteps.toFixed(2),
        `${item.uniqueLayouts}/${item.samples}${item.fallbacks > 0 ? ` (откатов ${item.fallbacks})` : ''}`,
        `${(item.layoutDistance * 100).toFixed(1)}%`,
        `${item.replayIndex}`,
      ].join(' | ')} |`,
    );
  }
  lines.push('');
  lines.push(
    '«С решением» - доля досок, где решатель доходит до финиша; «выбор» - средняя развилка на пути решения; «реиграбельность» - сводный индекс.',
  );
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
