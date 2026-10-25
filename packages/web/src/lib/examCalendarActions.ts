import { examCalendarEvent } from "./examCalendar";
import { nativeCalendar, canExportCalendar, exportCalendar } from "./calendarActions";
import type { ExamRow } from "./exams";

export const nativeExamCalendar = nativeCalendar;
export const canExportExamCalendar = canExportCalendar;
export async function exportExamCalendar(rows: ExamRow[]) {
  await exportCalendar(rows.map(examCalendarEvent).filter((event) => event !== null), "exams.ics");
}
