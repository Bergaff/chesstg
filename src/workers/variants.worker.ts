import {
  analyzeVariant,
  measureJamLevels,
  measureRaceLevels,
  type JamMeasure,
  type ModeId,
  type RaceMeasure,
  type VariantReport,
} from '../engine';

/**
 * Прогон вариантов правил в отдельном потоке.
 *
 * 1000 досок на вариант это секунды, а для строгой диагонали и минута: на
 * главном потоке вкладка в это время не отвечает, поэтому расчёт уходит сюда.
 * Отмена работает изнутри: флаг проверяется на каждом прогрессе, и перебор
 * прерывается исключением.
 */

interface WorkerScope {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ) => void;
}

type WorkerRequest =
  | { type: 'run'; index: number; mode: ModeId; level: number; samples: number; seed: number }
  /** Замер генератора «Парковки»: уровни по списку, прогресс по уровням. */
  | { type: 'jam'; levels: number[]; samples: number; seed: number }
  /** Прогон «Гонок» на правиле полосы: длина игры до нерешаемой позиции. */
  | {
      type: 'race';
      levels: number[];
      samples: number;
      seed: number;
      compare?: boolean;
      /** Сколько правил прогнать на одном наборе зёрен: строка на пару. */
      modes?: string[];
      compareMode?: string;
      cap?: number;
    }
  | { type: 'cancel' };

const scope = self as unknown as WorkerScope;
let cancelled = false;

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (request.type === 'jam') {
    cancelled = false;
    try {
      for (let position = 0; position < request.levels.length; position++) {
        if (cancelled) throw new Error('cancelled');
        const [row] = measureJamLevels([request.levels[position]], request.samples, request.seed);
        scope.postMessage({ type: 'jamrow', row: row as JamMeasure, done: position + 1, total: request.levels.length });
      }
      scope.postMessage({ type: 'jamdone' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'jam_measure_failed';
      scope.postMessage({ type: 'jamerror', message });
    }
    return;
  }

  if (request.type === 'race') {
    cancelled = false;
    try {
      // Строка на пару «уровень × правило»: прогресс обязан считать так же,
      // иначе «2 из 7» на трёх правилах означает «половина», а не «четверть».
      const modes = request.modes && request.modes.length > 0 ? request.modes : ['race'];
      const total = request.levels.length * modes.length;
      let position = 0;
      for (const level of request.levels) {
        for (const mode of modes) {
          if (cancelled) throw new Error('cancelled');
          position += 1;
          const [row] = measureRaceLevels([level], {
            samples: request.samples,
            seed: request.seed,
            compare: request.compare === true,
            mode: mode as never,
            compareMode: request.compareMode as never,
            cap: request.cap,
          });
          scope.postMessage({ type: 'racrow', row: row as RaceMeasure, done: position, total });
        }
      }
      scope.postMessage({ type: 'racdone' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'race_measure_failed';
      scope.postMessage({ type: 'racerror', message });
    }
    return;
  }

  const { index, mode, level, samples, seed } = request;
  cancelled = false;
  try {
    const report: VariantReport = analyzeVariant({
      mode,
      level,
      samples,
      seed,
      onProgress: (done, total) => {
        if (cancelled) throw new Error('cancelled');
        scope.postMessage({ type: 'progress', index, mode, done, total });
      },
    });
    scope.postMessage({ type: 'report', index, report });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'variant_failed';
    scope.postMessage({ type: 'error', index, mode, message });
  }
});
