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
 * Лаборатория прогонов.
 *
 * Три карточки - по одной на вопрос, который нельзя задать одной расстановкой:
 *
 * 1. «Кампания»: что меняет право вставать на пустую диагональ. Те же доски,
 *    два варианта правил, и мы смотрим, где задача интереснее.
 * 2. «Парковка»: насколько генератор вообще даёт разные задачи и сколько в них
 *    выбора. Победа тут тривиальна (план есть почти всегда), поэтому меряется
 *    длина плана, развилки на нём и отличия расстановок.
 * 3. «Гонки»: сколько ходов партия остаётся решаемой. Игрок заперт в полосе из
 *    двух нижних рядов, и финал забега - позиция, где от фигуры не уйти. Это и
 *    есть «до нерешаемой ситуации»: её перебирает `isDoomed`, а не эвристика.
 *
 * Всё считается в воркере (см. `variantsClient`): перебор на каждый ход
 * короля занимает секунды на доску, и на главном потоке вкладка бы встала.
 */

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
  'Ушло',
  'Выбор',
  'Форс',
  'Разных досок',
  'Отличие соседних',
  'Реиграбельность',
];

export function VariantsPanel({ level }: { level: number }): ReactNode {
  const [samples, setSamples] = useState(DEFAULT_SAMPLES);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [levels, setLevels] = useState(LEVELS_LADDER);

  const [reports, setReports] = useState<VariantReport[]>([]);
  const [running, setRunning] = useState(false);
  const [sample, setSample] = useState<{ mode: ModeId; done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [stopped, setStopped] = useState(false);
  const [note, setNote] = useState('');

  const [jamRows, setJamRows] = useState<JamMeasure[]>([]);
  const [jamRunning, setJamRunning] = useState(false);
  const [jamDone, setJamDone] = useState({ done: 0, total: 0 });
  const [jamError, setJamError] = useState('');

  const [raceRows, setRaceRows] = useState<RaceMeasure[]>([]);
  const [raceRunning, setRaceRunning] = useState(false);
  const [raceDone, setRaceDone] = useState({ done: 0, total: 0 });
  const [raceError, setRaceError] = useState('');

  const busyRef = useRef(false);
  const suiteRef = useRef<{ cancel: () => void } | null>(null);
  const jamBusyRef = useRef(false);
  const jamSuiteRef = useRef<{ cancel: () => void } | null>(null);
  const raceBusyRef = useRef(false);
  const raceSuiteRef = useRef<{ cancel: () => void } | null>(null);
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

  const runDiagonal = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setError('');
    setNote('');
    setStopped(false);
    setReports([]);
    setSample({ mode: DIAGONAL_PAIR[0], done: 0, total: samples });
    const suite = runVariantSuite(
      { modes: DIAGONAL_PAIR, level, samples, seed },
      {
        onSample: (mode, done, total) => setSample({ mode, done, total }),
        onReport: (item) => setReports((current) => [...current, item]),
      },
    );
    suiteRef.current = suite;
    suite.done
      .catch((runError: unknown) => {
        if (!stopRef.current) setError(runError instanceof Error ? runError.message : 'Прогон не удался');
      })
      .finally(() => {
        setRunning(false);
        busyRef.current = false;
        suiteRef.current = null;
        setSample(null);
      });
  };

  const runJam = () => {
    if (jamBusyRef.current || parsedLevels.length === 0) return;
    jamBusyRef.current = true;
    stopRef.current = false;
    setJamRunning(true);
    setJamError('');
    setJamRows([]);
    setJamDone({ done: 0, total: parsedLevels.length });
    const suite = runJamSuite(
      { levels: parsedLevels, samples, seed },
      {
        onRow: (row, done, total) => {
          setJamRows((current) => [...current, row]);
          setJamDone({ done, total });
        },
      },
    );
    jamSuiteRef.current = suite;
    suite.done
      .catch((runError: unknown) => {
        if (!stopRef.current) setJamError(runError instanceof Error ? runError.message : 'Замер не удался');
      })
      .finally(() => {
        setJamRunning(false);
        jamBusyRef.current = false;
        jamSuiteRef.current = null;
      });
  };

  const runRace = () => {
    if (raceBusyRef.current || parsedLevels.length === 0) return;
    raceBusyRef.current = true;
    stopRef.current = false;
    setRaceRunning(true);
    setRaceError('');
    setRaceRows([]);
    setRaceDone({ done: 0, total: parsedLevels.length });
    const suite = runRaceSuite(
      { levels: parsedLevels, samples: Math.max(MIN_SAMPLES, Math.min(120, Math.round(samples / 2))), seed },
      {
        onRow: (row, done, total) => {
          setRaceRows((current) => [...current, row]);
          setRaceDone({ done, total });
        },
      },
    );
    raceSuiteRef.current = suite;
    suite.done
      .catch((runError: unknown) => {
        if (!stopRef.current) setRaceError(runError instanceof Error ? runError.message : 'Прогон не удался');
      })
      .finally(() => {
        setRaceRunning(false);
        raceBusyRef.current = false;
        raceSuiteRef.current = null;
      });
  };

  const stopAll = () => {
    stopRef.current = true;
    setStopped(true);
    suiteRef.current?.cancel();
    jamSuiteRef.current?.cancel();
    raceSuiteRef.current?.cancel();
  };

  const conclusion = useMemo(() => diagonalConclusion(reports), [reports]);

  const copy = async (text: string) => {
    const ok = await writeClipboard(text);
    setNote(ok ? 'Скопировано. Вставляй прямо в чат или в `docs/modes.md`.' : 'Буфер обмена недоступен, выдели текст вручную.');
  };

  return (
    <Panel
      title="Прогоны: кампания, парковка, гонки"
      note={`Уровень ${level} задаёт доску и число фигур для кампании; «Парковка» и «Гонки» считают свою лестницу уровней. 1000 досок на вариант это секунды, перебор «Гонок» - десятки секунд, поэтому всё в воркере`}
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
        <label className="adm-field is-inline">
          <span className="adm-label">Уровни для «Парковки» и «Гонок»</span>
          <input
            type="text"
            value={levels}
            onChange={(event) => setLevels(event.target.value)}
            placeholder={LEVELS_LADDER}
            disabled={jamRunning || raceRunning}
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
            disabled={running || jamRunning || raceRunning}
          >
            {value}
          </button>
        ))}
        {(running || jamRunning || raceRunning) && (
          <button type="button" className="btn btn-quiet" onClick={stopAll}>
            Остановить
          </button>
        )}
      </div>

      {note && <StatusLine kind="ok">{note}</StatusLine>}

      <section className="adm-suite">
        <div className="adm-suite-head">
          <h3 className="adm-suite-title">Кампания: диагональ только бить или свободно</h3>
          <p className="adm-note">
            Один и тот же генератор, две версии права на пустую диагональ. Смотрим длину решения, развилки и
            реиграбельность: если «диагональ только бить» не хуже, правило можно оставить как есть.
          </p>
        </div>
        <div className="adm-row-actions">
          <button type="button" className="btn btn-outline" onClick={runDiagonal} disabled={running}>
            {running && sample ? `${modeDef(sample.mode).name}: ${sample.done} из ${sample.total}` : 'Сравнить диагональ'}
          </button>
          {reports.length > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => void copy(diagonalText(reports, { level, samples, seed }))}>
              Скопировать
            </button>
          )}
        </div>
        {error && <StatusLine kind="error">{error}</StatusLine>}
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
                <td>{item.avgEscapes.toFixed(2)}</td>
                <td>{item.avgChoiceSteps.toFixed(2)}</td>
                <td>{formatPercent(item.forcedShare, 0)}</td>
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
        {conclusion && <p className="adm-suite-note">{conclusion}</p>}
        {reports.length > 0 && <pre className="adm-code adm-copyable">{diagonalText(reports, { level, samples, seed })}</pre>}
      </section>

      <section className="adm-suite">
        <div className="adm-suite-head">
          <h3 className="adm-suite-title">Парковка: сложность и реиграбельность</h3>
          <p className="adm-note">
            Головоломка без финиша по времени: важна длина плана, число развилок на нём и то, насколько генератор
            даёт разные доски. «Прощение» - доля первых ходов вне плана, после которых задача всё ещё решаема: низкое
            прощение значит «один неверный ход, и всё», то есть головоломку заучивают, а не решают.
          </p>
        </div>
        <div className="adm-row-actions">
          <button type="button" className="btn btn-outline" onClick={runJam} disabled={jamRunning || parsedLevels.length === 0}>
            {jamRunning ? `Уровень ${jamDone.done} из ${jamDone.total || parsedLevels.length}` : `Замерить генератор (${parsedLevels.length})`}
          </button>
          {jamRows.length > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => void copy(jamText(jamRows, { samples, seed }))}>
              Скопировать
            </button>
          )}
        </div>
        {jamError && <StatusLine kind="error">{jamError}</StatusLine>}
        {jamRows.length > 0 && <pre className="adm-code adm-copyable">{jamText(jamRows, { samples, seed })}</pre>}
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
          {parsedLevels.map((value) => {
            const item = jamRows.find((row) => row.level === value);
            if (!item) {
              return (
                <tr key={value}>
                  <td>{value}</td>
                  <td colSpan={13} className="adm-muted">
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
      </section>

      <section className="adm-suite">
        <div className="adm-suite-head">
          <h3 className="adm-suite-title">Гонки: сколько можно играть до нерешаемой позиции</h3>
          <p className="adm-note">
            Король заперт в двух нижних рядах ({RACE_MIN_WIDTH}×{RACE_ROWS} на старте, рост вширь до {RACE_WIDTH}{' '}
            колонок), сдвиг поля его не убивает. Прогон играет жадным ботом и на каждом ходе перебирает ответы фигур:
            «до нерешаемой» - номер хода, после которого от фигуры уже не уйти ни одним ходом.
          </p>
        </div>
        <div className="adm-row-actions">
          <button type="button" className="btn btn-outline" onClick={runRace} disabled={raceRunning || parsedLevels.length === 0}>
            {raceRunning ? `Уровень ${raceDone.done} из ${raceDone.total || parsedLevels.length}` : `Прогнать гонки (${parsedLevels.length})`}
          </button>
          {raceRows.length > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => void copy(raceText(raceRows, { samples, seed }))}>
              Скопировать
            </button>
          )}
        </div>
        {raceError && <StatusLine kind="error">{raceError}</StatusLine>}
        {raceRows.length > 0 && <pre className="adm-code adm-copyable">{raceText(raceRows, { samples, seed })}</pre>}
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
          {parsedLevels.map((value) => {
            const item = raceRows.find((row) => row.level === value);
            if (!item) {
              return (
                <tr key={value}>
                  <td>{value}</td>
                  <td colSpan={7} className="adm-muted">
                    {raceRunning ? 'считаем' : 'нет данных'}
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
                <td className="adm-muted">{causesText(item.causes)}{item.capped > 0 ? `, потолок ${item.capped}` : ''}</td>
              </tr>
            );
          })}
        </Table>
      </section>

      <p className="adm-note">
        «Реиграбельность» это 40% разнообразия генератора, 25% отличия соседних досок, 25% шагов с выбором и 10%
        отсутствия безальтернативных ходов. «Ушло» - сколько фигур покинуло поле по пути решения. В гонках
        «решаемых до конца» - доля забегов, где партия кончилась прежде, чем позиция стала нерешаемой: ноль означает,
        что игрок всегда умирает в позиции, где ходить было некуда.
      </p>
    </Panel>
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
  const head = ['Уровень', 'Старт', 'Ширина в конце', 'До нерешаемой (медиана)', 'среднее', 'разброс', 'Партия (медиана)', 'Взятий', 'Чем кончились'];
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
        item.avgEscapes.toFixed(2),
        item.avgChoiceSteps.toFixed(2),
        `${(item.forcedShare * 100).toFixed(0)}%`,
        `${item.uniqueLayouts}/${item.samples}${item.fallbacks > 0 ? ` (откатов ${item.fallbacks})` : ''}`,
        `${(item.layoutDistance * 100).toFixed(1)}%`,
        `${item.replayIndex}`,
      ].join(' | ')} |`,
    );
  }
  lines.push('');
  lines.push(
    '«С решением» - доля досок, где решатель доходит до финиша; «выбор» и «форс» - развилки на пути решения; «реиграбельность» - сводный индекс.',
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
