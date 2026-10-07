/** Shared bits for dashboard sections. */
import { useState, useEffect } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import { isCurrentPortalDay } from "../lib/portalSchedule";

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
export function titleCase(s: unknown): string {
  if (s == null) return "";
  const str = String(s);
  if (!str) return "";
  return str
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

/** Humanize timestamp: "Synced today" when synced today, or "Synced Oct 5" for past days */
export function formatLastSync(ts: number | null): string {
  if (!ts) return "";
  if (isCurrentPortalDay(ts)) return "Synced today";
  const d = new Date(ts);
  return `Synced ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export const REFRESH_THROTTLE_MS = 2 * 60 * 1000;

/** Check whether an explicit refresh should be throttled based on the last manual refresh attempt. */
export function shouldThrottleRefresh(throttleMs = REFRESH_THROTTLE_MS): boolean {
  try {
    const raw = localStorage.getItem("juet.portal.last_refresh_attempt");
    return Boolean(raw && Date.now() - Number(raw) < throttleMs);
  } catch {
    return false;
  }
}

export function recordRefreshAttempt(): void {
  try {
    localStorage.setItem("juet.portal.last_refresh_attempt", String(Date.now()));
  } catch {}
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

/** Error line with retry, shared by every section. */
export function SectionError({ label, error, retry }: { label: string; error: string; retry: () => void }) {
  const isDown = /down \(not us\)|network error|failed to fetch|unable to reach|\b50[0-9]\b|\b429\b|you are offline/i.test(error);
  return (
    <p role="alert" className="error">
      {isDown ? "JUET's portal is down (not us)." : `${label} failed: ${error}`}{" "}
      <button onClick={retry}>Retry</button>
    </p>
  );
}

/** Number() yields NaN for non-numeric input — coerce those to 0 so one bad row can't poison the total. */
export function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Parse an exam/class datetime string in Indian portal formats (DD-MM-YYYY or DD/MM/YYYY with optional time). */
export function parseIndianDateTime(dt?: string): number | null {
  if (!dt) return null;
  const m = dt.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    const timeMatch = dt.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    let h = 0;
    let min = 0;
    if (timeMatch) {
      h = parseInt(timeMatch[1], 10);
      min = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3]?.toUpperCase();
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
    }
    return new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), h, min).getTime();
  }
  const t = Date.parse(dt);
  return Number.isNaN(t) ? null : t;
}

/** Parse an exam datetime; null when missing/unparseable. */
export function examTime(v?: string): number | null {
  return parseIndianDateTime(v);
}

export function countdown(ms: number): string {
  const days = Math.floor(ms / 86400000);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `in ${hours}h`;
  return "today";
}

export function pct(v: string | number | undefined | null): number | null {
  if (v == null) return null;
  const s = String(v).replace("%", "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function getSectionIcon(id?: string) {
  switch (id) {
    case "attendance":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
          <path d="m9 14 2 2 4-4" />
        </svg>
      );
    case "marks":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="6" />
          <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
        </svg>
      );
    case "exams":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "faculty":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "subjects":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    default:
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

  const [renderedOnce, setRenderedOnce] = useState(isOpen);
  useEffect(() => {
    if (isOpen) setRenderedOnce(true);
  }, [isOpen]);

  return (
    <section className={`card m3-card ${isOpen ? "open" : "collapsed"}`} id={id}>
      <div className="card-header m3-card-header">
        <button
          type="button"
          className="m3-list-item m3-card-toggle-btn"
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
          <div className={`m3-trailing-chevron ${isOpen ? "open" : ""}`} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </button>
      </div>
      <div
        className={`m3-accordion-wrapper ${isOpen ? "expanded" : "collapsed"}`}
        id={id ? `${id}-body` : undefined}
        aria-hidden={!isOpen}
      >
        <div className="m3-accordion-inner">
          <div className="card-body m3-card-body">
            {action && (
              <div className="m3-expanded-action-bar">
                {action}
              </div>
            )}
            {(isOpen || renderedOnce) && children}
          </div>
        </div>
      </div>
    </section>
  );
}
