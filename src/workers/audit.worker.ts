import { auditPlacements, type BatchOptions, type PlacementSpec } from '../engine/audit';

/**
 * Разбор расстановок в отдельном потоке.
 * Перебор на 5×5 и 6×6 занимает сотни миллисекунд, поэтому уходит с главного
 * потока, чтобы интерфейс не подвисал.
 */

interface WorkerScope {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<Request>) => void,
  ) => void;
}

interface Request {
  id: number;
  spec: PlacementSpec;
  options: Omit<BatchOptions, 'onProgress'>;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  const { id, spec, options } = event.data;
  try {
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
