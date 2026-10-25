import { useEffect, useId, useRef, useState } from "react";
import { googleCalendarUrl, type CalendarEvent } from "../lib/calendar";
import { insertCalendarEvent, canExportCalendar, exportCalendar } from "../lib/calendarActions";
import { CalendarAddIcon } from "./icons";
import { useAppBack } from "../hooks/useAppBack";

export function CalendarButton({ event, filename = "calendar.ics", unavailableLabel = "Calendar unavailable until dates are announced" }: { event: CalendarEvent | null; filename?: string; unavailableLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const googleUrl = event ? googleCalendarUrl(event) : null;
  useAppBack(open, () => { setOpen(false); button.current?.focus(); });
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
    setBusy(true);
    try { if (!(await insertCalendarEvent(event))) setOpen(!open); }
    catch { setOpen(true); }
    finally { setBusy(false); }
  }

  async function exportFile() {
    if (!event) return;
    setBusy(true);
    setExportError(false);
    try {
      await exportCalendar([event], filename);
      setOpen(false);
      button.current?.focus();
    } catch { setExportError(true); }
    finally { setBusy(false); }
  }

  const label = event ? `Add ${event.title} to calendar` : unavailableLabel;
  return (
    <div className="exam-calendar" ref={root}>
      <button ref={button} type="button" className="exam-calendar-button" aria-label={label} title={label}
        disabled={!event || busy} aria-expanded={open} aria-controls={open ? id : undefined} onClick={add}>
        <CalendarAddIcon />
      </button>
      {open && googleUrl && (
        <div className="exam-calendar-options" id={id} role="group" aria-label="Add to calendar">
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Google Calendar</a>
          {canExportCalendar() && <button type="button" disabled={busy} onClick={exportFile}>Calendar file (.ics)</button>}
          {exportError && <p role="alert">Couldn’t save calendar. Try again.</p>}
        </div>
      )}
    </div>
  );
}
