import { useEffect, useId, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { examCalendarEvent, googleExamUrl } from "../lib/examCalendar";
import { nativeExamCalendar, canExportExamCalendar, exportExamCalendar } from "../lib/examCalendarActions";
import type { ExamRow } from "../lib/exams";
import { CalendarAddIcon } from "./icons";

export function ExamCalendarButton({ row }: { row: ExamRow }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const event = examCalendarEvent(row);
  const googleUrl = googleExamUrl(row);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); button.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  async function add() {
    if (!event || busy) return;
    if (Capacitor.isPluginAvailable("ExamCalendar")) {
      setBusy(true);
      try { await nativeExamCalendar.insert(event); }
      catch { setOpen(true); }
      finally { setBusy(false); }
    } else setOpen(!open);
  }

  async function exportFile() {
    setBusy(true);
    setExportError(false);
    try {
      await exportExamCalendar([row]);
      setOpen(false);
      button.current?.focus();
    } catch { setExportError(true); }
    finally { setBusy(false); }
  }

  const label = event ? `Add ${event.title} to calendar` : "Calendar unavailable until exam times are announced";
  return (
    <div className="exam-calendar" ref={root}>
      <button ref={button} type="button" className="exam-calendar-button" aria-label={label} title={label}
        disabled={!event || busy} aria-expanded={open} aria-controls={open ? id : undefined} onClick={add}>
        <CalendarAddIcon />
      </button>
      {open && googleUrl && (
        <div className="exam-calendar-options" id={id} role="group" aria-label="Add to calendar">
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Google Calendar</a>
          {canExportExamCalendar() && <button type="button" disabled={busy} onClick={exportFile}>Calendar file (.ics)</button>}
          {exportError && <p role="alert">Couldn’t save calendar. Try again.</p>}
        </div>
      )}
    </div>
  );
}
