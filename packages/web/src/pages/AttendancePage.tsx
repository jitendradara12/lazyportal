import { useState, useEffect } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { SectionError, formatSemester } from "../components/DataViews";
import { ReconnectModal } from "../components/ReconnectModal";
import { SubjectDetailSheet } from "../components/SubjectDetailSheet";
import type { Session } from "../types";
import {
  type AttRow,
  type AttData,
  subjectName,
  combinedAttendance,
  getCachedSubjectDetail,
  getSubjectCacheKey,
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
  const [selectedSubject, setSelectedSubject] = useState<(AttRow & Record<string, unknown>) | null>(null);
  const [filter, setFilter] = useState<"all" | "short">("all");
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

  const loading = att.loading || detail.loading;
  const error = att.error ?? detail.error;
  const retry = att.error ? att.retry : detail.retry;

  // Cache-backed map of subject details for accurate L+T aggregation
  const [detailsMap, setDetailsMap] = useState<Record<string, Record<string, unknown>>>(() => {
    const map: Record<string, Record<string, unknown>> = {};
    for (const r of rows) {
      const cached = getCachedSubjectDetail(session.username, semId, r);
      if (cached) {
        const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
        map[subId] = cached;
      }
    }
    return map;
  });

  // Re-sync cached details when rows or semester change, and prefetch uncached in background
  useEffect(() => {
    if (!rows.length) return;

    let isLive = true;
    const currentMap: Record<string, Record<string, unknown>> = {};
    const uncached: (AttRow & Record<string, unknown>)[] = [];

    for (const r of rows) {
      const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
      const cached = getCachedSubjectDetail(session.username, semId, r);
      if (cached) {
        currentMap[subId] = cached;
      } else {
        uncached.push(r as AttRow & Record<string, unknown>);
      }
    }

    setDetailsMap((prev) => ({ ...prev, ...currentMap }));

    if (uncached.length > 0) {
      const base = {
        stynumber: initial?.header?.stynumber,
        registrationid: sem?.registrationid,
        registrationcode: sem?.registrationcode,
      };

      Promise.all(
        uncached.map(async (r) => {
          try {
            const data = await features.getSubjectAttendanceAll(client, session, r, base, "current");
            if (isLive && data) {
              const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
              const key = getSubjectCacheKey(session.username, semId, r);
              try {
                localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now() }));
              } catch {}
              setDetailsMap((prev) => ({ ...prev, [subId]: data }));
            }
          } catch {}
        })
      );
    }

    return () => {
      isLive = false;
    };
  }, [rows, semId, session, initial?.header?.stynumber, sem?.registrationid, sem?.registrationcode]);

  const shortsCount = rows.filter((r) => {
    const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
    return combinedAttendance(r, detailsMap[subId]).isShort;
  }).length;

  const filteredRows = rows.filter((r) => {
    if (filter === "short") {
      const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
      return combinedAttendance(r, detailsMap[subId]).isShort;
    }
    return true;
  });

  const handleRefresh = () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    window.dispatchEvent(new CustomEvent("juet:refresh-all"));
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1500);
  };

  return (
    <main className="dash att-page dash-view-enter">
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

      {/* Top Navigation Bar */}
      <header className="dash-top-bar att-top-bar">
        <div className="att-top-left">
          <button
            type="button"
            onClick={onBack}
            className="dash-refresh-btn"
            aria-label="Back to dashboard"
            title="Back to dashboard"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <h1 className="att-header-title">Attendance</h1>
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

      {/* Segmented Pill Toggle (only when subjects are short) */}
      {shortsCount > 0 && rows.length > 0 && (
        <div className="att-filter-bar">
          <div className="segmented-pill-toggle" role="tablist" aria-label="Filter subjects">
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              className={`segmented-pill ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All {rows.length}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "short"}
              className={`segmented-pill ${filter === "short" ? "active" : ""}`}
              onClick={() => setFilter("short")}
            >
              Short {shortsCount}
            </button>
          </div>
        </div>
      )}

      {/* Subject List Items */}
      <section className="m3-stacked-sections att-subjects-card" aria-label="Subject list">
        {loading && (
          <p className="muted" style={{ padding: "24px 20px" }}>Loading attendance records…</p>
        )}

        {filteredRows.length > 0 &&
          filteredRows.map((r, i) => {
            const { name, badge } = subjectName(r.subjectcode);
            const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
            const attInfo = combinedAttendance(r, detailsMap[subId]);

            let supportingContent = null;
            if (attInfo.hasHeldClasses && attInfo.totalClasses > 0) {
              supportingContent = (
                <span className="att-count-text">
                  {attInfo.totalPresent}/{attInfo.totalClasses} classes
                </span>
              );
            } else if (!attInfo.hasHeldClasses) {
              supportingContent = (
                <span className="att-count-text muted">
                  No classes yet
                </span>
              );
            }

            return (
              <button
                key={String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode ?? i)}
                type="button"
                className={`m3-list-item att-subject-row ${attInfo.isShort ? "is-short-row" : ""}`}
                onClick={() => setSelectedSubject(r as AttRow & Record<string, unknown>)}
                aria-label={`${name}, ${attInfo.pct} attendance`}
              >
                {/* Subject Content */}
                <div className="m3-item-content">
                  <div className="att-subject-headline-row">
                    <span className="m3-item-headline">{name}</span>
                    {badge && <span className="att-code-badge">{badge}</span>}
                  </div>
                  {supportingContent && (
                    <div className="att-subject-supporting-row">
                      {supportingContent}
                    </div>
                  )}
                </div>

                {/* Trailing Attendance % + Chevron */}
                <div className="att-trailing-group">
                  <span className={`att-row-pct ${attInfo.colorClass}`}>
                    {attInfo.pct}
                  </span>
                  <div className="m3-trailing-chevron" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>
              </button>
            );
          })}

        {/* Empty filter message */}
        {rows.length > 0 && filteredRows.length === 0 && (
          <div className="att-empty-filter">
            <p className="muted">No subjects match this filter.</p>
            <button type="button" className="att-reset-filter-btn" onClick={() => setFilter("all")}>
              Show All Subjects
            </button>
          </div>
        )}

        {initial && rows.length === 0 && !error && !loading && (
          <p className="muted" style={{ padding: "24px 20px" }}>No attendance rows found.</p>
        )}

        {error && <SectionError label="Attendance" error={error} retry={retry} />}
      </section>

      {/* Slide-over sheet for detailed history */}
      {selectedSubject && (
        <SubjectDetailSheet
          row={selectedSubject}
          registrationid={sem?.registrationid}
          registrationcode={sem?.registrationcode}
          session={session}
          onClose={() => setSelectedSubject(null)}
          onLogout={onLogout}
        />
      )}

      {/* Connected Button Group Footer */}
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
