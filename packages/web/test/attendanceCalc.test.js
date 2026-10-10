import test from "node:test";
import assert from "node:assert/strict";

const {
  isSubjectDetailComplete,
  combinedAttendance,
  computeBunkMargin,
  getColorClass,
  parseClassLogs,
  pct,
} = await import("../src/lib/attendanceCalc.ts");

const {
  doesSubjectNeedDeepFetch,
  computeSubjectRowChecksum,
} = await import("../src/lib/portalSchedule.ts");

test("isSubjectDetailComplete validates component completeness", () => {
  const rowLT = {
    subjectcode: "MA106",
    Lsubjectcomponentid: "comp_l",
    Tsubjectcomponentid: "comp_t",
  };

  assert.equal(isSubjectDetailComplete(rowLT, null), false, "null detail is incomplete");
  assert.equal(isSubjectDetailComplete(rowLT, undefined), false, "undefined detail is incomplete");
  assert.equal(isSubjectDetailComplete(rowLT, {}), false, "empty detail is incomplete");

  // Only tutorial fetched (the PTRP bug)
  const tutOnly = { T: { summary: [{ present: "Y" }] } };
  assert.equal(isSubjectDetailComplete(rowLT, tutOnly), false, "tut-only detail is incomplete when L is expected");

  // Lecture only fetched
  const lecOnly = { L: { summary: [{ present: "Y" }] } };
  assert.equal(isSubjectDetailComplete(rowLT, lecOnly), false, "lec-only detail is incomplete when T is expected");

  // Both L and T fetched
  const fullLT = {
    L: { summary: [{ present: "Y" }] },
    T: { summary: [{ present: "Y" }] },
  };
  assert.equal(isSubjectDetailComplete(rowLT, fullLT), true, "both L and T present is complete");

  // Practical lab row
  const rowLab = {
    subjectcode: "CS102",
    Psubjectcomponentid: "comp_p",
  };
  assert.equal(isSubjectDetailComplete(rowLab, fullLT), false, "missing P is incomplete for lab");
  assert.equal(isSubjectDetailComplete(rowLab, { P: { summary: [] } }), true, "P present is complete for lab");
});

test("combinedAttendance falls back to row counts when detail is incomplete", () => {
  // PTRP case: row has 31 L classes and 3 T classes (total 34)
  const rowPTRP = {
    subjectcode: "MA106",
    Lsubjectcomponentid: "comp_l",
    Tsubjectcomponentid: "comp_t",
    Ltotalclass: 31,
    Ltotalpresent: 28,
    Ttotalclass: 3,
    Ttotalpresent: 3,
    totalclass: 34,
    totalpresent: 31,
  };

  // Poisoned detail has only 3 tutorial classes
  const incompleteDetail = {
    T: {
      student_attdsummarylist: [
        { present: "Y", datetime: "01/09/2026 10:00 AM" },
        { present: "Y", datetime: "08/09/2026 10:00 AM" },
        { present: "Y", datetime: "15/09/2026 10:00 AM" },
      ],
    },
  };

  const att = combinedAttendance(rowPTRP, incompleteDetail);
  assert.equal(att.totalClasses, 34, "uses row fallback instead of incomplete 3-class detail");
  assert.equal(att.totalPresent, 31);
  assert.equal(att.pct, "91.2%");
  assert.equal(att.hasHeldClasses, true);
  assert.equal(att.isShort, false);
});

test("combinedAttendance displays '—' when 0 classes have been held", () => {
  // Minor Project or Internship with 0 classes and 0% or undefined percentage
  const rowZeroHeld = {
    subjectcode: "PRJ401",
    totalclass: 0,
    totalpresent: 0,
    Ltotalclass: 0,
    Ltotalpresent: 0,
    Lpercentage: "0.00%",
  };

  const att = combinedAttendance(rowZeroHeld, null);
  assert.equal(att.pct, "—", "displays dash instead of 0.0%");
  assert.equal(att.pctNum, null, "pctNum is null to avoid false debar alerts");
  assert.equal(att.isShort, false, "not marked short");
  assert.equal(att.hasHeldClasses, false);
  assert.equal(att.margin.type, "none");
});

test("combinedAttendance correctly combines complete L and T detail", () => {
  const rowPTRP = {
    subjectcode: "MA106",
    Lsubjectcomponentid: "comp_l",
    Tsubjectcomponentid: "comp_t",
    totalclass: 34,
    totalpresent: 31,
  };

  const completeDetail = {
    L: {
      student_attdsummarylist: [
        { present: "Y", datetime: "01/09/2026 09:00 AM" },
        { present: "N", datetime: "02/09/2026 09:00 AM" },
      ],
    },
    T: {
      student_attdsummarylist: [
        { present: "Y", datetime: "01/09/2026 10:00 AM" },
      ],
    },
  };

  const att = combinedAttendance(rowPTRP, completeDetail);
  // Detail has 3 total classes, but row totalClasses is 34.
  // When row total classes > detail total classes, detail is considered stale!
  assert.equal(att.totalClasses, 34, "stale detail (3 classes vs row 34) falls back to fresh row count");

  // Now test with detail matching or exceeding row counts:
  const freshRow = {
    subjectcode: "MA106",
    Lsubjectcomponentid: "comp_l",
    Tsubjectcomponentid: "comp_t",
    totalclass: 3,
    totalpresent: 2,
  };
  const attFresh = combinedAttendance(freshRow, completeDetail);
  assert.equal(attFresh.totalClasses, 3);
  assert.equal(attFresh.totalPresent, 2);
  assert.equal(attFresh.pct, "66.7%");
  assert.equal(attFresh.isShort, true, "below 70% is debarred");
  assert.equal(attFresh.colorClass, "att-red");
  assert.equal(attFresh.hasHeldClasses, true);
});

test("computeBunkMargin calculates accurate bunk and attend requirements", () => {
  // 8/10 = 80% (target 70%): can bunk 1 class (8/11 = 72.7%, 8/12 = 66.7%)
  const marginBunk = computeBunkMargin(8, 10, 0.70);
  assert.equal(marginBunk.type, "bunk");
  assert.equal(marginBunk.count, 1);
  assert.match(marginBunk.text, /Can bunk 1 class/);

  // 6/10 = 60% (target 70%): need ceil((0.7*10 - 6) / 0.3) = ceil(1 / 0.3) = 4 classes
  // Attending 4 classes -> 10/14 = 71.4%
  const marginAttend = computeBunkMargin(6, 10, 0.70);
  assert.equal(marginAttend.type, "attend");
  assert.equal(marginAttend.count, 4);
  assert.match(marginAttend.text, /Need 4 classes/);

  // 7/10 = 70%: exact threshold
  const marginEdge = computeBunkMargin(7, 10, 0.70);
  assert.equal(marginEdge.type, "bunk");
  assert.equal(marginEdge.count, 0);
  assert.equal(marginEdge.text, "Cannot bunk more");

  // 0 total classes
  const marginZero = computeBunkMargin(0, 0, 0.70);
  assert.equal(marginZero.type, "none");
  assert.equal(marginZero.count, 0);
});

test("doesSubjectNeedDeepFetch detects incomplete cache and triggers repair", () => {
  const row = {
    subjectid: "101",
    subjectcode: "MA106",
    totalclass: "34",
    totalpresent: "31",
    Lsubjectcomponentid: "c_l",
    Tsubjectcomponentid: "c_t",
  };
  const checksum = computeSubjectRowChecksum(row);
  const now = Date.now();

  // Incomplete cache: only T component present, even with matching checksum
  const incompleteCached = {
    T: { summary: [{ present: "Y" }] },
  };

  const needsDeep = doesSubjectNeedDeepFetch(row, incompleteCached, now, checksum, now);
  assert.equal(needsDeep, true, "incomplete cache forces deep fetch to heal missing components");

  // Complete cache: both L and T present
  const completeCached = {
    L: { summary: [{ present: "Y" }] },
    T: { summary: [{ present: "Y" }] },
  };
  const doesNotNeedDeep = doesSubjectNeedDeepFetch(row, completeCached, now, checksum, now);
  assert.equal(doesNotNeedDeep, false, "complete cache with matching checksum skips deep fetch");
});
