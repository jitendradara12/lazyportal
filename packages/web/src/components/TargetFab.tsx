import { useState, type CSSProperties } from "react";
import { ATTENDANCE_TARGETS, useDefaultAttendanceTarget } from "../hooks/useDefaultAttendanceTarget";

/** Small floating control: shows the attendance target, expands to pick another. */
export function TargetFab() {
  const [target, setTarget] = useDefaultAttendanceTarget();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  return (
    <div className="target-fab" data-open={open ? "" : undefined}>
      {open ? (
        <div className={`target-fab-options ${closing ? "is-closing" : ""}`} onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) { setClosing(false); setOpen(false); } }} role="radiogroup" aria-label="Attendance target" style={{ "--i": ATTENDANCE_TARGETS.indexOf(target) } as CSSProperties}>
          <span className="target-fab-thumb" aria-hidden="true" />
          {ATTENDANCE_TARGETS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={target === t}
              className={`target-fab-opt ${target === t ? "active" : ""}`}
              onClick={() => { setTarget(t); setTimeout(() => setClosing(true), 250); }}
            >
              {t}%
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="target-fab-btn is-entering" onClick={() => setOpen(true)} aria-label={`Attendance target ${target}%. Change`}>
          Target {target}%
        </button>
      )}
    </div>
  );
}
