import { useState, useEffect, useRef, useCallback, useContext, type PointerEvent } from "react";
import { SectionError } from "./DataViews";
import type { Session } from "../types";
import {
  type AttRow,
  subjectName,
  subjectRowId,
  getCachedSubjectDetailEntry,
  useSubjectDetail,
  CombinedClassLog,
} from "../sections/attendance";
import {
  combinedAttendance,
  computeBunkMargin,
  getColorClass,
  isSubjectDetailComplete,
} from "../lib/attendanceCalc";
import {
  doesSubjectNeedDeepFetch,
} from "../lib/portalSchedule";
import { WhatIfStepper } from "./WhatIfStepper";
import { BackScope, useAppBack } from "../hooks/useAppBack";
import { ATTENDANCE_TARGETS, useDefaultAttendanceTarget, type AttendanceTarget } from "../hooks/useDefaultAttendanceTarget";
import { selectionHaptic } from "../lib/nativeInteractions";
import { getSessionStatus, onSessionStatus } from "../lib/portal";
import { pauseAttendanceSync } from "../lib/attendanceSync";
import { SLOW_PORTAL_MESSAGE, useSlowRequest } from "../hooks/useSlowRequest";

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
  const pending = detail.loading || detail.refreshing;
  useEffect(() => {
    if (visible && pending) return pauseAttendanceSync();
  }, [visible, pending]);

  const onDetailLoadedRef = useRef(onDetailLoaded);
  const slow = useSlowRequest(pending);
  onDetailLoadedRef.current = onDetailLoaded;

  useEffect(() => {
    if (detail.data && onDetailLoadedRef.current) {
      const subId = subjectRowId(row);
      onDetailLoadedRef.current(subId, detail.data, detail.updatedAt);
    }
  }, [detail.data, detail.updatedAt, row]);

  const entry = getCachedSubjectDetailEntry(session.username, registrationid, row, session.instituteid);
  const activeDetail = detail.data ?? cachedDetail ?? entry.data;
  const savedBreakdown = Boolean(activeDetail) && doesSubjectNeedDeepFetch(row, activeDetail, entry.updatedAt, entry.checksum);
  const attInfo = combinedAttendance(row, activeDetail, target / 100, savedBreakdown);
  const emptyHistory = !attInfo.hasHeldClasses && attInfo.pctNum === null && isSubjectDetailComplete(row, activeDetail);

  // Simulation calculations (supports attending X and leaving Y simultaneously)
  const totalSimPresent = attInfo.totalPresent + attendCount;
  const totalSimClasses = attInfo.totalClasses + attendCount + missCount;

  const simPctNum = totalSimClasses > 0 ? (totalSimPresent / totalSimClasses) * 100 : null;
  const simPct = simPctNum != null ? `${simPctNum.toFixed(1)}%` : attInfo.pct;
  const simColorClass = getColorClass(simPctNum);
  const simMargin = computeBunkMargin(totalSimPresent, totalSimClasses, target / 100);

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
      setDragOffset(distance);
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
        {/* Mobile Drag Indicator Handle */}
        <div
          className="att-sheet-handle"
          aria-hidden="true"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
        ><span /></div>

        {/* Sheet Header */}
        <div className="att-sheet-header">
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
                <span className="att-sheet-ratio-label">classes attended</span>
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
              attendCount={attendCount}
              missCount={missCount}
              onAttendChange={setAttendCount}
              onMissChange={setMissCount}
              onReset={() => {
                setAttendCount(0);
                setMissCount(0);
              }}
              projectedPct={simPct}
              projectedColorClass={simColorClass}
              projectedRatio={{ present: totalSimPresent, total: totalSimClasses }}
              margin={simMargin}
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
