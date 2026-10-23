import { Capacitor, registerPlugin } from "@capacitor/core";
import { examCalendarEvent, examsCalendar, downloadExamsCalendar } from "./examCalendar";
import type { ExamRow } from "./exams";

export const nativeExamCalendar = registerPlugin<{
  insert(event: NonNullable<ReturnType<typeof examCalendarEvent>>): Promise<void>;
  exportCalendar(options: { content: string }): Promise<{ cancelled?: boolean }>;
}>("ExamCalendar");

export function canExportExamCalendar() {
  // Legacy APKs cannot save browser blob downloads. Keep Google Calendar available.
  return !Capacitor.isNativePlatform() || Capacitor.isPluginAvailable("ExamCalendar");
}

export async function exportExamCalendar(rows: ExamRow[]) {
  if (Capacitor.isNativePlatform()) {
    const content = examsCalendar(rows);
    if (!content) return;
    if (!canExportExamCalendar()) throw new Error("Update the app to export calendar files.");
    await nativeExamCalendar.exportCalendar({ content });
  } else {
    downloadExamsCalendar(rows);
  }
}
