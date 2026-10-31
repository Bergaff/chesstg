import {
  auditPlacements,
  type BatchOptions,
  type BatchReport,
  type PlacementSpec,
} from '../engine';

interface Progress {
  checked: number;
  total: number;
}

/**
 * Запускает разбор расстановок в отдельном потоке.
 * Если Worker недоступен (старый браузер), считает на месте.
 */
export function runPlacementAudit(
  spec: PlacementSpec,
  options: Omit<BatchOptions, 'onProgress'>,
  onProgress: (progress: Progress) => void,
): Promise<BatchReport> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      window.setTimeout(() => {
        try {
          resolve(auditPlacements(spec, { ...options, onProgress: (checked, total) => onProgress({ checked, total }) }));
        } catch (error) {
          reject(error instanceof Error ? error : new Error('audit_failed'));
        }
      }, 20);
      return;
    }

    const worker = new Worker(new URL('../workers/audit.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: 'progress'; checked: number; total: number }
        | { type: 'done'; report: BatchReport }
        | { type: 'error'; message: string };
      if (data.type === 'progress') {
        onProgress({ checked: data.checked, total: data.total });
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
}

export interface RangeProgress {
  /** Номер уровня в диапазоне, 0-based. */
  index: number;
  levelTotal: number;
  checked: number;
  of: number;
}

export interface RangeJob {
  spec: PlacementSpec;
  options: Omit<BatchOptions, 'onProgress'>;
}

export interface RangeHandle {
  promise: Promise<{ reports: BatchReport[]; aborted: boolean }>;
  abort: () => void;
}

/**
 * Прогон диапазона уровней одним заданием: воркер отдаёт строку отчёта по
 * мере разбора, поэтому таблица наполняется на глазах и прогон можно
 * оборвать - на 60 уровнях это минуты, а не секунды.
 *
 * Без Worker (старый браузер, превью в iframe без прав) цикл идёт по
 * тому же коду через `setTimeout`: уступать поток обязательно, иначе
 * вкладка висит до конца прогона и выглядит упавшей.
 */
export function runRangeAudit(
  jobs: RangeJob[],
  hooks: {
    onProgress?: (progress: RangeProgress) => void;
    onRow?: (index: number, report: BatchReport) => void;
  } = {},
): RangeHandle {
  if (typeof Worker === 'undefined') {
    let aborted = false;
    const promise = (async () => {
      const reports: BatchReport[] = [];
      for (let index = 0; index < jobs.length; index += 1) {
        if (aborted) break;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        if (aborted) break;
        const report = auditPlacements(jobs[index].spec, {
          ...jobs[index].options,
          onProgress: (checked, of) =>
            hooks.onProgress?.({ index, levelTotal: jobs.length, checked, of }),
        });
        reports.push(report);
        hooks.onRow?.(index, report);
      }
      return { reports, aborted };
    })();
    return { promise, abort: () => void (aborted = true) };
  }

  const worker = new Worker(new URL('../workers/audit.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  const handle = {
    resolve: (_value: { reports: BatchReport[]; aborted: boolean }) => undefined as void,
    reject: (_error: Error) => undefined as void,
  };
  const promise = new Promise<{ reports: BatchReport[]; aborted: boolean }>((resolve, reject) => {
    handle.resolve = resolve;
    handle.reject = reject;
  });
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | { type: 'progress'; index: number; levelTotal: number; checked: number; of: number }
      | { type: 'row'; index: number; report: BatchReport }
      | { type: 'done'; reports: BatchReport[]; aborted: boolean }
      | { type: 'error'; message: string };
    if (data.type === 'progress') {
      hooks.onProgress?.({ index: data.index, levelTotal: data.levelTotal, checked: data.checked, of: data.of });
    } else if (data.type === 'row') {
      hooks.onRow?.(data.index, data.report);
    } else if (data.type === 'done') {
      settled = true;
      worker.terminate();
      handle.resolve({ reports: data.reports, aborted: data.aborted === true });
    } else if (data.type === 'error') {
      settled = true;
      worker.terminate();
      handle.reject(new Error(data.message));
    }
  };
  worker.onerror = () => {
    if (settled) return;
    settled = true;
    worker.terminate();
    handle.reject(new Error('worker_failed'));
  };
  worker.postMessage({ id: 2, jobs });
  return {
    promise,
    // Убийство воркера здесь же: «остановить» без освобождения потока означало
    // бы, что тяжёлый перебор продолжает есть CPU после закрытия панели.
    abort: () => {
      if (settled) return;
      worker.postMessage({ type: 'abort' });
    },
  };
}
