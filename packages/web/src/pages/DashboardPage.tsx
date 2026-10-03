import { useState, useEffect } from "react";
import { auth } from "@juet/core";
import { client } from "../lib/portal";
import { titleCase, formatLastSync } from "../components/DataViews";
import { SECTIONS } from "../sections";
import { AttendancePage } from "./AttendancePage";
import { useAttendanceSummary } from "../sections/attendance";
import { ReconnectModal } from "../components/ReconnectModal";
import type { Session } from "../types";

interface InstituteOption {
  value?: string;
  label?: string;
}

export function DashboardPage({
  session,
  isExpired,
  onLogout,
  onSessionRenewed,
  onSelectInstitute,
}: {
  session: Session;
  isExpired?: boolean;
  onLogout: () => void;
  onSessionRenewed?: (s: Session) => void;
  onSelectInstitute: (instituteid: string) => void;
}) {
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (isExpired) {
      setShowRenewModal(true);
    }
  }, [isExpired]);

  const [lastSync, setLastSync] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem("juet.portal.last_sync");
      return raw ? Number(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const update = () => {
      try {
        const raw = localStorage.getItem("juet.portal.last_sync");
        if (raw) setLastSync(Number(raw));
      } catch {}
      setIsRefreshing(false);
    };
    window.addEventListener("storage", update);
    window.addEventListener("juet:sync", update);
    const interval = setInterval(update, 30000);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("juet:sync", update);
      clearInterval(interval);
    };
  }, []);

  const handleRefresh = () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    window.dispatchEvent(new CustomEvent("juet:refresh-all"));
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1500);
  };

  const institutes = (session.institutelist as InstituteOption[] | undefined) ?? [];
  const visible = SECTIONS.filter((s) => s.enabled !== false);
  const otherSections = visible.filter((s) => s.id !== "attendance");
  const displayName = titleCase(session.name ?? session.enrollmentno ?? "Student");

  const [view, setView] = useState<"dashboard" | "attendance">(() => {
    return typeof window !== "undefined" && window.location.hash === "#attendance"
      ? "attendance"
      : "dashboard";
  });

  useEffect(() => {
    const handleHash = () => {
      setView(window.location.hash === "#attendance" ? "attendance" : "dashboard");
    };
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const navigateWithTransition = (action: () => void) => {
    const run = () => {
      action();
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      (document as unknown as { startViewTransition: (cb: () => void) => void }).startViewTransition(run);
    } else {
      run();
    }
  };

  const openAttendance = () => {
    navigateWithTransition(() => {
      window.location.hash = "#attendance";
      setView("attendance");
    });
  };

  const closeAttendance = () => {
    navigateWithTransition(() => {
      if (window.location.hash === "#attendance") {
        history.back();
      } else {
        setView("dashboard");
      }
    });
  };

  const attSummary = useAttendanceSummary(session);

  if (view === "attendance") {
    return (
      <AttendancePage
        session={session}
        isExpired={isExpired}
        onBack={closeAttendance}
        onLogout={onLogout}
        onSessionRenewed={onSessionRenewed}
      />
    );
  }

  return (
    <main className="dash dash-view-enter">
      {/* Session Expired Sticky Notice */}
      {isExpired && (
        <aside className="expiry-banner" role="alert">
          <div className="expiry-banner-content">
            <span className="expiry-icon" aria-hidden="true">⚠️</span>
            <span><strong>Portal logged you out</strong> — showing cached data.</span>
          </div>
          <button onClick={() => setShowRenewModal(true)} className="renew-btn">
            Reconnect
          </button>
        </aside>
      )}

      {/* Material 3 Compact Top Status Bar */}
      <header className="dash-top-bar">
        <div className="dash-user-meta">
          <h1 className="dash-user-name">{displayName}</h1>
          <div className="dash-user-sub">
            <span className="dash-sync-time">
              {isRefreshing ? (
                <>
                  <span className="sync-pulse-dot" aria-hidden="true" /> Refreshing…
                </>
              ) : lastSync ? (
                `Refreshed ${formatLastSync(lastSync)}`
              ) : (
                "Live"
              )}
            </span>
            {institutes.length > 1 && (
              <select
                value={String(session.instituteid ?? "")}
                onChange={(e) => onSelectInstitute(e.target.value)}
                className="dash-institute-select"
                aria-label="Select Institute"
              >
                {institutes.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>
                    {String(o.label ?? o.value)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="dash-top-actions">
          {isExpired && (
            <button
              onClick={() => setShowRenewModal(true)}
              className="m3-reconnect-pill"
              title="Session expired — tap to reconnect"
            >
              <span className="reconnect-dot" />
              <span>Reconnect</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleRefresh}
            className={`dash-refresh-btn ${isRefreshing ? "is-spinning" : ""}`}
            aria-label="Refresh portal data"
            title="Refresh portal data"
            disabled={isRefreshing}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </header>

      <div className="dash-content">
        <button
          type="button"
          className="dash-hero"
          data-state={attSummary.shortsCount > 0 ? "short" : "ok"}
          onClick={openAttendance}
          aria-label={`Attendance, ${attSummary.badgeText}`}
        >
          <div className="dash-hero-text">
            <span className="dash-hero-headline">Attendance</span>
            <span className="dash-hero-status">{attSummary.badgeText}</span>
          </div>

          {/* M3 Expressive icon — shape differs by state (clover vs diamond) */}
          <span className="dash-hero-icon" aria-hidden="true">
            {attSummary.shortsCount > 0 ? (
              /* Priority / warning glyph */
              <svg viewBox="0 -960 960 960" fill="currentColor">
                <path d="M480-120q-33 0-56.5-23.5T400-200q0-33 23.5-56.5T480-280q33 0 56.5 23.5T560-200q0 33-23.5 56.5T480-120Zm-80-240v-480h160v480H400Z"/>
              </svg>
            ) : (
              /* Check / all-clear glyph */
              <svg viewBox="0 -960 960 960" fill="currentColor">
                <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/>
              </svg>
            )}
          </span>

          {/* Navigation chevron */}
          <svg className="dash-hero-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <div className="m3-stacked-sections" role="list">
          {otherSections.map(({ id, Component }) => (
            <Component
              key={`${id}:${String(session.instituteid ?? "")}`}
              session={session}
              onLogout={onLogout}
            />
          ))}
        </div>
      </div>

      {/* Material 3 Connected Button Group Footer */}
      <footer className="dash-footer">
        <span className="dash-footer-tagline">free and open source, always</span>
        <div className="m3-connected-button-group" role="group" aria-label="Quick links">
          <a
            href="https://github.com/jitendradara12/lazyportal/"
            target="_blank"
            rel="noopener noreferrer"
            className="m3-connected-btn"
            aria-label="View source on GitHub"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            <span>GitHub</span>
            {/* <span className="arrow-icon">↗</span> */}
          </a>
          <button
            type="button"
            onClick={onLogout}
            className="m3-connected-btn logout-action"
            aria-label="Logout"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </footer>

      {showRenewModal && onSessionRenewed && (
        <ReconnectModal
          session={session}
          onRenewed={onSessionRenewed}
          onClose={() => setShowRenewModal(false)}
        />
      )}
    </main>
  );
}
