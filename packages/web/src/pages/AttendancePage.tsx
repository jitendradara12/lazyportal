import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { features } from "@juet/core";
import { client, getSessionStatus } from "../lib/portal";
import { useFeature, sessionCacheKey, getCacheGeneration, isCacheGenerationCurrent } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { SectionError, formatSemester, formatLastSync, shouldThrottleRefresh, recordRefreshAttempt } from "../components/DataViews";
import { SubjectDetailSheet } from "../components/SubjectDetailSheet";
import { TopBar, SemesterPicker, useShell } from "../components/AppBar";
import {
  isCurrentPortalDay,
  computeSubjectRowChecksum,
  getManualRefreshQuota,
  getRefreshQuotaNotice,
  subscribePortalDayRollover,
  FEATURE_TTL,
  type RefreshQuotaState,
} from "../lib/portalSchedule";
import type { Session } from "../types";
import {
  type AttRow,
  subjectName,
  rowSubId,
  subjectRowId,
  getCachedSubjectDetail,
  getCachedSubjectDetailEntry,
  useAttendanceInitial,
} from "../sections/attendance";
import { combinedAttendance, isSubjectDetailComplete } from "../lib/attendanceCalc";
import { runManualAttendanceRefresh, syncAttendanceDetails, type ManualAttendanceRefreshCheckpoint } from "../lib/attendanceSync";

export function AttendancePage({
  session,
  isExpired,
  onLogout,
}: {
  session: Session;
  isExpired?: boolean;
  isRecovering?: boolean;
  onLogout: () => void;
}) {
  const shell = useShell();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [detailSyncError, setDetailSyncError] = useState<string | null>(null);
  const [detailSyncAttempt, setDetailSyncAttempt] = useState(0);
  const [quotaNotice, setQuotaNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (msg: string, ms: number) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setQuotaNotice(msg);
    noticeTimer.current = setTimeout(() => {
      if (pageIsLive.current) setQuotaNotice(null);
    }, ms);
  };
  const refreshInProgress = useRef(false);
  const manualCheckpoint = useRef<ManualAttendanceRefreshCheckpoint>({});
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
  const lastSemRef = useRef(`${session.username}:${session.instituteid ?? "default"}:${semId}`);

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
    staleTimeMs: FEATURE_TTL.pastDetail,
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
        const subId = rowSubId(r);
        map[subId] = cached;
      }
    }
    return map;
  });

  // Old logs can otherwise override a newly fetched percentage after a partial
  // failure. Keep cached numbers only while they describe the same overview.
  const visibleDetailsMap = useMemo(() => {
    const compatible: typeof detailsMap = {};
    for (const row of rows) {
      const id = rowSubId(row);
      const entry = getCachedSubjectDetailEntry(session.username, semId, row, session.instituteid);
      if (!entry.checksum || entry.checksum === computeSubjectRowChecksum(row)) {
        if (detailsMap[id]) compatible[id] = detailsMap[id];
      }
    }
    return compatible;
  }, [rows, detailsMap, session, semId]);

  const activeSelectedSubject = useMemo(() => {
    if (!selectedSubject) return null;
    const subId = subjectRowId(selectedSubject);
    const found = rows.find((r) => subjectRowId(r) === subId);
    return (found as (AttRow & Record<string, unknown>) | undefined) ?? selectedSubject;
  }, [selectedSubject, rows]);

  const handleDetailLoaded = useCallback(
    (subId: string, data: Record<string, Record<string, unknown>>, loadedUpdatedAt?: number | null) => {
      const entry = getCachedSubjectDetailEntry(
        session.username,
        semId,
        subId,
        session.instituteid
      );
      if (entry.updatedAt && loadedUpdatedAt && entry.updatedAt > loadedUpdatedAt && entry.data !== data) {
        return;
      }
      setDetailsMap((prev) => (prev[subId] === data ? prev : { ...prev, [subId]: data }));
    },
    [session.username, semId, session.instituteid]
  );

  useEffect(() => {
    if (isExpired) {
      setIsRefreshing(false);
      setSyncingIds(new Set());
      setSyncProgress({ done: 0, total: 0 });
    }
  }, [isExpired]);

  // Wait for today's overview before fetching logs, otherwise the old row
  // checksum can launch a second wave of identical reads when it is replaced.
  useEffect(() => {
    if (!rows.length || isExpired || !isDefault || refreshInProgress.current ||
      att.refreshing || !isCurrentPortalDay(att.updatedAt)) return;
    setDetailSyncError(null);
    const generation = getCacheGeneration();
    let active = true;
    const current = () => active && pageIsLive.current && isCacheGenerationCurrent(generation) && getSessionStatus() !== "expired";
    const currentMap: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      const entry = getCachedSubjectDetailEntry(session.username, semId, row, session.instituteid);
      if (entry.data) currentMap[rowSubId(row)] = entry.data;
    }
    const key = `${session.username}:${session.instituteid ?? "default"}:${semId}`;
    const changedSemester = lastSemRef.current !== key;
    lastSemRef.current = key;
    setDetailsMap((prev) => changedSemester ? currentMap : { ...prev, ...currentMap });

    void syncAttendanceDetails({
      session, rows,
      overviewUpdatedAt: att.updatedAt,
      base: { registrationid: sem?.registrationid, registrationcode: sem?.registrationcode },
      isCurrent: current,
      onDetail: (id, data) => setDetailsMap((prev) => ({ ...prev, [id]: data })),
      onProgress: (pending, done, total) => {
        setSyncingIds(pending);
        setSyncProgress({ done, total });
      },
    }).then((result) => {
      if (current() && !result.complete) setDetailSyncError("Some class details could not be updated. Retry to load the remaining subjects.");
    }).finally(() => {
      if (active) {
        setSyncingIds(new Set());
        setSyncProgress({ done: 0, total: 0 });
      }
    });
    return () => { active = false; };
  }, [rows, semId, session, sem?.registrationid, sem?.registrationcode, isExpired, att.refreshing, att.updatedAt, detailSyncAttempt]);

  const isSyncing = !isExpired && (isRefreshing || loading || att.refreshing || syncingIds.size > 0);

  // Single-pass short-count + filter for cheap mobile renders.
  const { shortsCount, filteredRows } = useMemo(() => {
    let count = 0;
    const filtered: (AttRow & Record<string, unknown>)[] = [];
    for (const r of rows) {
      const subId = rowSubId(r);
      const isShort = combinedAttendance(r, visibleDetailsMap[subId]).isShort;
      if (isShort) count++;
      if (filter === "all" || isShort) {
        filtered.push(r as AttRow & Record<string, unknown>);
      }
    }
    return { shortsCount: count, filteredRows: filtered };
  }, [rows, visibleDetailsMap, filter]);

  const { setShorts } = shell;
  useEffect(() => setShorts(shortsCount), [shortsCount, setShorts]);

  const handleRefresh = async () => {
    if (refreshInProgress.current || isSyncing || refreshFeedback || isExpired) return;
    if (!isDefault) {
      showNotice("Only current semester updates", 2000);
      return;
    }

    const quota = getManualRefreshQuota(session);
    if (!quota.canRefresh) {
      setRefreshFeedback(true);
      showNotice(getRefreshQuotaNotice(quota), 3500);
      return;
    }
    if (shouldThrottleRefresh("attendance")) {
      showNotice("Please wait a few seconds to refresh", 2000);
      return;
    }

    const requestGeneration = getCacheGeneration();
    const current = () => pageIsLive.current && isCacheGenerationCurrent(requestGeneration) && getSessionStatus() !== "expired";
    refreshInProgress.current = true;
    recordRefreshAttempt("attendance");
    setRefreshError(null);
    setDetailSyncError(null);
    setQuotaNotice(null);
    setIsRefreshing(true);
    const baselineRows = rows;

    try {
      // Joins an automatic overview read if one is already pending. All callers
      // share its cache write, so a late older response cannot replace this one.
      const result = await runManualAttendanceRefresh({
        session, baselineRows, readOverview: att.refresh, isCurrent: current,
        checkpoint: manualCheckpoint.current,
        onDetail: (id, data) => setDetailsMap((prev) => ({ ...prev, [id]: data })),
        onProgress: (pending, done, total) => {
          setSyncingIds(pending);
          setSyncProgress({ done, total });
        },
      });
      if (!result) return;
      setRefreshQuota(result.quota);
      if (!result.changed) showNotice("Up to date with portal", 2500);
    } catch (err: unknown) {
      if (current()) setRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      refreshInProgress.current = false;
      if (pageIsLive.current) {
        setIsRefreshing(false);
        setSyncingIds(new Set());
        setSyncProgress({ done: 0, total: 0 });
      }
    }
  };

  const error = refreshError ?? att.error ?? detail.error ?? (isDefault ? detailSyncError : null);
  const isHardBlocked = isDefault && !refreshQuota.canRefresh && !error;
  const retry = refreshError ? () => handleRefresh() : att.error ? att.retry
    : detail.error ? detail.retry : () => setDetailSyncAttempt((attempt) => attempt + 1);

  const status = isSyncing ? (
    <span className="att-sync-pill is-syncing" role="status" aria-live="polite">
      <span className="att-sync-dot" aria-hidden="true" />
      <span>{syncProgress.total > 0 ? `Refreshing ${syncProgress.done}/${syncProgress.total}…` : "Refreshing…"}</span>
    </span>
  ) : quotaNotice ? (
    <span className="att-sync-pill att-sync-notice" role="status" aria-live="polite">{quotaNotice}</span>
  ) : lastSync ? (
    <span className="att-sync-pill">{formatLastSync(lastSync)}</span>
  ) : null;

  return (
    <div className="page att-page">
      <TopBar
        title="Attendance"
        subtitle={status}
        busy={isSyncing}
        onRefresh={() => void handleRefresh()}
        feedback={refreshFeedback}
        onFeedbackEnd={() => setRefreshFeedback(false)}
        refreshLabel="Refresh attendance"
        refreshTitle={
          isSyncing
            ? "Refreshing attendance…"
            : isHardBlocked
            ? getRefreshQuotaNotice(getManualRefreshQuota(session))
            : shouldThrottleRefresh("attendance") && lastSync
            ? formatLastSync(lastSync)
            : "Refresh attendance"
        }
      />

      <div className="page-body">
        {((shortsCount > 0 && rows.length > 0) || semesters.length > 1) && (
          <div className="page-toolbar">
            {shortsCount > 0 && rows.length > 0 && (
              <div className="segmented-pill-toggle att-filter" role="tablist" aria-label="Filter subjects">
                <button type="button" role="tab" aria-selected={filter === "all"} className={`segmented-pill ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
                  All {rows.length}
                </button>
                <button type="button" role="tab" aria-selected={filter === "short"} className={`segmented-pill ${filter === "short" ? "active" : ""}`} onClick={() => setFilter("short")}>
                  Short {shortsCount}
                </button>
              </div>
            )}
            <SemesterPicker semesters={semesters} value={semId} onChange={setSemId} disabled={loading || isSyncing} format={formatSemester} />
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
              const subId = rowSubId(r);
              const isSubjectSyncing = syncingIds.has(subId);
              const attInfo = combinedAttendance(r, visibleDetailsMap[subId]);
              const hasPercentage = attInfo.pctNum !== null;
              const hasDetail = isSubjectDetailComplete(r, visibleDetailsMap[subId]);

              return (
                <button
                  key={String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode ?? i)}
                  type="button"
                  className={`att-subject-row ${attInfo.isShort ? "is-short-row" : ""}`}
                  onClick={() => setSelectedSubject(r as AttRow & Record<string, unknown>)}
                  aria-label={`${name}, ${attInfo.pct} attendance`}
                >
                  <div className="att-subject-info">
                    <span className="att-subject-name">{name}</span>
                    <span className="att-subject-supporting">
                      {badge && <span className="att-code">{badge}</span>}
                      {badge && " · "}
                      {attInfo.totalClasses > 0 ? (
                        `${attInfo.totalPresent}/${attInfo.totalClasses} classes`
                      ) : !hasDetail || hasPercentage ? (
                        isSyncing ? "Loading classes…" : "Class details unavailable"
                      ) : (
                        "No classes yet"
                      )}
                      {isSubjectSyncing && (
                        <span className="att-count-syncing" role="status" aria-label="Updating class details">
                          <span className="sync-pulse-dot" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                  </div>
                  <span className={`att-row-pct ${hasPercentage ? attInfo.colorClass : "is-empty"}`}>
                    {hasPercentage ? (
                      <>{attInfo.pct.replace("%", "")}<span className="att-pct-sign">%</span></>
                    ) : "--"}
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
      {activeSelectedSubject && (
        <SubjectDetailSheet
          row={activeSelectedSubject}
          registrationid={sem?.registrationid}
          registrationcode={sem?.registrationcode}
          session={session}
          cachedDetail={visibleDetailsMap[subjectRowId(activeSelectedSubject)]}
          enabled={!att.refreshing && isCurrentPortalDay(att.updatedAt)}
          onDetailLoaded={handleDetailLoaded}
          onClose={() => setSelectedSubject(null)}
          onLogout={onLogout}
        />
      )}

    </div>
  );
}
