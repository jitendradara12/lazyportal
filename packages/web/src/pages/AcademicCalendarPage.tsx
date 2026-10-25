import { useRef, useState } from "react";
import { TopBar } from "../components/AppBar";
import { CalendarButton } from "../components/CalendarButton";
import { CalendarAddIcon, CloseIcon, GitHubIcon, SearchIcon } from "../components/icons";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchButton = useRef<HTMLButtonElement>(null);
  const query = search.trim().toLowerCase();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const events = calendar.events.filter((event) =>
    (audience === "all" || event.audience !== "Faculty & staff") &&
    (filter === "all" || event.category === filter || (filter === "break" && event.category === "holiday")) &&
    (!query || [event.title, academicCategories[event.category], academicDateLabel(event), event.audience, event.notes].filter(Boolean).join(" ").toLowerCase().includes(query)));
  const { past, upcoming, guidance } = groupAcademicEvents(events, now);
  const next = upcoming.find((event) => academicBounds(event)!.start > now);
  const exportable = upcoming.map((event) => academicCalendarEvent(calendar, event)).filter((event) => event !== null);

  function closeSearch() {
    setSearchOpen(false);
    setSearch("");
    setTimeout(() => searchButton.current?.focus(), 0);
  }

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
      <AcademicEventCard calendar={calendar} event={event} featured={state === "next" || state === "current"} state={state} now={now} />
    </TimelineStop>;
  }

  return <div className="page academic-calendar-page">
    <TopBar title="Academic calendar" subtitle={`JUET · ${calendar.academicYear}`} noRefresh
      actions={<>
        {!searchOpen && <button ref={searchButton} type="button" className="exam-calendar-button academic-search-toggle" aria-label="Search calendar" title="Search calendar" aria-expanded={false} aria-controls="academic-search" onClick={() => setSearchOpen(true)}><SearchIcon /></button>}
        {canExportCalendar() && exportable.length > 0 && <button type="button" className="exam-calendar-button exam-export" aria-label="Export upcoming academic events" title="Export upcoming academic events" disabled={exporting} onClick={exportUpcoming}><CalendarAddIcon /></button>}
      </>} />
    <div className="page-body">
      {searchOpen && <div className="academic-search" role="search" aria-label="Academic calendar">
        <SearchIcon />
        <input id="academic-search" type="search" aria-label="Search calendar events" placeholder="Search events, dates…" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeSearch(); } }} autoFocus />
        <button type="button" className="academic-search-close" aria-label="Close calendar search" title="Close calendar search" onClick={closeSearch}><CloseIcon /></button>
      </div>}
      <div className="academic-controls">
        <label className="academic-control-field">
          <span>Semester</span>
          <div className="picker-wrap">
            <select className="sem-picker" aria-label="Academic semester" value={calendarId} onChange={(event) => { setCalendarId(event.target.value); setExportError(null); }}>
              {calendars.map((entry) => <option key={entry.id} value={entry.id}>{entry.term === "odd" ? "Odd" : "Even"} sem · {entry.academicYear}</option>)}
            </select>
            <svg className="picker-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </div>
        </label>
        <label className="academic-control-field is-audience">
          <span>Show</span>
          <div className="picker-wrap">
            <select className="sem-picker" aria-label="Calendar audience" value={audience} onChange={(event) => setAudience(event.target.value)}>
              <option value="students">Students</option><option value="all">All events</option>
            </select>
            <svg className="picker-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </div>
        </label>
      </div>
      <div className="chip-row academic-filters" role="group" aria-label="Event categories">
        {filters.map(({ id, label }) => <button key={id} type="button" className={`chip-btn ${filter === id ? "active" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
      <div className="academic-schedule-heading"><h2 className="page-subhead">{query ? "Search results" : upcoming.some((event) => academicBounds(event)!.start <= now) ? "Happening now & coming up" : "Coming up"}</h2><span role="status">{query ? `${events.length} ${events.length === 1 ? "result" : "results"}` : `${upcoming.length} events`}</span></div>
      {exportError && <SectionError label="Calendar" error={exportError} retry={exportUpcoming} />}
      {upcoming.length > 0 ? <Timeline label="Academic schedule" className="academic-timeline" key={`${calendarId}:${filter}:${audience}:${query}`}>
        {upcoming.map(stop)}
        {past.length > 0 && <TimelineGroup label="Past events" count={past.length} defaultOpen={Boolean(query)}>{[...past].reverse().map(stop)}</TimelineGroup>}
      </Timeline> : <>
        {(!query || events.length === 0) && <p className="muted page-note">{query ? "No events match your search. Try another term or change the filters." : events.length === 0 ? "No events match this filter." : "No upcoming events for this selection."}</p>}
        {past.length > 0 && <Timeline label="Academic schedule" className="academic-timeline" key={`${calendarId}:${filter}:${audience}:${query}`}><TimelineGroup label="Past events" count={past.length} defaultOpen={Boolean(query)}>{[...past].reverse().map(stop)}</TimelineGroup></Timeline>}
      </>}
      {guidance.length > 0 && <section className="academic-guidance" aria-labelledby="academic-guidance">
        <h2 className="page-subhead" id="academic-guidance">Date guidance</h2>
        {guidance.map((event) => <AcademicEventCard key={event.id} calendar={calendar} event={event} now={now} />)}
      </section>}
      <footer className="academic-contribute">
        <span>Something wrong in data?</span>
        <a href="https://github.com/jitendradara12/lazyportal/blob/master/packages/web/src/data/academic-calendars/README.md" target="_blank" rel="noopener noreferrer">
          <GitHubIcon />
          <span>Make a pull request.</span>
        </a>
      </footer>
    </div>
  </div>;
}

function AcademicEventCard({ calendar, event, featured = false, state, now }: { calendar: AcademicCalendar; event: AcademicEvent; featured?: boolean; state?: string; now?: number }) {
  const startDateObj = event.startDate ? new Date(`${event.startDate}T00:00:00+05:30`) : null;
  const day = event.startDate?.slice(8);
  const month = event.startDate ? new Date(`${event.startDate}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }) : "TBA";
  const weekday = startDateObj ? startDateObj.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }) : null;
  const exportEvent = academicCalendarEvent(calendar, event);
  const unavailable = event.status === "tentative" ? "Calendar unavailable while dates are proposed" : "Calendar unavailable until exact dates are announced";

  let duration: string | null = null;
  if (event.startDate && event.endDate && event.endDate !== event.startDate) {
    const days = Math.round((Date.parse(event.endDate) - Date.parse(event.startDate)) / 86_400_000) + 1;
    if (days > 1) duration = `${days} days`;
  }

  let countdownLabel: string | null = null;
  if (now && event.startDate && !event.dateRule) {
    const bounds = academicBounds(event);
    if (bounds && bounds.start > now) {
      const diffDays = Math.ceil((bounds.start - now) / 86_400_000);
      if (diffDays === 1) countdownLabel = "Tomorrow";
      else if (diffDays > 1 && diffDays <= 7) countdownLabel = `in ${diffDays} days`;
    }
  }

  return <article className={`exam-card academic-event ${featured ? "is-next" : ""}`}>
    <div className="exam-date" aria-hidden="true">
      {day && <span className="exam-day">{Number(day)}</span>}
      <span className="exam-month">{month}</span>
      {weekday && <span className="exam-weekday">{weekday}</span>}
    </div>
    <div className="exam-body">
      <div className="academic-event-meta">
        <span className={`academic-category category-${event.category}`}>{academicCategories[event.category]}</span>
        {event.status === "tentative" && <span className="academic-proposed">Proposed</span>}
        {featured && <span className="academic-event-state">{state === "current" ? "Happening now" : "Up next"}</span>}
      </div>
      <h3 className="exam-subject">{event.title}</h3>
      <p className="academic-event-dates">
        <span>{academicDateLabel(event)}</span>
        {duration && <span className="academic-meta-pill"> · {duration}</span>}
        {countdownLabel && <span className="academic-meta-pill"> · {countdownLabel}</span>}
      </p>
      {event.audience && <span className="academic-audience">{event.audience}</span>}
      {event.notes && <p className="academic-event-note">{event.notes}</p>}
    </div>
    <CalendarButton event={exportEvent} filename={`juet-${calendar.id}.ics`} unavailableLabel={unavailable} />
  </article>;
}
