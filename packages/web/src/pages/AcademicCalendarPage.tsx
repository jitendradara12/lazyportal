import { useState } from "react";
import { TopBar } from "../components/AppBar";
import { CalendarButton } from "../components/CalendarButton";
import { CalendarAddIcon, GitHubIcon } from "../components/icons";
import { Timeline, TimelineStop, TimelineGroup } from "../components/Timeline";
import { SectionError } from "../components/DataViews";
import { useNow } from "../hooks/useNow";
import { academicBounds, academicCalendarEvent, academicCategories, academicDateLabel, currentAcademicCalendar, groupAcademicEvents, type AcademicCalendar, type AcademicEvent } from "../lib/academicCalendar";
import { canExportCalendar, exportCalendar } from "../lib/calendarActions";

const calendars = Object.values(import.meta.glob<AcademicCalendar>("../data/academic-calendars/*.json", { eager: true, import: "default" })).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
const filters = [
  { id: "all", label: "All events" },
  { id: "exam", label: "Exams" },
  { id: "break", label: "Holidays & breaks" },
  { id: "deadline", label: "Deadlines" },
  { id: "academic", label: "Academic" },
];

export function AcademicCalendarPage() {
  const now = useNow();
  const [calendarId, setCalendarId] = useState(() => currentAcademicCalendar(calendars, now).id);
  const calendar = calendars.find((entry) => entry.id === calendarId)!;
  const [filter, setFilter] = useState("all");
  const [audience, setAudience] = useState("students");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const events = calendar.events.filter((event) =>
    (audience === "all" || event.audience !== "Faculty & staff") &&
    (filter === "all" || event.category === filter || (filter === "break" && event.category === "holiday")));
  const { past, upcoming, guidance } = groupAcademicEvents(events, now);
  const next = upcoming.find((event) => academicBounds(event)!.start > now);
  const exportable = upcoming.map((event) => academicCalendarEvent(calendar, event)).filter((event) => event !== null);

  async function exportUpcoming() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try { await exportCalendar(exportable, `juet-${calendar.id}.ics`); }
    catch { setExportError("Couldn’t save calendar. Try again."); }
    finally { setExporting(false); }
  }

  function stop(event: AcademicEvent) {
    const bounds = academicBounds(event)!;
    const state = bounds.end !== null && bounds.end <= now ? "past" : bounds.start <= now ? "current" : event === next ? "next" : "later";
    return <TimelineStop key={event.id} state={state}>
      <AcademicEventCard calendar={calendar} event={event} featured={state === "next" || state === "current"} state={state} />
    </TimelineStop>;
  }

  return <div className="page academic-calendar-page">
    <TopBar title="Academic calendar" subtitle={`JUET · ${calendar.academicYear}`} noRefresh
      actions={canExportCalendar() && exportable.length > 0 && <button type="button" className="exam-calendar-button exam-export" aria-label="Export upcoming academic events" title="Export upcoming academic events" disabled={exporting} onClick={exportUpcoming}><CalendarAddIcon /></button>} />
    <div className="page-body">
      <div className="academic-controls">
        <label>Semester<select className="sem-picker" aria-label="Academic semester" value={calendarId} onChange={(event) => { setCalendarId(event.target.value); setExportError(null); }}>
          {calendars.map((entry) => <option key={entry.id} value={entry.id}>{entry.term === "odd" ? "Odd" : "Even"} semester · {entry.academicYear}</option>)}
        </select></label>
        <label>Show<select className="sem-picker" aria-label="Calendar audience" value={audience} onChange={(event) => setAudience(event.target.value)}>
          <option value="students">Student events</option><option value="all">All audiences</option>
        </select></label>
      </div>
      <div className="chip-row academic-filters" role="group" aria-label="Event categories">
        {filters.map(({ id, label }) => <button key={id} type="button" className={`chip-btn ${filter === id ? "active" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
      <div className="academic-schedule-heading"><h2 className="page-subhead">{upcoming.some((event) => academicBounds(event)!.start <= now) ? "Happening now & coming up" : "Coming up"}</h2><span>{upcoming.length} events</span></div>
      {exportError && <SectionError label="Calendar" error={exportError} retry={exportUpcoming} />}
      {upcoming.length > 0 ? <Timeline label="Academic schedule" className="academic-timeline" key={`${calendarId}:${filter}:${audience}`}>
        {upcoming.map(stop)}
        {past.length > 0 && <TimelineGroup label="Past events" count={past.length}>{[...past].reverse().map(stop)}</TimelineGroup>}
      </Timeline> : <>
        <p className="muted page-note">{events.length === 0 ? "No events match this filter." : "No upcoming events for this selection."}</p>
        {past.length > 0 && <Timeline label="Academic schedule" className="academic-timeline" key={`${calendarId}:${filter}:${audience}`}><TimelineGroup label="Past events" count={past.length}>{[...past].reverse().map(stop)}</TimelineGroup></Timeline>}
      </>}
      {guidance.length > 0 && <section className="academic-guidance" aria-labelledby="academic-guidance">
        <h2 className="page-subhead" id="academic-guidance">Date guidance</h2>
        {guidance.map((event) => <AcademicEventCard key={event.id} calendar={calendar} event={event} />)}
      </section>}
      <footer className="academic-contribute">
        <a href="https://github.com/jitendradara12/lazyportal/blob/master/packages/web/src/data/academic-calendars/README.md" target="_blank" rel="noopener noreferrer"><GitHubIcon />Something Wrong? Make a pull request.</a>
      </footer>
    </div>
  </div>;
}

function AcademicEventCard({ calendar, event, featured = false, state }: { calendar: AcademicCalendar; event: AcademicEvent; featured?: boolean; state?: string }) {
  const day = event.startDate?.slice(8);
  const month = event.startDate ? new Date(`${event.startDate}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }) : "TBA";
  const exportEvent = academicCalendarEvent(calendar, event);
  const unavailable = event.status === "tentative" ? "Calendar unavailable while dates are proposed" : "Calendar unavailable until exact dates are announced";
  return <article className={`exam-card academic-event ${featured ? "is-next" : ""}`}>
    <div className="exam-date" aria-hidden="true">{day && <span className="exam-day">{Number(day)}</span>}<span className="exam-month">{month}</span></div>
    <div className="exam-body">
      <div className="academic-event-meta"><span className={`academic-category category-${event.category}`}>{academicCategories[event.category]}</span>{event.status === "tentative" && <span className="academic-proposed">Proposed</span>}{featured && <span className="academic-event-state">{state === "current" ? "Happening now" : "Up next"}</span>}</div>
      <h3 className="exam-subject">{event.title}</h3>
      <p className="academic-event-dates">{academicDateLabel(event)}</p>
      {event.audience && <span className="academic-audience">{event.audience}</span>}
      {event.notes && <p className="academic-event-note">{event.notes}</p>}
    </div>
    <CalendarButton event={exportEvent} filename={`juet-${calendar.id}.ics`} unavailableLabel={unavailable} />
  </article>;
}
