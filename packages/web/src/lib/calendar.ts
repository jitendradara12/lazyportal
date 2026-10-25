export type CalendarEvent = {
  id?: string;
  title: string;
  location?: string;
  description?: string;
} & ({ allDay: true; startDate: string; endDate: string } | { allDay?: false; start: number; end: number });

const compactDate = (date: string) => date.replaceAll("-", "");

const utcDate = (timestamp: number) => new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function googleCalendarUrl(event: CalendarEvent): string {
  const query = new URLSearchParams({
    action: "TEMPLATE", text: event.title,
    dates: event.allDay ? `${compactDate(event.startDate)}/${compactDate(event.endDate)}` : `${utcDate(event.start)}/${utcDate(event.end)}`,
    ctz: "Asia/Kolkata", location: event.location ?? "", details: event.description ?? "",
  });
  return `https://calendar.google.com/calendar/render?${query}`;
}

const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");

// RFC 5545 lines are limited to 75 octets, including continuation whitespace.
function foldLine(line: string): string {
  let result = "";
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) { result += "\r\n "; bytes = 1; }
    result += char;
    bytes += size;
  }
  return result;
}

export function calendarFile(events: CalendarEvent[], now = Date.now()): string | null {
  if (!events.length) return null;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lazyportal//Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const event of events) {
    // Stable, local UID; no student identifier or external service is involved.
    const identity = event.id ?? `${event.title}|${event.allDay ? event.startDate : event.start}|${event.location}`;
    let hash = 2166136261;
    for (const char of identity) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
    const uid = event.id ? (hash >>> 0).toString(16) : `${event.allDay ? event.startDate : event.start}-${(hash >>> 0).toString(16)}`;
    lines.push("BEGIN:VEVENT", `UID:${uid}@lazyportal`,
      `DTSTAMP:${utcDate(now)}`, event.allDay ? `DTSTART;VALUE=DATE:${compactDate(event.startDate)}` : `DTSTART:${utcDate(event.start)}`,
      event.allDay ? `DTEND;VALUE=DATE:${compactDate(event.endDate)}` : `DTEND:${utcDate(event.end)}`,
      `SUMMARY:${escapeText(event.title)}`, `LOCATION:${escapeText(event.location ?? "")}`,
      `DESCRIPTION:${escapeText(event.description ?? "")}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function downloadCalendar(events: CalendarEvent[], filename = "calendar.ics") {
  const content = calendarFile(events);
  if (!content) return;
  const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
