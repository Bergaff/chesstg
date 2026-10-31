export function getTg() {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
}

export function initTelegram(): void {
  const tg = getTg();
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#17160f');
    tg.setBackgroundColor('#17160f');
  } catch {
    /* старые версии клиента */
  }

  // Высота держится с запасом: во время жеста `viewportStableHeight` иногда
  // приезжает нулём, и берутся за `window.innerHeight` - значения расходятся на
  // десятки пикселей, переменная скачет, и поле пересчитывает размер клетки на
  // каждый тап. Реагируем только на заметную смену высоты и никогда не пишем ноль.
  let appHeight = 0;
  const applyViewport = () => {
    try {
      const stable = tg.viewportStableHeight ?? 0;
      const height = Math.round(stable > 0 ? stable : window.innerHeight);
      if (!height || Math.abs(height - appHeight) < 16) return;
      appHeight = height;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
    } catch {
      /* ignore */
    }
  };
  applyViewport();
  try {
    tg.onEvent('viewportChanged', applyViewport);
  } catch {
    /* ignore */
  }
}

/**
 * Экран документа по `startapp`. Бот отвечает на `/terms` и `/privacy` кнопкой
 * «Открыть в игре», и ссылка обязана вести на сам документ: кнопка, которая
 * приводит в меню и говорит «ищи сам», не считается выполнением требования
 * показать условия.
 */
export function legalScreenFromStartParam(startParam: string): 'terms' | 'privacy' | null {
  return startParam === 'terms' || startParam === 'privacy' ? startParam : null;
}

export function getStartParam(): string {
  const tg = getTg();
  const fromTg = tg?.initDataUnsafe?.start_param;
  if (fromTg) return fromTg;
  try {
    const query = new URLSearchParams(window.location.search);
    const fromQuery = query.get('startapp') ?? query.get('tgWebAppStartParam');
    if (fromQuery) return fromQuery;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return hash.get('tgWebAppStartParam') ?? '';
  } catch {
    return '';
  }
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  try {
    getTg()?.HapticFeedback?.impactOccurred(style);
  } catch {
    /* ignore */
  }
}

export function hapticNotify(type: 'error' | 'success' | 'warning' = 'success'): void {
  try {
    getTg()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    /* ignore */
  }
}

export function setClosingConfirmation(enabled: boolean): void {
  const tg = getTg();
  try {
    if (enabled) tg?.enableClosingConfirmation();
    else tg?.disableClosingConfirmation();
  } catch {
    /* ignore */
  }
}

export type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending' | 'unavailable';

export function openInvoice(url: string): Promise<InvoiceStatus> {
  return new Promise((resolve) => {
    const tg = getTg();
    if (tg?.openInvoice) {
      try {
        tg.openInvoice(url, (status) => resolve(status as InvoiceStatus));
      } catch {
        resolve('unavailable');
      }
      return;
    }
    if (tg?.openTelegramLink && /^https:\/\/t\.me\//.test(url)) {
      try {
        tg.openTelegramLink(url);
      } catch {
        window.open(url, '_blank', 'noopener');
      }
      resolve('pending');
      return;
    }
    try {
      const opened = window.open(url, '_blank', 'noopener');
      resolve(opened ? 'pending' : 'unavailable');
    } catch {
      resolve('unavailable');
    }
  });
}

export async function shareContent(text: string, url?: string): Promise<'shared' | 'copied' | 'failed'> {
  const tg = getTg();
  if (tg && url) {
    try {
      tg.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
      );
      return 'shared';
    } catch {
      /* fallthrough */
    }
  }
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ text, url });
      return 'shared';
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return 'failed';
    }
  }
  try {
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function telegramShareUrl(url: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}
