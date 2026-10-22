import { useCallback, useRef, useState, type ReactNode } from 'react';
import { analyzeVariant, boardForMode, modeDef, type ModeId, type VariantReport } from '../../engine';
import { Metric, Panel, StatusLine, Table, formatNumber, formatPercent } from '../ui';

/**
 * Сравнение вариантов правил одним прогоном.
 *
 * Отвечает на вопросы, которые нельзя задать одной расстановкой: что даёт уход
 * фигур с площадки в «Парковке», как долго держится пешка в «Гонках на
 * уклонение» и что меняет запрет свободной диагонали. Считается в потоке
 * страницы, между вариантами управление отдаётся браузеру.
 */

const SAMPLES = 16;

interface GroupSpec {
  title: string;
  hint: string;
  modes: ModeId[];
  kind: 'goal' | 'survival';
}

const GROUPS: GroupSpec[] = [
  {
    title: '«Парковка»: стоят фигуры или уходят с площадки',
    hint: 'Смотрим, остаётся ли задача задачей, когда стена редеет сама: цена прохода, нужные взятия и доля досок, где выбор вообще есть.',
    modes: ['jam', 'jamExit2', 'jamExit4'],
    kind: 'goal',
  },
  {
    title: '«Гонки»: проход до верха против уклонения',
    hint: 'Во втором варианте фигуры приходят с верхнего края и ходят по своим правилам, а верхний ряд переливает пешку вниз. Метрика длина жизни в ходах.',
    modes: ['race', 'raceDodge'],
    kind: 'survival',
  },
  {
    title: 'Свободная диагональ и запрет диагонали без взятия',
    hint: 'Тот же генератор и та же доска: менялось только право вставать на пустую диагональ. Сравнение показывает, где уровень держится на выборе, а где на единственных ходах.',
    modes: ['campaign', 'campaignStrictDiag', 'jam', 'jamStrictDiag'],
    kind: 'goal',
  },
];

export function VariantsPanel({ level }: { level: number }): ReactNode {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [reports, setReports] = useState<VariantReport[]>([]);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRunning(true);
    setError('');
    setDone(0);
    setReports([]);
    const collected: VariantReport[] = [];
    try {
      const modes = GROUPS.flatMap((group) => group.modes);
      for (const mode of modes) {
        // Отдаём поток браузеру, чтобы вкладка не выглядела зависшей.
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        collected.push(analyzeVariant({ mode, level, samples: SAMPLES }));
        setReports([...collected]);
        setDone(collected.length);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Прогон не удался');
    } finally {
      setRunning(false);
      busyRef.current = false;
    }
  }, [level]);

  const byMode = new Map(reports.map((report) => [report.mode, report]));
  const total = GROUPS.reduce((sum, group) => sum + group.modes.length, 0);

  return (
    <Panel title="Прогон сравнений" note={`По ${SAMPLES} уровню на вариант, отбор по полосе режима`}>
      <div className="adm-row-actions">
        <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={running}>
          {running ? `Считаем ${done} из ${total}` : 'Сравнить варианты'}
        </button>
        {reports.length > 0 && <span className="adm-muted">Готово, уровень {level}</span>}
      </div>

      {error && <StatusLine kind="error">{error}</StatusLine>}

      {GROUPS.map((group) => (
        <div key={group.title} className="adm-variant-group">
          <h4 className="adm-subtitle">{group.title}</h4>
          <p className="adm-note">{group.hint}</p>
          <Table
            head={
              group.kind === 'survival'
                ? ['Режим', 'Поле', 'С разбором', 'Жизнь в ходах', 'Взятий', 'Разных досок', 'Отличие соседних', 'Реиграбельность']
                : ['Режим', 'Поле', 'С решением', 'Оценка', 'Взятий', 'Ушло фигур', 'Выборов', 'Разных досок', 'Отличие соседних', 'Реиграбельность']
            }
            empty="Нажмите «Сравнить варианты»"
          >
            {group.modes.map((mode) => {
              const report = byMode.get(mode);
              const def = modeDef(mode);
              if (!report) {
                return (
                  <tr key={mode}>
                    <td>{def.name}</td>
                    <td colSpan={7} className="adm-muted">
                      {running ? 'считаем' : 'нет данных'}
                    </td>
                  </tr>
                );
              }
              const geo = boardForMode(mode, level);
              return (
                <tr key={mode}>
                  <td>{def.name}</td>
                  <td className="is-mono">
                    {geo.width}×{geo.height}
                  </td>
                  <td>{formatPercent(report.solvableShare, 1)}</td>
                  {group.kind === 'survival' ? (
                    <td className="is-mono">{describeSurvival(report)}</td>
                  ) : (
                    <>
                      <td>{report.avgScore}</td>
                      <td>{report.avgCaptures.toFixed(2)}</td>
                      <td>{report.avgEscapes.toFixed(2)}</td>
                      <td>{report.avgChoiceSteps.toFixed(2)}</td>
                    </>
                  )}
                  {group.kind === 'survival' && <td>{report.avgCaptures.toFixed(2)}</td>}
                  <td>
                    {report.uniqueLayouts} из {report.samples}
                  </td>
                  <td>{formatPercent(report.layoutDistance, 1)}</td>
                  <td>{report.replayIndex}</td>
                </tr>
              );
            })}
          </Table>
        </div>
      ))}

      {reports.length > 0 && (
        <div className="adm-metrics is-compact">
          <Metric label="Вариантов посчитано" value={formatNumber(reports.length)} />
          <Metric label="Паттернов на прогон" value={formatNumber(SAMPLES * reports.length)} />
          <Metric label="Время" value={`${(reports.reduce((sum, item) => sum + item.ms, 0) / 1000).toFixed(1)} c`} />
        </div>
      )}

      <p className="adm-note">
        Цифры считаются прямо здесь, на устройстве: {SAMPLES} сгенерированных уровней на вариант, каждый разобран
        полностью. Индекс реиграбельности это 40% разнообразия генератора, 25% отличия соседних уровней, 25%
        шагов с выбором и 10% отсутствия безальтернативных ходов.
      </p>
    </Panel>
  );
}

function describeSurvival(report: VariantReport): string {
  if (!report.survival) return 'нет данных';
  const { avg, min, max, capped } = report.survival;
  return `${avg} (от ${min} до ${max})${capped > 0 ? `, упёрлись в границу: ${capped}` : ''}`;
}
