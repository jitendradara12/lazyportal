import { useState, useEffect } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, STALE_MS } from "../hooks/useFeature";
import { SectionError } from "./DataViews";
import type { Session } from "../types";
import {
  type AttRow,
  subjectName,
  combinedAttendance,
  computeBunkMargin,
  getColorClass,
  getSubjectCacheKey,
  CombinedClassLog,
} from "../sections/attendance";
import { WhatIfStepper } from "./WhatIfStepper";

export function SubjectDetailSheet({
  row,
  registrationid,
  registrationcode,
  session,
  onClose,
  onLogout: _onLogout,
}: {
  row: AttRow & Record<string, unknown>;
  registrationid?: string;
  registrationcode?: string;
  session: Session;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [target, setTarget] = useState<70 | 80 | 90>(70);
  const [attendCount, setAttendCount] = useState(0);
  const [missCount, setMissCount] = useState(0);

  const { name } = subjectName(row.subjectcode);
  const base = { registrationid, registrationcode };
  const cacheKey = getSubjectCacheKey(session.username, registrationid, row, session.instituteid);

  const detail = useFeature<Record<string, Record<string, unknown>>>({
    run: () => features.getSubjectAttendanceAll(client, session, row, base, "current"),
    deps: [session, registrationid, String(row.subjectid)],
    cacheKey,
    staleTimeMs: STALE_MS,
  });

  const attInfo = combinedAttendance(row, detail.data, target / 100);

  // Simulation calculations (supports attending X and leaving Y simultaneously)
  const totalSimPresent = attInfo.totalPresent + attendCount;
  const totalSimClasses = attInfo.totalClasses + attendCount + missCount;

  const simPctNum = totalSimClasses > 0 ? (totalSimPresent / totalSimClasses) * 100 : null;
  const simPct = simPctNum != null ? `${simPctNum.toFixed(1)}%` : attInfo.pct;
  const simColorClass = getColorClass(simPctNum);
  const simMargin = computeBunkMargin(totalSimPresent, totalSimClasses, target / 100);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(onClose, 220);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className={`att-sheet-backdrop ${isClosing ? "closing" : ""}`} onClick={handleClose} role="presentation">
      <div
        className={`att-sheet-card ${isClosing ? "closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="att-sheet-title"
      >
        {/* Mobile Drag Indicator Handle */}
        <div className="att-sheet-handle" aria-hidden="true" />

        {/* Sheet Header */}
        <div className="att-sheet-header">
          <h2 className="att-sheet-title" id="att-sheet-title">
            {name}
          </h2>
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
                {([70, 80, 90] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={target === t}
                    className={`segmented-pill ${target === t ? "active" : ""}`}
                    onClick={() => setTarget(t)}
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
          {!attInfo.hasHeldClasses && !detail.loading && (
            <div className="att-empty-held-card">
              <span className="att-empty-icon" aria-hidden="true">📋</span>
              <p>No classes held yet.</p>
            </div>
          )}
        </div>

        {/* Detailed Class History Log */}
        <div className="att-sheet-history-section">
          {detail.loading && !detail.data && <p className="muted">Loading class breakdown…</p>}
          {detail.error && !detail.data && (
            <SectionError label="Subject detail" error={detail.error} retry={detail.retry} />
          )}
          {detail.data && Object.keys(detail.data).length > 0 && (
            <div className="att-detail-grid">
              <CombinedClassLog data={detail.data} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
