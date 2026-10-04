import { useState, useEffect } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { SectionError, formatSemester, formatLastSync, shouldThrottleRefresh } from "../components/DataViews";
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
  onRequestRenew,
}: {
  session: Session;
  isExpired?: boolean;
  onBack: () => void;
  onLogout: () => void;
  onRequestRenew?: () => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [selectedSubject, setSelectedSubject] = useState<(AttRow & Record<string, unknown>) | null>(null);
  const [filter, setFilter] = useState<"all" | "short">("all");

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
    };
    window.addEventListener("storage", update);
    window.addEventListener("juet:sync", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("juet:sync", update);
    };
  }, []);

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
      const uncachedIds = new Set(uncached.map((r) => String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode)));
      setSyncingIds(uncachedIds);
      setSyncProgress({ done: 0, total: uncached.length });

      const base = {
        stynumber: initial?.header?.stynumber,
        registrationid: sem?.registrationid,
        registrationcode: sem?.registrationcode,
      };

      const queue = [...uncached];
      const concurrency = 3;
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length > 0 && isLive) {
          const r = queue.shift();
          if (!r) break;
          const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
          try {
            const data = await features.getSubjectAttendanceAll(client, session, r, base, "current");
            if (isLive && data) {
              const key = getSubjectCacheKey(session.username, semId, r);
              try {
                localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now() }));
              } catch {}
              setDetailsMap((prev) => ({ ...prev, [subId]: data }));
            }
          } catch {
            // Gracefully ignore network / adblock errors
          } finally {
            if (isLive) {
              setSyncingIds((prev) => {
                const next = new Set(prev);
                next.delete(subId);
                return next;
              });
              setSyncProgress((prev) => ({ ...prev, done: prev.done + 1 }));
            }
          }
        }
      });

      Promise.all(workers).then(() => {
        if (isLive) {
          try {
            localStorage.setItem("juet.portal.last_sync", String(Date.now()));
            window.dispatchEvent(new CustomEvent("juet:sync"));
          } catch {}
        }
      });
    }

    return () => {
      isLive = false;
      setSyncingIds(new Set());
    };
  }, [rows, semId, session, initial?.header?.stynumber, sem?.registrationid, sem?.registrationcode]);

  const isSyncing = isRefreshing || loading || syncingIds.size > 0;

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

  const handleRefresh = async () => {
    if (isRefreshing || shouldThrottleRefresh()) return;
    setIsRefreshing(true);

    try {
      // 1. Tell useFeature to refresh base attendance (bypasses cache-first check)
      window.dispatchEvent(new CustomEvent("juet:refresh-all"));

      // 2. Fetch fresh detail for all subjects in current semester
      if (rows.length > 0) {
        const allIds = new Set(rows.map((r) => String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode)));
        setSyncingIds(allIds);
        setSyncProgress({ done: 0, total: rows.length });

        const base = {
          stynumber: initial?.header?.stynumber,
          registrationid: sem?.registrationid,
          registrationcode: sem?.registrationcode,
        };

        const queue = [...rows];
        const concurrency = 3;
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
          while (queue.length > 0) {
            const r = queue.shift();
            if (!r) break;
            const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
            try {
              const data = await features.getSubjectAttendanceAll(client, session, r, base, "current");
              if (data) {
                const key = getSubjectCacheKey(session.username, semId, r);
                try {
                  localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now() }));
                } catch {}
                setDetailsMap((prev) => ({ ...prev, [subId]: data }));
              }
            } catch {
              // Gracefully handle network/block error
            } finally {
              setSyncingIds((prev) => {
                const next = new Set(prev);
                next.delete(subId);
                return next;
              });
              setSyncProgress((prev) => ({ ...prev, done: prev.done + 1 }));
            }
          }
        });

        await Promise.all(workers);
      }

      try {
        localStorage.setItem("juet.portal.last_sync", String(Date.now()));
        window.dispatchEvent(new CustomEvent("juet:sync"));
      } catch {}
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <main className="dash att-page dash-view-enter">
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

          <div className="att-header-titles">
            <h1 className="att-header-title">Attendance</h1>
            {isSyncing ? (
              <span className="att-sync-pill is-syncing" role="status" aria-live="polite">
                <span className="att-sync-dot" aria-hidden="true" />
                <span>
                  {syncProgress.total > 0
                    ? `Refreshing ${syncProgress.done}/${syncProgress.total}…`
                    : "Refreshing…"}
                </span>
              </span>
            ) : lastSync ? (
              <span className="att-sync-pill">
                Refreshed {formatLastSync(lastSync)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="att-top-actions">
          {semesters.length > 1 && (
            <select
              value={semId ?? ""}
              onChange={(e) => setSemId(e.target.value)}
              disabled={loading || isSyncing}
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

          {isExpired && (
            <button
              onClick={onRequestRenew}
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
            className={`dash-refresh-btn ${isSyncing ? "is-spinning" : ""}`}
            aria-label="Refresh attendance"
            title={isSyncing ? "Refreshing attendance…" : "Refresh attendance"}
            disabled={isSyncing}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </header>

      <div className="att-content">
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
        <section className="att-list" aria-label="Subject list">
          {loading && (
            <p className="muted" style={{ padding: "24px 20px" }}>Loading attendance records…</p>
          )}

          {filteredRows.length > 0 &&
            filteredRows.map((r, i) => {
              const { name, badge } = subjectName(r.subjectcode);
              const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
              const isSubjectSyncing = syncingIds.has(subId);
              const attInfo = combinedAttendance(r, detailsMap[subId]);

              return (
                <button
                  key={String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode ?? i)}
                  type="button"
                  className={`m3-list-item att-subject-row ${attInfo.isShort ? "is-short-row" : ""}`}
                  onClick={() => setSelectedSubject(r as AttRow & Record<string, unknown>)}
                  aria-label={`${name}, ${attInfo.pct} attendance`}
                >
                  <div className="m3-item-content">
                    <span className="m3-item-headline att-subject-name">{name}</span>
                    <span className="att-subject-supporting">
                      {badge && <span className="att-code">{badge}</span>}
                      {badge && " · "}
                      {isSubjectSyncing ? (
                        <span className="att-count-syncing">
                          <span className="sync-pulse-dot" aria-hidden="true" />
                          Refreshing…
                        </span>
                      ) : attInfo.hasHeldClasses && attInfo.totalClasses > 0 ? (
                        `${attInfo.totalPresent}/${attInfo.totalClasses} classes`
                      ) : attInfo.hasHeldClasses && attInfo.totalClasses === 0 ? (
                        attInfo.components.L?.pct != null && attInfo.components.T?.pct != null
                          ? `L: ${attInfo.components.L.pct}% · T: ${attInfo.components.T.pct}%`
                          : "Classes held"
                      ) : (
                        "No classes yet"
                      )}
                    </span>
                  </div>
                  <span className={`att-row-pct ${attInfo.hasHeldClasses && attInfo.totalClasses > 0 ? attInfo.colorClass : "is-empty"} ${isSubjectSyncing ? "att-pct-syncing" : ""}`}>
                    {isSubjectSyncing ? "…" : attInfo.hasHeldClasses && attInfo.pct !== "—" ? attInfo.pct : "--"}
                  </span>
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
      </div>

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
    </main>
  );
}
