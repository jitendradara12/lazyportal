import test from "node:test";
import assert from "node:assert/strict";
import { examTimes, groupExams, formatExamRoom, cleanExamSubject } from "../src/lib/exams.ts";

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

test("formatExamRoom cleans up portal room codes and handles edge cases", () => {
  // Standard portal formats
  assert.equal(formatExamRoom("LT-4: LECTURE THEATER 4"), "LT-4");
  assert.equal(formatExamRoom("CR-3: whatever"), "CR-3");
  assert.equal(formatExamRoom("CL-5: whatever"), "CL-5");
  assert.equal(formatExamRoom("cl-5: whatever"), "CL-5");
  assert.equal(formatExamRoom("lt-4: whatever"), "LT-4");
  assert.equal(formatExamRoom("TR-1: TUTORIAL ROOM 1"), "TR-1");
  assert.equal(formatExamRoom("MPH: MULTI PURPOSE HALL"), "MPH");
  assert.equal(formatExamRoom("AUDI: AUDITORIUM"), "AUDI");
  assert.equal(formatExamRoom("EC-LAB: ELECTRONICS LAB"), "EC-LAB");

  // Spaces around colon / unhyphenated codes
  assert.equal(formatExamRoom("LT 4: LECTURE THEATER 4"), "LT-4");
  assert.equal(formatExamRoom("  CR-3   :   CLASS ROOM 3  "), "CR-3");
  assert.equal(formatExamRoom("CR 3 : CLASS ROOM 3"), "CR-3");

  // Already concise code or plain venue
  assert.equal(formatExamRoom("LT-4"), "LT-4");
  assert.equal(formatExamRoom("CR-3"), "CR-3");
  assert.equal(formatExamRoom("CL-5"), "CL-5");
  assert.equal(formatExamRoom("Auditorium"), "Auditorium");
  assert.equal(formatExamRoom("To be announced"), "To be announced");

  // Full descriptions without code
  assert.equal(formatExamRoom("LECTURE THEATER 4"), "LT-4");
  assert.equal(formatExamRoom("Lecture Theatre-4"), "LT-4");
  assert.equal(formatExamRoom("CLASS ROOM 3"), "CR-3");
  assert.equal(formatExamRoom("Classroom 3"), "CR-3");
  assert.equal(formatExamRoom("COMPUTER LAB 5"), "CL-5");
  assert.equal(formatExamRoom("Tutorial Room 2"), "TR-2");

  // Label prefixes
  assert.equal(formatExamRoom("Room: LT-4: LECTURE THEATER 4"), "LT-4");
  assert.equal(formatExamRoom("Room: CR-3"), "CR-3");
  assert.equal(formatExamRoom("Venue: CL-5"), "CL-5");

  // Colon edge cases
  assert.equal(formatExamRoom(": LECTURE THEATER 4"), "LT-4");
  assert.equal(formatExamRoom("LT-4:"), "LT-4");
  assert.equal(formatExamRoom("Note: Exam conducted online"), "Note: Exam conducted online");
  assert.equal(formatExamRoom("Exams for batch A will be in: LT-4"), "LT-4");
  assert.equal(formatExamRoom("Random Hall"), "Random Hall");
  assert.equal(formatExamRoom("Random Prefix: Some details"), "Random Prefix");

  // Empty / nullish
  assert.equal(formatExamRoom(null), "—");
  assert.equal(formatExamRoom(undefined), "—");
  assert.equal(formatExamRoom(""), "—");
  assert.equal(formatExamRoom("   "), "—");
  assert.equal(formatExamRoom("—"), "—");
  assert.equal(formatExamRoom("-"), "—");
});

test("cleanExamSubject strips course codes in parentheses", () => {
  assert.equal(cleanExamSubject("Concepts of Economics (Hs301)"), "Concepts of Economics");
  assert.equal(cleanExamSubject("Theory of Computation (Cs110)"), "Theory of Computation");
  assert.equal(cleanExamSubject("Materials Science and Applications (Ph304)"), "Materials Science and Applications");
  assert.equal(cleanExamSubject("Artificial Intelligence (Cs303)"), "Artificial Intelligence");
  assert.equal(cleanExamSubject("Probability Theory and Random Processes (Ma106)"), "Probability Theory and Random Processes");
  assert.equal(cleanExamSubject("Computer Networks (Cs109)"), "Computer Networks");

  // Portal uppercase with/without spaces
  assert.equal(cleanExamSubject("CONCEPTS OF ECONOMICS (HS301)"), "CONCEPTS OF ECONOMICS");
  assert.equal(cleanExamSubject("THEORY OF COMPUTATION(CS110)"), "THEORY OF COMPUTATION");

  // Subjects without codes or edge cases
  assert.equal(cleanExamSubject("Computer Networks"), "Computer Networks");
  assert.equal(cleanExamSubject("(CS101)"), "(CS101)");
  assert.equal(cleanExamSubject(null), "");
  assert.equal(cleanExamSubject(undefined), "");
  assert.equal(cleanExamSubject(""), "");
});
