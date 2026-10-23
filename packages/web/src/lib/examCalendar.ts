import { examTimes, formatExamRoom, cleanExamSubject, type ExamRow } from "./exams.ts";

export function examCalendarEvent(row: ExamRow) {
  const times = examTimes(row);
  // The display parser intentionally keeps incomplete exams visible all day.
  // Never export that fallback as an invented start or end time.
  const clockTimes = [row.datetime, row.datetimefrom, row.datetimeupto]
    .filter(Boolean).join(" ").match(/\d{1,2}:\d{2}\s*(?:AM|PM)?/gi) ?? [];
  if (!times || clockTimes.length < 2 || times.end <= times.start) return null;
  const room = formatExamRoom(row.roomcode);
  const seat = String(row.seatno ?? "").trim();
  const roomCode = room === "—" ? "" : room.replace(/^(LT|CR|CL|TR)-(\d)/i, "$1$2");
  const location = [roomCode, seat === "—" || seat === "-" ? "" : seat].filter(Boolean).join("-");
  return {
    ...times,
    title: cleanExamSubject(row.subjectdesc) || "Exam",
    location,
    description: `Room: ${room}\nSeat: ${seat || "—"}`,
  };
}

const utcDate = (timestamp: number) => new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function googleExamUrl(row: ExamRow): string | null {
  const event = examCalendarEvent(row);
  if (!event) return null;
  const query = new URLSearchParams({
    action: "TEMPLATE", text: event.title,
    dates: `${utcDate(event.start)}/${utcDate(event.end)}`,
    ctz: "Asia/Kolkata", location: event.location, details: event.description,
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

export function examsCalendar(rows: ExamRow[], now = Date.now()): string | null {
  const events = rows.map(examCalendarEvent).filter((event) => event !== null);
  if (!events.length) return null;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lazyportal//Exams//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const event of events) {
    // Stable, local UID; no student identifier or external service is involved.
    const identity = `${event.title}|${event.start}|${event.location}`;
    let hash = 2166136261;
    for (const char of identity) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
    lines.push("BEGIN:VEVENT", `UID:${event.start}-${(hash >>> 0).toString(16)}@lazyportal`,
      `DTSTAMP:${utcDate(now)}`, `DTSTART:${utcDate(event.start)}`, `DTEND:${utcDate(event.end)}`,
      `SUMMARY:${escapeText(event.title)}`, `LOCATION:${escapeText(event.location)}`,
      `DESCRIPTION:${escapeText(event.description)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function downloadExamsCalendar(rows: ExamRow[]) {
  const content = examsCalendar(rows);
  if (!content) return;
  const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "exams.ics";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
