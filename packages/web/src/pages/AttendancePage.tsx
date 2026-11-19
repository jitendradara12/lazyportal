import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from "react";
import { client, getRefreshThrottleMs, getSessionStatus } from "../lib/portal";
import { useFeature, sessionCacheKey, getCacheGeneration, isCacheGenerationCurrent } from "../hooks/useFeature";
import { SectionError, ListSkeleton, formatLastSync } from "../components/DataViews";
import { SubjectDetailSheet } from "../lazy";
import { selectionHaptic } from "../lib/nativeInteractions";
import { TopBar } from "../components/AppBar";
import { useShell } from "../hooks/useShell";
import { AppUpdatePromptBanner } from "../components/AppUpdatePromptBanner";
import { useTabRefresh } from "../hooks/useAlerts";
import {
  isCurrentPortalDay,
  doesSubjectNeedDeepFetch,
  subscribePortalDayRollover,
  shouldThrottleRefresh,
  recordRefreshAttempt,
  REFRESH_THROTTLE_MS,
} from "../lib/portalSchedule";
import type { Session } from "../types";
import {
  type AttData,
  type AttRow,
  combinedAttendance,
  isSubjectDetailComplete,
  rowSubId,
  subjectName,
} from "../lib/attendanceCalc";
import { TargetFab } from "../components/TargetFab";
import { useDefaultAttendanceTarget } from "../hooks/useDefaultAttendanceTarget";
import {
  getCachedSubjectDetailEntry,
  getSubjectCacheKey,
  idleAttendanceSync,
  readAttendanceOverview,
  runManualAttendanceRefresh,
  syncAttendanceDetails,
} from "../lib/attendanceSync";

export function AttendancePage({
  session,
  isExpired,
  onLogout,
  onOpenMore,
}: {
  session: Session;
  isExpired?: boolean;
  isRecovering?: boolean;
  onLogout: () => void;
  onOpenMore?: () => void;
}) {
  const shell = useShell();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [detailSyncError, setDetailSyncError] = useState<string | null>(null);
  const [detailSyncAttempt, setDetailSyncAttempt] = useState(0);
  const [manualRefreshSeq, setManualRefreshSeq] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const detailUpdatedAtRef = useRef<Record<string, number>>({});
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (msg: string, ms: number) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = setTimeout(() => {
      if (pageIsLive.current) setNotice(null);
    }, ms);
  };
  const manualController = useRef<AbortController | null>(null);
  const lastRefreshAttempt = useRef({ key: "", at: 0 });
  const refreshKey = sessionCacheKey("refresh.attendance", session);
  const activeRefreshKey = useRef(refreshKey);
  activeRefreshKey.current = refreshKey;
  const pageIsLive = useRef(true);
  const [syncState, setSyncState] = useState(idleAttendanceSync);
  const syncingHistory = syncState.phase === "running" || syncState.phase === "paused";
  const [selectedSubject, setSelectedSubject] = useState<(AttRow & Record<string, unknown>) | null>(null);
  const [filter, setFilter] = useState<"all" | "short">("all");
  const [defaultTarget] = useDefaultAttendanceTarget();
  const [throttleMs, setThrottleMs] = useState<number>(REFRESH_THROTTLE_MS);

  useEffect(() => {
    pageIsLive.current = true;
    let active = true;
    void getRefreshThrottleMs("attendance").then((ms) => {
      if (active) setThrottleMs(ms);
    });
    const unsubscribeRollover = subscribePortalDayRollover(() => {});
    return () => {
      active = false;
      pageIsLive.current = false;
      unsubscribeRollover();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
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

  const att = useFeature<AttData>({
    run: (signal) => readAttendanceOverview(session, signal),
    deps: [session],
    cacheKey: sessionCacheKey("att.initial", session),
    isFresh: isCurrentPortalDay,
  });
  const initial = att.data;
  const sem = initial?.semesters?.[0] ?? null;
  const semId = sem?.registrationid != null ? String(sem.registrationid) : null;
  useEffect(() => {
    setIsRefreshing(false);
    setRefreshError(null);
    setDetailSyncError(null);
    setSyncState(idleAttendanceSync());
    detailUpdatedAtRef.current = {};
    return () => {
      manualController.current?.abort();
      manualController.current = null;
    };
  }, [refreshKey]);
  useEffect(() => {
    detailUpdatedAtRef.current = {};
  }, [semId]);
  const lastSemRef = useRef(`${session.username}:${session.instituteid ?? "default"}:${semId}`);

  const attUpdatedAtRef = useRef(att.updatedAt);
  attUpdatedAtRef.current = att.updatedAt;
  useEffect(() => {
    const onRefreshAttendance = (event: Event) => {
      const force = (event as CustomEvent<{ force?: boolean }>).detail?.force === true;
      if (force || !isCurrentPortalDay(attUpdatedAtRef.current)) {
        att.retry();
      }
    };
    window.addEventListener("juet:refresh-attendance", onRefreshAttendance);
    return () => window.removeEventListener("juet:refresh-attendance", onRefreshAttendance);
  }, [att.retry]);

  useTabRefresh("attendance", () => {
    att.retry();
  });

  const rows = initial?.rows ?? [];
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const loading = att.loading;

  // Cache-backed map of subject details for accurate L+T aggregation
  const [detailsMap, setDetailsMap] = useState<Record<string, Record<string, unknown>>>(() => {
    const map: Record<string, Record<string, unknown>> = {};
    for (const r of rows) {
      const cached = getCachedSubjectDetailEntry(session.username ?? "", semId, r, session.instituteid).data;
      if (cached) {
        map[rowSubId(r)] = cached;
      }
    }
    return map;
  });

  // Read scoped cache entries so counts survive revalidation without carrying
  // another semester's in-memory data into the current overview.
  const subjectStates = useMemo(() => {
    const states: Record<string, {
      data: Record<string, Record<string, unknown>> | null;
      saved: boolean;
      attendance: ReturnType<typeof combinedAttendance>;
    }> = {};
    for (const row of rows) {
      const id = rowSubId(row);
      const entry = getCachedSubjectDetailEntry(session.username ?? "", semId, row, session.instituteid);
      const saved = Boolean(entry.data) && (entry.provisional || doesSubjectNeedDeepFetch(row, entry.data, entry.updatedAt, entry.checksum, Date.now(), entry.provisional));
      states[id] = { data: entry.data, saved, attendance: combinedAttendance(row, entry.data, defaultTarget / 100, saved) };
    }
    return states;
  }, [rows, detailsMap, session, semId, defaultTarget]);

  const activeSelectedSubject = useMemo(() => {
    if (!selectedSubject) return null;
    const subId = rowSubId(selectedSubject);
    const found = rows.find((r) => rowSubId(r) === subId);
    return (found as (AttRow & Record<string, unknown>) | undefined) ?? selectedSubject;
  }, [selectedSubject, rows]);

  const handleDetailLoaded = useCallback(
    (subId: string, data: Record<string, Record<string, unknown>>, loadedUpdatedAt?: number | null) => {
      const entry = getCachedSubjectDetailEntry(
        session.username ?? "",
        semId,
        subId,
        session.instituteid,
      );
      if (entry.updatedAt && loadedUpdatedAt && entry.updatedAt > loadedUpdatedAt && entry.data !== data) {
        return;
      }
      if (loadedUpdatedAt) {
        detailUpdatedAtRef.current[subId] = Math.max(detailUpdatedAtRef.current[subId] ?? 0, loadedUpdatedAt);
      }
      setDetailsMap((prev) => (prev[subId] === data ? prev : { ...prev, [subId]: data }));
    },
    [session.username, semId, session.instituteid],
  );

  // Sync detailsMap if a subject read finishes after SubjectDetailSheet closes.
  const activeRegId = sem?.registrationid ?? semId;
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    const prefix = `${sessionCacheKey("att.subject", sessionRef.current, activeRegId)}:`;
    const onCacheUpdated = (event: Event) => {
      if (!pageIsLive.current) return;
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (typeof key !== "string" || !key.startsWith(prefix)) return;
      const currentSession = sessionRef.current;
      const matched = rowsRef.current.find(
        (r) => getSubjectCacheKey(currentSession.username ?? "", activeRegId, r, currentSession.instituteid) === key,
      );
      if (!matched) return;
      const subId = rowSubId(matched);
      const entry = getCachedSubjectDetailEntry(currentSession.username ?? "", activeRegId, matched, currentSession.instituteid);
      if (!entry.data) return;
      const prevUpdatedAt = detailUpdatedAtRef.current[subId] ?? 0;
      if (entry.updatedAt && prevUpdatedAt && entry.updatedAt < prevUpdatedAt) return;
      if (entry.updatedAt) detailUpdatedAtRef.current[subId] = entry.updatedAt;
      setDetailsMap((prev) => (prev[subId] === entry.data ? prev : { ...prev, [subId]: entry.data! }));
    };
    window.addEventListener("juet:cache-updated", onCacheUpdated);
    return () => window.removeEventListener("juet:cache-updated", onCacheUpdated);
  }, [session.username, session.enrollmentno, session.instituteid, activeRegId]);

  useEffect(() => {
    if (isExpired) {
      setIsRefreshing(false);
      setSyncState(idleAttendanceSync());
    }
  }, [isExpired]);

  // Wait for today's overview before fetching logs, otherwise the old row
  // checksum can launch a second wave of identical reads when it is replaced.
  useEffect(() => {
    if (!rows.length || isExpired || isRefreshing || manualController.current ||
      att.refreshing || !isCurrentPortalDay(att.updatedAt) || refreshError) {
      if (!manualController.current) setSyncState((previous) => previous.phase === "idle" ? previous : idleAttendanceSync());
      return;
    }
    const currentSession = sessionRef.current;
    setDetailSyncError(null);
    const generation = getCacheGeneration();
    let active = true;
    const controller = new AbortController();
    const current = () => active && pageIsLive.current && isCacheGenerationCurrent(generation) && getSessionStatus() !== "expired";
    const currentMap: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      const entry = getCachedSubjectDetailEntry(currentSession.username ?? "", semId, row, currentSession.instituteid);
      if (entry.data) currentMap[rowSubId(row)] = entry.data;
    }
    const key = `${currentSession.username}:${currentSession.instituteid ?? "default"}:${semId}`;
    const changedSemester = lastSemRef.current !== key;
    lastSemRef.current = key;
    setDetailsMap((prev) => changedSemester ? currentMap : { ...prev, ...currentMap });

    void syncAttendanceDetails({
      session: currentSession,
      rows,
      overviewUpdatedAt: att.updatedAt,
      base: { registrationid: sem?.registrationid, registrationcode: sem?.registrationcode },
      isCurrent: current,
      signal: controller.signal,
      onDetail: (id, data) => setDetailsMap((prev) => ({ ...prev, [id]: data })),
      onProgress: setSyncState,
    }).then((result) => {
      if (current() && !result.complete) setDetailSyncError("Some class details could not be updated. Retry to load the remaining subjects.");
    });
    return () => { active = false; controller.abort(); };
  }, [
    rows,
    semId,
    session.username,
    session.enrollmentno,
    session.instituteid,
    sem?.registrationid,
    sem?.registrationcode,
    isExpired,
    isRefreshing,
    manualRefreshSeq,
    refreshError,
    att.refreshing,
    att.updatedAt,
    detailSyncAttempt,
  ]);

  const isSyncing = !isExpired && (isRefreshing || loading || att.refreshing || syncingHistory);

  const attRetryInDispatchRef = useRef(false);
  const triggerAttRetry = useCallback(() => {
    if (attRetryInDispatchRef.current) return;
    attRetryInDispatchRef.current = true;
    Promise.resolve().then(() => {
      attRetryInDispatchRef.current = false;
    });
    att.retry();
  }, [att.retry]);

  const wasHiddenRef = useRef(typeof document !== "undefined" && document.visibilityState !== "visible");
  useEffect(() => {
    if (!att.error && !detailSyncError) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      wasHiddenRef.current = true;
    }
  }, [att.error, detailSyncError]);

  const resumeRef = useRef<() => void>(() => {});
  resumeRef.current = () => {
    if (!pageIsLive.current) return;
    if (isExpired || isSyncing || manualController.current) return;
    if (getSessionStatus() === "expired") return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (refreshError) return;

    if (att.error) {
      triggerAttRetry();
      return;
    }

    if (!isCurrentPortalDay(att.updatedAt)) return;

    const currentSession = sessionRef.current;
    const needsDeepFetch = rows.some((row) => {
      const entry = getCachedSubjectDetailEntry(currentSession.username ?? "", semId, row, currentSession.instituteid);
      return doesSubjectNeedDeepFetch(row, entry.data, entry.updatedAt, entry.checksum, Date.now(), entry.provisional);
    });
    if (detailSyncError || needsDeepFetch) {
      setDetailSyncError(null);
      setDetailSyncAttempt((attempt) => attempt + 1);
    }
  };

  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") {
        wasHiddenRef.current = true;
        return;
      }
      if (!wasHiddenRef.current) return;
      wasHiddenRef.current = false;
      resumeRef.current();
    };
    const onOnline = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        wasHiddenRef.current = true;
        return;
      }
      resumeRef.current();
    };
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", onOnline);
    }
    return () => {
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("online", onOnline);
      }
    };
  }, []);

  // Single-pass short-count + filter for cheap mobile renders.
  const { shortsCount, filteredRows } = useMemo(() => {
    let count = 0;
    const filtered: (AttRow & Record<string, unknown>)[] = [];
    for (const r of rows) {
      const subId = rowSubId(r);
      const isShort = subjectStates[subId].attendance.isShort;
      if (isShort) count++;
      if (filter === "all" || isShort) {
        filtered.push(r as AttRow & Record<string, unknown>);
      }
    }
    return { shortsCount: count, filteredRows: filtered };
  }, [rows, subjectStates, filter]);

  const { setShorts } = shell;
  useEffect(() => setShorts(shortsCount), [shortsCount, setShorts]);

  const handleRefresh = async () => {
    if (manualController.current || isSyncing || isExpired || shell.isRecovering || navigator.onLine === false) return;

    const controller = new AbortController();
    manualController.current = controller;
    const requestGeneration = getCacheGeneration();
    const current = () => !controller.signal.aborted && pageIsLive.current && activeRefreshKey.current === refreshKey && isCacheGenerationCurrent(requestGeneration) && getSessionStatus() !== "expired";
    try {
      const cooldownMs = await getRefreshThrottleMs("attendance");
      if (pageIsLive.current) setThrottleMs(cooldownMs);
      if (!current()) return;
      if (shouldThrottleRefresh(refreshKey, cooldownMs) ||
          (lastRefreshAttempt.current.key === refreshKey && Date.now() - lastRefreshAttempt.current.at < cooldownMs)) {
        showNotice("Please wait a few seconds to refresh", 2000);
        return;
      }

      selectionHaptic();
      recordRefreshAttempt(refreshKey);
      lastRefreshAttempt.current = { key: refreshKey, at: Date.now() };
      setRefreshError(null);
      setDetailSyncError(null);
      setNotice(null);
      setIsRefreshing(true);
      setSyncState(idleAttendanceSync());
      const baselineRows = rows;

      // Joins an automatic overview read if one is already pending. All callers
      // share its cache write, so a late older response cannot replace this one.
      const result = await runManualAttendanceRefresh({
        session,
        baselineRows,
        readOverview: att.refresh,
        isCurrent: current,
        signal: controller.signal,
        onDetail: (id, data) => setDetailsMap((prev) => ({ ...prev, [id]: data })),
        onProgress: setSyncState,
      });
      if (!result) return;
      if (!result.changed && !result.provisional) showNotice("Up to date with portal", 2500);
    } catch (err: unknown) {
      if (current()) setRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      if (manualController.current === controller) {
        manualController.current = null;
        if (pageIsLive.current) {
          setIsRefreshing(false);
          setManualRefreshSeq((n) => n + 1);
          setSyncState(idleAttendanceSync());
        }
      }
    }
  };

  const error = refreshError ?? att.error ?? detailSyncError;
  const retry = refreshError ? () => handleRefresh() : att.error ? triggerAttRetry
    : () => setDetailSyncAttempt((attempt) => attempt + 1);

  const status = isSyncing ? (
    <span className="att-sync-pill is-syncing" role="status" aria-live="polite">
      <span className="att-sync-dot" aria-hidden="true" />
      <span>{syncState.total > 0 ? `Refreshing ${syncState.done}/${syncState.total}…` : "Refreshing…"}</span>
    </span>
  ) : notice ? (
    <span className="att-sync-pill att-sync-notice" role="status" aria-live="polite">{notice}</span>
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
        refreshLabel="Refresh attendance"
        refreshTitle={
          isSyncing
            ? "Refreshing attendance…"
            : shouldThrottleRefresh(refreshKey, throttleMs) && lastSync
            ? formatLastSync(lastSync)
            : "Refresh attendance"
        }
      />

      <div className="page-body">
        <AppUpdatePromptBanner onOpenMore={onOpenMore} />
        {rows.length > 0 && (
          <div className="page-toolbar">
            <TargetFab />
            {shortsCount > 0 && (
              <div className="segmented-pill-toggle att-filter" role="tablist" aria-label="Filter subjects">
                <button type="button" role="tab" aria-selected={filter === "all"} className={`segmented-pill ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
                  All {rows.length}
                </button>
                <button type="button" role="tab" aria-selected={filter === "short"} className={`segmented-pill ${filter === "short" ? "active" : ""}`} onClick={() => setFilter("short")}>
                  Short {shortsCount}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Subject List Items */}
        <section className="att-list" aria-label="Subject list">
          {loading && filteredRows.length === 0 && (
            <ListSkeleton rows={5} label="Loading attendance records…" />
          )}

          {filteredRows.length > 0 &&
            filteredRows.map((r, i) => {
              const { name, badge } = subjectName(r.subjectcode);
              const subId = rowSubId(r);
              const isSubjectSyncing = syncingHistory && syncState.pending.has(subId);
              const subject = subjectStates[subId];
              const attInfo = subject.attendance;
              const hasPercentage = attInfo.pctNum !== null;
              const hasDetail = isSubjectDetailComplete(r, subject.data);

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
                      {attInfo.totalClasses > 0 ? (
                        <>
                          <span>{`${subject.saved ? "Saved " : ""}${attInfo.totalPresent}/${attInfo.totalClasses} classes`}</span>
                          {attInfo.margin.text && (
                            <span className="att-row-margin">
                              <span className="att-proj-sep" aria-hidden="true">·</span>
                              <span className={attInfo.margin.type === "attend" ? "att-margin-need" : "att-margin-bunk"}>
                                {attInfo.margin.type === "bunk" && attInfo.margin.count > 0
                                  ? `Can bunk ${attInfo.margin.count}`
                                  : attInfo.margin.text}
                              </span>
                            </span>
                          )}
                        </>
                      ) : !hasDetail || hasPercentage ? (
                        isSyncing ? "Loading classes…" : (badge ? <span className="att-code">{badge}</span> : "Tap for history")
                      ) : (
                        "No attendance recorded"
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

          {error && <SectionError label="Attendance" error={error} retry={retry} autoRetry={!refreshError} />}
        </section>
      </div>

      {/* Slide-over sheet for detailed history */}
      {activeSelectedSubject && (
        <Suspense fallback={null}>
          <SubjectDetailSheet
            row={activeSelectedSubject}
            registrationid={sem?.registrationid}
            registrationcode={sem?.registrationcode}
            session={session}
            cachedDetail={subjectStates[rowSubId(activeSelectedSubject)]?.data ?? undefined}
            onDetailLoaded={handleDetailLoaded}
            onClose={() => setSelectedSubject(null)}
            onLogout={onLogout}
          />
        </Suspense>
      )}

    </div>
  );
}
