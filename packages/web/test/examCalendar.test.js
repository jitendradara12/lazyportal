import test from "node:test";
import assert from "node:assert/strict";
import { examCalendarEvent, googleExamUrl, examsCalendar } from "../src/lib/examCalendar.ts";

const row = { datetime: "23/10/2026", datetimeupto: "09:30 am to 12:30 pm", subjectdesc: "Computer Networks (CS109)", roomcode: "LT-3: Lecture Theatre 3", seatno: "B5" };

test("calendar destinations preserve IST instants, subject and room-seat location", () => {
  const event = examCalendarEvent(row);
  assert.equal(event.start, Date.parse("2026-10-23T09:30:00+05:30"));
  assert.equal(event.end, Date.parse("2026-10-23T12:30:00+05:30"));
  assert.equal(event.location, "LT3-B5");
  assert.equal(event.title, "Computer Networks");
  const url = new URL(googleExamUrl(row));
  assert.equal(url.searchParams.get("dates"), "20261023T040000Z/20261023T070000Z");
  assert.equal(url.searchParams.get("location"), "LT3-B5");
  assert.equal(url.searchParams.get("ctz"), "Asia/Kolkata");
  assert.equal(url.searchParams.get("details"), "Room: LT-3\nSeat: B5");
});

test("incomplete and invalid times cannot export the display parser's fallback", () => {
  for (const input of [{}, { datetime: "23/10/2026" }, { datetime: "23/10/2026", datetimefrom: "09:30 am" }, { ...row, datetime: "31/02/2026" }, { ...row, datetimeupto: "29:30 to 30:30" }]) {
    assert.equal(examCalendarEvent(input), null);
    assert.equal(googleExamUrl(input), null);
    assert.equal(examsCalendar([input]), null);
  }
});

test("ICS exports multiple events, stable UIDs, escaped text and folded UTF-8 lines", () => {
  const special = { ...row, subjectdesc: "数学, topic; \\ test\n".repeat(12), seatno: undefined };
  const calendar = examsCalendar([row, special, {}], 0);
  assert.equal((calendar.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.match(calendar, /DTSTART:20261023T040000Z\r\n/);
  assert.match(calendar, /DTEND:20261023T070000Z\r\n/);
  assert.match(calendar, /LOCATION:LT3-B5/);
  assert.match(calendar.replace(/\r\n /g, ""), /数学\\, topic\\; \\\\ test\\n/);
  assert.ok(calendar.endsWith("END:VCALENDAR\r\n"));
  for (const line of calendar.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  assert.deepEqual(calendar.match(/UID:.+/g), examsCalendar([row, special], 1000).match(/UID:.+/g));
});

test("overnight exams retain the correct end date and missing venues stay empty", () => {
  const overnight = { ...row, datetimeupto: "11:30 pm to 01:30 am", roomcode: undefined, seatno: undefined };
  const event = examCalendarEvent(overnight);
  assert.equal(event.end, Date.parse("2026-10-24T01:30:00+05:30"));
  assert.equal(event.location, "");
});
