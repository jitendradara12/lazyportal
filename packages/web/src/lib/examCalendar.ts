import { googleCalendarUrl, calendarFile, downloadCalendar } from "./calendar.ts";
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

export function googleExamUrl(row: ExamRow): string | null {
  const event = examCalendarEvent(row);
  return event ? googleCalendarUrl(event) : null;
}

export function examsCalendar(rows: ExamRow[], now = Date.now()): string | null {
  return calendarFile(rows.map(examCalendarEvent).filter((event) => event !== null), now);
}

export function downloadExamsCalendar(rows: ExamRow[]) {
  downloadCalendar(rows.map(examCalendarEvent).filter((event) => event !== null), "exams.ics");
}
