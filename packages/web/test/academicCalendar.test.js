import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { academicBounds, academicCalendarEvent, academicDateLabel, academicSchedule, currentAcademicCalendar, academicDays, academicYears, groupAcademicEvents, matchesAcademicSearch, nextDate, portalDate } from "../src/lib/academicCalendar.ts";
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

test("both semesters of an academic year form one timeline with distinguishable events", () => {
  const [year, ...others] = academicYears(calendars);
  assert.equal(others.length, 0);
  assert.equal(year.academicYear, "2026-27");
  assert.deepEqual(year.semesters.map((semester) => semester.term), ["odd", "even"]);
  assert.equal(year.events.length, odd.events.length + even.events.length);
  assert.equal(new Set(year.events.map((event) => `${event.semester.id}:${event.id}`)).size, year.events.length);
  const holi = year.events.find((event) => event.semester.id === even.id && event.id === "t2");
  assert.equal(academicCalendarEvent(year, holi).id, `academic:${even.id}:t2`);
  assert.match(academicCalendarEvent(year, holi).description, /even semester/);
  const upcoming = groupAcademicEvents(year.events, Date.parse("2026-10-25T12:00:00+05:30")).upcoming;
  assert.ok(upcoming.some((event) => event.semester.id === odd.id) && upcoming.some((event) => event.semester.id === even.id));
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

test("holiday aliases find the published title without changing export titles", () => {
  const holiday = odd.events.find((event) => event.id === "deepawali");
  for (const query of ["diwali", "  DEEPAWALI  ", "deepavali", "8  Nov 2026", ""]) {
    assert.equal(matchesAcademicSearch(holiday, query), true, query);
  }
  assert.equal(odd.events.filter((event) => matchesAcademicSearch(event, "diwali")).length, 2);
  assert.equal(matchesAcademicSearch(holiday, "republic"), false);
  assert.equal(academicCalendarEvent(odd, holiday).title, "Deepawali");
});

test("month grid days: holidays share the break tone, the strongest tone wins, rules mark only their start", () => {
  const ev = (id, category, startDate, endDate, dateRule) => ({ id, title: id, category, startDate, endDate, dateRule });
  const days = academicDays([
    ev("break", "break", "2026-11-06", "2026-11-14"), ev("holiday", "holiday", "2026-11-08"),
    ev("test", "exam", "2026-11-10", "2026-11-11"), ev("from", "academic", "2026-11-20", undefined, "from"),
    { id: "tba", title: "tba", category: "academic", dateRule: "tba" },
  ]);
  assert.equal(days.get("2026-11-08").tone, "break");
  assert.equal(days.get("2026-11-08").events.length, 2);
  assert.equal(days.get("2026-11-10").tone, "exam");
  assert.equal(days.get("2026-11-12").tone, "break");
  assert.equal(days.has("2026-11-21"), false);
  assert.equal(days.size, 10);
});

test("month groups retain every event and put contained holidays under their break", () => {
  const { upcoming } = groupAcademicEvents(odd.events, Date.parse("2026-10-25T12:00:00+05:30"));
  const schedule = academicSchedule(upcoming);
  assert.deepEqual(schedule.map((month) => month.month), ["2026-10", "2026-11", "2026-12", "2027-01"]);
  const rows = schedule.flatMap((month) => month.entries);
  const deepawali = rows.find(({ event }) => event.id === "deepawali-break");
  assert.deepEqual(deepawali.holidays.map((event) => event.id), ["deepawali", "govardhan"]);
  assert.deepEqual(rows.find(({ event }) => event.id === "winter-vacation").holidays.map((event) => event.id), ["christmas"]);
  assert.deepEqual(rows.flatMap(({ event, holidays }) => [event, ...holidays]).map((event) => event.id).sort(), upcoming.map((event) => event.id).sort());
  assert.ok(deepawali.holidays.every((event) => academicCalendarEvent(odd, event)));
  assert.ok(academicSchedule(upcoming, false).flatMap((month) => month.entries).every((row) => row.holidays.length === 0));
  assert.deepEqual(academicSchedule(upcoming, true, true).map((month) => month.month), ["2027-01", "2026-12", "2026-11", "2026-10"]);
});

test("holiday grouping never assumes a proposed break or mixes staff and student dates", () => {
  const holiday = odd.events.find((event) => event.id === "deepawali");
  const vacation = odd.events.find((event) => event.id === "deepawali-break");
  for (const change of [{ status: "tentative" }, { dateRule: "from" }, { audience: "Faculty & staff" }, { endDate: "2026-11-07" }]) {
    const rows = academicSchedule([{ ...vacation, ...change }, holiday]).flatMap((month) => month.entries);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.holidays.length === 0));
  }
});
