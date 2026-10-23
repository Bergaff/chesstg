import {
  analyzeVariant,
  measureJamLevels,
  measureRaceLevels,
  type JamMeasure,
  type ModeId,
  type RaceMeasure,
  type VariantReport,
} from '../engine';

/** Одна задача прогона: вариант правил на конкретном уровне. */
export interface VariantSuiteJob {
  mode: ModeId;
  level: number;
}

export interface VariantSuiteRequest {
  /**
   * Пары «вариант + уровень». Правило сравнивается на лесенке уровней, а не на
   * одном: иначе вывод снимается на поле 4x6 и молчит про 3x4 и 6x9, где то же
   * правило может работать иначе.
   */
  jobs: VariantSuiteJob[];
  samples: number;
  seed: number;
}

export interface VariantSuiteHandlers {
  /** Одна доска разобрана: прогресс внутри текущей пары. */
  onSample?: (mode: ModeId, level: number, done: number, total: number) => void;
  /** Пара «вариант + уровень» посчитана целиком. */
  onReport?: (report: VariantReport) => void;
}

export interface VariantSuite {
  done: Promise<void>;
  cancel: () => void;
}

export interface JamSuiteRequest {
  levels: number[];
  samples: number;
  seed: number;
}

export interface JamSuiteHandlers {
  /** Один уровень замерен. */
  onRow?: (row: JamMeasure, done: number, total: number) => void;
}

/**
 * Замер генератора «Парковки». Отчёт не похож на сравнение вариантов: у
 * головоломки нет финиша и нет дерева поиска, есть длина плана решателя и доля
 * расстановок, которые решатель взял. Считаем в том же воркере: на 250 полях
 * замер идёт минуты, и на главном потоке вкладка бы встала.
 */
export function runJamSuite(request: JamSuiteRequest, handlers: JamSuiteHandlers = {}): VariantSuite {
  let cancelled = false;
  let worker: Worker | null = null;

  const done = new Promise<void>((resolve, reject) => {
    const finish = () => {
      worker?.terminate();
      worker = null;
      resolve();
    };

    if (typeof Worker === 'undefined') {
      (async () => {
        const total = request.levels.length;
        for (let index = 0; index < total; index++) {
          if (cancelled) break;
          await new Promise((tick) => window.setTimeout(tick, 0));
          try {
            const [row] = measureJamLevels([request.levels[index]], request.samples, request.seed);
            handlers.onRow?.(row, index + 1, total);
          } catch (error) {
            reject(error instanceof Error ? error : new Error('jam_measure_failed'));
            return;
          }
        }
        resolve();
      })();
      return;
    }

    worker = new Worker(new URL('../workers/variants.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; row?: JamMeasure; done?: number; total?: number; message?: string };
      if (data.type === 'jamrow' && data.row) {
        if (cancelled) {
          finish();
          return;
        }
        handlers.onRow?.(data.row, data.done ?? 0, data.total ?? request.levels.length);
        return;
      }
      if (data.type === 'jamdone') {
        finish();
        return;
      }
      if (data.message === 'cancelled' || cancelled) {
        finish();
        return;
      }
      worker?.terminate();
      worker = null;
      reject(new Error(data.message ?? 'jam_measure_failed'));
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      reject(new Error('worker_failed'));
    };
    worker.postMessage({ type: 'jam', levels: request.levels, samples: request.samples, seed: request.seed });
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      worker?.postMessage({ type: 'cancel' });
    },
  };
}

export interface RaceSuiteRequest {
  levels: number[];
  samples: number;
  seed: number;
  /**
   * Прогнать те же зёрна на базовом правиле (`compareMode`) и положить разницу
   * в строку (`comparison`).
   */
  compare?: boolean;
  /** Какие правила меряем. По умолчанию - боевые «Гонки» одним списком. */
  modes?: ModeId[];
  /** С чем сравниваем: по умолчанию «Гонки без выпада». */
  compareMode?: ModeId;
  /** Потолок длины забега. При медленном темпе партии не кончаются вовсе. */
  cap?: number;
}

export interface RaceSuiteHandlers {
  /** Один уровень прогнан: нерешаемая позиция найдена перебором. */
  onRow?: (row: RaceMeasure, done: number, total: number) => void;
}

/**
 * Прогон «Гонок» на новом правиле: для каждого уровня - сколько ходов партия
 * остаётся решаемой. Перебор на каждый ход, поэтому в воркере: на главном
 * потоке вкладка встала бы на минуты.
 */
export function runRaceSuite(request: RaceSuiteRequest, handlers: RaceSuiteHandlers = {}): VariantSuite {
  let cancelled = false;
  let worker: Worker | null = null;

  const done = new Promise<void>((resolve, reject) => {
    const finish = () => {
      worker?.terminate();
      worker = null;
      resolve();
    };

    if (typeof Worker === 'undefined') {
      (async () => {
        const modes = request.modes && request.modes.length > 0 ? request.modes : (['race'] as ModeId[]);
        const jobs = request.levels.flatMap((level) => modes.map((mode) => ({ level, mode })));
        for (let index = 0; index < jobs.length; index++) {
          if (cancelled) break;
          await new Promise((tick) => window.setTimeout(tick, 0));
          try {
            const [row] = measureRaceLevels([jobs[index]!.level], {
              samples: request.samples,
              seed: request.seed,
              compare: request.compare,
              mode: jobs[index]!.mode,
              compareMode: request.compareMode,
              cap: request.cap,
            });
            handlers.onRow?.(row, index + 1, jobs.length);
          } catch (error) {
            reject(error instanceof Error ? error : new Error('race_measure_failed'));
            return;
          }
        }
        resolve();
      })();
      return;
    }

    worker = new Worker(new URL('../workers/variants.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; row?: RaceMeasure; done?: number; total?: number; message?: string };
      if (data.type === 'racrow' && data.row) {
        if (cancelled) {
          finish();
          return;
        }
        handlers.onRow?.(data.row, data.done ?? 0, data.total ?? request.levels.length);
        return;
      }
      if (data.type === 'racdone') {
        finish();
        return;
      }
      if (data.message === 'cancelled' || cancelled) {
        finish();
        return;
      }
      worker?.terminate();
      worker = null;
      reject(new Error(data.message ?? 'race_measure_failed'));
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      reject(new Error('worker_failed'));
    };
    worker.postMessage({
      type: 'race',
      levels: request.levels,
      samples: request.samples,
      seed: request.seed,
      compare: request.compare === true,
      modes: request.modes,
      compareMode: request.compareMode,
      cap: request.cap,
    });
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      worker?.postMessage({ type: 'cancel' });
    },
  };
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
      const step = (index: number) => {
        if (cancelled || index >= request.jobs.length) {
          resolve();
          return;
        }
        const job = request.jobs[index];
        window.setTimeout(() => {
          try {
            const report = analyzeVariant({
              mode: job.mode,
              level: job.level,
              samples: request.samples,
              seed: request.seed,
              onProgress: (finished, total) => handlers.onSample?.(job.mode, job.level, finished, total),
            });
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
      const job = request.jobs[index];
      worker?.postMessage({
        type: 'run',
        index,
        mode: job.mode,
        level: job.level,
        samples: request.samples,
        seed: request.seed,
      });
    };

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as WorkerMessage;
      if (data.type === 'progress') {
        handlers.onSample?.(data.mode, request.jobs[data.index]?.level ?? 0, data.done, data.total);
        return;
      }
      if (data.type === 'report') {
        if (cancelled) {
          finish();
          return;
        }
        handlers.onReport?.(data.report);
        if (data.index + 1 >= request.jobs.length) finish();
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
