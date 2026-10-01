import { Fragment, useState, useEffect } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { SectionError, formatSemester } from "../components/DataViews";
import { ReconnectModal } from "../components/ReconnectModal";
import type { Session } from "../types";
import {
  type AttRow,
  type AttData,
  subjectName,
  combinedAttendance,
  SubjectDetail,
} from "../sections/attendance";

export function AttendancePage({
  session,
  isExpired,
  onBack,
  onLogout,
  onSessionRenewed,
}: {
  session: Session;
  isExpired?: boolean;
  onBack: () => void;
  onLogout: () => void;
  onSessionRenewed?: (s: Session) => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [showRenewModal, setShowRenewModal] = useState(false);

  const att = useFeature<AttData>({
    run: () => features.getAttendance(client, session),
    deps: [session],
    cacheKey: `att.initial:${session.username}`,
  });
  const initial = att.data;
  const [semId, setSemId, sem] = useSemester("attendance", initial?.semesters);
  const isDefault = semId === String(initial?.semesters?.[0]?.registrationid);

  const detail = useFeature<{ rows: AttRow[] }>({
    run: () =>
      features.getAttendanceDetail(client, session, {
        stynumber: initial?.header?.stynumber,
        registrationid: sem?.registrationid,
        registrationcode: sem?.registrationcode,
      }),
    deps: [session, semId],
    enabled: sem !== null && !isDefault,
    cacheKey: semId ? `att.detail:${session.username}:${semId}` : undefined,
  });

  const rows = isDefault ? (initial?.rows ?? []) : (detail.data?.rows ?? []);
  const semesters = initial?.semesters ?? [];

  useEffect(() => {
    setOpen(null);
  }, [semId]);

  const loading = att.loading || detail.loading;
  const error = att.error ?? detail.error;
  const retry = att.error ? att.retry : detail.retry;

  const shortsCount = rows.filter((r) => combinedAttendance(r).isShort).length;
  const badgeText = rows.length > 0
    ? (shortsCount > 0 ? `${shortsCount} short` : "All clear")
    : (loading ? "Loading…" : undefined);

  const handleRefresh = () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    window.dispatchEvent(new CustomEvent("juet:refresh-all"));
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1500);
  };

  return (
    <main className="dash att-page">
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

      {/* Top Navigation Bar with Back button */}
      <header className="dash-top-bar att-top-bar">
        <button
          type="button"
          onClick={onBack}
          className="att-back-btn"
          aria-label="Back to dashboard"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Dashboard</span>
        </button>

        <div className="att-top-center">
          <span className="att-page-title">Attendance</span>
          {badgeText && (
            <span className={`att-title-pill ${shortsCount > 0 ? "short" : ""}`}>
              {badgeText}
            </span>
          )}
        </div>

        <div className="att-top-actions">
          {semesters.length > 1 && (
            <select
              value={semId ?? ""}
              onChange={(e) => setSemId(e.target.value)}
              disabled={loading}
              className="sem-picker"
              aria-label="Select Semester"
            >
              {semesters.map((s) => (
                <option key={String(s.registrationid)} value={String(s.registrationid)}>
                  {formatSemester(s.registrationcode ?? s.registrationdesc)}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={handleRefresh}
            className={`dash-refresh-btn ${isRefreshing ? "is-spinning" : ""}`}
            aria-label="Refresh attendance"
            title="Refresh attendance"
            disabled={isRefreshing}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </header>

      {/* Full Page Attendance Card */}
      <div className="att-full-page-card">
        {loading && <p className="muted" style={{ padding: "24px 20px" }}>Loading attendance records…</p>}
        {rows.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th className="num-col">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const { name, badge } = subjectName(r.subjectcode);
                  const attInfo = combinedAttendance(r);
                  const isOpen = open === i;
                  return (
                    <Fragment key={i}>
                      <tr
                        className={`clickable-row ${isOpen ? "active-row" : ""}`}
                        onClick={() => setOpen(isOpen ? null : i)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpen(isOpen ? null : i);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={isOpen}
                        title="Tap to see class-by-class attendance"
                      >
                        <td>
                          <div className="sub-row">
                            <span className="row-chevron" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                            <div className="sub-content">
                              <div className="sub-header-line">
                                {badge && <span className="badge">{badge}</span>}
                                <span className="sub-name">{name}</span>
                              </div>
                              {attInfo.margin.text && (
                                <span className={`bunk-note ${attInfo.margin.type}`}>
                                  {attInfo.margin.text}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className={`num-col ${attInfo.colorClass}`}>
                          {attInfo.pct}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="detail-expanded-row">
                          <td colSpan={2}>
                            <SubjectDetail
                              row={r as AttRow & Record<string, unknown>}
                              registrationid={sem?.registrationid}
                              registrationcode={sem?.registrationcode}
                              session={session}
                              onLogout={onLogout}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {initial && rows.length === 0 && !error && !loading && (
          <p className="muted" style={{ padding: "24px 20px" }}>No attendance rows found.</p>
        )}
        {error && <SectionError label="Attendance" error={error} retry={retry} />}
      </div>

      {/* Footer */}
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
