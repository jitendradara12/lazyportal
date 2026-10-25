import type { ReactNode } from "react";

export type TimelineState = "past" | "current" | "next" | "later";

export function Timeline({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <ol className={`exam-timeline ${className}`} aria-label={label}>{children}</ol>;
}

export function TimelineStop({ state, children, pastLabel = "Past event" }: { state: TimelineState; children: ReactNode; pastLabel?: string }) {
  const label = state === "past" ? pastLabel : state === "current" ? "In progress" : state === "next" ? "Up next" : "Upcoming";
  return <li className={`exam-stop is-${state}`} aria-current={state === "current" || state === "next" ? "step" : undefined}>
    <span className="exam-marker" role="img" aria-label={label} title={label}>
      {state === "past" && <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m4 8 3 3 5-6" /></svg>}
      {state === "current" && <span className="exam-marker-live" />}
    </span>
    {children}
  </li>;
}

export function TimelineGroup({ label, count, children, defaultOpen = false }: { label: string; count: number; children: ReactNode; defaultOpen?: boolean }) {
  return <li className="exam-future-group">
    <details open={defaultOpen || undefined}>
      <summary aria-label={`${label} (${count})`}>
        <span>{label} <span className="exam-future-count">· {count}</span></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
      <ol className="exam-future-list" aria-label={label}>{children}</ol>
    </details>
  </li>;
}
