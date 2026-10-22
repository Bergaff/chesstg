import { analyzeVariant, type ModeId, type VariantReport } from '../engine';

export interface VariantSuiteRequest {
  modes: ModeId[];
  level: number;
  samples: number;
  seed: number;
}

export interface VariantSuiteHandlers {
  /** Одна доска разобрана: прогресс внутри текущего варианта. */
  onSample?: (mode: ModeId, done: number, total: number) => void;
  /** Вариант посчитан целиком. */
  onReport?: (report: VariantReport) => void;
}

export interface VariantSuite {
  done: Promise<void>;
  cancel: () => void;
}

type WorkerMessage =
  | { type: 'progress'; index: number; mode: ModeId; done: number; total: number }
  | { type: 'report'; index: number; report: VariantReport }
  | { type: 'error'; index: number; mode: ModeId; message: string };

/**
 * Прогон списка вариантов: в воркере, с прогрессом по доскам и отменой.
 * Без Worker (старый браузер, тестовая среда) считает на месте и проверяет
 * отмену между вариантами.
 */
export function runVariantSuite(
  request: VariantSuiteRequest,
  handlers: VariantSuiteHandlers = {},
): VariantSuite {
  let cancelled = false;
  let worker: Worker | null = null;

  const done = new Promise<void>((resolve, reject) => {
    const finish = () => {
      worker?.terminate();
      worker = null;
      resolve();
    };

    if (typeof Worker === 'undefined') {
      const reports: VariantReport[] = [];
      const step = (index: number) => {
        if (cancelled || index >= request.modes.length) {
          resolve();
          return;
        }
        const mode = request.modes[index];
        window.setTimeout(() => {
          try {
            const report = analyzeVariant({
              mode,
              level: request.level,
              samples: request.samples,
              seed: request.seed,
              onProgress: (finished, total) => handlers.onSample?.(mode, finished, total),
            });
            reports.push(report);
            handlers.onReport?.(report);
            step(index + 1);
          } catch (error) {
            reject(error instanceof Error ? error : new Error('variant_failed'));
          }
        }, 0);
      };
      step(0);
      return;
    }

    worker = new Worker(new URL('../workers/variants.worker.ts', import.meta.url), { type: 'module' });
    const post = (index: number) => {
      worker?.postMessage({
        type: 'run',
        index,
        mode: request.modes[index],
        level: request.level,
        samples: request.samples,
        seed: request.seed,
      });
    };

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as WorkerMessage;
      if (data.type === 'progress') {
        handlers.onSample?.(data.mode, data.done, data.total);
        return;
      }
      if (data.type === 'report') {
        if (cancelled) {
          finish();
          return;
        }
        handlers.onReport?.(data.report);
        if (data.index + 1 >= request.modes.length) finish();
        else post(data.index + 1);
        return;
      }
      if (data.message === 'cancelled' || cancelled) {
        finish();
        return;
      }
      worker?.terminate();
      worker = null;
      reject(new Error(data.message));
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      reject(new Error('worker_failed'));
    };

    post(0);
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      worker?.postMessage({ type: 'cancel' });
    },
  };
}
