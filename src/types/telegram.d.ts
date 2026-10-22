export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: TelegramWebAppUser;
    start_param?: string;
    chat_type?: string;
    chat_instance?: string;
  };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  viewportHeight: number;
  viewportStableHeight: number;
  platform: string;
  version: string;
  isExpanded: boolean;
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  onEvent(event: string, callback: () => void): void;
  offEvent(event: string, callback: () => void): void;
  openInvoice(url: string, callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  showAlert(message: string, callback?: () => void): void;
  showConfirm(message: string, callback?: (confirmed: boolean) => void): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  BackButton?: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
}

declare global {
  /** Профиль, который виджет Telegram Login отдаёт странице. */
  interface TelegramLoginUser {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    auth_date?: number;
    hash?: string;
    [key: string]: string | number | undefined;
  }

  interface Window {
    /** Колбэк виджета Telegram Login для страниц, не открытых из бота. */
    onTelegramLogin?: (user: TelegramLoginUser) => void;
    Telegram?: {
      WebApp: TelegramWebApp;
      LoginWidget?: {
        createButton(
          host: HTMLElement,
          options: {
            telegram: string;
            button_text?: string;
            size?: 'large' | 'medium' | 'small';
            radius?: string;
            user_is_bot?: boolean;
            request_access?: boolean;
            onTelegramLogin?: (user: TelegramLoginUser) => void;
          },
        ): void;
      };
    };
    Adsgram?: {
      init(options: { blockId: string; debug?: boolean; debugBannerType?: string }): {
        show(): Promise<{ done: boolean; description?: string; state?: string }>;
        destroy?(): void;
      };
    };
  }
}

export {};
