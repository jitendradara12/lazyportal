import { useState, useEffect, useRef, useMemo } from "react";
import { features } from "@juet/core";
import { client, getSessionStatus } from "../lib/portal";
import { useFeature, setCached, sessionCacheKey, getCacheGeneration, isCacheGenerationCurrent } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { SectionError, formatSemester, formatLastSync, shouldThrottleRefresh, recordRefreshAttempt } from "../components/DataViews";
import { SubjectDetailSheet } from "../components/SubjectDetailSheet";
import {
  getManualRefreshQuota,
  recordSuccessfulManualRefresh,
  formatQuotaStatus,
  isPortalDayFresh,
  computeSubjectRowChecksum,
  doesSubjectNeedDeepFetch,
  subscribePortalDayRollover,
  type RefreshQuotaState,
} from "../lib/portalSchedule";
import type { Session } from "../types";
import {
  type AttRow,
  type AttData,
  subjectName,
  combinedAttendance,
  getCachedSubjectDetail,
  getCachedSubjectDetailEntry,
  getSubjectCacheKey,
  useAttendanceInitial,
} from "../sections/attendance";

export function AttendancePage({
  session,
  isExpired,
  isRecovering,
  onBack,
  onLogout,
  onRequestRenew,
}: {
  session: Session;
  isExpired?: boolean;
  isRecovering?: boolean;
  onBack: () => void;
  onLogout: () => void;
  onRequestRenew?: () => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [quotaNotice, setQuotaNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInProgress = useRef(false);
  const pageIsLive = useRef(true);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [selectedSubject, setSelectedSubject] = useState<(AttRow & Record<string, unknown>) | null>(null);
  const [filter, setFilter] = useState<"all" | "short">("all");

  useEffect(() => {
    pageIsLive.current = true;
    return () => {
      pageIsLive.current = false;
    };
  }, []);

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

  const [refreshQuota, setRefreshQuota] = useState<RefreshQuotaState>(() => getManualRefreshQuota(session));

  useEffect(() => {
    const updateQuota = () => {
      setRefreshQuota(getManualRefreshQuota(session));
    };
    window.addEventListener("juet:quota-changed", updateQuota);
    window.addEventListener("storage", updateQuota);
    const unsubscribeRollover = subscribePortalDayRollover(updateQuota);
    return () => {
      window.removeEventListener("juet:quota-changed", updateQuota);
      window.removeEventListener("storage", updateQuota);
      unsubscribeRollover();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [session]);

  const att = useAttendanceInitial(session);
  const initial = att.data;
  const [semId, setSemId, sem] = useSemester(sessionCacheKey("semester", session, "attendance"), initial?.semesters);
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
    cacheKey: semId ? sessionCacheKey("att.detail", session, semId) : undefined,
    staleTimeMs: 7 * 24 * 60 * 60 * 1000,
  });

  const rows = isDefault ? (initial?.rows ?? []) : (detail.data?.rows ?? []);
  const semesters = initial?.semesters ?? [];

  const loading = att.loading || detail.loading;

  // Cache-backed map of subject details for accurate L+T aggregation
  const [detailsMap, setDetailsMap] = useState<Record<string, Record<string, unknown>>>(() => {
    const map: Record<string, Record<string, unknown>> = {};
    for (const r of rows) {
      const cached = getCachedSubjectDetail(session.username, semId, r, session.instituteid);
      if (cached) {
        const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
        map[subId] = cached;
      }
    }
    return map;
  });

  useEffect(() => {
    if (isExpired) {
      setIsRefreshing(false);
      setSyncingIds(new Set());
      setSyncProgress({ done: 0, total: 0 });
    }
  }, [isExpired]);

  // Re-sync cached details when rows or semester change, and prefetch uncached/changed in background
  useEffect(() => {
    if (!rows.length || isExpired) return;

    let isLive = true;
    let isAborted = false;
    let successCount = 0;
    const currentMap: Record<string, Record<string, unknown>> = {};
    const toFetch: (AttRow & Record<string, unknown>)[] = [];

    for (const r of rows) {
      const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
      const entry = getCachedSubjectDetailEntry(session.username, semId, r, session.instituteid);
      if (entry.data) {
        currentMap[subId] = entry.data;
      }
      if (doesSubjectNeedDeepFetch(r as AttRow & Record<string, unknown>, entry.data, entry.updatedAt, entry.checksum)) {
        toFetch.push(r as AttRow & Record<string, unknown>);
      }
    }

    // Isolate detailsMap to current semester (no additive leak across semesters)
    setDetailsMap(currentMap);

    if (toFetch.length > 0 && getSessionStatus() !== "expired") {
      setSyncProgress({ done: 0, total: toFetch.length });

      const base = {
        stynumber: initial?.header?.stynumber,
        registrationid: sem?.registrationid,
        registrationcode: sem?.registrationcode,
      };

      const queue = [...toFetch];
      const concurrency = 2;
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length > 0 && isLive && !isAborted && getSessionStatus() !== "expired") {
          const r = queue.shift();
          if (!r) break;
          const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
          if (isLive) {
            setSyncingIds((prev) => new Set(prev).add(subId));
          }
          try {
            const data = await features.getSubjectAttendanceAll(client, session, r, base, "current");
            if (isLive && data && !isAborted && getSessionStatus() !== "expired") {
              const key = getSubjectCacheKey(session.username, semId, r, session.instituteid);
              const checksum = computeSubjectRowChecksum(r);
              try {
                localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now(), checksum }));
              } catch {}
              setDetailsMap((prev) => ({ ...prev, [subId]: data }));
              successCount++;
            }
          } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            const status = (err as { status?: number })?.status;
            if (code === "SESSION_EXPIRED" || status === 401 || getSessionStatus() === "expired") {
              isAborted = true;
              queue.length = 0;
              if (isLive) {
                setSyncingIds(new Set());
                setSyncProgress({ done: 0, total: 0 });
              }
              break;
            }
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

      Promise.all(workers)
        .then(() => {
          if (isLive && !isAborted && successCount > 0 && getSessionStatus() !== "expired") {
            try {
              localStorage.setItem("juet.portal.last_sync", String(Date.now()));
              window.dispatchEvent(new CustomEvent("juet:sync"));
            } catch {}
          }
        })
        .finally(() => {
          if (isLive) {
            setSyncingIds(new Set());
            setSyncProgress({ done: 0, total: 0 });
          }
        });
    }

    return () => {
      isLive = false;
      isAborted = true;
      setSyncingIds(new Set());
      setSyncProgress({ done: 0, total: 0 });
    };
  }, [rows, semId, session, initial?.header?.stynumber, sem?.registrationid, sem?.registrationcode, isExpired]);

  const isSyncing = !isExpired && (isRefreshing || loading || syncingIds.size > 0);

  // Memoize counts and filtering in a single O(N) pass to preserve smooth CPU/memory on mobile
  const { shortsCount, filteredRows } = useMemo(() => {
    let count = 0;
    const filtered: (AttRow & Record<string, unknown>)[] = [];
    for (const r of rows) {
      const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
      const isShort = combinedAttendance(r, detailsMap[subId]).isShort;
      if (isShort) count++;
      if (filter === "all" || isShort) {
        filtered.push(r as AttRow & Record<string, unknown>);
      }
    }
    return { shortsCount: count, filteredRows: filtered };
  }, [rows, detailsMap, filter]);

  const handleRefresh = async (bypassThrottle = false) => {
    if (refreshInProgress.current || isSyncing || isExpired) return;

    // Retrying an error explicitly passes bypassThrottle = true.
    // Normal manual refresh checks daily quota and rapid-click throttle.
    // Daily quota applies ONLY to the active current semester (isDefault).
    const isErrorRetry = Boolean(bypassThrottle);
    const quota = getManualRefreshQuota(session);
    if (!isErrorRetry) {
      if (isDefault && !quota.canRefresh) {
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        setQuotaNotice("Up to date with portal • Refresh resets at 2:00 AM IST");
        noticeTimer.current = setTimeout(() => {
          if (pageIsLive.current) setQuotaNotice(null);
        }, 2500);
        return;
      }
      if (shouldThrottleRefresh()) {
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        setQuotaNotice("Please wait 2 minutes between refreshes");
        noticeTimer.current = setTimeout(() => {
          if (pageIsLive.current) setQuotaNotice(null);
        }, 2000);
        return;
      }
    }

    const requestGeneration = getCacheGeneration();
    refreshInProgress.current = true;
    recordRefreshAttempt();
    setRefreshError(null);
    setQuotaNotice(null);
    setIsRefreshing(true);

    try {
      // 1. Fetch fresh base overview first
      let freshRows: (AttRow & Record<string, unknown>)[] | null = null;
      const basePayload = {
        stynumber: initial?.header?.stynumber,
        registrationid: sem?.registrationid,
        registrationcode: sem?.registrationcode,
      };

      if (isDefault) {
        const freshAtt = await features.getAttendance(client, session);
        if (!pageIsLive.current || !isCacheGenerationCurrent(requestGeneration)) return;
        if (freshAtt && Array.isArray(freshAtt.rows)) {
          freshRows = freshAtt.rows as (AttRow & Record<string, unknown>)[];
          setCached(sessionCacheKey("att.initial", session), freshAtt);
        } else {
          throw new Error("Portal returned no attendance data");
        }
      } else if (sem?.registrationid) {
        const freshDetail = await features.getAttendanceDetail(client, session, basePayload);
        if (!pageIsLive.current || !isCacheGenerationCurrent(requestGeneration)) return;
        if (freshDetail && Array.isArray(freshDetail.rows)) {
          freshRows = freshDetail.rows as (AttRow & Record<string, unknown>)[];
          setCached(sessionCacheKey("att.detail", session, semId), freshDetail);
        } else {
          throw new Error("Portal returned no attendance data");
        }
      }

      if (!pageIsLive.current || !isCacheGenerationCurrent(requestGeneration)) return;

      // Tell hooks to update from fresh cache
      window.dispatchEvent(new CustomEvent("juet:refresh-attendance"));

      // 2. Fetch fresh detail only for subjects whose checksum changed or lack detail
      const activeRows = freshRows ?? rows;
      const toFetch: (AttRow & Record<string, unknown>)[] = [];
      for (const r of activeRows) {
        const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
        const entry = getCachedSubjectDetailEntry(session.username, semId, r, session.instituteid);
        if (doesSubjectNeedDeepFetch(r as AttRow & Record<string, unknown>, detailsMap[subId] ?? entry.data, entry.updatedAt, entry.checksum)) {
          toFetch.push(r as AttRow & Record<string, unknown>);
        }
      }

      let isAborted = false;
      let detailRefreshError: string | null = null;

      if (toFetch.length > 0 && getSessionStatus() !== "expired") {
        setSyncProgress({ done: 0, total: toFetch.length });

        const base = {
          stynumber: initial?.header?.stynumber,
          registrationid: sem?.registrationid,
          registrationcode: sem?.registrationcode,
        };

        const queue = [...toFetch];
        const concurrency = 2;
        let successCount = 0;
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
          while (
            queue.length > 0 &&
            !isAborted &&
            pageIsLive.current &&
            isCacheGenerationCurrent(requestGeneration) &&
            getSessionStatus() !== "expired"
          ) {
            const r = queue.shift();
            if (!r) break;
            const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode);
            setSyncingIds((prev) => new Set(prev).add(subId));
            try {
              const data = await features.getSubjectAttendanceAll(client, session, r, base, "current");
              if (
                data &&
                !isAborted &&
                pageIsLive.current &&
                isCacheGenerationCurrent(requestGeneration) &&
                getSessionStatus() !== "expired"
              ) {
                const key = getSubjectCacheKey(session.username, semId, r, session.instituteid);
                const checksum = computeSubjectRowChecksum(r);
                try {
                  localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now(), checksum }));
                } catch {}
                setDetailsMap((prev) => ({ ...prev, [subId]: data }));
                successCount++;
              }
            } catch (err: unknown) {
              const code = (err as { code?: string })?.code;
              const status = (err as { status?: number })?.status;
              if (code === "SESSION_EXPIRED" || status === 401 || getSessionStatus() === "expired") {
                isAborted = true;
                queue.length = 0;
                if (pageIsLive.current) {
                  setSyncingIds(new Set());
                  setSyncProgress({ done: 0, total: 0 });
                }
                break;
              }
              if (!detailRefreshError) {
                detailRefreshError = err instanceof Error ? err.message : String(err);
              }
            } finally {
              if (pageIsLive.current) {
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

        await Promise.all(workers);
        if (
          detailRefreshError &&
          pageIsLive.current &&
          isCacheGenerationCurrent(requestGeneration) &&
          getSessionStatus() !== "expired"
        ) {
          setRefreshError(detailRefreshError);
        }

        if (
          !isAborted &&
          successCount > 0 &&
          pageIsLive.current &&
          isCacheGenerationCurrent(requestGeneration) &&
          getSessionStatus() !== "expired"
        ) {
          try {
            localStorage.setItem("juet.portal.last_sync", String(Date.now()));
            window.dispatchEvent(new CustomEvent("juet:sync"));
          } catch {}
        }
      } else if (getSessionStatus() !== "expired" && !att.error && !detail.error) {
        try {
          localStorage.setItem("juet.portal.last_sync", String(Date.now()));
          window.dispatchEvent(new CustomEvent("juet:sync"));
        } catch {}
      }

      // Deduct quota ONLY after BOTH Step 1 and Step 2 completed without error,
      // and ONLY for the active current semester (isDefault) with valid rows.
      if (
        !detailRefreshError &&
        !isAborted &&
        isDefault &&
        quota.canRefresh &&
        freshRows &&
        freshRows.length > 0 &&
        pageIsLive.current &&
        isCacheGenerationCurrent(requestGeneration) &&
        getSessionStatus() !== "expired"
      ) {
        recordSuccessfulManualRefresh(session);
        setRefreshQuota(getManualRefreshQuota(session));
      }
    } catch (err: unknown) {
      // Session expiry has its own reconnect UI; report ordinary refresh errors
      // here instead of leaking an unhandled rejection from the click handler.
      if (pageIsLive.current && getSessionStatus() !== "expired") {
        setRefreshError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      refreshInProgress.current = false;
      if (pageIsLive.current) {
        setIsRefreshing(false);
        setSyncingIds(new Set());
        setSyncProgress({ done: 0, total: 0 });
      }
    }
  };

  const error = refreshError ?? att.error ?? detail.error;
  const retry = refreshError ? () => handleRefresh(true) : att.error ? att.retry : detail.retry;

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
            ) : quotaNotice ? (
              <span className="att-sync-pill att-sync-notice" role="status" aria-live="polite">
                {quotaNotice}
              </span>
            ) : lastSync ? (
              <span className="att-sync-pill">
                {formatLastSync(lastSync)}
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

          {isExpired && !isRecovering && (
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
            onClick={() => void handleRefresh()}
            className={`dash-refresh-btn ${isSyncing ? "is-spinning" : ""}`}
            aria-label="Refresh attendance"
            title={
              isSyncing
                ? "Refreshing attendance…"
                : isDefault && !refreshQuota.canRefresh && !error
                ? formatQuotaStatus(refreshQuota)
                : shouldThrottleRefresh() && lastSync
                ? formatLastSync(lastSync)
                : "Refresh attendance"
            }
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
