import { useState, useEffect } from "react";
import type { Session } from "../types";
import {
  type AttRow,
  subjectName,
  combinedAttendance,
  SubjectDetail,
} from "../sections/attendance";

export function SubjectDetailSheet({
  row,
  registrationid,
  registrationcode,
  session,
  onClose,
  onLogout,
}: {
  row: AttRow & Record<string, unknown>;
  registrationid?: string;
  registrationcode?: string;
  session: Session;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const { name, badge } = subjectName(row.subjectcode);
  const attInfo = combinedAttendance(row);

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
  }, [handleClose]);

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
          <div className="att-sheet-header-main">
            <h2 className="att-sheet-title" id="att-sheet-title">
              {name}
            </h2>
            {badge && <span className="att-code-badge">{badge}</span>}
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

          {/* Actionable Status Advice */}
          {attInfo.margin.text ? (
            <div className={`att-sheet-advice ${attInfo.margin.type}`}>
              {attInfo.margin.type === "bunk" ? (
                <>
                  <span className="advice-icon" aria-hidden="true">🎉</span>
                  <span>
                    Can safely skip <strong>{attInfo.margin.count}</strong> {attInfo.margin.count === 1 ? "class" : "classes"} and maintain ≥75%.
                  </span>
                </>
              ) : (
                <>
                  <span className="advice-icon" aria-hidden="true">⚠️</span>
                  <span>
                    Must attend next <strong>{attInfo.margin.count}</strong> {attInfo.margin.count === 1 ? "class" : "classes"} in a row to reach 75%.
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className={`att-sheet-advice ${attInfo.isShort ? "short" : "safe"}`}>
              <span className="advice-icon" aria-hidden="true">{attInfo.isShort ? "⚠️" : "✓"}</span>
              <span>
                {attInfo.isShort
                  ? "Currently below the 75% minimum attendance requirement."
                  : "Attendance is comfortably above the 75% minimum threshold."}
              </span>
            </div>
          )}

          {/* Component Chips (Lecture / Tutorial / Practical) */}
          {(attInfo.components.L || attInfo.components.T || attInfo.components.P) && (
            <div className="att-sheet-components" aria-label="Component breakdown">
              {attInfo.components.L && (
                <div className="att-comp-chip">
                  <span className="comp-name">Lecture</span>
                  {attInfo.components.L.total > 0 && (
                    <span className="comp-ratio">
                      {attInfo.components.L.present}/{attInfo.components.L.total}
                    </span>
                  )}
                  {attInfo.components.L.pct != null && (
                    <span className="comp-pct">
                      {String(attInfo.components.L.pct).replace("%", "")}%
                    </span>
                  )}
                </div>
              )}
              {attInfo.components.T && (
                <div className="att-comp-chip">
                  <span className="comp-name">Tutorial</span>
                  {attInfo.components.T.total > 0 && (
                    <span className="comp-ratio">
                      {attInfo.components.T.present}/{attInfo.components.T.total}
                    </span>
                  )}
                  {attInfo.components.T.pct != null && (
                    <span className="comp-pct">
                      {String(attInfo.components.T.pct).replace("%", "")}%
                    </span>
                  )}
                </div>
              )}
              {attInfo.components.P && (
                <div className="att-comp-chip">
                  <span className="comp-name">Practical</span>
                  {attInfo.components.P.total > 0 && (
                    <span className="comp-ratio">
                      {attInfo.components.P.present}/{attInfo.components.P.total}
                    </span>
                  )}
                  {attInfo.components.P.pct != null && (
                    <span className="comp-pct">
                      {String(attInfo.components.P.pct).replace("%", "")}%
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Detailed Class History Log */}
        <div className="att-sheet-history-section">
          <SubjectDetail
            row={row}
            registrationid={registrationid}
            registrationcode={registrationcode}
            session={session}
            onLogout={onLogout}
          />
        </div>
      </div>
    </div>
  );
}
