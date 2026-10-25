import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { academicBounds, academicCalendarEvent, academicDateLabel, currentAcademicCalendar, groupAcademicEvents, nextDate, portalDate } from "../src/lib/academicCalendar.ts";
import { calendarFile, googleCalendarUrl } from "../src/lib/calendar.ts";

const dataDir = new URL("../src/data/academic-calendars/", import.meta.url);
const calendars = readdirSync(dataDir).filter((file) => file.endsWith(".json")).map((file) => JSON.parse(readFileSync(new URL(file, dataDir), "utf8")));
const odd = calendars.find((calendar) => calendar.term === "odd");
const even = calendars.find((calendar) => calendar.term === "even");

test("every maintained calendar has valid dates and unique event IDs", () => {
  assert.equal(new Set(calendars.map((calendar) => calendar.id)).size, calendars.length);
  for (const calendar of calendars) {
    assert.ok(calendar.events.length > 0);
    assert.equal(new Set(calendar.events.map((event) => event.id)).size, calendar.events.length);
    for (const event of calendar.events) {
      assert.ok(event.id && event.title);
      assert.ok(["exam", "holiday", "break", "deadline", "academic"].includes(event.category));
      assert.ok(!event.dateRule || ["before", "from", "relative", "tba"].includes(event.dateRule));
      for (const date of [event.startDate, event.endDate].filter(Boolean)) {
        assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
      }
      if (event.endDate) assert.ok(event.startDate && event.endDate >= event.startDate);
      if (!event.startDate) assert.ok(["relative", "tba"].includes(event.dateRule));
      if (["before", "from"].includes(event.dateRule)) assert.ok(event.startDate && !event.endDate);
      if (event.dateRule === "relative") assert.ok(event.timing);
      if (event.status) assert.equal(event.status, "tentative");
    }
  }
});

test("term selection follows term starts rather than the January boundary or trailing supplementary exams", () => {
  assert.equal(currentAcademicCalendar(calendars, Date.parse("2026-10-25T12:00:00Z")).id, odd.id);
  assert.equal(currentAcademicCalendar(calendars, Date.parse("2027-01-03T18:29:59Z")).id, odd.id);
  assert.equal(currentAcademicCalendar(calendars, Date.parse("2027-01-03T18:30:00Z")).id, even.id);
  assert.equal(currentAcademicCalendar(calendars, 0).id, odd.id);
  assert.equal(portalDate(Date.parse("2026-12-31T20:00:00Z")), "2027-01-01");
});

test("all-day ranges include the last published day in IST and export date-only exclusive ends", () => {
  const event = even.events.find((event) => event.id === "t2");
  const exported = academicCalendarEvent(even, event);
  assert.equal(exported.allDay, true);
  assert.equal(exported.startDate, "2027-03-29");
  assert.equal(exported.endDate, "2027-04-04");
  assert.equal(academicBounds(event).end, Date.parse("2027-04-04T00:00:00+05:30"));
  assert.equal(groupAcademicEvents([event], Date.parse("2027-04-03T23:59:59+05:30")).upcoming.length, 1);
  assert.equal(groupAcademicEvents([event], Date.parse("2027-04-04T00:00:00+05:30")).past.length, 1);
  const file = calendarFile([exported], 0);
  assert.match(file, /DTSTART;VALUE=DATE:20270329\r\nDTEND;VALUE=DATE:20270404/);
  assert.equal(new URL(googleCalendarUrl(exported)).searchParams.get("dates"), "20270329/20270404");
  assert.equal(nextDate("2026-12-31"), "2027-01-01");
  assert.equal(nextDate("2028-02-28"), "2028-02-29");
});

test("single holidays export one day and corrected dates keep the same event UID", () => {
  const holiday = even.events.find((event) => event.id === "republic-day");
  const event = academicCalendarEvent(even, holiday);
  assert.equal(event.endDate, "2027-01-27");
  const uid = (event) => calendarFile([event], 0).match(/UID:.+/)[0];
  assert.equal(uid(event), uid(academicCalendarEvent(even, { ...holiday, startDate: "2027-01-27" })));
});

test("date guidance stays honest and proposed or incomplete dates cannot export", () => {
  const before = even.events.find((event) => event.id === "feedback");
  assert.equal(academicDateLabel(before), "Before 15 May 2027");
  assert.equal(academicBounds(before).end, Date.parse("2027-05-15T00:00:00+05:30"));
  for (const event of [...odd.events, ...even.events].filter((event) => event.dateRule || event.status)) {
    assert.equal(academicCalendarEvent(even, event), null);
  }
  const from = odd.events.find((event) => event.id === "project-viva");
  assert.equal(academicDateLabel(from), "From 26 Oct 2026 onwards");
  const relative = even.events.find((event) => event.id === "dpmc");
  assert.equal(academicDateLabel(relative), "Within 15 days of registration");
  assert.equal(groupAcademicEvents([relative], 0).guidance.length, 1);
});

test("onwards events keep their unknown end and move to guidance when they start", () => {
  const event = odd.events.find((event) => event.id === "project-viva");
  assert.equal(academicBounds(event).end, null);
  const before = groupAcademicEvents([event], Date.parse("2026-10-25T23:59:59+05:30"));
  assert.deepEqual(before.upcoming, [event]);
  assert.equal(before.guidance.length, 0);
  for (const now of ["2026-10-26T00:00:00+05:30", "2026-10-27T12:00:00+05:30"]) {
    const grouped = groupAcademicEvents([event], Date.parse(now));
    assert.equal(grouped.past.length, 0);
    assert.equal(grouped.upcoming.length, 0);
    assert.deepEqual(grouped.guidance, [event]);
  }
});
