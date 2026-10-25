import { Capacitor, registerPlugin } from "@capacitor/core";
import { calendarFile, downloadCalendar, type CalendarEvent } from "./calendar";

// Keep the installed bridge name so existing APKs retain timed exam exports.
export const nativeCalendar = registerPlugin<{
  insert(event: { title: string; start: number; end: number; location?: string; description?: string; allDay?: boolean }): Promise<void>;
  getCapabilities(): Promise<{ allDay: boolean }>;
  exportCalendar(options: { content: string; filename?: string }): Promise<{ cancelled?: boolean }>;
}>("ExamCalendar");

export function canExportCalendar() {
  return !Capacitor.isNativePlatform() || Capacitor.isPluginAvailable("ExamCalendar");
}

export async function insertCalendarEvent(event: CalendarEvent): Promise<boolean> {
  if (!Capacitor.isPluginAvailable("ExamCalendar")) return false;
  if (event.allDay) {
    // Older APKs must use Google/ICS rather than silently create timed events.
    try { if (!(await nativeCalendar.getCapabilities()).allDay) return false; }
    catch { return false; }
    await nativeCalendar.insert({ ...event, start: Date.parse(`${event.startDate}T00:00:00Z`), end: Date.parse(`${event.endDate}T00:00:00Z`) });
  } else await nativeCalendar.insert(event);
  return true;
}

export async function exportCalendar(events: CalendarEvent[], filename = "calendar.ics") {
  if (Capacitor.isNativePlatform()) {
    const content = calendarFile(events);
    if (!content) return;
    if (!canExportCalendar()) throw new Error("Update the app to export calendar files.");
    await nativeCalendar.exportCalendar({ content, filename });
  } else downloadCalendar(events, filename);
}
