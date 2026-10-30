import type { CalendarEvent } from "./calendar.ts";

export type AcademicCategory = "exam" | "holiday" | "break" | "deadline" | "academic";
export interface AcademicEvent {
  id: string;
  title: string;
  category: AcademicCategory;
  startDate?: string;
  /** Inclusive in JSON; converted to an exclusive date only during export. */
  endDate?: string;
  dateRule?: "before" | "from" | "relative" | "tba";
  timing?: string;
  status?: "tentative";
  audience?: string;
  notes?: string;
  aliases?: string[];
  /** Set by `academicYears`: the semester file this event was published in. */
  semester?: AcademicSemester;
}
export interface AcademicSemester { id: string; term: string; startsOn: string }
export interface AcademicCalendar {
  id: string;
  academicYear: string;
  term: string;
  startsOn: string;
  events: AcademicEvent[];
}

export interface AcademicYear { academicYear: string; startsOn: string; semesters: AcademicSemester[]; events: AcademicEvent[] }

/** One continuous timeline per academic year. Event IDs repeat across semester files, so `semester` tells them apart. */
export function academicYears(calendars: AcademicCalendar[]): AcademicYear[] {
  const years = new Map<string, AcademicYear>();
  for (const { id, term, startsOn, academicYear, events } of [...calendars].sort((a, b) => a.startsOn.localeCompare(b.startsOn))) {
    const semester = { id, term, startsOn };
    const year = years.get(academicYear) ?? { academicYear, startsOn, semesters: [], events: [] };
    year.semesters.push(semester);
    year.events.push(...events.map((event) => ({ ...event, semester })));
    years.set(academicYear, year);
  }
  return [...years.values()];
}

export const academicEventKey = (event: AcademicEvent) => `${event.semester?.id ?? ""}:${event.id}`;

export function matchesAcademicSearch(event: AcademicEvent, query: string): boolean {
  const text = [event.title, academicCategories[event.category], academicDateLabel(event), event.audience, event.notes, ...(event.aliases ?? [])].filter(Boolean).join(" ");
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalize(text).includes(normalize(query));
}

export type AcademicTone = "exam" | "deadline" | "break" | "academic";
export interface AcademicDay { tone: AcademicTone; events: AcademicEvent[] }

/** Dated events by day for the month grid. Holidays share the break tone; the strongest tone wins a shared day. */
export function academicDays(events: AcademicEvent[]): Map<string, AcademicDay> {
  const order: AcademicTone[] = ["exam", "deadline", "break", "academic"];
  const days = new Map<string, AcademicDay>();
  for (const event of events) {
    if (!event.startDate) continue;
    const tone = event.category === "holiday" ? "break" : event.category;
    const end = event.dateRule ? event.startDate : event.endDate ?? event.startDate;
    for (let date = event.startDate; date <= end; date = nextDate(date)) {
      const day = days.get(date);
      if (!day) days.set(date, { tone, events: [event] });
      else {
        day.events.push(event);
        if (order.indexOf(tone) < order.indexOf(day.tone)) day.tone = tone;
      }
    }
  }
  return days;
}

export function academicSchedule(events: AcademicEvent[], groupHolidays = true, descending = false) {
  const sorted = [...events].sort((a, b) => (descending ? -1 : 1) * a.startDate!.localeCompare(b.startDate!) || a.title.localeCompare(b.title));
  const breaks = sorted.filter((event) => event.category === "break" && !event.dateRule && !event.status);
  const holidays = new Map<AcademicEvent, AcademicEvent[]>();
  const nested = new Set<AcademicEvent>();
  if (groupHolidays) for (const holiday of sorted.filter((event) => event.category === "holiday" && !event.dateRule && !event.status)) {
    const parent = breaks.find((event) => event.startDate! <= holiday.startDate! && (event.endDate ?? event.startDate)! >= (holiday.endDate ?? holiday.startDate)!
      && (event.audience === holiday.audience || (!event.audience && holiday.audience === "Students")));
    if (parent) {
      holidays.set(parent, [...(holidays.get(parent) ?? []), holiday]);
      nested.add(holiday);
    }
  }
  const months = new Map<string, { event: AcademicEvent; holidays: AcademicEvent[] }[]>();
  for (const event of sorted.filter((entry) => !nested.has(entry))) {
    const month = event.startDate!.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month)!.push({ event, holidays: holidays.get(event) ?? [] });
  }
  return [...months].map(([month, entries]) => ({ month, entries }));
}

export const academicCategories: Record<AcademicCategory, string> = {
  exam: "Exams", holiday: "Holiday", break: "Break", deadline: "Deadline", academic: "Academic",
};
export const portalDate = (now: number) => new Date(now + 330 * 60_000).toISOString().slice(0, 10);
export const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
export const prevDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export function currentAcademicCalendar(calendars: AcademicCalendar[], now: number): AcademicCalendar {
  const sorted = [...calendars].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return sorted.filter((calendar) => calendar.startsOn <= portalDate(now)).at(-1) ?? sorted[0];
}

export function academicBounds(event: AcademicEvent): { start: number; end: number | null } | null {
  if (!event.startDate) return null;
  const start = Date.parse(`${event.startDate}T00:00:00+05:30`);
  return { start, end: event.dateRule === "from" ? null : event.dateRule === "before" ? start : Date.parse(`${nextDate(event.endDate ?? event.startDate)}T00:00:00+05:30`) };
}

export function groupAcademicEvents(events: AcademicEvent[], now: number) {
  const dated = events.filter((event) => event.startDate).sort((a, b) => a.startDate!.localeCompare(b.startDate!) || a.title.localeCompare(b.title));
  return {
    past: dated.filter((event) => {
      const { end } = academicBounds(event)!;
      return end !== null && end <= now;
    }),
    upcoming: dated.filter((event) => {
      const { start, end } = academicBounds(event)!;
      return end === null ? start > now : end > now;
    }),
    guidance: events.filter((event) => !event.startDate || (event.dateRule === "from" && academicBounds(event)!.start <= now)),
  };
}

export function academicCalendarEvent(calendar: { academicYear: string } & Partial<AcademicSemester>, event: AcademicEvent): CalendarEvent | null {
  if (!event.startDate || event.dateRule || event.status === "tentative") return null;
  const source = event.semester ?? calendar;
  return {
    id: `academic:${source.id}:${event.id}`,
    title: event.title,
    allDay: true,
    startDate: event.startDate,
    endDate: nextDate(event.endDate ?? event.startDate),
    description: ["JUET academic calendar", `${calendar.academicYear} · ${source.term} semester`, event.audience, event.notes].filter(Boolean).join("\n"),
  };
}

const displayDate = (date: string, includeYear: boolean) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: includeYear ? "numeric" : undefined, timeZone: "UTC" });
export function academicDateLabel(event: AcademicEvent, includeYear = true): string {
  if (!event.startDate) return event.timing ?? "To be announced";
  const date = displayDate(event.startDate, includeYear);
  if (event.dateRule === "before") return `Before ${date}`;
  if (event.dateRule === "from") return `From ${date} onwards`;
  return event.endDate && event.endDate !== event.startDate ? `${date} – ${displayDate(event.endDate, includeYear)}` : date;
}
