import { useState, useEffect, useRef, useCallback } from "react";

interface WhatIfStepperProps {
  mode: "attend" | "miss";
  count: number;
  onModeChange: (mode: "attend" | "miss") => void;
  onCountChange: (count: number) => void;
  projectedPct: string;
  projectedColorClass: string;
  projectedRatio: { present: number; total: number };
  margin: { type: "bunk" | "attend" | "none"; count: number; text: string };
  max?: number;
  defaultOpen?: boolean;
}

export function WhatIfStepper({
  mode,
  count,
  onModeChange,
  onCountChange,
  projectedPct,
  projectedColorClass,
  projectedRatio,
  margin,
  max = 99,
  defaultOpen = false,
}: WhatIfStepperProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const valueRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(count);
  const countRef = useRef(count);
  countRef.current = count;
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  const holdTimersRef = useRef<{
    timeoutId?: ReturnType<typeof setTimeout>;
    intervalId?: ReturnType<typeof setInterval>;
  }>({});

  // Clean stop for hold-to-repeat timers
  const stopHold = useCallback(() => {
    if (holdTimersRef.current.timeoutId) {
      clearTimeout(holdTimersRef.current.timeoutId);
      holdTimersRef.current.timeoutId = undefined;
    }
    if (holdTimersRef.current.intervalId) {
      clearInterval(holdTimersRef.current.intervalId);
      holdTimersRef.current.intervalId = undefined;
    }
    window.removeEventListener("pointerup", stopHold);
    window.removeEventListener("pointercancel", stopHold);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      stopHold();
    };
  }, [stopHold]);

  // Animate value number transitions
  useEffect(() => {
    const prev = prevCountRef.current;
    if (prev !== count && valueRef.current) {
      const dir = count > prev ? 1 : -1;
      const calm = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!calm) {
        valueRef.current.animate(
          [
            { transform: `translateY(${dir * -12}px)`, opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 180, easing: "cubic-bezier(.2,0,0,1)" }
        );
      }
    }
    prevCountRef.current = count;
  }, [count]);

  const step = useCallback((delta: number) => {
    const cur = countRef.current;
    const next = Math.min(max, Math.max(0, cur + delta));
    if (next === cur) return false;
    onCountChangeRef.current(next);
    return true;
  }, [max]);

  const handlePointerDown = (delta: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.disabled) return;
    if (e.button !== 0) return; // Only primary mouse click or touch

    stopHold();
    const ok = step(delta);
    if (!ok) return;

    window.addEventListener("pointerup", stopHold);
    window.addEventListener("pointercancel", stopHold);

    holdTimersRef.current.timeoutId = setTimeout(() => {
      holdTimersRef.current.intervalId = setInterval(() => {
        const canContinue = step(delta);
        if (!canContinue) stopHold();
      }, 90);
    }, 420);
  };

  const handleClick = (delta: number) => (e: React.MouseEvent<HTMLButtonElement>) => {
    // Keyboard activation (Enter/Space on focused button sends detail === 0)
    if (e.detail === 0) {
      step(delta);
    }
  };

  const attendBtnRef = useRef<HTMLButtonElement>(null);
  const missBtnRef = useRef<HTMLButtonElement>(null);

  const handleGroupKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const nextMode = mode === "attend" ? "miss" : "attend";
      onModeChange(nextMode);
      if (nextMode === "attend") {
        attendBtnRef.current?.focus();
      } else {
        missBtnRef.current?.focus();
      }
    }
  };

  return (
    <section className={`att-sim-box ${isOpen ? "is-open" : "is-collapsed"}`} data-mode={mode}>
      <div className="att-sim-header">
        <button
          type="button"
          className="att-sim-toggle-btn"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls="att-sim-panel"
        >
          <span className="att-sim-toggle-left">
            <svg
              className="att-sim-toggle-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <line x1="8" y1="6" x2="16" y2="6" />
              <line x1="16" y1="14" x2="16" y2="18" />
              <path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01" />
            </svg>
            <span className="att-sim-title">What-if calculator</span>
            {!isOpen && count > 0 && (
              <span className={`att-sim-preview-badge ${mode === "miss" ? "miss" : "attend"}`}>
                {mode === "attend" ? `+${count} attend` : `+${count} miss`} → {projectedPct}
              </span>
            )}
          </span>
          <span className={`att-sim-chevron ${isOpen ? "open" : ""}`} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>

        {count > 0 && (
          <button
            type="button"
            className="att-sim-reset-btn"
            onClick={() => onCountChange(0)}
            aria-label="Reset what-if simulation"
          >
            Reset
          </button>
        )}
      </div>

      <div
        id="att-sim-panel"
        className={`att-sim-body ${isOpen ? "is-open" : ""}`}
        role="region"
        aria-label="What-if simulation controls"
      >
        <div className="att-sim-body-inner">
          <div
            className="att-sim-mode"
            role="radiogroup"
            aria-label="Scenario"
            onKeyDown={handleGroupKeyDown}
          >
            <button
              ref={attendBtnRef}
              type="button"
              className="att-sim-mode-btn"
              role="radio"
              aria-checked={mode === "attend"}
              tabIndex={mode === "attend" && isOpen ? 0 : -1}
              onClick={() => onModeChange("attend")}
            >
              Attend next
            </button>
            <button
              ref={missBtnRef}
              type="button"
              className="att-sim-mode-btn"
              role="radio"
              aria-checked={mode === "miss"}
              tabIndex={mode === "miss" && isOpen ? 0 : -1}
              onClick={() => onModeChange("miss")}
            >
              Miss next
            </button>
          </div>

          <div className="att-sim-pill">
            <button
              type="button"
              className="att-sim-step"
              aria-label="Decrease"
              disabled={count <= 0}
              tabIndex={isOpen ? 0 : -1}
              onPointerDown={handlePointerDown(-1)}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              onClick={handleClick(-1)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14" />
              </svg>
            </button>

            <div
              ref={valueRef}
              className="att-sim-value"
              role="status"
              aria-live="polite"
            >
              {count}
            </div>

            <button
              type="button"
              className="att-sim-step"
              aria-label="Increase"
              disabled={count >= max}
              tabIndex={isOpen ? 0 : -1}
              onPointerDown={handlePointerDown(1)}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              onClick={handleClick(1)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14M12 5v14" />
              </svg>
            </button>
          </div>

          {/* Projected % and bunk count right under .att-sim-pill */}
          <div className="att-sim-outcome">
            <div className="att-sim-outcome-score">
              <span className="att-sim-outcome-label">Projected:</span>
              <span className={`att-sim-projected-pct ${projectedColorClass}`}>
                {projectedPct}
              </span>
              <span className="att-sim-projected-ratio">
                ({projectedRatio.present}/{projectedRatio.total})
              </span>
            </div>
            {margin.text ? (
              <div className={`att-advice-inline ${margin.type}`}>
                <span>{margin.text}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
