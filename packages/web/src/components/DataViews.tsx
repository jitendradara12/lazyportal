/** Shared bits for dashboard sections. */
import { useState, useEffect, useRef } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import { isCurrentPortalDay } from "../lib/portalSchedule";
import { titleCase } from "../lib/attendanceCalc";
import { dateFormatter } from "../lib/dateFormat";
import { useShell } from "../hooks/useShell";

export { titleCase };

/** Tonal M3 skeleton rows for uncached loading states. */
export function ListSkeleton({
  rows = 4,
  label = "Loading…",
  variant = "card",
}: {
  rows?: number;
  label?: string;
  variant?: "card" | "inline";
}) {
  return (
    <div className={`m3-skeleton-list ${variant === "inline" ? "is-inline" : ""}`} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="m3-skeleton-row" aria-hidden="true">
          <div className="m3-skeleton-main">
            <span className="m3-skeleton-bar is-title" style={{ width: `${68 - (i % 3) * 11}%` }} />
            <span className="m3-skeleton-bar is-sub" style={{ width: `${44 + (i % 2) * 14}%` }} />
          </div>
          <span className="m3-skeleton-pill" />
        </div>
      ))}
    </div>
  );
}

/** Humanize semester codes: "2026ODDSEM" -> "Odd 2026", "2026EVESEM" -> "Even 2026" */
export function formatSemester(code: string | undefined | null): string {
  if (!code) return "";
  const m = code.match(/^(\d{4})(ODD|EVE|EVEN)SEM$/i);
  if (!m) return code;
  const type = m[2].toUpperCase() === "ODD" ? "Odd" : "Even";
  return `${type} ${m[1]}`;
}

const syncDate = dateFormatter([], { month: "short", day: "numeric" });

/** Humanize timestamp: "Synced today" when synced today, or "Synced Oct 5" for past days */
export function formatLastSync(ts: number | null): string {
  if (!ts) return "";
  if (isCurrentPortalDay(ts)) return "Synced today";
  const d = new Date(ts);
  return `Synced ${syncDate(d)}`;
}

const AUTH_OR_CLIENT_ERROR_RE =
  /session.*expired|logged you out|invalid.*token|token.*expired|login again|unauthorized|forbidden|captcha|invalid (user|password|credential)|wrong password|password.*incorrect|\b40[0134]\b/i;

export function classifySectionError(
  error: string,
  online = typeof navigator === "undefined" ? true : navigator.onLine !== false,
) {
  const isAuthOrClient = AUTH_OR_CLIENT_ERROR_RE.test(error);
  const isOffline = !isAuthOrClient && (online === false || /you are offline|offline/i.test(error));
  const isDown =
    !isOffline &&
    !isAuthOrClient &&
    /down \(not us\)|network error|failed to fetch|unable to reach|\b50[0-9]\b|\b429\b/i.test(error);
  const isTimeout =
    !isOffline && !isDown && !isAuthOrClient && /took too long|timed?\s*out|timeout/i.test(error);
  return {
    isOffline,
    isDown,
    isTimeout,
    isTransient: !isAuthOrClient && (isOffline || isDown || isTimeout),
  };
}

export function subscribeSectionAutoRetry({
  isTransient,
  isExpired = false,
  retry,
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
  nav = typeof navigator !== "undefined" ? navigator : undefined,
}: {
  isTransient: boolean;
  isExpired?: boolean;
  retry: () => void;
  win?: Pick<Window, "addEventListener" | "removeEventListener">;
  doc?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  nav?: Pick<Navigator, "onLine">;
}): () => void {
  if (!isTransient || isExpired) return () => {};
  let triggeredForCycle = false;

  const attemptRetry = () => {
    if (triggeredForCycle) return;
    if (nav && nav.onLine === false) return;
    if (doc && doc.visibilityState === "hidden") return;
    triggeredForCycle = true;
    retry();
  };

  const onOnline = () => {
    attemptRetry();
  };

  const onVisibilityChange = () => {
    if (!doc) return;
    if (doc.visibilityState === "hidden") {
      triggeredForCycle = false;
      return;
    }
    if (doc.visibilityState === "visible") {
      attemptRetry();
    }
  };

  win?.addEventListener("online", onOnline);
  doc?.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    win?.removeEventListener("online", onOnline);
    doc?.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/** Error line with retry, shared by every section. */
export function SectionError({
  label,
  error,
  retry,
  autoRetry = true,
}: {
  label: string;
  error: string;
  retry: () => void;
  autoRetry?: boolean;
}) {
  const [retrying, setRetrying] = useState(false);
  const { isExpired } = useShell();
  const { isOffline, isDown, isTransient } = classifySectionError(error);
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
  }, []);

  useEffect(() => {
    if (!autoRetry) return;
    return subscribeSectionAutoRetry({
      isTransient,
      isExpired,
      retry: () => retryRef.current(),
    });
  }, [autoRetry, isTransient, isExpired]);

  const handleRetry = () => {
    if (retrying) return;
    setRetrying(true);
    retry();
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setRetrying(false);
    }, 600);
  };

  return (
    <div role="alert" className="section-error">
      <span>
        {isOffline ? "You are offline." : isDown ? "JUET's portal is down (not us)." : `${label} failed: ${error}`}
      </span>
      <button type="button" onClick={handleRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
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

export function countdown(ms: number): string {
  const days = Math.floor(ms / 86400000);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `in ${hours}h`;
  return "today";
}

function getSectionIcon(id?: string) {
  switch (id) {
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
    <section className={`m3-card ${isOpen ? "open" : "collapsed"}`} id={id}>
      <div className="m3-card-header">
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
          <div className="m3-card-body">
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
