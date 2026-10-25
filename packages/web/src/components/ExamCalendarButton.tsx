import { CalendarButton } from "./CalendarButton";
import { examCalendarEvent } from "../lib/examCalendar";
import type { ExamRow } from "../lib/exams";

export function ExamCalendarButton({ row }: { row: ExamRow }) {
  return <CalendarButton event={examCalendarEvent(row)} filename="exams.ics" unavailableLabel="Calendar unavailable until exam times are announced" />;
}
