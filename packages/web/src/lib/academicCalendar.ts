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
}
export interface AcademicCalendar {
  id: string;
  academicYear: string;
  term: string;
  startsOn: string;
  events: AcademicEvent[];
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

const displayDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export function academicDateLabel(event: AcademicEvent): string {
  if (!event.startDate) return event.timing ?? "To be announced";
  const date = displayDate(event.startDate);
  if (event.dateRule === "before") return `Before ${date}`;
  if (event.dateRule === "from") return `From ${date} onwards`;
  return event.endDate && event.endDate !== event.startDate ? `${date} – ${displayDate(event.endDate)}` : date;
}
