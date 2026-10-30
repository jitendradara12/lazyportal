import { useRef, useState } from "react";
import { TopBar } from "../components/AppBar";
import { CalendarButton } from "../components/CalendarButton";
import { CalendarAddIcon, CloseIcon, GitHubIcon, SearchIcon } from "../components/icons";
import { MonthGrid } from "../components/MonthGrid";
import { Timeline, TimelineStop, TimelineGroup } from "../components/Timeline";
import { SectionError } from "../components/DataViews";
import { useNow } from "../hooks/useNow";
import { academicBounds, academicCalendarEvent, academicCategories, academicDateLabel, academicDays, academicEventKey, academicSchedule, academicYears, currentAcademicCalendar, groupAcademicEvents, matchesAcademicSearch, portalDate, type AcademicCalendar, type AcademicEvent, type AcademicYear } from "../lib/academicCalendar";
import { canExportCalendar, exportCalendar } from "../lib/calendarActions";
import { dateFormatter } from "../lib/dateFormat";

const monthYear = dateFormatter("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const fullDay = dateFormatter("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const monthShort = dateFormatter("en-IN", { month: "short", timeZone: "UTC" });
const weekdayIst = dateFormatter("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });
const calendars = Object.values(import.meta.glob<AcademicCalendar>("../data/academic-calendars/*.json", { eager: true, import: "default" })).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
const years = academicYears(calendars);
const filters = [
  { id: "all", label: "All" },
  { id: "exam", label: "Exams" },
  { id: "break", label: "Holidays" },
  { id: "deadline", label: "Deadlines" },
  { id: "academic", label: "Academic" },
];

export function AcademicCalendarPage() {
  const now = useNow();
  const [yearId, setYearId] = useState(() => currentAcademicCalendar(calendars, now).academicYear);
  const year = years.find((entry) => entry.academicYear === yearId)!;
  const currentSemester = currentAcademicCalendar(calendars, now).startsOn;
  const [filter, setFilter] = useState("all");
  const [day, setDay] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const matching = year.events.filter((event) => event.audience !== "Faculty & staff" &&
    (filter === "all" || event.category === filter || (filter === "break" && event.category === "holiday")) && matchesAcademicSearch(event, query));
  const days = academicDays(matching);
  const activeDay = day && days.has(day) ? day : null;
  const events = activeDay ? days.get(activeDay)!.events : matching;
  const months = year.events.flatMap((event) => event.startDate ? [event.startDate, event.endDate ?? event.startDate] : []).map((date) => date.slice(0, 7)).sort();
  const { past, upcoming, guidance } = groupAcademicEvents(events, now);
  const shownGuidance = guidance.filter((event) => query || event.semester!.startsOn >= currentSemester);
  const next = activeDay ? undefined : upcoming.find((event) => academicBounds(event)!.start > now);
  const exportPool = activeDay ? groupAcademicEvents(matching, now).upcoming : upcoming;
  const exportable = exportPool.map((event) => academicCalendarEvent(year, event)).filter((event) => event !== null);

  function closeSearch() {
    setSearchOpen(false);
    setSearch("");
    setTimeout(() => searchButton.current?.focus(), 0);
  }

  function clearSearch() {
    setSearch("");
    searchInput.current?.focus();
  }

  async function exportUpcoming() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try { await exportCalendar(exportable, `juet-${year.academicYear}.ics`); }
    catch { setExportError("Couldn’t save calendar. Try again."); }
    finally { setExporting(false); }
  }

  function stop(event: AcademicEvent, holidays: AcademicEvent[] = []) {
    const bounds = academicBounds(event)!;
    const state = bounds.end !== null && bounds.end <= now ? "past" : bounds.start <= now ? "current" : event === next ? "next" : "later";
    return <TimelineStop key={academicEventKey(event)} state={state}>
      <AcademicEventCard year={year} event={event} holidays={holidays} featured={state === "next" || state === "current"} state={state} now={now} />
    </TimelineStop>;
  }

  function schedule(entries: AcademicEvent[], descending = false) {
    return academicSchedule(entries, !query, descending).map(({ month, entries: stops }) => <li className="academic-month-group" key={month}>
      <h3 className="academic-month-heading">{monthYear(new Date(`${month}-01T00:00:00Z`))}</h3>
      <ol className="academic-month-events">{stops.map(({ event, holidays }) => stop(event, holidays))}</ol>
    </li>);
  }

  return <div className="page academic-calendar-page">
    <TopBar title="Academic calendar" subtitle={years.length > 1 ? <span className="academic-sem">
        <select aria-label="Academic year" value={yearId} onChange={(event) => { setYearId(event.target.value); setDay(null); setExportError(null); }}>
          {years.map((entry) => <option key={entry.academicYear} value={entry.academicYear}>{entry.academicYear}</option>)}
        </select>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </span> : `JUET · ${year.academicYear}`} noRefresh
      actions={<>
        {!searchOpen && <button ref={searchButton} type="button" className="exam-calendar-button academic-search-toggle" aria-label="Search calendar" title="Search calendar" aria-expanded={false} aria-controls="academic-search" onClick={() => setSearchOpen(true)}><SearchIcon /></button>}
        {canExportCalendar() && exportable.length > 0 && <button type="button" className="exam-calendar-button exam-export" aria-label="Export upcoming academic events" title="Export upcoming academic events" disabled={exporting} onClick={exportUpcoming}><CalendarAddIcon /></button>}
      </>} />
    <div className="page-body">
      {searchOpen && <div className="academic-search" role="search" aria-label="Academic calendar">
        <SearchIcon />
        <input ref={searchInput} id="academic-search" type="search" aria-label="Search calendar events" placeholder="Search events, dates…" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeSearch(); } }} autoFocus />
        <button type="button" className="academic-search-close" aria-label="Close calendar search" title="Close calendar search" onClick={closeSearch}><CloseIcon /></button>
      </div>}
      {months.length > 0 && <MonthGrid key={yearId} days={days} today={portalDate(now)} first={months[0]} last={months.at(-1)!} selected={activeDay} onSelect={setDay} />}
      <div className="chip-row academic-filters" role="group" aria-label="Event categories">
        {filters.map(({ id, label }) => <button key={id} type="button" className={`chip-btn ${filter === id ? "active" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{id !== "all" && <span className={`chip-dot tone-${id}`} aria-hidden="true" />}{label}</button>)}
      </div>
      <div className="academic-schedule-heading">{activeDay
        ? <><h2 className="page-subhead">{fullDay(new Date(`${activeDay}T00:00:00Z`))}</h2><button type="button" className="academic-clear-day" onClick={() => setDay(null)}>Show all</button></>
        : <><h2 className="page-subhead">{query ? "Search results" : "Coming up"}</h2><span role="status">{query ? `${events.length} ${events.length === 1 ? "result" : "results"}` : `${upcoming.length} events`}</span></>}</div>
      {exportError && <SectionError label="Calendar" error={exportError} retry={exportUpcoming} />}
      {upcoming.length > 0 ? <Timeline label="Academic schedule" className="academic-timeline" key={`${yearId}:${filter}:${activeDay}:${query}`}>
        {schedule(upcoming)}
        {past.length > 0 && <TimelineGroup label="Past events" count={past.length} defaultOpen={Boolean(query || activeDay)}>{schedule(past, true)}</TimelineGroup>}
      </Timeline> : <>
        {!activeDay && (!query || events.length === 0) && <div className="academic-empty">
          <p className="muted page-note">{query ? "No events match your search. Try another term or change the filters." : events.length === 0 ? "No events match this filter." : "No upcoming events for this selection."}</p>
          <div className="academic-empty-actions">
            {query && <button type="button" onClick={clearSearch}>Clear search</button>}
            {filter !== "all" && <button type="button" onClick={() => { setFilter("all"); searchInput.current?.focus(); }}>{query ? "Search all categories" : "Show all categories"}</button>}
          </div>
        </div>}
        {past.length > 0 && <Timeline label="Academic schedule" className="academic-timeline" key={`${yearId}:${filter}:${activeDay}:${query}`}><TimelineGroup label="Past events" count={past.length} defaultOpen={Boolean(query || activeDay)}>{schedule(past, true)}</TimelineGroup></Timeline>}
      </>}
      {shownGuidance.length > 0 && <section className="academic-guidance" aria-labelledby="academic-guidance">
        <h2 className="page-subhead" id="academic-guidance">Date guidance</h2>
        {shownGuidance.map((event) => <AcademicEventCard key={academicEventKey(event)} year={year} event={event} now={now} />)}
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

function AcademicEventCard({ year, event, holidays = [], featured = false, state, now }: { year: AcademicYear; event: AcademicEvent; holidays?: AcademicEvent[]; featured?: boolean; state?: string; now?: number }) {
  const startDateObj = event.startDate ? new Date(`${event.startDate}T00:00:00+05:30`) : null;
  const day = event.startDate?.slice(8);
  const month = event.startDate ? monthShort(new Date(`${event.startDate}T00:00:00Z`)) : "TBA";
  const weekday = startDateObj ? weekdayIst(startDateObj) : null;
  const exportEvent = academicCalendarEvent(year, event);
  const uncertain = Boolean(event.dateRule || event.status);

  let duration: string | null = null;
  if (event.startDate && event.endDate && event.endDate !== event.startDate) {
    const days = Math.round((Date.parse(event.endDate) - Date.parse(event.startDate)) / 86_400_000) + 1;
    if (days > 1) duration = `${days} days`;
  }

  let countdownLabel: string | null = null;
  if (now && event.startDate && !uncertain) {
    const bounds = academicBounds(event);
    if (bounds && bounds.start > now) {
      const diffDays = Math.ceil((bounds.start - now) / 86_400_000);
      if (diffDays === 1) countdownLabel = "Tomorrow";
      else if (diffDays > 1 && diffDays <= 7) countdownLabel = `in ${diffDays} days`;
    }
  }

  return <article className={`exam-card academic-event ${featured && !uncertain ? "is-next" : ""} ${uncertain ? "has-date-guidance" : ""}`}>
    <div className="academic-event-main">
      {!uncertain && <div className="exam-date" aria-hidden="true">
        {day && <span className="exam-day">{Number(day)}</span>}
        <span className="exam-month">{month}</span>
        {weekday && <span className="exam-weekday">{weekday}</span>}
      </div>}
      <div className="exam-body">
        <div className="academic-event-meta">
          <span className={`academic-category category-${event.category}`}>{academicCategories[event.category]}</span>
          {event.status === "tentative" && <span className="academic-proposed">Proposed</span>}
          {featured && <span className="academic-event-state">{state === "current" && !event.dateRule ? "Happening now" : "Next"}</span>}
        </div>
        {state ? <h4 className="exam-subject">{event.title}</h4> : <h3 className="exam-subject">{event.title}</h3>}
        <p className="academic-event-dates">
          <span>{academicDateLabel(event)}</span>
          {duration && <span className="academic-meta-pill"> · {duration}</span>}
          {countdownLabel && <span className="academic-meta-pill"> · {countdownLabel}</span>}
        </p>
        {event.audience && <span className="academic-audience">For {event.audience}</span>}
        {(!event.startDate || event.dateRule === "from") && year.semesters.length > 1 && <span className="academic-audience">{event.semester!.term === "odd" ? "Odd" : "Even"} semester</span>}
        {event.notes && <p className="academic-event-note">{event.notes}</p>}
      </div>
      {exportEvent && <CalendarButton event={exportEvent} filename={`juet-${year.academicYear}.ics`} />}
    </div>
    {holidays.length > 0 && <div className="academic-break-holidays">
      <p>Holidays during this break</p>
      <ul>{holidays.map((holiday) => <li key={academicEventKey(holiday)}>
        <div><h5>{holiday.title}</h5><p>{academicDateLabel(holiday, false)}</p>{holiday.audience && <span className="academic-audience">For {holiday.audience}</span>}</div>
        <CalendarButton event={academicCalendarEvent(year, holiday)} filename={`juet-${year.academicYear}.ics`} />
      </li>)}</ul>
    </div>}
  </article>;
}
