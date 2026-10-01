import { useState, useEffect, useRef } from "react";
import { auth } from "@juet/core";
import { client } from "../lib/portal";
import { titleCase } from "../components/DataViews";
import { SECTIONS } from "../sections";
import { AttendancePage } from "./AttendancePage";
import { useAttendanceSummary } from "../sections/attendance";
import { ReconnectModal } from "../components/ReconnectModal";
import type { Session } from "../types";

interface InstituteOption {
  value?: string;
  label?: string;
}

function formatLastSync(ts: number | null): string {
  if (!ts) return "";
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  const d = new Date(ts);
  const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diffHours < 24) return timeStr;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${timeStr}`;
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
          <span className="dash-user-name">{displayName}</span>
          <span className="dash-meta-sep" aria-hidden="true">·</span>
          <span className="dash-sync-time">
            {lastSync ? `Updated ${formatLastSync(lastSync)}` : "Live"}
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

      {/* Material 3 Expressive Expandable Stacked Sections */}
      <div className="m3-stacked-sections" role="list">
        {/* Attendance Navigation Item (Opens Full Page) */}
        <div className="m3-card m3-nav-card">
          <div className="m3-card-header">
            <button
              type="button"
              className="m3-list-item m3-nav-item-btn"
              onClick={openAttendance}
              aria-label="Open Attendance page"
            >
              <div className="m3-leading-icon-circle">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                  <path d="m9 14 2 2 4-4" />
                </svg>
              </div>
              <div className="m3-item-content">
                <span className="m3-item-headline">Attendance</span>
                <span className={`m3-item-supporting ${attSummary.shortsCount > 0 ? "short" : ""}`}>
                  {attSummary.badgeText}
                </span>
              </div>
              <div className="m3-trailing-chevron" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </button>
          </div>
        </div>

        {/* Other Sections (Expandable in-place) */}
        {otherSections.map(({ id, Component }) => (
          <Component
            key={`${id}:${String(session.instituteid ?? "")}`}
            session={session}
            onLogout={onLogout}
          />
        ))}
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
