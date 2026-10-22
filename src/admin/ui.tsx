import type { ReactNode } from 'react';
import { isModeId, modeDef } from '../engine';

/** id режима в имя из движка: админка нигде не показывает сырые `jam` и `race`. */
export function modeTitle(mode: string): string {
  return isModeId(mode) ? modeDef(mode).name : mode;
}

export function Panel({
  title,
  note,
  actions,
  children,
}: {
  title: string;
  note?: string;
  actions?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="adm-panel">
      <header className="adm-panel-head">
        <div>
          <h2 className="adm-panel-title">{title}</h2>
          {note && <p className="adm-panel-note">{note}</p>}
        </div>
        {actions && <div className="adm-panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'accent' | 'danger' | 'ok';
}): ReactNode {
  return (
    <div className="adm-metric">
      <span className="adm-metric-label">{label}</span>
      <span className={`adm-metric-value${tone ? ` is-${tone}` : ''}`}>{value}</span>
      {hint && <span className="adm-metric-hint">{hint}</span>}
    </div>
  );
}

export function Bars({
  data,
  label,
  format,
}: {
  data: Array<{ day: string; value: number }>;
  label: string;
  format?: (value: number) => string;
}): ReactNode {
  const max = Math.max(1, ...data.map((point) => point.value));
  return (
    <figure className="adm-chart">
      <figcaption className="adm-chart-label">{label}</figcaption>
      <div className="adm-bars" role="img" aria-label={label}>
        {data.map((point) => {
          const height = Math.round((point.value / max) * 100);
          return (
            <div className="adm-bar-slot" key={point.day} title={`${point.day}: ${point.value}`}>
              <span className="adm-bar-fill" style={{ height: `${Math.max(point.value > 0 ? 4 : 0, height)}%` }} />
              <span className="adm-bar-day">{point.day.slice(8)}</span>
              {point.value > 0 && (
                <span className="adm-bar-value">{format ? format(point.value) : point.value}</span>
              )}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export function Table({
  head,
  children,
  empty,
}: {
  head: string[];
  children: ReactNode;
  empty?: string;
}): ReactNode {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty && <p className="adm-empty">{empty}</p>}
    </div>
  );
}

export function StatusLine({
  kind,
  children,
}: {
  kind: 'info' | 'error' | 'ok';
  children: ReactNode;
}): ReactNode {
  return (
    <p className={`adm-status is-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

export function formatNumber(value: number): string {
  return Math.max(0, Math.round(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(ms: number): string {
  if (!ms) return 'нет';
  const date = new Date(ms);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function formatDateTime(ms: number): string {
  if (!ms) return 'нет';
  const date = new Date(ms);
  return `${formatDate(ms)} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}
