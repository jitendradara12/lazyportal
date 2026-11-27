import { useState, useEffect, useMemo, useRef, useCallback, useContext, type PointerEvent } from "react";
import { SectionError, parseIndianDateTime } from "./DataViews";
import type { Session } from "../types";
import {
  type AttRow,
  type ClassRecord,
  cleanDateTime,
  combinedAttendance,
  isSubjectDetailComplete,
  parseClassLogs,
  rowSubId,
  simulateAttendance,
  subjectName,
} from "../lib/attendanceCalc";
import {
  computeSubjectRowChecksum,
  doesSubjectNeedDeepFetch,
} from "../lib/portalSchedule";
import { WhatIfStepper } from "./WhatIfStepper";
import { BackScope, useAppBack } from "../hooks/useAppBack";
import { ATTENDANCE_TARGETS, useDefaultAttendanceTarget, type AttendanceTarget } from "../hooks/useDefaultAttendanceTarget";
import { selectionHaptic } from "../lib/nativeInteractions";
import { getSessionStatus, onSessionStatus } from "../lib/portal";
import {
  detailMetadata,
  getCachedSubjectDetailEntry,
  getSubjectCacheKey,
  pauseAttendanceSync,
  readSubjectDetail,
  subjectDetailRequest,
  validSubjectComponent,
} from "../lib/attendanceSync";
import { getCached, useFeature } from "../hooks/useFeature";
import { SLOW_PORTAL_MESSAGE, useSlowRequest } from "../hooks/useSlowRequest";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatClassDateTime(dt?: string): string {
  if (!dt) return "—";
  const ms = parseIndianDateTime(dt);
  if (!ms) return cleanDateTime(dt);
  const d = new Date(ms);
  const day = d.getDate();
  const month = MONTH_NAMES[d.getMonth()];
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const minStr = minutes < 10 ? `0${minutes}` : String(minutes);
  return `${day} ${month}, ${hours}:${minStr} ${ampm}`;
}

export function CombinedClassLog({
  data,
}: {
  data: Record<string, unknown>;
}) {
  const [filter, setFilter] = useState<"all" | "absent" | "present">("all");

  const { total, attended, absent, allClasses } = useMemo(() => {
    const parsedEntries = Object.entries(data)
      .map(([type, raw]) => ({ type, stats: parseClassLogs(raw, type) }))
      .filter((item): item is { type: string; stats: NonNullable<ReturnType<typeof parseClassLogs>> } => item.stats !== null);

    let tot = 0;
    let att = 0;
    const classes: { record: ClassRecord; ts: number }[] = [];

    for (const { stats } of parsedEntries) {
      tot += stats.total;
      att += stats.attended;
      for (const c of stats.classes) {
        classes.push({ record: c, ts: parseIndianDateTime(c.datetime) ?? 0 });
      }
    }

    classes.sort((a, b) => b.ts - a.ts);

    return {
      total: tot,
      attended: att,
      absent: tot - att,
      allClasses: classes.map((item) => item.record),
    };
  }, [data]);

  if (total === 0 && allClasses.length === 0) {
    return <p className="muted">No class records available.</p>;
  }

  const filtered = allClasses.filter((c) => {
    if (filter === "absent") return !c.isAttended;
    if (filter === "present") return c.isAttended;
    return true;
  });

  return (
    <div className="att-comp-box" onClick={(e) => e.stopPropagation()}>
      {allClasses.length > 0 && (
        <>
          <div className="filter-chips">
            <button
              type="button"
              className={`chip-btn ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All ({total})
            </button>
            {absent > 0 && (
              <button
                type="button"
                className={`chip-btn chip-absent ${filter === "absent" ? "active" : ""}`}
                onClick={() => setFilter("absent")}
              >
                Absent ({absent})
              </button>
            )}
            <button
              type="button"
              className={`chip-btn ${filter === "present" ? "active" : ""}`}
              onClick={() => setFilter("present")}
            >
              Present ({attended})
            </button>
          </div>

          <div className="att-log-list" role="list">
            {filtered.map((c, i) => (
              <div
                key={i}
                className={`att-log-row ${c.isAttended ? "row-present" : "row-absent"}`}
                role="listitem"
              >
                <div className="att-log-info">
                  <span className="att-log-date">{formatClassDateTime(c.datetime)}</span>
                  {c.type && <span className="att-log-type-tag">{c.type}</span>}
                </div>
                <span className={`log-badge ${c.isAttended ? "present" : "absent"}`}>
                  {c.isAttended ? "Present" : "Absent"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Full saved history stays visible; a first load can show completed components. */
export function useSubjectDetail(
  session: Session,
  row: AttRow & Record<string, unknown>,
  base: { registrationid?: string | null; registrationcode?: string | null },
) {
  const checksum = computeSubjectRowChecksum(row);
  const { key, snapshot, portalDay, version } = subjectDetailRequest(session, row, base);
  const validation = { provisional: false };
  const [, updateProgress] = useState(0);
  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === key) updateProgress((n) => n + 1);
    };
    window.addEventListener("juet:cache-updated", update);
    return () => window.removeEventListener("juet:cache-updated", update);
  }, [key]);
  const detail = useFeature<Record<string, Record<string, unknown>>>({
    run: (signal) => readSubjectDetail(session, row, base, signal, () => { validation.provisional = true; }),
    deps: [session, base.registrationid, base.registrationcode, rowSubId(row), checksum],
    cacheKey: getSubjectCacheKey(session.username ?? "", base.registrationid, row, session.instituteid),
    requestVersion: version,
    isFresh: () => {
      const entry = getCachedSubjectDetailEntry(session.username ?? "", base.registrationid, row, session.instituteid);
      return !doesSubjectNeedDeepFetch(row, entry.data, entry.updatedAt, entry.checksum, Date.now(), entry.provisional);
    },
    writeExtra: () => detailMetadata(row, base, validation.provisional),
  });
  const progress = getCached<Record<string, Record<string, unknown>>>(key);
  const partial = useMemo(() => progress.snapshot === snapshot && progress.portalDay === portalDay
    ? Object.fromEntries(Object.entries(progress.data ?? {}).filter((entry) => validSubjectComponent(row, entry as [string, Record<string, unknown>]))) : {},
  [progress.data, progress.snapshot, progress.portalDay, snapshot, portalDay, row]);
  return { ...detail, data: detail.data ?? (Object.keys(partial).length ? partial : null) };
}

export function SubjectDetailSheet({
  row,
  registrationid,
  registrationcode,
  session,
  cachedDetail,
  onDetailLoaded,
  onClose,
  onLogout: _onLogout,
}: {
  row: AttRow & Record<string, unknown>;
  registrationid?: string;
  registrationcode?: string;
  session: Session;
  cachedDetail?: Record<string, Record<string, unknown>>;
  onDetailLoaded?: (subId: string, data: Record<string, Record<string, unknown>>, updatedAt?: number | null) => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const drag = useRef<{ pointerId: number; startY: number; startedAt: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [defaultTarget] = useDefaultAttendanceTarget();
  const [target, setTarget] = useState<AttendanceTarget>(defaultTarget);
  const [attendCount, setAttendCount] = useState(0);
  const [missCount, setMissCount] = useState(0);
  const [sessionStatus, setSessionStatus] = useState(getSessionStatus);
  useEffect(() => {
    const unsubscribe = onSessionStatus(setSessionStatus);
    setSessionStatus(getSessionStatus());
    return unsubscribe;
  }, []);
  const visible = useContext(BackScope);

  const { name, badge } = subjectName(row.subjectcode);
  const rawCode = row.individualsubjectcode ? String(row.individualsubjectcode).trim() : "";
  const sheetCode = badge || (rawCode && rawCode.toLowerCase() !== name.toLowerCase() ? rawCode : "");
  const base = { registrationid, registrationcode };
  const detail = useSubjectDetail(session, row, base);
  const entry = getCachedSubjectDetailEntry(session.username ?? "", registrationid, row, session.instituteid);
  const needsFetch = doesSubjectNeedDeepFetch(row, entry.data, entry.updatedAt, entry.checksum, Date.now(), entry.provisional);
  const pending = detail.loading || detail.refreshing || (!detail.error && needsFetch);
  useEffect(() => {
    if (visible && pending) return pauseAttendanceSync();
  }, [visible, pending]);

  const onDetailLoadedRef = useRef(onDetailLoaded);
  const slow = useSlowRequest(pending);
  onDetailLoadedRef.current = onDetailLoaded;

  useEffect(() => {
    if (detail.data && onDetailLoadedRef.current) {
      const subId = rowSubId(row);
      onDetailLoadedRef.current(subId, detail.data, detail.updatedAt);
    }
  }, [detail.data, detail.updatedAt, row]);

  const activeDetail = detail.data ?? cachedDetail ?? entry.data;
  const savedBreakdown = Boolean(activeDetail) && (entry.provisional || doesSubjectNeedDeepFetch(row, activeDetail, entry.updatedAt, entry.checksum, Date.now(), entry.provisional));
  const attInfo = combinedAttendance(row, activeDetail, target / 100, savedBreakdown);
  const emptyHistory = !attInfo.hasHeldClasses && attInfo.pctNum === null && isSubjectDetailComplete(row, activeDetail);

  // Simulation calculations (supports future + and past correction - deltas)
  const sim = simulateAttendance(attInfo.totalPresent, attInfo.totalClasses, attendCount, missCount, target / 100);

  const handleClose = useCallback(() => {
    if (closeTimer.current !== null) return;
    setIsClosing(true);
    closeTimer.current = setTimeout(onClose, 220);
  }, [onClose]);

  useAppBack(true, handleClose);

  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || isClosing ||
        (event.target as HTMLElement)?.closest?.("button") ||
        window.matchMedia("(min-width: 640px)").matches) return;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startedAt: event.timeStamp };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    setDragOffset(Math.max(0, event.clientY - drag.current.startY));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.current.startY);
    const speed = distance / Math.max(1, event.timeStamp - drag.current.startedAt);
    drag.current = null;
    setIsDragging(false);
    if (distance >= 96 || (distance >= 24 && speed > 0.65)) {
      setDragOffset(Math.max(distance, 600));
      handleClose();
    } else {
      setDragOffset(0);
    }
  };

  const cancelDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setIsDragging(false);
    setDragOffset(0);
  };

  const dragHandlers = {
    onPointerDown: startDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
    onLostPointerCapture: cancelDrag,
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  return (
    <div className={`att-sheet-backdrop ${isClosing ? "closing" : ""}`} onClick={handleClose} role="presentation">
      <div
        className={`att-sheet-card ${isClosing ? "closing" : ""} ${isDragging ? "dragging" : ""}`}
        style={{ translate: `0 ${dragOffset}px` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="att-sheet-title"
      >
        <div className="att-sheet-top">
          {/* Mobile Drag Indicator Handle */}
          <div className="att-sheet-handle" aria-hidden="true" {...dragHandlers}><span /></div>

          {/* Sheet Header */}
          <div className="att-sheet-header" {...dragHandlers}>
            <div className="att-sheet-title-group">
              <h2 className="att-sheet-title" id="att-sheet-title">
                {name}
              </h2>
              {sheetCode && <span className="att-code att-sheet-code">{sheetCode}</span>}
            </div>
            <button
              type="button"
              className="auth-close-btn"
              onClick={handleClose}
              aria-label="Close subject details"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Hero KPI Summary inside Sheet */}
        <div className="att-sheet-kpi-card">
          <div className="att-sheet-kpi-main">
            <div className="att-sheet-score-group">
              <span className={`att-sheet-score ${attInfo.colorClass}`}>
                {attInfo.pct}
              </span>
              <span className="att-sheet-kpi-label">overall attendance</span>
            </div>
            {attInfo.totalClasses > 0 && (
              <div className="att-sheet-ratio-group">
                <span className="att-sheet-ratio-val">
                  <strong>{attInfo.totalPresent}</strong> / {attInfo.totalClasses}
                </span>
                <span className="att-sheet-ratio-label">{savedBreakdown ? "saved classes attended" : "classes attended"}</span>
              </div>
            )}
          </div>

          {/* Interactive Target Selector & Actionable Advice in Same Compact Row */}
          {attInfo.hasHeldClasses && (
            <div className="att-target-row">
              {attInfo.margin.text ? (
                <div className={`att-advice-inline ${attInfo.margin.type}`}>
                  <span>{attInfo.margin.text}</span>
                </div>
              ) : <div />}

              <div className="segmented-pill-toggle att-target-toggle" role="radiogroup" aria-label="Target percentage">
                {ATTENDANCE_TARGETS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={target === t}
                    className={`segmented-pill ${target === t ? "active" : ""}`}
                    onClick={() => { if (target !== t) { selectionHaptic(); setTarget(t); } }}
                  >
                    {t}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Interactive What-If Simulator (M3 Expressive) */}
          {attInfo.hasHeldClasses && (
            <WhatIfStepper
              attendCount={sim.attendCount}
              missCount={sim.missCount}
              minAttend={sim.minAttend}
              minMiss={sim.minMiss}
              onAttendChange={setAttendCount}
              onMissChange={setMissCount}
              onReset={() => {
                setAttendCount(0);
                setMissCount(0);
              }}
              projectedPct={sim.pct}
              projectedColorClass={sim.colorClass}
              projectedRatio={{ present: sim.totalPresent, total: sim.totalClasses }}
              margin={sim.margin}
            />
          )}

          {/* Empty state when no classes held yet */}
          {emptyHistory && !detail.loading && !detail.error && (
            <div className="att-empty-held-card">
              <span className="att-empty-icon" aria-hidden="true">📋</span>
              <p>No attendance recorded for this subject.</p>
            </div>
          )}
        </div>

        {/* Detailed Class History Log */}
        <div className="att-sheet-history-section">
          {(detail.loading || detail.refreshing) && (
            <>
              <p className="muted" role="status">
                {sessionStatus === "recovering" ? "Reconnecting to JUET's portal…"
                  : slow ? SLOW_PORTAL_MESSAGE
                  : activeDetail ? "Updating breakdown…" : "Loading class breakdown…"}
              </p>
              {!activeDetail && (
                <div className="m3-skeleton-list" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="m3-skeleton-row is-compact">
                      <div className="m3-skeleton-main">
                        <span className="m3-skeleton-bar is-title" style={{ width: `${56 - (i % 2) * 12}%` }} />
                      </div>
                      <span className="m3-skeleton-pill" />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {detail.error && (
            <SectionError label="Subject detail" error={detail.error} retry={detail.retry} />
          )}
          {activeDetail && !emptyHistory && (
            <div className="att-detail-grid">
              <CombinedClassLog data={activeDetail} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
