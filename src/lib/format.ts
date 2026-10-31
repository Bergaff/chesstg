import { tr, trf } from '../lib/i18n';
export function formatNumber(value: number): string {
  return Math.max(0, Math.round(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatCompactDuration(ms: number): string {
  const totalMinutes = Math.ceil(Math.max(0, ms) / 60000);
  if (totalMinutes < 1) return tr('меньше минуты');
  if (totalMinutes < 60) return trf('{0} мин', [totalMinutes]);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? trf('{0} ч {1} мин', [hours, minutes]) : trf('{0} ч', [hours]);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function initialOf(name: string): string {
  const clean = name.trim();
  return clean ? clean[0].toUpperCase() : '♟';
}

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/** Адрес игры для ссылок: рабочий https из конфига, иначе текущий домен. */
export function appBaseUrl(webappUrl: string): string {
  const value = webappUrl.trim().replace(/\/+$/, '');
  if (value.startsWith('https://')) return value;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return value;
}
