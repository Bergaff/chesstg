import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  boardForMode,
  modeDef,
  RACE_MIN_WIDTH,
  RACE_ROWS,
  raceCoinReward,
  RACE_WIDTH,
  type JamMeasure,
  type ModeId,
  type RaceMeasure,
  type VariantReport,
} from '../../engine';
import { Panel, StatusLine, Table, formatDateTime, formatPercent } from '../ui';
import { runJamSuite, runRaceSuite, runVariantSuite } from '../variantsClient';

/**
 * Лаборатория прогонов: одно окно, четыре прогона.
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
 * 4. «Темп фигур»: те же доски на трёх правилах темпа (все фигуры, одна, по
 *    кругу) - проверяем, остаётся ли напряжение и платится ли награда.
 *
 * Всё считается в воркере (см. `variantsClient`): перебор на каждый ход короля
 * занимает секунды на доску, и на главном потоке вкладка бы встала.
 */

type SuiteId = 'diagonal' | 'jam' | 'race' | 'tempo';

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
/**
 * Правила темпа, которые сравнивает четвёртая вкладка: боевой общий темп и два
 * медленных. Строка таблицы - пара «уровень × правило».
 */
const TEMPO_MODES: ModeId[] = ['race', 'raceTempoOne', 'raceTempoCycle'];
/** Правило, относительно которого темп и меряется: первый элемент списка. */
const TEMPO_BASE: ModeId = TEMPO_MODES[0];
/**
 * За сколько ходов прогон считает забег законченным. Медленный темп партии не
 * кончает вовсе, и потолок обязан быть виден в отчёте, а не спрятан в цифре.
 */
const RACE_CAP = 240;
/** Сколько монет панель приписывает одному взятию, когда проектирует награду. */
const COIN_PRESETS = [0, 1, 2, 3];
/** Имена фигур в сводке: `busiestType` приходит из движка по-английски. */
const PIECE_NAME: Record<string, string> = {
  pawn: 'пешка',
  rook: 'ладья',
  knight: 'конь',
  bishop: 'слон',
  queen: 'ферзь',
};

const DIAGONAL_HEAD = [
  'Уровень',
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

/** Как называть единицу прогона (с формами склонения) и на что она делится. */
const BOARD_FORMS: Record<SuiteId, [string, string, string]> = {
  diagonal: ['доска', 'доски', 'досок'],
  jam: ['поле', 'поля', 'полей'],
  race: ['забег', 'забега', 'забегов'],
  tempo: ['забег', 'забега', 'забегов'],
};
const PER_WORD: Record<SuiteId, string> = {
  diagonal: 'на вариант',
  jam: 'на уровень',
  race: 'на уровень и на правило',
  tempo: 'на уровень и на правило',
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
    note: 'Один генератор, две версии права на пустую диагональ, и считаются все уровни лесенки: поле растёт с 3x4 до 6x9, и правило надо проверять на всём росте, а не на одном 4x6. Если «только бить» не хуже по цифрам на каждом поле, правило можно оставлять как есть. Тяжёлые уровни (30-40) считают заметно дольше: если нужен быстрый ответ, оставь 1,8,20.',
    run: 'Сравнить диагональ',
    bigEta: '~45 с на уровень',
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
  tempo: {
    tab: 'Темп фигур',
    title: 'Гонки: за такт ходят все фигуры или по одной',
    note: 'Один генератор, три правила темпа: все фигуры (боевое), одна атакующая, фигуры по кругу. Смотрим не длину партии, а то, что за ней стоит: сколько осмысленного выбора остаётся у короля, какая доля ходов не ведёт к краху, как различаются забеги по длине и что при этом даёт взятие. Медленный темп обязан быть хуже по всем четырём пунктам или объяснять, зачем он нужен.',
    run: 'Сравнить темп',
    bigEta: '~2 мин на одном уровне, ~12 мин на лесенке',
    footnote:
      '«Реиграб.» = 35% выбора на ходу (три хода и больше - максимум), 25% доли безопасных ходов (0.7 - максимум), 25% разброса длины партии ((p90-p10)/медиана, 0.5 - максимум) и 15% разных стартов. «Фигур за такт» - среднее число сдвинувшихся фигур: 1 значит темп «по одной». Уровень в «Гонках» не меняет ни поле, ни приток (из него берётся только зерно стартовой пробки), поэтому семь строк лесенки - это семь стартов одного поля.',
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

const SUITE_ORDER: SuiteId[] = ['diagonal', 'jam', 'race', 'tempo'];

export function VariantsPanel({ level }: { level: number }): ReactNode {
  const [samples, setSamples] = useState(DEFAULT_SAMPLES);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [levels, setLevels] = useState(LEVELS_LADDER);
  const [active, setActive] = useState<SuiteId>('diagonal');

  const [reports, setReports] = useState<VariantReport[]>([]);
  const [jamRows, setJamRows] = useState<JamMeasure[]>([]);
  const [raceRows, setRaceRows] = useState<RaceMeasure[]>([]);
  const [tempoRows, setTempoRows] = useState<RaceMeasure[]>([]);
  // Монет за взятие: панель только проектирует награду, движок пока платит за
  // длину партии. Число нужно, чтобы увидеть цену правила до его смены.
  const [coins, setCoins] = useState(2);

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

  /**
   * Лестница уровней для всех трёх прогонов. Пустое поле ввода - не ошибка:
   * кампания тогда считает свой текущий уровень, а не весь прогон падает.
   */
  const ladder = useMemo(() => (parsedLevels.length > 0 ? parsedLevels : [level]), [parsedLevels, level]);
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
    // Каждая строка лесенки даёт две пары: тот же уровень, два правила. Порядком
    // идут уровни, внутри уровня - вариант, поэтому прогресс показывает и то, и
    // другое: на 30-м уровне ждать заметно дольше, и без уровня в подписи это
    // выглядит как зависший прогон.
    const jobs = ladder.flatMap((jobLevel) => DIAGONAL_PAIR.map((mode) => ({ mode, level: jobLevel })));
    let finished = 0;
    setProgress(`Пар 0 из ${jobs.length}`);
    const suite = runVariantSuite(
      { jobs, samples: count, seed },
      {
        onSample: (mode, jobLevel, done, total) =>
          setProgress(`${modeDef(mode).name}, уровень ${jobLevel}: ${done} из ${total}`),
        onReport: (item) => {
          finished += 1;
          setReports((current) => [...current, item]);
          setProgress(`Готово ${finished} из ${jobs.length} (уровень ${item.level})`);
        },
      },
    );
    suiteRef.current = suite;
    return suite.done;
  }

  function suiteJam(count: number): Promise<void> {
    setJamRows([]);
    setProgress(`Уровень 0 из ${ladder.length}`);
    const suite = runJamSuite(
      { levels: ladder, samples: count, seed },
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
    setProgress(`Уровень 0 из ${ladder.length}`);
    const suite = runRaceSuite(
      {
        levels: ladder,
        samples: count,
        seed,
        // Тот же набор зёрен без права на выпад: иначе таблица не отвечает на
        // вопрос «а зачем правило вообще нужно».
        compare: true,
        compareMode: 'raceNoStrike',
        cap: RACE_CAP,
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

  /**
   * Темп меряется тремя правилами на одних и тех же зёрнах, базой служит боевое
   * «race»: иначе «замедление» выглядело бы изменением генератора, а не правила.
   */
  function suiteTempo(count: number): Promise<void> {
    setTempoRows([]);
    const total = ladder.length * TEMPO_MODES.length;
    setProgress(`Строк 0 из ${total}`);
    const suite = runRaceSuite(
      {
        levels: ladder,
        modes: TEMPO_MODES,
        samples: count,
        seed,
        compare: true,
        compareMode: TEMPO_BASE,
        cap: RACE_CAP,
      },
      {
        onRow: (row, done) => {
          setTempoRows((current) => [...current, row]);
          setProgress(
            `${modeDef(row.mode).name}, уровень ${row.level}: ${done} из ${total}`,
          );
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
        ? `Прогон остановлен: в отчёте только то, что успело сосчитаться (${count} ${declension(
          count,
          BOARD_FORMS[active],
        )} ${PER_WORD[active]}).`
        : `Готово: ${count} ${declension(count, BOARD_FORMS[active])} ${PER_WORD[active]} за ${seconds} с. Отчёт с выводами лежит ниже, «Скопировать» забирает его целиком.`,
    );
  }

  /**
   * Один прогон активного таба. `big` - тяжёлый расчёт на 1000 досок: то же
   * самое, только дольше и с полным отчётом на выходе, чтобы результат можно
   * было переслать без подписей «что за колонки».
   */
  const runSuite = (count: number, big: boolean) => {
    const scope = ladder.length === 1 ? `уровень ${ladder[0]}` : `уровни ${ladder.join(',')}`;
    start(async () => {
      const startedAt = Date.now();
      try {
        if (active === 'diagonal') await suiteDiagonal(count);
        else if (active === 'jam') await suiteJam(count);
        else if (active === 'tempo') await suiteTempo(count);
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

  const count =
    active === 'diagonal'
      ? reports.length
      : active === 'jam'
        ? jamRows.length
        : active === 'tempo'
          ? tempoRows.length
          : raceRows.length;

  /** Markdown-таблицы активного прогона с их же заголовком про зерно и доски. */
  const tableText = (): string => {
    const ran = runMeta?.samples ?? samples;
    const usedSeed = runMeta?.seed ?? seed;
    return active === 'diagonal'
      ? diagonalText(reports, { levels: ladder, samples: ran, seed: usedSeed })
      : active === 'jam'
        ? jamText(jamRows, { samples: ran, seed: usedSeed })
        : active === 'tempo'
          ? raceText(tempoRows, { samples: ran, seed: usedSeed, coins, modeColumn: true })
          : raceText(raceRows, { samples: ran, seed: usedSeed, coins });
  };

  const reportFindings = (): string[] =>
    active === 'diagonal'
      ? diagonalFindings(reports)
      : active === 'jam'
        ? jamFindings(jamRows)
        : active === 'tempo'
          ? tempoFindings(tempoRows, coins)
          : raceFindings(raceRows, coins);

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
          `${formatDateTime(own.finishedAt)} · ${own.scope} · ${own.samples} ${declension(own.samples, BOARD_FORMS[own.suite])} ${PER_WORD[own.suite]}${own.big ? ` · тяжёлый расчёт на ${BIG_SAMPLES} досок, считалось ${own.seconds} с` : ` · считалось ${own.seconds} с`}${own.stopped ? ' · прогон остановлен, считали не все уровни' : ''}`,
          '',
        ].join('\n')
      : '';
    const findings = reportFindings();
    const tail = findings.length > 0 ? `\n\nВыводы:\n${findings.map((line) => `- ${line}`).join('\n')}` : '';
    return `${head}${tableText()}${tail}`.trim();
  };

  /** Выводы считаются из строк прогона: они живут и под таблицей, и в отчёте. */
  const findings = reportFindings();

  const copy = async () => {
    const ok = await writeClipboard(reportText());
    setNote(ok ? 'Скопировано. Вставляй прямо в чат или в `docs/modes.md`.' : 'Буфер обмена недоступен, выдели текст вручную.');
  };

  return (
    <Panel
      title="Прогоны: кампания, парковка, гонки"
      note={`Лестница уровней задаёт поле и число фигур для всех прогонов: кампания растёт с 3x4 до 6x9, у «Парковки» своё расписание, а у «Гонок» уровень меняет только зерно старта. Пустое поле - не ошибка: тогда считается текущий уровень ${level}. Перебор живёт в воркере, поэтому вкладка не замирает`}
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
          <span className="adm-label">Лестница уровней</span>
          <input
            type="text"
            value={levels}
            onChange={(event) => setLevels(event.target.value)}
            placeholder={LEVELS_LADDER}
            disabled={running}
          />
        </label>
        {(active === 'race' || active === 'tempo') && (
          <label className="adm-field is-inline">
            <span className="adm-label">Монет за взятие</span>
            <input
              type="number"
              min={0}
              max={10}
              step={1}
              value={coins}
              onChange={(event) => setCoins(Math.max(0, Math.min(10, Number(event.target.value) || 0)))}
              disabled={running}
              title="Сколько монет панель приписывает одному взятию, когда проектирует награду за забег. Движок пока платит за длину партии: это только расчёт."
            />
          </label>
        )}
        {(active === 'race' || active === 'tempo') &&
          COIN_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              className={`adm-chip${coins === value ? ' is-active' : ''}`}
              onClick={() => setCoins(value)}
              disabled={running}
              title={`Проекция награды при ${value} монетах за взятие`}
            >
              {value} м/вз
            </button>
          ))}
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
            disabled={running}
          >
            {running && progress
              ? progress
              : `${meta.run} (${active === 'tempo' ? ladder.length * TEMPO_MODES.length : ladder.length})`}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={runBig}
            disabled={running}
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

        {active === 'diagonal' && <DiagonalTable rows={reports} levels={ladder} running={running} />}
        {active === 'jam' && <JamTable rows={jamRows} levels={ladder} running={running} />}
        {active === 'race' && (
          <RaceTable rows={raceRows} levels={ladder} running={running} coins={coins} compareLabel="Что даёт выпад" />
        )}
        {active === 'tempo' && (
          <RaceTable
            rows={tempoRows}
            levels={ladder}
            running={running}
            coins={coins}
            modeColumn
            compareLabel="Что даёт темп"
          />
        )}

        {findings.length > 0 && (
          <ul className="adm-suite-findings">
            {findings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        <p className="adm-suite-note">{meta.footnote}</p>
        {count > 0 && <pre className="adm-code adm-copyable">{reportText()}</pre>}
      </section>
    </Panel>
  );
}

function DiagonalTable({
  rows,
  levels,
  running,
}: {
  rows: VariantReport[];
  levels: number[];
  running: boolean;
}): ReactNode {
  const byJob = new Map(rows.map((row) => [`${row.level}:${row.mode}`, row]));
  return (
    <Table head={DIAGONAL_HEAD} empty="Нажми «Сравнить диагональ»: отчёт появится строками по мере прогона пар «уровень + правило»">
      {levels.flatMap((value) =>
        DIAGONAL_PAIR.map((mode) => {
          const item = byJob.get(`${value}:${mode}`);
          const geo = boardForMode(mode, value);
          const key = `${value}:${mode}`;
          const cells = item ? DIAGONAL_CELLS(item) : null;
          if (!item || !cells) {
            return (
              <tr key={key}>
                <td>{value}</td>
                <td>{modeDef(mode).name}</td>
                <td className="is-mono">
                  {geo.width}×{geo.height}
                </td>
                <td colSpan={DIAGONAL_HEAD.length - 3} className="adm-muted">
                  {running ? 'считаем' : 'нет данных'}
                </td>
              </tr>
            );
          }
          return (
            <tr key={key}>
              <td>{value}</td>
              <td>{modeDef(mode).name}</td>
              <td className="is-mono">
                {geo.width}×{geo.height}
              </td>
              {cells}
            </tr>
          );
        }),
      )}
    </Table>
  );
}

/** Колонки сравнения после «уровень / режим / поле»: одни и те же для строки-заглушки и строки с данными. */
function DIAGONAL_CELLS(item: VariantReport): ReactNode {
  return (
    <>
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
    </>
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

interface RaceTableProps {
  rows: RaceMeasure[];
  levels: number[];
  running: boolean;
  /** Сколько монет за взятие показывает проекция награды. */
  coins: number;
  /** Строка на пару «уровень × правило»: так работает вкладка «Темп фигур». */
  modeColumn?: boolean;
  /** Колонка сравнения: на вкладке «Гонки» это выпад, на «Темпе» - сам темп. */
  compareLabel?: string;
}

/**
 * Одна таблица на два гоночных прогона. Строки заданы не данными, а списком
 * уровней (и правил): недостающие показаны как «считаем» или «нет данных»,
 * чтобы остановленный прогон не выглядел полным.
 */
function RaceTable({ rows, levels, running, coins, modeColumn = false, compareLabel = 'Что даёт сравнение' }: RaceTableProps): ReactNode {
  const head = [
    'Уровень',
    ...(modeColumn ? ['Правило'] : []),
    'Ширина в конце',
    'Ходов до нерешаемой',
    'Разброс',
    'Партия, ходов',
    'До нерешаемой доходят',
    'Взятий',
    compareLabel,
    'Выбор · безопасные',
    'Фигур за такт · кто бегает',
    'Реиграб.',
    'Награда, монеты',
    'Чем кончились',
  ];
  const pairs = levels.flatMap((level) =>
    modeColumn ? TEMPO_MODES.map((mode) => ({ level, mode })) : [{ level, mode: 'race' as ModeId }],
  );
  const rest = head.length - (modeColumn ? 2 : 1);
  return (
    <Table
      head={head}
      empty="Прогон считает перебором: ход, после которого любой ответ фигур ведёт к смерти"
    >
      {pairs.map(({ level, mode }) => {
        const key = modeColumn ? `${level}-${mode}` : `${level}`;
        const item = rows.find((row) => row.level === level && (!modeColumn || row.mode === mode));
        if (!item) {
          return (
            <tr key={key}>
              <td>{level}</td>
              {modeColumn ? <td className="adm-muted">{modeDef(mode).name}</td> : null}
              <td colSpan={rest} className="adm-muted">
                {running ? 'считаем' : 'нет данных'}
              </td>
            </tr>
          );
        }
        return (
          <tr key={key}>
            <td>{level}</td>
            {modeColumn ? <td>{modeDef(item.mode).name}</td> : null}
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
            <td className="is-mono">{item.capturesAvg.toFixed(1)}</td>
            <td className="is-mono">{compareGainText(item, modeColumn && item.mode === TEMPO_BASE)}</td>
            <td className="is-mono">
              {item.choiceAvg.toFixed(2)} · {formatPercent(item.safeShare, 0)}
            </td>
            <td className="is-mono">
              {item.moversAvg.toFixed(2)} · {PIECE_NAME[item.busiestType] ?? item.busiestType}{' '}
              {Math.round(item.busiestShare * 100)}%
            </td>
            <td className="is-mono">
              {item.replayIndex.toFixed(2)} (форс {formatPercent(item.forcedShare, 0)})
            </td>
            <td className="is-mono">{rewardText(item, coins)}</td>
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

/** Причины конца забега человеческим языком: ключи `lastEvent` админу ничего не говорят. */
const CAUSE_NAME: Record<string, string> = {
  captured: 'поимка',
  stuck: 'тупик',
  escaped: 'ушли с поля',
  won: 'победа',
  capped: 'потолок просчёта',
};

/**
 * Что даёт проверяемое правило: та же доска, тот же бот, разница в ходах и
 * снятых фигурах. Без сравнения правило невозможно ни подтвердить, ни отменить.
 */
/** Разница с базовым правилом со знаком и числом: «плюс» без цифры ничего не значит. */
function delta(value: number, digits = 1): string {
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

function compareGainText(row: RaceMeasure, isBase = false): string {
  const base = row.comparison;
  if (!base) return isBase ? 'это база сравнения' : 'нет сравнения';
  const doom = row.doomMedian - base.doomMedian;
  const length = row.lengthMedian - base.lengthMedian;
  const takes = row.capturesAvg - base.capturesAvg;
  const replay = (row.replayIndex - base.replayIndex) * 100;
  return `доом ${delta(doom, 0)}, партия ${delta(length, 0)}, взятий ${delta(takes)}, реиграб. ${delta(replay)}`;
}

/**
 * Проекция награды. Движок платит за пережитые ходы и только за проигранный
 * забег (`raceCoinReward`), взятие пока бесплатно. Колонка отвечает на вопрос
 * «сколько было бы, если платить за фигуру»: медиану, а не среднее - редкие
 * длинные партии тянут средний вверх, а платить приходится за обычный забег.
 * Выпад идёт за половину взятия: фигура та же, но король не ушёл с клетки.
 */
function rewardText(row: RaceMeasure, coins: number): string {
  // Платёж начисляется за проигранный забег. Если половина партий упёрлась в
  // потолок прогона, игрок не проигрывает - и награды нет, как бы ни рос счёт.
  if (row.samples > 0 && row.capped / row.samples > 0.5) return '0: забег не проигран';
  const now = raceCoinReward(Math.round(row.lengthAvg));
  const takes = row.capturesMedian * coins + Math.round(row.strikesAvg * Math.floor(coins / 2));
  return `${now} → ${now + Math.round(takes)}`;
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

/** Средняя цифра по строкам: выводы пишутся по всему прогону, а не по одной строке. */
function mean(rows: RaceMeasure[], pick: (row: RaceMeasure) => number): number {
  return rows.length ? rows.reduce((sum, row) => sum + pick(row), 0) / rows.length : 0;
}

/** Медианы взятий и выпадов -> сколько монет добавила бы плата за фигуру. */
function rewardLine(rows: RaceMeasure[], coins: number): string {
  const runs = Math.max(1, rows.reduce((sum, row) => sum + row.samples, 0));
  const stuck = rows.reduce((sum, row) => sum + row.capped, 0) / runs;
  if (stuck > 0.5) {
    const share = Math.round(stuck * 100);
    return (
      `Награда не начисляется: ${share}% ${declension(share, ['забегов', 'забегов', 'забегов'])} не кончились проигрышем, а платёж привязан к концу партии. ` +
      'Пока забег можно не проигрывать, платить за взятие бессмысленно: деньги начнут капать из ожидания.'
    );
  }
  const now = Math.round(mean(rows, (row) => raceCoinReward(Math.round(row.lengthAvg))));
  const takes = mean(rows, (row) => row.capturesMedian);
  const strikes = mean(rows, (row) => row.strikesAvg);
  const bonus = Math.round(takes * coins + Math.round(strikes * Math.floor(coins / 2)));
  const p90 = Math.round(mean(rows, (row) => row.capturesP90));
  return (
    `Медиана взятий ${takes.toFixed(1)} за забег, верхний дециль ${p90}, выпадов ${strikes.toFixed(1)}. ` +
    (coins > 0
      ? `При ${coins} ${declension(coins, ['монете', 'монетах', 'монетах'])} за взятие это +${bonus} к ${now} монетам за длину: награда за забег стала бы ${now + bonus} ` +
        `(${((now + bonus) / Math.max(1, now) - 1) * 100 > 0 ? '+' : ''}${Math.round(((now + bonus) / Math.max(1, now) - 1) * 100)}% к текущему).`
      : `При нулевой ставке платёж остаётся тем же: ${now} монет только за длину.`)
  );
}

/**
 * Выводы из цифр гонок. Их пишет сама панель, потому что вывод «правило работает»
 * должен быть выводом из прогона, а не из того, что автор кнопки ожидал увидеть.
 */
function raceFindings(rows: RaceMeasure[], coins: number): string[] {
  if (rows.length === 0) return [];
  const doom = rows.map((row) => row.doomMedian);
  const out = [
    `Длина решаемой партии от уровня не зависит: ${Math.min(...doom)}-${Math.max(...doom)} ходов на уровнях ${rows
      .map((row) => row.level)
      .join(', ')}. Разница между соседними строками меньше разброса по зёрнам - читать её как «стало сложнее» нельзя.`,
  ];

  const compared = rows.filter((row) => row.comparison);
  if (compared.length > 0) {
    const avg = (pick: (row: RaceMeasure) => number) => mean(compared, pick);
    const gain = avg((row) => row.doomMedian - row.comparison!.doomMedian);
    const captures = avg((row) => row.capturesAvg - row.comparison!.capturesAvg);
    const length = avg((row) => row.lengthMedian - row.comparison!.lengthMedian);
    const replay = avg((row) => row.replayIndex - row.comparison!.replayIndex);
    const worse = gain < 0 || captures < 0;
    out.push(
      `Выпад через линию: ${sign(gain)} ${Math.abs(gain).toFixed(1)} хода до нерешаемой позиции, ${sign(
        captures,
      )} ${Math.abs(captures).toFixed(1)} взятия за забег, длина партии ${sign(length)} ${Math.abs(
        length,
      ).toFixed(1)} хода, реиграбельность ${sign(replay)} ${(Math.abs(replay) * 100).toFixed(1)} пункта. ` +
        (worse
          ? 'Правило хуже базового - его надо убирать, а не докручивать.'
          : 'Правило чистит полосу, а не дарит лишнюю жизнь: при той же длине партии взятий заметно больше.'),
    );
  } else {
    out.push('Сравнения с полем без выпада нет: колонка пустая, и судить о правилу не по чему.');
  }

  const width = mean(rows, (row) => row.widthEnd);
  out.push(
    `Поле дорастает в среднем до ${width.toFixed(1)} колонки из ${RACE_WIDTH} при стартовых ${RACE_MIN_WIDTH}: рост поля успевает случиться внутри одного забега.`,
  );

  out.push(replayLine(rows));
  out.push(rewardLine(rows, coins));

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
    `Исходы ${total} ${declension(total, ['забега', 'забегов', 'забегов'])}: ${names || 'нет данных'}. В ${formatPercent(
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

/**
 * Выводы вкладки «Темп фигур»: сравниваются три правила на одних зёрнах. Читаем
 * не длину партии (она зависит от потолка прогона), а напряжение: доля ходов без
 * альтернативы, доля безопасных, разброс длины и то, платится ли награда.
 */
function tempoFindings(rows: RaceMeasure[], coins: number): string[] {
  if (rows.length === 0) return [];
  const byMode = new Map<ModeId, RaceMeasure[]>();
  for (const row of rows) {
    byMode.set(row.mode, [...(byMode.get(row.mode) ?? []), row]);
  }
  const base = byMode.get('race') ?? [];
  const lines: string[] = [];
  if (base.length === 0) {
    lines.push('Боевого правила в прогоне нет: сравнивать не с чем, цифры ниже - просто описание каждого темпа.');
  }

  for (const mode of TEMPO_MODES) {
    const group = byMode.get(mode) ?? [];
    if (group.length === 0) continue;
    const capped = group.reduce((sum, row) => sum + row.capped, 0);
    const runs = group.reduce((sum, row) => sum + row.samples, 0);
    const doomShare = mean(group, (row) => row.doomShare);
    lines.push(
      `${modeDef(mode).name}: ${mean(group, (row) => row.moversAvg).toFixed(2)} фигур за такт, ` +
        `партия ${mean(group, (row) => row.lengthAvg).toFixed(0)} ходов, ` +
        `до нерешаемой доходят в ${formatPercent(doomShare, 0)} забегов, ` +
        `выбор ${mean(group, (row) => row.choiceAvg).toFixed(2)} хода при ${formatPercent(
          mean(group, (row) => row.safeShare),
          0,
        )} безопасных, ` +
        `реиграбельность ${mean(group, (row) => row.replayIndex).toFixed(2)}, ` +
        `взятий ${mean(group, (row) => row.capturesAvg).toFixed(1)}, ` +
        `бегает чаще всех ${PIECE_NAME[group[0]!.busiestType] ?? group[0]!.busiestType} (${Math.round(
          mean(group, (row) => row.busiestShare) * 100,
        )}% сдвигов)` +
        (capped > 0 ? `, а ${capped} из ${runs} ${declension(capped, ['забега', 'забегов', 'забегов'])} упёрлись в потолок ${RACE_CAP} ходов - партия не кончается вовсе` : '') +
        '.',
    );
  }

  if (base.length > 0) {
    for (const mode of TEMPO_MODES) {
      if (mode === 'race') continue;
      const group = byMode.get(mode) ?? [];
      if (group.length === 0) continue;
      const doom = mean(group, (row) => row.doomMedian) - mean(base, (row) => row.doomMedian);
      const safe = mean(group, (row) => row.safeShare) - mean(base, (row) => row.safeShare);
      const replay = mean(group, (row) => row.replayIndex) - mean(base, (row) => row.replayIndex);
      const takes = mean(group, (row) => row.capturesAvg) - mean(base, (row) => row.capturesAvg);
      const neverDies = mean(group, (row) => row.doomShare) < 0.05;
      lines.push(
        `${modeDef(mode).name} против общего темпа: ${sign(doom)} ${Math.abs(doom).toFixed(0)} хода до нерешаемой, ` +
        `${sign(safe * 100)} ${(Math.abs(safe) * 100).toFixed(0)} п.п. безопасных ходов, ` +
        `${sign(takes)} ${Math.abs(takes).toFixed(1)} взятия, реиграбельность ${sign(replay)} ${(Math.abs(replay) * 100).toFixed(1)} пункта. ` +
        (neverDies
          ? 'Позиция не становится нерешаемой ни разу: королю нельзя дать мат одной фигурой в открытой полосе, поэтому конец партии наступает только от потолка прогона, а не от правил.'
          : 'Напряжение остаётся: фигуры успевают накрыть короля раньше, чем он уйдёт.') +
          ' Награда за медленным темпом не платится вовсе: начисление идёт за проигранный забег, а его нет.',
      );
    }
    lines.push(replayLine(rows.filter((row) => row.mode === 'race')));
    lines.push(rewardLine(rows.filter((row) => row.mode === 'race'), coins));
    lines.push(
      'Вывод по цифрам: темп «по одной фигуре» убирает из «Гонок» не сложность, а сам конец партии. Держать его можно только вместе с другим ограничением - два ходящих за такт, стена вместо открытой полосы или запрет сходить с поля, - иначе счёт перестаёт что-то значить.',
    );
  }
  return lines;
}

/**
 * Реиграбельность одной строкой: сравнение выбора, безопасных ходов, разброса
 * длины и стартового разнообразия с выводом о том, что именно её держит.
 */
function replayLine(rows: RaceMeasure[]): string {
  const choice = mean(rows, (row) => row.choiceAvg);
  const safe = mean(rows, (row) => row.safeShare);
  const forced = mean(rows, (row) => row.forcedShare);
  const spread = mean(rows, (row) => row.lengthSpread);
  const variety = mean(rows, (row) => row.startVariety);
  const index = mean(rows, (row) => row.replayIndex);
  const fromStarts = variety < 0.1;
  return (
    `Реиграбельность ${index.toFixed(2)} из 1: на ходу ${choice.toFixed(1)} легальных хода (из них ${formatPercent(
      safe,
      0,
    )} не ведут к краху), безальтернативных ходов ${formatPercent(forced, 0)}, разброс длины партии ${formatPercent(
      spread,
      0,
    )} медианы, разных стартов ${formatPercent(variety, 0)}. ` +
    (fromStarts
      ? 'Разнообразие стартов почти нулевое: режим держится на том, как игрок читает доску, а не на том, что генератор дал другую задачу.'
      : 'Генератор даёт разные доски, и длина партии гуляет: забеги между собой не путаются.') +
    (forced < 0.02 ? ' Безальтернативных ходов нет - «решение» нельзя угадать по одному варианту.' : '')
  );
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
  out.push(
    `Разнообразие генератора: ${unique} ${declension(
      unique,
      ['расстановка', 'расстановки', 'расстановок'],
    )} из ${runs} - повторов он не даёт.`,
  );

  const forgiveness = rows.map((row) => row.forgiveness);
  out.push(
    `Прощение первого хода гуляет от ${formatPercent(Math.min(...forgiveness), 0)} до ${formatPercent(
      Math.max(...forgiveness),
      0,
    )} и не монотонно по уровню: метрика уровни не различает, спорить на её основе нельзя.`,
  );
  return out;
}

/** Выводы сравнения диагонали: по всей лесенке уровней, а не по одному полю. */
function diagonalFindings(reports: VariantReport[]): string[] {
  const levels = [...new Set(reports.map((report) => report.level))].sort((a, b) => a - b);
  const rows = levels
    .map((value) => ({
      level: value,
      free: reports.find((report) => report.level === value && report.mode === 'campaignFreeDiag'),
      strict: reports.find((report) => report.level === value && report.mode === 'campaignStrictDiag'),
    }))
    .filter(
      (row): row is { level: number; free: VariantReport; strict: VariantReport } => !!row.free && !!row.strict,
    );
  if (rows.length === 0) return [];

  const avg = (pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
  const fields = [
    ...new Set(
      rows.map((row) => {
        const geo = boardForMode(row.free.mode, row.level);
        return `${geo.width}x${geo.height}`;
      }),
    ),
  ];
  const perVariant = Math.round(rows.reduce((sum, row) => sum + row.strict.samples, 0) / rows.length);
  const out = [
    `Сравнение снято на ${rows.length} ${declension(rows.length, ['уровне', 'уровнях', 'уровнях'])} - поля ${fields.join(
      ', ',
    )}, на вариант по ${perVariant} ${declension(perVariant, ['доска', 'доски', 'досок'])}. Правило смотрят по всему росту поля: на 3x4 и 6x9 оно работает по-разному, один уровень этого не покажет.`,
  ];

  const freeChoice = avg((row) => row.free.avgChoiceSteps);
  const strictChoice = avg((row) => row.strict.avgChoiceSteps);
  const ratio = strictChoice > 0 ? freeChoice / strictChoice : 0;
  out.push(
    `Выбор на пути решения: ${freeChoice.toFixed(2)} против ${strictChoice.toFixed(2)}` +
      (ratio > 1
        ? ` - со строгой диагональю развилок в ${ratio.toFixed(1)} раза меньше, задача превращается в одну нитку.`
        : ' - за весь прогон строгой диагонали развилок не стало меньше.'),
  );

  const drop = avg((row) => (row.free.solvableShare - row.strict.solvableShare) * 100);
  const fallbacks = rows.reduce((sum, row) => sum + row.strict.fallbacks, 0);
  const boards = rows.reduce((sum, row) => sum + row.strict.samples, 0);
  out.push(
    fallbacks > 0 && drop > 1
      ? `Решаемость падает в среднем на ${drop.toFixed(1)} п.п., но генератор отдал ${fallbacks} ${declension(
          fallbacks,
          ['доску', 'доски', 'досок'],
        )} из ${boards} без отбора: почти всё падение объясняется воронкой генератора, а не правилом. Цифра «с решением» смешивает «доска нерешаемая» и «генератор сдался» - смотри на откаты рядом.`
      : `Решаемость ${formatPercent(avg((row) => row.free.solvableShare), 1)} против ${formatPercent(
          avg((row) => row.strict.solvableShare),
          1,
        )} при откатах ${fallbacks} из ${boards}: откатов почти нет, значит падение - настоящее, а не воронка генератора.`,
  );

  const freeIndex = Math.round(avg((row) => row.free.replayIndex));
  const strictIndex = Math.round(avg((row) => row.strict.replayIndex));
  const gaps = rows.map((row) => row.free.replayIndex - row.strict.replayIndex);
  const unique = rows.reduce((sum, row) => sum + row.free.uniqueLayouts + row.strict.uniqueLayouts, 0);
  const better = freeIndex >= strictIndex ? 'свободная' : 'строгая';
  out.push(
    `Реиграбельность ${freeIndex} против ${strictIndex}, по уровням разница от ${Math.round(Math.min(...gaps))} до ${Math.round(
      Math.max(...gaps),
    )}; различных досок ${unique} из ${boards * 2}. Выигрывает ${better} диагональ - её и оставляем.` +
      (perVariant < 64
        ? ` По ${perVariant} ${declension(
            perVariant,
            ['доска', 'доски', 'досок'],
          )} на вариант разница в пару пунктов рождается сама: для вывода нужно 64+.`
        : ` По ${perVariant} ${declension(
            perVariant,
            ['доски', 'досок', 'досок'],
          )} на вариант это уже не шум.`),
  );

  const byGap = [...rows].sort(
    (a, b) =>
      Math.abs(a.free.replayIndex - a.strict.replayIndex) - Math.abs(b.free.replayIndex - b.strict.replayIndex),
  );
  const calmest = byGap[0];
  const angriest = byGap[byGap.length - 1];
  if (rows.length > 1) {
    const calmGeo = boardForMode(calmest.free.mode, calmest.level);
    const angryGeo = boardForMode(angriest.free.mode, angriest.level);
    out.push(
      `Меньше всего уровни расходятся на ${calmest.level}-м (поле ${calmGeo.width}x${calmGeo.height}, ${Math.round(
        Math.abs(calmest.free.replayIndex - calmest.strict.replayIndex),
      )} пункта), больше всего на ${angriest.level}-м (поле ${angryGeo.width}x${angryGeo.height}, ${Math.round(
        Math.abs(angriest.free.replayIndex - angriest.strict.replayIndex),
      )}). Если правило и возвращать, то только там, где оно на что-то влияет.`,
    );
  }
  return out;
}

/** Русское склонение при числе: «81 доска», «75 досок», «2 уровня». */
function declension(value: number, forms: [string, string, string]): string {
  const last = Math.abs(Math.round(value)) % 100;
  const one = last % 10;
  if (one === 1 && last !== 11) return forms[0];
  if (one >= 2 && one <= 4 && (last < 12 || last > 14)) return forms[1];
  return forms[2];
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
  const lines = [
    `Замер генератора «Парковки», по ${ran} ${declension(ran, ['поле', 'поля', 'полей'])} на уровень, зерно ${
      meta.seed
    }`,
    '',
  ];
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

/**
 * Текст прогона «Гонок». Одна функция на два таба: «Гонки» дают строку на уровень,
 * «Темп фигур» - строку на пару «уровень × правило» и сверху сводку по правилам,
 * потому что 21 строку никто не читает с экрана, а вывод нужен по трём цифрам.
 */
function raceText(
  rows: RaceMeasure[],
  meta: { samples: number; seed: number; coins: number; modeColumn?: boolean },
): string {
  const head = [
    'Уровень',
    ...(meta.modeColumn ? ['Правило'] : []),
    'Старт',
    'Ширина в конце',
    'До нерешаемой (медиана)',
    'среднее',
    'разброс',
    'Партия (медиана)',
    'Взятий',
    meta.modeColumn ? 'Общий темп: доом / партия / взятий' : 'Без выпада: доом / партия / взятий',
    'Выбор',
    'Безопасных',
    'Фигур/такт',
    'Реиграб.',
    'Награда',
    'Чем кончились',
  ];
  // Число берём из строк, а не из поля «досок»: заголовок обязан показывать то,
  // что реально прогналось, - на случай отмены и округлений в запросе.
  const ran = rows[0]?.samples ?? meta.samples;
  const scope = meta.modeColumn
    ? `три правила темпа (общий, одна фигура, по кругу) на одних зёрнах, база сравнения - боевое правило`
    : `поле ${RACE_MIN_WIDTH}x${RACE_ROWS} с ростом вширь до ${RACE_WIDTH}, полоса короля - два нижних ряда, фигуры идут своими ходами`;
  const lines = [
    `Прогон «Гонок»: ${scope}; по ${ran} ${declension(ran, ['забег', 'забега', 'забегов'])} на уровень и на правило, зерно ${meta.seed}, потолок длины забега ${RACE_CAP} ходов`,
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
  ];
  // Строка markdown-таблицы: ячейки склеивает один хелпер, иначе «|» разъезжается
  // при первой же правке состава колонок.
  const cells = (values: (string | number)[]): string => `| ${values.map((value) => ` ${value} `).join('|')} |`;
  for (const row of rows) {
    const base = row.comparison;
    lines.push(
      cells([
        row.level,
        ...(meta.modeColumn ? [modeDef(row.mode).name] : []),
        row.widthStart,
        row.widthEnd.toFixed(1),
        row.doomMedian,
        row.doomAvg.toFixed(1),
        `${row.doomMin}-${row.doomMax}`,
        `${row.lengthMedian} (avg ${row.lengthAvg.toFixed(1)})${row.capped > 0 ? `, в потолок ушло ${row.capped}` : ''}`,
        row.capturesAvg.toFixed(1),
        base
          ? `${base.doomMedian} / ${base.lengthMedian} / ${base.capturesAvg} - ${compareGainText(row)}`
          : meta.modeColumn && row.mode === TEMPO_BASE
            ? 'это база сравнения'
            : 'нет сравнения',
        row.choiceAvg.toFixed(2),
        formatPercent(row.safeShare, 0),
        `${row.moversAvg.toFixed(2)} (${PIECE_NAME[row.busiestType] ?? row.busiestType} ${Math.round(row.busiestShare * 100)}%)`,
        `${row.replayIndex.toFixed(3)} (разброс ${formatPercent(row.lengthSpread, 0)}, старты ${formatPercent(row.startVariety, 0)}, форс ${formatPercent(row.forcedShare, 0)})`,
        rewardText(row, meta.coins),
        causesText(row.causes, row.samples),
      ]),
    );
  }
  if (meta.modeColumn) {
    const byMode = new Map<ModeId, RaceMeasure[]>();
    for (const row of rows) byMode.set(row.mode, [...(byMode.get(row.mode) ?? []), row]);
    const aggHead = [
      'Правило',
      'Строк',
      'Фигур/такт',
      'Партия, средняя',
      'До нерешаемой',
      'Взятий',
      'Выпад',
      'Выбор',
      'Безопасных',
      'Реиграб.',
      'Награда сейчас',
      'Награда при ставке',
    ];
    lines.push('', '### Сводка по правилам', '', `| ${aggHead.join(' | ')} |`, `| ${aggHead.map(() => '---').join(' | ')} |`);
    for (const mode of TEMPO_MODES) {
      const group = byMode.get(mode) ?? [];
      if (group.length === 0) continue;
      // Сводка по правилу: незавершённые партии не оплачиваются, и врать про
      // «награду 50» в строке медленного темпа нельзя.
      const runs = Math.max(1, group.reduce((sum, row) => sum + row.samples, 0));
      const stuck = group.reduce((sum, row) => sum + row.capped, 0) / runs;
      const reward =
        stuck > 0.5 ? 0 : Math.round(mean(group, (row) => raceCoinReward(Math.round(row.lengthAvg))));
      const bonus = Math.round(
        mean(group, (row) => row.capturesMedian) * meta.coins +
          Math.round(mean(group, (row) => row.strikesAvg) * Math.floor(meta.coins / 2)),
      );
      lines.push(
        cells([
          modeDef(mode).name,
          group.reduce((sum, row) => sum + row.samples, 0),
          mean(group, (row) => row.moversAvg).toFixed(2),
          mean(group, (row) => row.lengthAvg).toFixed(0),
          mean(group, (row) => row.doomMedian).toFixed(0),
          mean(group, (row) => row.capturesAvg).toFixed(1),
          mean(group, (row) => row.strikesAvg).toFixed(1),
          mean(group, (row) => row.choiceAvg).toFixed(2),
          formatPercent(mean(group, (row) => row.safeShare), 0),
          mean(group, (row) => row.replayIndex).toFixed(3),
          reward,
          stuck > 0.5 ? '0: партия не кончается' : `${reward + bonus} (+${bonus})`,
        ]),
      );
    }
  }
  lines.push('');
  lines.push(
    '«До нерешаемой» - ход, после которого перебор не находит ни одного хода, уводящего от смерти в ближайшие три полухода. «Выбор» - сколько легальных ходов было у бота на ходу, «Безопасных» - доля ходов, после которых позиция ещё не проиграна и перебор ещё видит выход; 100% значит, что напряжение в правиле отсутствует. «Фигур/такт» - сколько фигур сдвигается за такт: 1.0 значит «по одной». «Реиграб.» - сводный индекс 0..1 (35% выбора, 25% безопасных ходов, 25% разброса длины, 15% разных стартов).',
  );
  lines.push(
    '«Награда» - проекция: слева то, сколько платит движок сегодня (`raceCoinReward` - за пережитые ходы и только за проигранный забег), справа сколько было бы, если платить по `монет за взятие` из панели; выпад идёт за половину взятия. Колонка сравнения - тот же бот и те же зёрна на базовом правиле.',
  );
  lines.push(
    'Уровень в «Гонках» не меняет поле и приток: из него берётся только зерно стартовой пробки, а сложность растёт от пережитых ходов. Поэтому строки лесенки - это разные старты одного поля, и расхождение между ними меньше разброса по зёрнам.',
  );
  return lines.join('\n');
}

/** Текст сравнения диагонали в markdown. */
function diagonalText(reports: VariantReport[], meta: { levels: number[]; samples: number; seed: number }): string {
  const ran = reports[0]?.samples ?? meta.samples;
  const fields = [...new Set(meta.levels.map((value) => boardForMode('campaign', value)))].map(
    (geo) => `${geo.width}x${geo.height}`,
  );
  const lines = [
    `Кампания: диагональ свободно или только бить, уровни ${meta.levels.join(',')} (поля ${fields.join(', ')}), по ${ran} ${declension(
      ran,
      ['доска', 'доски', 'досок'],
    )} на вариант, зерно ${meta.seed}`,
    '',
    `| ${DIAGONAL_HEAD.join(' | ')} |`,
    `| ${DIAGONAL_HEAD.map(() => '---').join(' | ')} |`,
  ];
  const byJob = new Map(reports.map((row) => [`${row.level}:${row.mode}`, row]));
  for (const value of meta.levels) {
    for (const mode of DIAGONAL_PAIR) {
      const geo = boardForMode(mode, value);
      const item = byJob.get(`${value}:${mode}`);
      if (!item) {
        lines.push(`| ${value} | ${modeDef(mode).name} | ${geo.width}x${geo.height} | нет данных |`);
        continue;
      }
      lines.push(
        `| ${[
          value,
          modeDef(mode).name,
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
  }
  lines.push('');
  lines.push(
    '«С решением» - доля досок, где решатель доходит до финиша; «выбор» - средняя развилка на пути решения; «реиграбельность» - сводный индекс. Строки идут парами: на уровне сначала свободная диагональ, затем строгая - и те же доски, и то же зерно.',
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
