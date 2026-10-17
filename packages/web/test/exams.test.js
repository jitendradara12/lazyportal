import test from "node:test";
import assert from "node:assert/strict";
import { examTimes, groupExams } from "../src/lib/exams.ts";

test("portal time ranges are parsed in IST, including noon and midnight", () => {
  assert.deepEqual(examTimes({ datetime: "18/10/2026", datetimeupto: "12:00 pm to 01:30 pm" }), {
    start: Date.parse("2026-10-18T12:00:00+05:30"),
    end: Date.parse("2026-10-18T13:30:00+05:30"),
  });
  assert.deepEqual(examTimes({ datetime: "18-10-2026", datetimefrom: "12:00 AM", datetimeupto: "01:30 AM" }), {
    start: Date.parse("2026-10-18T00:00:00+05:30"),
    end: Date.parse("2026-10-18T01:30:00+05:30"),
  });
});

test("completed exams leave the upcoming list at their end, not their start", () => {
  const row = { datetime: "18/10/2026", datetimeupto: "12:00 pm to 01:30 pm" };
  const { start, end } = examTimes(row);
  assert.deepEqual(groupExams([row], start).upcoming, [row]);
  assert.deepEqual(groupExams([row], end - 1).upcoming, [row]);
  assert.deepEqual(groupExams([row], end).past, [row]);
});

test("date-only and missing-end schedules stay visible until the end of their IST date", () => {
  for (const row of [{ datetime: "18/10/2026" }, { datetime: "18/10/2026", datetimefrom: "09:30 am" }]) {
    assert.equal(groupExams([row], Date.parse("2026-10-18T23:59:59+05:30")).upcoming.length, 1);
    assert.equal(groupExams([row], Date.parse("2026-10-19T00:00:00+05:30")).past.length, 1);
  }
});

test("mixed schedules are sorted, and unknown dates remain accessible without being counted", () => {
  const past = { datetime: "17/10/2026", datetimeupto: "12:00 pm to 01:30 pm" };
  const later = { datetime: "20/10/2026", datetimeupto: "09:30 am to 11:00 am" };
  const next = { datetime: "19/10/2026", datetimeupto: "03:00 pm to 04:30 pm" };
  const undated = { datetime: "To be announced" };
  assert.deepEqual(groupExams([later, undated, past, next], Date.parse("2026-10-18T10:00:00+05:30")), {
    upcoming: [next, later], past: [past], undated: [undated],
  });
  assert.equal(examTimes({ datetime: "31/02/2026" }), null);
  assert.equal(examTimes({ datetime: "18/10/2026", datetimeupto: "25:00" }), null);
});
