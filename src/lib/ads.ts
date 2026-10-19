let scriptPromise: Promise<void> | null = null;
let controller: ReturnType<NonNullable<Window['Adsgram']>['init']> | null = null;
let controllerBlock = '';

function loadScript(src: string): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (ok) {
        resolve();
      } else {
        // Не кэшируем неудачу: следующий показ может перезагрузить SDK.
        scriptPromise = null;
        reject(new Error('ads_script_error'));
      }
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-adsgram="1"]');
    if (existing) {
      if (window.Adsgram) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => finish(true), { once: true });
      existing.addEventListener('error', () => finish(false), { once: true });
    } else {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.adsgram = '1';
      script.addEventListener('load', () => finish(true), { once: true });
      script.addEventListener('error', () => finish(false), { once: true });
      document.head.appendChild(script);
    }

    timer = window.setTimeout(() => finish(false), 12_000);
  });
  return scriptPromise;
}

/**
 * Показывает Rewarded Video Adsgram.
 * true, ролик досмотрен, false, пользователь закрыл/реклама не вышла.
 */
export async function showAdsgram(blockId: string, src: string): Promise<boolean> {
  if (!blockId) throw new Error('ads_not_configured');
  await loadScript(src);
  const sdk = window.Adsgram;
  if (!sdk) throw new Error('ads_unavailable');

  if (!controller || controllerBlock !== blockId) {
    controller = sdk.init({ blockId });
    controllerBlock = blockId;
  }

  try {
    const result = await controller.show();
    return Boolean(result?.done);
  } catch {
    return false;
  }
}
