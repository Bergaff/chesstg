import { analyzeVariant, type ModeId, type VariantReport } from '../engine';

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
  | { type: 'cancel' };

const scope = self as unknown as WorkerScope;
let cancelled = false;

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelled = true;
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
