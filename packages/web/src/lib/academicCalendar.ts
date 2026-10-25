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
}
export interface AcademicCalendar {
  id: string;
  academicYear: string;
  term: string;
  startsOn: string;
  events: AcademicEvent[];
}

export function matchesAcademicSearch(event: AcademicEvent, query: string): boolean {
  const text = [event.title, academicCategories[event.category], academicDateLabel(event), event.audience, event.notes, ...(event.aliases ?? [])].filter(Boolean).join(" ");
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalize(text).includes(normalize(query));
}

export function matchesAcademicAudience(event: AcademicEvent, audience: string): boolean {
  if (audience === "all") return true;
  if (event.audience === "Faculty & staff") return false;
  if (audience === "students" || !event.audience || event.audience === "Students") return true;
  if (event.audience.includes("Ph.D.")) return audience === "phd";
  if (event.audience === "First year") return audience === "first-year";
  if (["Except first year", "Years 2–4", "Final semester"].includes(event.audience)) return audience === "continuing";
  if (event.audience === "Years 1–3") return audience !== "phd";
  return true;
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

export function academicCalendarEvent(calendar: AcademicCalendar, event: AcademicEvent): CalendarEvent | null {
  if (!event.startDate || event.dateRule || event.status === "tentative") return null;
  return {
    id: `academic:${calendar.id}:${event.id}`,
    title: event.title,
    allDay: true,
    startDate: event.startDate,
    endDate: nextDate(event.endDate ?? event.startDate),
    description: ["JUET academic calendar", `${calendar.academicYear} · ${calendar.term} semester`, event.audience, event.notes].filter(Boolean).join("\n"),
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
