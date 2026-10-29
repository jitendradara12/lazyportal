/** App shell context + top app bar shared by every tab. */
import { createContext, useContext, type ReactNode } from "react";
import { RefreshIcon } from "./icons";
import { SLOW_PORTAL_MESSAGE, useSlowRequest } from "../hooks/useSlowRequest";

export interface Shell {
  isExpired: boolean;
  isRecovering: boolean;
  requestRenew: () => void;
  setShorts: (n: number) => void;
}

export const ShellContext = createContext<Shell>({
  isExpired: false,
  isRecovering: false,
  requestRenew() {},
  setShorts() {},
});

export const useShell = () => useContext(ShellContext);

export function TopBar({
  title,
  subtitle,
  busy = false,
  noRefresh = false,
  onRefresh,
  refreshLabel = "Refresh",
  refreshTitle,
  feedback = false,
  onFeedbackEnd,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  busy?: boolean;
  noRefresh?: boolean;
  onRefresh?: () => void;
  refreshLabel?: string;
  refreshTitle?: string;
  feedback?: boolean;
  onFeedbackEnd?: () => void;
  actions?: ReactNode;
}) {
  const shell = useShell();
  const slow = useSlowRequest(busy);
  const waitMessage = busy && shell.isRecovering ? "Reconnecting to JUET's portal…" : slow ? SLOW_PORTAL_MESSAGE : null;
  const spinning = busy;
  return (
    <header className="app-bar">
      <div className="app-bar-titles">
        <h1 className="app-bar-title">{title}</h1>
        {subtitle && <div className="app-bar-sub">{subtitle}</div>}
        {waitMessage && <div className="app-bar-sub" role="status">{waitMessage}</div>}
      </div>
      <div className="app-bar-actions">
        {actions}
        {shell.isExpired && !shell.isRecovering && (
          <button type="button" onClick={shell.requestRenew} className="m3-reconnect-pill" title="Session expired, tap to reconnect">
            <span className="reconnect-dot" />
            <span>Reconnect</span>
          </button>
        )}
        {!noRefresh && onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            onAnimationEnd={onFeedbackEnd}
            className={`dash-refresh-btn ${spinning ? "is-spinning" : feedback ? "is-feedback-spinning" : ""}`}
            aria-label={refreshLabel}
            title={refreshTitle ?? refreshLabel}
            disabled={spinning}
          >
            <RefreshIcon />
          </button>
        )}
      </div>
    </header>
  );
}

/** Semester dropdown styled as an M3 filter chip. */
export function SemesterPicker({
  semesters,
  value,
  onChange,
  disabled,
  format,
}: {
  semesters: { registrationid?: string; registrationcode?: string; registrationdesc?: string }[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  format: (code?: string) => string;
}) {
  if (semesters.length < 2) return null;
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="sem-picker" aria-label="Select semester">
      {semesters.map((s) => (
        <option key={String(s.registrationid)} value={String(s.registrationid)}>
          {format(s.registrationcode ?? s.registrationdesc)}
        </option>
      ))}
    </select>
  );
}
