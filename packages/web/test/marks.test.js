import test from "node:test";
import assert from "node:assert/strict";

const { formatEventCode, extractEvents, combineSubjectMarks } = await import("../src/lib/marks.ts");

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

test("combineSubjectMarks and extractEvents across all 6 semester timelines", () => {
  // 1. No exams happened
  assert.deepEqual(extractEvents([]), []);
  assert.deepEqual(combineSubjectMarks([]), []);

  // 2. T1 happened
  const t1Rows = [
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "TEST -1", obtainedmarks: "9.0", fullmarks: "15.0" },
    { subjectcode: "CS103", subjectdesc: "DATA STRUCTURES", eventcode: "TEST-1", obtainedmarks: "9.0", fullmarks: "15.0" },
  ];
  assert.deepEqual(extractEvents(t1Rows), ["T1"]);
  assert.deepEqual(combineSubjectMarks(t1Rows), [
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "T1", obtainedmarks: 9, fullmarks: 15 },
    { subjectcode: "CS103", subjectdesc: "DATA STRUCTURES", eventcode: "T1", obtainedmarks: 9, fullmarks: 15 },
  ]);

  // 3. P1 happened (practicals are separate courses)
  const p1Rows = [
    ...t1Rows,
    { subjectcode: "CS203", subjectdesc: "DATA STRUCTURES LAB", eventcode: "P-1", obtainedmarks: "11.0", fullmarks: "15.0" },
    { subjectcode: "CS204", subjectdesc: "DATABASE SYSTEMS LAB", eventcode: "P-1", obtainedmarks: "10.0", fullmarks: "15.0" },
  ];
  assert.deepEqual(extractEvents(p1Rows), ["T1", "P1"]);
  assert.deepEqual(combineSubjectMarks(p1Rows), [
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
  assert.deepEqual(extractEvents(t2Rows), ["T1", "T2", "P1"]);
  assert.deepEqual(combineSubjectMarks(t2Rows), [
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
  assert.deepEqual(extractEvents(p2Rows), ["T1", "T2", "P1", "P2"]);
  assert.deepEqual(combineSubjectMarks(p2Rows), [
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
  assert.deepEqual(extractEvents(t3Rows), ["T1", "T2", "T3", "P1", "P2"]);
  assert.deepEqual(combineSubjectMarks(t3Rows), [
    { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "T1 · T2 · T3", obtainedmarks: 43, fullmarks: 75 },
    { subjectcode: "CS103", subjectdesc: "DATA STRUCTURES", eventcode: "T1 · T2", obtainedmarks: 20, fullmarks: 40 },
    { subjectcode: "CS203", subjectdesc: "DATA STRUCTURES LAB", eventcode: "P1 · P2", obtainedmarks: 22, fullmarks: 30 },
    { subjectcode: "CS204", subjectdesc: "DATABASE SYSTEMS LAB", eventcode: "P1 · P2", obtainedmarks: 22, fullmarks: 30 },
    { subjectcode: "HS103", subjectdesc: "TECHNIQUES FOR DECISION MAKING", eventcode: "T1 · T2 · T3", obtainedmarks: 44.5, fullmarks: 75 },
    { subjectcode: "HS007", subjectdesc: "CAREER MANAGEMENT AND DEVELOPMENT", eventcode: "T2 · T3", obtainedmarks: 21, fullmarks: 60 },
  ]);
});
