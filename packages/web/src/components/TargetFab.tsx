import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ATTENDANCE_TARGETS, useDefaultAttendanceTarget } from "../hooks/useDefaultAttendanceTarget";
import { useAppBack } from "../hooks/useAppBack";

/** Small floating control: shows the attendance target, expands to pick another. */
export function TargetFab() {
  const [target, setTarget] = useDefaultAttendanceTarget();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const closeDelay = useRef<ReturnType<typeof setTimeout>>();
  const restoreFocus = useRef(false);

  function close(focusButton = false) {
    clearTimeout(closeDelay.current);
    restoreFocus.current = focusButton;
    setClosing(true);
  }

  useAppBack(open, () => close(true));

  useEffect(() => {
    if (!open) {
      if (restoreFocus.current) button.current?.focus();
      restoreFocus.current = false;
      return;
    }
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      clearTimeout(closeDelay.current);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (!closing) return;
    // Reduced motion disables animationend; closing must also work without it.
    const timer = setTimeout(() => {
      setClosing(false);
      setOpen(false);
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300);
    return () => clearTimeout(timer);
  }, [closing]);

  return (
    <div className="target-fab" ref={root} data-open={open ? "" : undefined}
      onBlur={(event) => { if (open && !event.currentTarget.contains(event.relatedTarget)) close(); }}>
      {open ? (
        <div className={`target-fab-options ${closing ? "is-closing" : ""}`} role="radiogroup" aria-label="Attendance target" style={{ "--i": ATTENDANCE_TARGETS.indexOf(target) } as CSSProperties}>
          <span className="target-fab-thumb" aria-hidden="true" />
          {ATTENDANCE_TARGETS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={target === t}
              className={`target-fab-opt ${target === t ? "active" : ""}`}
              onClick={() => {
                setTarget(t);
                clearTimeout(closeDelay.current);
                closeDelay.current = setTimeout(() => close(true), 250);
              }}
            >
              {t}%
            </button>
          ))}
        </div>
      ) : (
        <button ref={button} type="button" className="target-fab-btn is-entering" onClick={() => setOpen(true)} aria-label={`Attendance target ${target}%. Change`}>
          Target {target}%
        </button>
      )}
    </div>
  );
}
