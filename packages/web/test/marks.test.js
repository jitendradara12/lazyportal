import test from "node:test";
import assert from "node:assert/strict";

const { formatEventCode, groupSubjectMarks, mergeMarkRows } = await import("../src/lib/marks.ts");

test("partial refreshes keep earlier exams and replace corrected scores without double counting", () => {
  const t1 = Object.freeze({ subjectcode: "CS303", eventcode: "TEST-1", obtainedmarks: 7, fullmarks: 15 });
  const t2 = Object.freeze({ subjectcode: "CS303", eventcode: "TEST-2", obtainedmarks: 13, fullmarks: 25 });
  const previous = Object.freeze([t1]);
  const merged = mergeMarkRows(previous, [t2]);
  assert.deepEqual(summarize(merged), [
    { subjectcode: "CS303", subjectdesc: undefined, eventcode: "T1 · T2", obtainedmarks: 20, fullmarks: 40 },
  ]);
  const corrected = { ...t1, subjectcode: " cs303 ", eventcode: "T 1", obtainedmarks: 0 };
  assert.deepEqual(mergeMarkRows(merged, [corrected]), [corrected, t2]);
  assert.deepEqual(mergeMarkRows(merged, [t2]), merged);
  assert.deepEqual(mergeMarkRows(merged, []), merged);
  assert.deepEqual(previous, [t1]);
});

// Check course totals and the exact exams contributing to each total together.
function summarize(rows) {
  return groupSubjectMarks(rows).map(({ exams, ...course }) => ({
    ...course,
    eventcode: exams.map((exam) => formatEventCode(exam.eventcode)).join(" · "),
  }));
}

test("formatEventCode converts test events to compact T/P format", () => {
  assert.equal(formatEventCode("TEST-1"), "T1");
  assert.equal(formatEventCode("TEST-2"), "T2");
  assert.equal(formatEventCode("TEST-3"), "T3");
  assert.equal(formatEventCode("TEST 1"), "T1");
  assert.equal(formatEventCode("TEST -1"), "T1");
  assert.equal(formatEventCode("test1"), "T1");
  assert.equal(formatEventCode("P-1"), "P1");
  assert.equal(formatEventCode("P-2"), "P2");
  assert.equal(formatEventCode("p-3"), "P3");
  assert.equal(formatEventCode("P 1"), "P1");
  assert.equal(formatEventCode("T-1"), "T1");
  assert.equal(formatEventCode("T 1"), "T1");
  assert.equal(formatEventCode("PRAC-1"), "P1");
  assert.equal(formatEventCode(1), "1");
  assert.equal(formatEventCode(null), "");
  assert.equal(formatEventCode(""), "");
  assert.equal(formatEventCode(undefined), "");
  assert.equal(formatEventCode("MID-SEM"), "MID-SEM");
});

test("course totals and their exams across all 6 semester timelines", () => {
  // 1. No exams happened
  assert.deepEqual(groupSubjectMarks([]), []);

  // 2. T1 happened
  const t1Rows = [
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "TEST -1", obtainedmarks: "9.0", fullmarks: "15.0" },
    { subjectcode: "CS103", subjectdesc: "DATA STRUCTURES", eventcode: "TEST-1", obtainedmarks: "9.0", fullmarks: "15.0" },
  ];
  assert.deepEqual(summarize(t1Rows), [
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "T1", obtainedmarks: 9, fullmarks: 15 },
    { subjectcode: "CS103", subjectdesc: "DATA STRUCTURES", eventcode: "T1", obtainedmarks: 9, fullmarks: 15 },
  ]);

  // 3. P1 happened (practicals are separate courses)
  const p1Rows = [
    ...t1Rows,
    { subjectcode: "CS203", subjectdesc: "DATA STRUCTURES LAB", eventcode: "P-1", obtainedmarks: "11.0", fullmarks: "15.0" },
    { subjectcode: "CS204", subjectdesc: "DATABASE SYSTEMS LAB", eventcode: "P-1", obtainedmarks: "10.0", fullmarks: "15.0" },
  ];
  assert.deepEqual(summarize(p1Rows), [
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "T1", obtainedmarks: 9, fullmarks: 15 },
    { subjectcode: "CS103", subjectdesc: "DATA STRUCTURES", eventcode: "T1", obtainedmarks: 9, fullmarks: 15 },
    { subjectcode: "CS203", subjectdesc: "DATA STRUCTURES LAB", eventcode: "P1", obtainedmarks: 11, fullmarks: 15 },
    { subjectcode: "CS204", subjectdesc: "DATABASE SYSTEMS LAB", eventcode: "P1", obtainedmarks: 10, fullmarks: 15 },
  ]);

  // 4. T2 happened
  const t2Rows = [
    ...p1Rows,
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "TEST-2", obtainedmarks: "13.0", fullmarks: "25.0" },
    { subjectcode: "CS103", subjectdesc: "DATA STRUCTURES", eventcode: "TEST-2", obtainedmarks: "11.0", fullmarks: "25.0" },
  ];
  assert.deepEqual(summarize(t2Rows), [
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "T1 · T2", obtainedmarks: 22, fullmarks: 40 },
    { subjectcode: "CS103", subjectdesc: "DATA STRUCTURES", eventcode: "T1 · T2", obtainedmarks: 20, fullmarks: 40 },
    { subjectcode: "CS203", subjectdesc: "DATA STRUCTURES LAB", eventcode: "P1", obtainedmarks: 11, fullmarks: 15 },
    { subjectcode: "CS204", subjectdesc: "DATABASE SYSTEMS LAB", eventcode: "P1", obtainedmarks: 10, fullmarks: 15 },
  ]);

  // 5. P2 happened
  const p2Rows = [
    ...t2Rows,
    { subjectcode: "CS203", subjectdesc: "DATA STRUCTURES LAB", eventcode: "P-2", obtainedmarks: "11.0", fullmarks: "15.0" },
    { subjectcode: "CS204", subjectdesc: "DATABASE SYSTEMS LAB", eventcode: "P-2", obtainedmarks: "12.0", fullmarks: "15.0" },
  ];
  assert.deepEqual(summarize(p2Rows), [
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "T1 · T2", obtainedmarks: 22, fullmarks: 40 },
    { subjectcode: "CS103", subjectdesc: "DATA STRUCTURES", eventcode: "T1 · T2", obtainedmarks: 20, fullmarks: 40 },
    { subjectcode: "CS203", subjectdesc: "DATA STRUCTURES LAB", eventcode: "P1 · P2", obtainedmarks: 22, fullmarks: 30 },
    { subjectcode: "CS204", subjectdesc: "DATABASE SYSTEMS LAB", eventcode: "P1 · P2", obtainedmarks: 22, fullmarks: 30 },
  ]);

  // 6. T3 happened (including fractional marks and partial course uploads)
  const t3Rows = [
    ...p2Rows,
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "TEST-3", obtainedmarks: "21.0", fullmarks: "35.0" },
    { subjectcode: "HS103", subjectdesc: "TECHNIQUES FOR DECISION MAKING", eventcode: "TEST -1", obtainedmarks: "11.5", fullmarks: "15.0" },
    { subjectcode: "HS103", subjectdesc: "TECHNIQUES FOR DECISION MAKING", eventcode: "TEST-2", obtainedmarks: "16.5", fullmarks: "25.0" },
    { subjectcode: "HS103", subjectdesc: "TECHNIQUES FOR DECISION MAKING", eventcode: "TEST-3", obtainedmarks: "16.5", fullmarks: "35.0" },
    { subjectcode: "HS007", subjectdesc: "CAREER MANAGEMENT AND DEVELOPMENT", eventcode: "TEST-2", obtainedmarks: "8.0", fullmarks: "25.0" },
    { subjectcode: "HS007", subjectdesc: "CAREER MANAGEMENT AND DEVELOPMENT", eventcode: "TEST-3", obtainedmarks: "13.0", fullmarks: "35.0" },
  ];
  assert.deepEqual(summarize(t3Rows), [
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "T1 · T2 · T3", obtainedmarks: 43, fullmarks: 75 },
    { subjectcode: "CS103", subjectdesc: "DATA STRUCTURES", eventcode: "T1 · T2", obtainedmarks: 20, fullmarks: 40 },
    { subjectcode: "CS203", subjectdesc: "DATA STRUCTURES LAB", eventcode: "P1 · P2", obtainedmarks: 22, fullmarks: 30 },
    { subjectcode: "CS204", subjectdesc: "DATABASE SYSTEMS LAB", eventcode: "P1 · P2", obtainedmarks: 22, fullmarks: 30 },
    { subjectcode: "HS103", subjectdesc: "TECHNIQUES FOR DECISION MAKING", eventcode: "T1 · T2 · T3", obtainedmarks: 44.5, fullmarks: 75 },
    { subjectcode: "HS007", subjectdesc: "CAREER MANAGEMENT AND DEVELOPMENT", eventcode: "T2 · T3", obtainedmarks: 21, fullmarks: 60 },
  ]);
});

test("course breakdowns preserve original exam rows, sort naturally and leave the source unchanged", () => {
  const rows = Object.freeze([
    Object.freeze({ subjectcode: " CS109 ", subjectdesc: "COMPUTER NETWORKS", eventcode: "TEST-3", obtainedmarks: "28.5", fullmarks: "35" }),
    Object.freeze({ subjectcode: "CS212", subjectdesc: "COMPUTER NETWORKS LAB", eventcode: "P-2", obtainedmarks: 14, fullmarks: 15 }),
    Object.freeze({ subjectcode: "cs109", eventcode: "TEST-1", obtainedmarks: 9, fullmarks: 15 }),
    Object.freeze({ subjectcode: "CS109", eventcode: "TEST-2", obtainedmarks: 20, fullmarks: 25 }),
    Object.freeze({ subjectcode: "CS212", eventcode: "P-1", obtainedmarks: 11, fullmarks: 15 }),
  ]);
  const [theory, lab] = groupSubjectMarks(rows);
  assert.equal(theory.obtainedmarks, 57.5);
  assert.equal(theory.fullmarks, 75);
  assert.deepEqual(theory.exams, [rows[2], rows[3], rows[0]]);
  assert.equal(theory.exams[0], rows[2]);
  assert.deepEqual(lab.exams, [rows[4], rows[1]]);
  assert.equal(lab.obtainedmarks, 25);
  assert.equal(lab.fullmarks, 30);
});

test("missing marks stay missing, zero stays zero and nonnumeric exam statuses remain available", () => {
  const rows = [
    { subjectdesc: "Missing", eventcode: "T1", obtainedmarks: " ", fullmarks: " " },
    { subjectcode: "ZERO", eventcode: "T1", obtainedmarks: "0", fullmarks: "15" },
    { subjectcode: "ABSENT", eventcode: "T1", obtainedmarks: "AB", fullmarks: 15 },
    { subjectcode: "PARTIAL", eventcode: "T1", obtainedmarks: "AB", fullmarks: 15 },
    { subjectcode: "PARTIAL", eventcode: "T2", obtainedmarks: 12.5, fullmarks: 25 },
  ];
  const [missing, zero, absent, partial] = groupSubjectMarks(rows);
  assert.equal(missing.obtainedmarks, " ");
  assert.equal(missing.fullmarks, undefined);
  assert.equal(zero.obtainedmarks, 0);
  assert.equal(absent.obtainedmarks, "AB");
  assert.equal(partial.obtainedmarks, 12.5);
  assert.equal(partial.fullmarks, 40);
  assert.equal(partial.exams[0].obtainedmarks, "AB");
});

test("courses without codes group by name while anonymous rows remain separate", () => {
  const groups = groupSubjectMarks([
    { subjectdesc: " Elective ", eventcode: "T2", obtainedmarks: 0.2, fullmarks: 25 },
    { subjectdesc: "elective", eventcode: "T1", obtainedmarks: 0.1, fullmarks: 15 },
    { obtainedmarks: 2 },
    { obtainedmarks: 3 },
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].obtainedmarks, 0.3);
  assert.equal(groups[0].fullmarks, 40);
  assert.equal(groups[0].exams.length, 2);
});
