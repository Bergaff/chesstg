import { auditPlacements, type BatchOptions, type BatchReport, type PlacementSpec } from '../engine/audit';

/**
 * Разбор расстановок в отдельном потоке.
 * Перебор на 5×5 и 6×6 занимает сотни миллисекунд, поэтому уходит с главного
 * потока, чтобы интерфейс не подвисал.
 *
 * Две формы задания: одна расстановка (выбор уровня в лаборатории) и список
 * расстановок (прогон диапазона). Список обрабатывается одним сообщением
 * намеренно: заводить по воркеру на каждый уровень - значит 60 раз платить
 * стартом потока и загрузкой движка, а показывать прогресс по одному уровню
 * бессмысленно: человеку видно, на каком уровне всё встало, только внутри
 * текущего.
 */

interface Request {
  id: number;
  spec?: PlacementSpec;
  /** Прогон диапазона: у каждого уровня свои лимит, сид и полоса сложности. */
  jobs?: RangeJob[];
  options: Omit<BatchOptions, 'onProgress'>;
}

interface RangeJob {
  spec: PlacementSpec;
  options: Omit<BatchOptions, 'onProgress'>;
}

interface Abort {
  type: 'abort';
}

interface WorkerScope {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<Request | Abort>) => void,
  ) => void;
}

const scope = self as unknown as WorkerScope;

/** Флаг остановки на один воркер: параллельных прогонов лаборатория не ведёт. */
let aborted = false;

scope.addEventListener('message', (event) => {
  const data = event.data as Request | Abort;
  if ('type' in data && data.type === 'abort') {
    aborted = true;
    return;
  }
  const { id, spec, jobs, options } = data as Request;
  try {
    if (Array.isArray(jobs)) {
      aborted = false;
      const reports: BatchReport[] = [];
      for (let index = 0; index < jobs.length; index += 1) {
        if (aborted) break;
        reports.push(
          auditPlacements(jobs[index].spec, {
            ...jobs[index].options,
            onProgress: (checked, total) =>
              scope.postMessage({ type: 'progress', id, index, levelTotal: jobs.length, checked, of: total }),
          }),
        );
        // Строка улетает сразу: таблица диапазона заполняется по мере
        // разбора, и длинный прогон виден как работа, а не как зависший экран.
        scope.postMessage({ type: 'row', id, index, report: reports[index - 1] });
      }
      scope.postMessage({ type: 'done', id, reports, aborted });
      return;
    }
    if (!spec) throw new Error('нет задания');
    const report = auditPlacements(spec, {
      ...options,
      onProgress: (checked, total) => {
        scope.postMessage({ type: 'progress', id, checked, total });
      },
    });
    scope.postMessage({ type: 'done', id, report });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : 'audit_failed',
    });
  }
});
