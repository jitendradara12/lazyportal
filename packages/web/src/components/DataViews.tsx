/** Shared bits for dashboard sections. */
import { useState } from "react";
import { usePersistentState } from "../hooks/usePersistentState";

/** Humanize a backend key for table headers: camelCase/snake_case -> words. */
export function prettyKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/** Title-case a string: "COMPUTER NETWORKS" -> "Computer Networks" */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(And|Or|Of|The|In|For|To|A|An)\b/g, (w) => w.toLowerCase())
    .replace(/^./, (c) => c.toUpperCase());
}

/** Humanize semester codes: "2026ODDSEM" -> "Odd 2026", "2026EVESEM" -> "Even 2026" */
export function formatSemester(code: string | undefined | null): string {
  if (!code) return "";
  const m = code.match(/^(\d{4})(ODD|EVE|EVEN)SEM$/i);
  if (!m) return code;
  const type = m[2].toUpperCase() === "ODD" ? "Odd" : "Even";
  return `${type} ${m[1]}`;
}

/** Fallback table for responses whose columns we haven't mapped yet. */
export function AutoTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c}>{prettyKey(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c}>{cell(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function personalScalars(general: Record<string, unknown> | null): [string, string][] {
  if (!general || typeof general !== "object") return [];
  return Object.entries(general)
    .filter(([k, v]) => {
      if (/photo/i.test(k)) return false;
      if (v === null || v === undefined) return false;
      if (typeof v === "object") return false;
      return true;
    })
    .map(([k, v]) => [k, String(v)]);
}

/** Render an unmapped response: arrays as tables, objects as key/value lists (nested included). */
export function UnknownData({ data }: { data: unknown }) {
  if (Array.isArray(data)) return <AutoTable rows={data as Record<string, unknown>[]} />;
  if (data !== null && typeof data !== "object") return <p className="muted">{String(data)}</p>;
  if (data && typeof data === "object") {
    const entries = personalScalars(data as Record<string, unknown>);
    const nested = Object.entries(data as Record<string, unknown>).filter(
      ([k, v]) => v !== null && typeof v === "object" && !/photo/i.test(k)
    );
    if (entries.length === 0 && nested.length === 0) return null;
    return (
      <>
        {entries.length > 0 && (
          <dl>
            {entries.map(([k, v]) => (
              <div key={k}><dt>{prettyKey(k)}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
        {nested.map(([k, v]) => (
          <div key={k}>
            <h3>{prettyKey(k)}</h3>
            <UnknownData data={v} />
          </div>
        ))}
      </>
    );
  }
  return null;
}

/** Error line with retry, shared by every section. */
export function SectionError({ label, error, retry }: { label: string; error: string; retry: () => void }) {
  return (
    <p role="alert" className="error">
      {label} failed: {error} <button onClick={retry}>Retry</button>
    </p>
  );
}

/** Number() yields NaN for non-numeric input — coerce those to 0 so one bad row can't poison the total. */
export function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Parse an exam datetime; null when missing/unparseable. */
export function examTime(v?: string): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function countdown(ms: number): string {
  const days = Math.floor(ms / 86400000);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `in ${hours}h`;
  return "today";
}

export function pct(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

/** Below 75% in any component counts as short. */
export function isShort(r: { Lpercentage?: string; Tpercentage?: string; Ppercentage?: string }): boolean {
  return [pct(r.Lpercentage), pct(r.Tpercentage), pct(r.Ppercentage)].some((n) => n !== null && n < 75);
}

/** Keep only columns matching any pattern (case-insensitive key spelling varies live). */
export function selectColumns(rows: Record<string, unknown>[], keep: RegExp[]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.some((re) => re.test(k)))));
}

export interface PayslipRow {
  currencycode?: string;
  dueamount?: string | number;
}

export function payslipTotals(rows: PayslipRow[]): { currency: string; total: number }[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const cur = r.currencycode ?? "";
    sums.set(cur, (sums.get(cur) ?? 0) + num(r.dueamount));
  }
  return [...sums.entries()].map(([currency, total]) => ({ currency, total }));
}

function getSectionIcon(id?: string) {
  switch (id) {
    case "attendance":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M3 13h4.5a2 2 0 0 0 2 1.5h5a2 2 0 0 0 2-1.5H21" />
        </svg>
      );
    case "exams":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 20a7 7 0 0 0-14 0" />
          <circle cx="12" cy="9" r="4" />
        </svg>
      );
    case "marks":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 3 14.9 9 21.5 9.8 16.5 14.3 17.9 20.8 12 17.5 6.1 20.8 7.5 14.3 2.5 9.8 9.1 9 12 3" />
        </svg>
      );
    case "faculty":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 20a7 7 0 0 0-14 0" />
          <circle cx="12" cy="9" r="4" />
        </svg>
      );
    case "subjects":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <polyline points="8 12 12 16 16 12" />
          <line x1="12" y1="8" x2="12" y2="16" />
        </svg>
      );
    default:
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <line x1="8" y1="10" x2="16" y2="10" />
          <line x1="8" y1="14" x2="12" y2="14" />
        </svg>
      );
  }
}

/** Hook managing collapsible card open/toggle state and expansion tracking for lazy fetching. */
export function useCardState(id?: string, defaultOpen = false) {
  const [open, setOpen] = usePersistentState(id ? `card.${id}` : "card.temp", defaultOpen ? "1" : "0");
  const isOpen = open !== "0";
  const [expanded, setExpanded] = useState(isOpen);

  const toggle = () => {
    const next = isOpen ? "0" : "1";
    if (next === "1") setExpanded(true);
    setOpen(next);
  };

  return {
    isOpen,
    toggle,
    hasExpanded: expanded || isOpen,
  };
}

/** Collapsible card section with persisted open/closed state in Material 3 Expressive style. */
export function CollapsibleCard({
  id,
  title,
  subtitle,
  badge,
  badgeShort,
  defaultOpen = false,
  isOpen: controlledIsOpen,
  onToggle: controlledOnToggle,
  action,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeShort?: boolean;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  action?: import("react").ReactNode;
  children: import("react").ReactNode;
}) {
  const [open, setOpen] = usePersistentState(id ? `card.${id}` : "card.temp", defaultOpen ? "1" : "0");
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : open !== "0";
  const toggle = controlledOnToggle ?? (() => setOpen(isOpen ? "0" : "1"));

  return (
    <section className={`card m3-card ${isOpen ? "open" : "collapsed"}`} id={id}>
      <div className="card-header m3-card-header">
        <button
          type="button"
          className="m3-list-item"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={id ? `${id}-body` : undefined}
        >
          <div className="m3-leading-icon-circle">
            {getSectionIcon(id)}
          </div>
          <div className="m3-item-content">
            <span className="m3-item-headline">{title}</span>
            {(badge || subtitle) && (
              <span className={`m3-item-supporting ${badgeShort ? "short" : ""}`}>
                {badge ?? subtitle}
              </span>
            )}
          </div>
          {action && (
            <div className="m3-card-action" onClick={(e) => e.stopPropagation()}>
              {action}
            </div>
          )}
          <div className={`m3-trailing-chevron ${isOpen ? "open" : ""}`} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </button>
      </div>
      {isOpen && (
        <div className="card-body m3-card-body" id={id ? `${id}-body` : undefined}>
          {children}
        </div>
      )}
    </section>
  );
}
