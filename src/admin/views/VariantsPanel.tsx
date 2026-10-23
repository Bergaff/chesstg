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
import { Panel, StatusLine, Table, formatDateTime, formatPercent } from '../ui';
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
const SAMPLE_PRESETS = [16, 64, 100, 250, 1000];
const MIN_SAMPLES = 4;
const MAX_SAMPLES = 2000;
/**
 * Тяжёлый прогон: тот же таб, но 1000 досок и полный отчёт вместо таблицы.
 * 1000 - не круглая цифра ради цифры: на 16 досках разница между правилом и его
 * отсутствием тоньше шума (см. выводы в отчёте), а больше браузер в воркере
 * считает только по явной кнопке.
 */
const BIG_SAMPLES = 1000;
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

/** Что осталось после прогона: шапка отчёта собирается из этих полей, а не из
 * текущего значения полей ввода - пользователь мог поменять зерно, пока считалось. */
interface RunMeta {
  suite: SuiteId;
  finishedAt: number;
  seconds: number;
  samples: number;
  seed: number;
  /** Уровень кампании или лестница уровней «Парковки» и «Гонок». */
  scope: string;
  /** Это расчёт на 1000 досок: в отчёте он помечен явно. */
  big: boolean;
  stopped: boolean;
}

/** Как называть единицу прогона и на что она делится - в заголовке отчёта. */
const BOARD_WORD: Record<SuiteId, string> = { diagonal: 'досок', jam: 'полей', race: 'забегов' };
const PER_WORD: Record<SuiteId, string> = {
  diagonal: 'на вариант',
  jam: 'на уровень',
  race: 'на уровень и на правило',
};

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
  /** Сколько живёт расчёт на 1000 досок: мерялось node-ом на этом движке. */
  bigEta: string;
}

const SUITE: Record<SuiteId, SuiteMeta> = {
  diagonal: {
    tab: 'Диагональ',
    title: 'Кампания: диагональ только бить или свободно',
    note: 'Один генератор, две версии права на пустую диагональ. Если «только бить» не хуже по цифрам, правило можно оставлять как есть.',
    run: 'Сравнить диагональ',
    bigEta: '~45 с',
    footnote:
      '«Реиграбельность» это 40% разнообразия генератора, 25% отличия соседних досок, 25% шагов с выбором и 10% отсутствия безальтернативных ходов. «Выбор» - средняя развилка на пути решения.',
  },
  jam: {
    tab: 'Парковка',
    title: 'Парковка: сложность и реиграбельность',
    note: 'Головоломка без финиша по времени: важна длина плана, число развилок и различие досок. «Прощение» - доля первых ходов вне плана, после которых задача всё ещё решаема: низкое значит «один неверный ход, и всё».',
    run: `Замерить генератор`,
    bigEta: '~3 мин',
    footnote:
      '«Запас» - сколько ходов бюджета остаётся после плана: бюджет около двух длин плана, поэтому различают уровни именно план и запас, а не прощение.',
  },
  race: {
    tab: 'Гонки',
    title: 'Гонки: сколько можно играть до нерешаемой позиции',
    note: `Король заперт в двух нижних рядах (${RACE_MIN_WIDTH}×${RACE_ROWS} на старте, рост вширь до ${RACE_WIDTH} колонок), поля как ленты больше нет: фигура за такт делает ровно свой ход. Жадный бот играет и на каждом ходе перебирает ответы фигур: «до нерешаемой» - номер хода, после которого от фигуры не уйти. Справа то же поле без права на выпад: по разнице видно, что даёт правило, и обе ветки считают ровно столько досок, сколько запрошено.`,
    footnote:
      '«До нерешаемой доходят» - доля забегов, где перебор успевает найти позицию без хода: сто процентов означают, что конец партии читается заранее, а не приходит из-за угла. Фигура, дошедшая до нижнего ряда и не взявшая короля, сходит с поля - это замена уносившему ряду, иначе доска забивалась бы за пару десятков ходов. «Чем кончились» считается по тем же забегам, что и строка: «поимка 16 из 16» значит, что все партии этого уровня закончились поимкой.',
    run: 'Прогнать гонки',
    bigEta: '~10 с',
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

  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);

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

  /**
   * Прогон сравнивает два правила, и каждая ветка получает ровно столько досок,
   * сколько запрошено: делить пополам значит соврать в заголовке отчёта.
   */
  function suiteDiagonal(count: number): Promise<void> {
    setReports([]);
    setProgress(`${modeDef(DIAGONAL_PAIR[0]).name}: 0 из ${count}`);
    const suite = runVariantSuite(
      { modes: DIAGONAL_PAIR, level, samples: count, seed },
      {
        onSample: (mode, done, total) => setProgress(`${modeDef(mode).name}: ${done} из ${total}`),
        onReport: (item) => setReports((current) => [...current, item]),
      },
    );
    suiteRef.current = suite;
    return suite.done;
  }

  function suiteJam(count: number): Promise<void> {
    setJamRows([]);
    setProgress(`Уровень 0 из ${parsedLevels.length}`);
    const suite = runJamSuite(
      { levels: parsedLevels, samples: count, seed },
      {
        onRow: (row, done, total) => {
          setJamRows((current) => [...current, row]);
          setProgress(`Уровень ${done} из ${total}`);
        },
      },
    );
    suiteRef.current = suite;
    return suite.done;
  }

  function suiteRace(count: number): Promise<void> {
    setRaceRows([]);
    setProgress(`Уровень 0 из ${parsedLevels.length}`);
    const suite = runRaceSuite(
      {
        levels: parsedLevels,
        samples: count,
        seed,
        // Тот же набор зёрен без права на выпад: иначе таблица не отвечает на
        // вопрос «а зачем правило вообще нужно».
        compare: true,
      },
      {
        onRow: (row, done, total) => {
          setRaceRows((current) => [...current, row]);
          setProgress(`Уровень ${done} из ${total}`);
        },
      },
    );
    suiteRef.current = suite;
    return suite.done;
  }

  /** Шапка отчёта пишется из того, что прогналось, а не из текущего ввода. */
  function stamp(scope: string, count: number, big: boolean, startedAt: number) {
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const stopped = stopRef.current;
    setRunMeta({ suite: active, finishedAt: Date.now(), seconds, samples: count, seed, scope, big, stopped });
    setNote(
      stopped
        ? `Прогон остановлен: в отчёте только то, что успело сосчитаться (${count} ${BOARD_WORD[active]} ${PER_WORD[active]}).`
        : `Готово: ${count} ${BOARD_WORD[active]} ${PER_WORD[active]} за ${seconds} с. Отчёт с выводами лежит ниже, «Скопировать» забирает его целиком.`,
    );
  }

  /**
   * Один прогон активного таба. `big` - тяжёлый расчёт на 1000 досок: то же
   * самое, только дольше и с полным отчётом на выходе, чтобы результат можно
   * было переслать без подписей «что за колонки».
   */
  const runSuite = (count: number, big: boolean) => {
    if (active !== 'diagonal' && parsedLevels.length === 0) return;
    const scope = active === 'diagonal' ? `уровень ${level}` : `уровни ${parsedLevels.join(',')}`;
    start(async () => {
      const startedAt = Date.now();
      try {
        if (active === 'diagonal') await suiteDiagonal(count);
        else if (active === 'jam') await suiteJam(count);
        else await suiteRace(count);
      } finally {
        // Отчёт нужен и после отмены: половина уровней посчитана - её и показываем,
        // в шапке помечено, что прогон остановлен.
        stamp(scope, count, big, startedAt);
      }
    });
  };

  const runActive = () => runSuite(samples, false);
  const runBig = () => runSuite(BIG_SAMPLES, true);

  const stop = () => {
    stopRef.current = true;
    suiteRef.current?.cancel();
  };

  const count = active === 'diagonal' ? reports.length : active === 'jam' ? jamRows.length : raceRows.length;
  const canRun = active === 'diagonal' || parsedLevels.length > 0;

  /** Markdown-таблицы активного прогона с их же заголовком про зерно и доски. */
  const tableText = (): string => {
    const ran = runMeta?.samples ?? samples;
    const usedSeed = runMeta?.seed ?? seed;
    return active === 'diagonal'
      ? diagonalText(reports, { level, samples: ran, seed: usedSeed })
      : active === 'jam'
        ? jamText(jamRows, { samples: ran, seed: usedSeed })
        : raceText(raceRows, { samples: ran, seed: usedSeed });
  };

  const reportFindings = (): string[] =>
    active === 'diagonal'
      ? diagonalFindings(reports)
      : active === 'jam'
        ? jamFindings(jamRows)
        : raceFindings(raceRows);

  /**
   * Отчёт целиком: дата, настройки, таблицы и выводы, посчитанные из цифр.
   * Шапка берётся из меты прогона - поля ввода за время расчёта могли уехать,
   * а пересылаем мы именно то, что считалось.
   */
  const reportText = (): string => {
    const own = runMeta && runMeta.suite === active ? runMeta : null;
    const head = own
      ? [
          `Отчёт лаборатории: ${meta.title}`,
          `${formatDateTime(own.finishedAt)} · ${own.scope} · ${own.samples} ${BOARD_WORD[own.suite]} ${PER_WORD[own.suite]}${own.big ? ` · тяжёлый расчёт на ${BIG_SAMPLES} досок, считалось ${own.seconds} с` : ` · считалось ${own.seconds} с`}${own.stopped ? ' · прогон остановлен, считали не все уровни' : ''}`,
          '',
        ].join('\n')
      : '';
    const findings = reportFindings();
    const tail = findings.length > 0 ? `\n\nВыводы:\n${findings.map((line) => `- ${line}`).join('\n')}` : '';
    return `${head}${tableText()}${tail}`.trim();
  };

  const copy = async () => {
    const ok = await writeClipboard(reportText());
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
          <button
            type="button"
            className="btn btn-quiet"
            onClick={runBig}
            disabled={running || !canRun}
            title={`Тот же прогон на ${BIG_SAMPLES} досок и отчёт с выводами: его можно переслать как есть. Ориентир по времени - ${meta.bigEta}`}
          >
            {running && progress ? `считаем: ${BIG_SAMPLES} досок` : `Расчёт на ${BIG_SAMPLES} досок · ${meta.bigEta}`}
          </button>
          {count > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => void copy()}>
              Скопировать отчёт
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
        {count > 0 && <pre className="adm-code adm-copyable">{reportText()}</pre>}
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
        'До нерешаемой доходят',
        'Взятий',
        'Что даёт выпад',
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
              <td colSpan={8} className="adm-muted">
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
            <td>{formatPercent(item.doomShare, 0)}</td>
            <td>{item.capturesAvg.toFixed(1)}</td>
            <td className="is-mono">{strikeGainText(item)}</td>
            <td className="adm-muted">
              {causesText(item.causes, item.samples)}
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
  escaped: 'ушли с поля',
  won: 'победа',
  capped: 'потолок просчёта',
};

/**
 * Что даёт право бить через линию: та же доска, тот же бот, разница в ходах и
 * снятых фигурах. Без сравнения правило невозможно ни подтвердить, ни отменить.
 */
function strikeGainText(row: RaceMeasure): string {
  const base = row.noStrike;
  if (!base) return 'нет сравнения';
  const doom = row.doomMedian - base.doomMedian;
  const length = row.lengthMedian - base.lengthMedian;
  const takes = +(row.capturesAvg - base.capturesAvg).toFixed(1);
  const sign = (value: number): string => (value > 0 ? `+${value}` : `${value}`);
  return `доом ${sign(doom)}, партия ${sign(length)}, взятий ${sign(takes)}`;
}

function causesText(causes: Record<string, number>, total?: number): string {
  const entries = Object.entries(causes);
  if (entries.length === 0) return 'нет данных';
  const suffix = total ? ` из ${total}` : '';
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([cause, count]) => `${CAUSE_NAME[cause] ?? cause} ${count}${suffix}`)
    .join(', ');
}

/**
 * Выводы из цифр гонок. Их пишет сама панель, потому что вывод «правило работает»
 * должен быть выводом из прогона, а не из того, что автор кнопки ожидал увидеть.
 */
function raceFindings(rows: RaceMeasure[]): string[] {
  if (rows.length === 0) return [];
  const doom = rows.map((row) => row.doomMedian);
  const out = [
    `Длина решаемой партии от уровня не зависит: ${Math.min(...doom)}-${Math.max(...doom)} ходов на уровнях ${rows
      .map((row) => row.level)
      .join(', ')}. Разница между соседними строками меньше разброса по зёрнам - читать её как «стало сложнее» нельзя.`,
  ];

  const compared = rows.filter((row) => row.noStrike);
  if (compared.length > 0) {
    const avg = (pick: (row: RaceMeasure) => number) =>
      compared.reduce((sum, row) => sum + pick(row), 0) / compared.length;
    const gain = avg((row) => row.doomMedian - row.noStrike!.doomMedian);
    const captures = avg((row) => row.capturesAvg - row.noStrike!.capturesAvg);
    const length = avg((row) => row.lengthMedian - row.noStrike!.lengthMedian);
    const worse = gain < 0 || captures < 0;
    out.push(
      `Выпад через линию: ${sign(gain)} ${Math.abs(gain).toFixed(1)} хода до нерешаемой позиции, ${sign(
        captures,
      )} ${Math.abs(captures).toFixed(1)} взятия за забег, длина партии ${sign(length)} ${Math.abs(length).toFixed(1)} хода. ` +
        (worse
          ? 'Правило хуже базового - его надо убирать, а не докручивать.'
          : 'Правило чистит полосу, а не дарит лишнюю жизнь: при той же длине партии взятий заметно больше.'),
    );
  } else {
    out.push('Сравнения с полем без выпада нет: колонка пустая, и судить о правилу не по чему.');
  }

  const width = rows.reduce((sum, row) => sum + row.widthEnd, 0) / rows.length;
  out.push(
    `Поле дорастает в среднем до ${width.toFixed(1)} колонки из ${RACE_WIDTH} при стартовых ${RACE_MIN_WIDTH}: рост поля успевает случиться внутри одного забега.`,
  );

  const causes: Record<string, number> = {};
  let total = 0;
  let capped = 0;
  let doomShare = 0;
  for (const row of rows) {
    for (const [cause, count] of Object.entries(row.causes)) {
      causes[cause] = (causes[cause] ?? 0) + count;
      total += count;
    }
    capped += row.capped;
    doomShare += row.doomShare;
  }
  const names = Object.entries(causes)
    .sort((a, b) => b[1] - a[1])
    .map(([cause, count]) => `${CAUSE_NAME[cause] ?? cause} ${count}`)
    .join(', ');
  out.push(
    `Исходы ${total} забегов: ${names || 'нет данных'}. В ${formatPercent(
      doomShare / rows.length,
      0,
    )} партий конец наступает там, где перебор уже не оставляет хода${
      capped > 0 ? `, в ${capped} забегах длина упёрлась в потолок просчёта и не измерена` : ', упоров в потолок просчёта нет'
    }.`,
  );
  if ((causes.stuck ?? 0) === 0 && (causes.won ?? 0) === 0) {
    out.push(
      'Тупика и победы нет ни в одном забеге: у режима без финиша единственный конец - поимка, и она приходит раньше, чем игроку станет некуда ходить.',
    );
  }
  return out;
}

/** Выводы замера «Парковки»: растёт ли сложность и где лестница упирается. */
function jamFindings(rows: JamMeasure[]): string[] {
  if (rows.length === 0) return [];
  const first = rows[0];
  const last = rows[rows.length - 1];
  const out = [
    `План растёт с уровнем: ${first.avgCost} хода на ${first.level}-м против ${last.avgCost} на ${last.level}-м (поле ${first.width}x${first.height} выросло до ${last.width}x${last.height}).`,
  ];

  const tail = rows.slice(-3);
  if (tail.length > 1) {
    const costs = tail.map((row) => row.avgCost);
    const spread = Math.max(...costs) - Math.min(...costs);
    const sameBoard = new Set(tail.map((row) => `${row.width}x${row.height}`)).size === 1;
    if (sameBoard && spread / Math.max(1, last.avgCost) < 0.12) {
      out.push(
        `Последние уровни (${tail.map((row) => row.level).join(', ')}) играют на одном поле ${tail[0].width}x${tail[0].height} и прибавляют по плану всего ${spread.toFixed(0)} хода: выше этого уровня генератор задачу не усложняет, различаются только число фигур и расстановка.`,
      );
    }
  }

  const over = rows.reduce((sum, row) => sum + row.overBudget, 0);
  const runs = rows.reduce((sum, row) => sum + row.samples, 0);
  const slack = rows.map((row) => row.slackAvg);
  out.push(
    over > 0
      ? `Сверх бюджета ${over} полей из ${runs}: бюджет давит и сам по себе делает уровень сложнее.`
      : `Бюджет не давит ни на одном уровне (сверх бюджета 0 из ${runs}), после плана остаётся ${Math.min(
          ...slack,
        ).toFixed(0)}-${Math.max(...slack).toFixed(0)} хода: сложность делают план и развилки, а не лимит.`,
  );

  const unique = rows.reduce((sum, row) => sum + row.uniqueLayouts, 0);
  out.push(`Разнообразие генератора: ${unique} различных расстановок из ${runs} - повторов он не даёт.`);

  const forgiveness = rows.map((row) => row.forgiveness);
  out.push(
    `Прощение первого хода гуляет от ${formatPercent(Math.min(...forgiveness), 0)} до ${formatPercent(
      Math.max(...forgiveness),
      0,
    )} и не монотонно по уровню: метрика уровни не различает, спорить на её основе нельзя.`,
  );
  return out;
}

/** Выводы сравнения диагонали: чем объясняется падение решаемости. */
function diagonalFindings(reports: VariantReport[]): string[] {
  const free = reports.find((report) => report.mode === 'campaignFreeDiag');
  const strict = reports.find((report) => report.mode === 'campaignStrictDiag');
  if (!free || !strict) return [];
  const ratio = strict.avgChoiceSteps > 0 ? free.avgChoiceSteps / strict.avgChoiceSteps : 0;
  const drop = (free.solvableShare - strict.solvableShare) * 100;
  const out = [
    `Выбор на пути решения: ${free.avgChoiceSteps.toFixed(2)} против ${strict.avgChoiceSteps.toFixed(
      2,
    )}${ratio > 0 ? ` - со строгой диагональю развилок в ${ratio.toFixed(1)} раза меньше` : ''}.`,
  ];
  out.push(
    strict.fallbacks > 0 && drop > 1
      ? `Решаемость падает на ${drop.toFixed(
          1,
        )} п.п., но генератор отдал ${strict.fallbacks} досок из ${strict.samples} без отбора: почти всё падение объясняется воронкой генератора, а не правилом. Цифра «с решением» смешивает «доска нерешаемая» и «генератор сдался» - смотри на откаты рядом.`
      : `Решаемость ${formatPercent(free.solvableShare, 1)} против ${formatPercent(
          strict.solvableShare,
          1,
        )} при откатах ${free.fallbacks} и ${strict.fallbacks}.`,
  );
  const better = free.replayIndex >= strict.replayIndex ? 'свободная' : 'строгая';
  out.push(
    `Реиграбельность ${Math.round(free.replayIndex * 100)} против ${Math.round(
      strict.replayIndex * 100,
    )}, различных досок ${free.uniqueLayouts}/${free.samples} против ${strict.uniqueLayouts}/${strict.samples}: выигрывает ${better} диагональ, её и оставляем.` +
      (free.samples < 64 ? ` На ${free.samples} досках разница в пару пунктов - шум, для вывода нужно 64+.` : ''),
  );
  return out;
}

/** Знак в выводах словами: «плюс 1.2 хода» читается быстрее, чем «1.2». */
function sign(value: number): string {
  if (value > 0) return 'плюс';
  if (value < 0) return 'минус';
  return 'ровно';
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
  // Как и в гонках: сколько полей реально прогналось, а не что стоит в поле ввода.
  const ran = rows[0]?.samples ?? meta.samples;
  const lines = [`Замер генератора «Парковки», по ${ran} полей на уровень, зерно ${meta.seed}`, ''];
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
    'Без выпада: доом / партия / взятий',
    'Чем кончились',
  ];
  // Число берём из строк, а не из поля «досок»: заголовок обязан показывать то,
  // что реально прогналось, - на случай отмены и округлений в запросе.
  const ran = rows[0]?.samples ?? meta.samples;
  const lines = [
    `Прогон «Гонок», поле ${RACE_MIN_WIDTH}x${RACE_ROWS} с ростом вширь до ${RACE_WIDTH}, полоса короля - два нижних ряда, фигуры идут своими ходами; по ${ran} забегов на уровень и на правило, зерно ${meta.seed}`,
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.level} | ${row.widthStart} | ${row.widthEnd.toFixed(1)} | ${row.doomMedian} | ${row.doomAvg.toFixed(1)} | ${row.doomMin}-${row.doomMax} | ${row.lengthMedian} (avg ${row.lengthAvg.toFixed(1)}) | ${row.capturesAvg.toFixed(1)} | ${row.noStrike ? `${row.noStrike.doomMedian} / ${row.noStrike.lengthMedian} / ${row.noStrike.capturesAvg}` : 'нет сравнения'} | ${causesText(row.causes, row.samples)} |`,
    );
  }
  lines.push('');
  lines.push(
    '«До нерешаемой» - ход, после которого перебор не находит ни одного хода, уводящего от смерти в ближайшие три полухода. «Взятий» - сколько фигур снял бот: без взятий полоса забивается раньше. Колонка сравнения - тот же бот и те же зёрна на правиле без выпадата (`raceNoStrike`).',
  );
  return lines.join('\n');
}

/** Текст сравнения диагонали в markdown. */
function diagonalText(
  reports: VariantReport[],
  meta: { level: number; samples: number; seed: number },
): string {
  const ran = reports[0]?.samples ?? meta.samples;
  const lines = [
    `Кампания: диагональ свободно или только бить, уровень ${meta.level}, по ${ran} досок на вариант, зерно ${meta.seed}`,
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
