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
