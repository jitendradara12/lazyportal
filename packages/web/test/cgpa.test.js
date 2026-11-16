import test from "node:test";
import assert from "node:assert/strict";

const {
  toNumber,
  toTerms,
  toCourses,
  detailRows,
  isFail,
  gpaRange,
  formatGpa,
  formatCredits,
  totals,
  formatSubjectName,
  GRADE_SCALE,
  gradeToPoint,
  cumulativeStats,
  forecastCoursesToGrades,
  pruneForecasts,
  projectTerms,
  requiredSgpaForTargets,
} = await import("../src/lib/cgpa.ts");

test("toNumber parses numbers and filters out empty or invalid values", () => {
  assert.equal(toNumber(42), 42);
  assert.equal(toNumber("8.75"), 8.75);
  assert.equal(toNumber(" 9.1 "), 9.1);
  assert.equal(toNumber(0), 0);
  assert.equal(toNumber("0"), 0);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber(""), null);
  assert.equal(toNumber("   "), null);
  assert.equal(toNumber("abc"), null);
  assert.equal(toNumber(Infinity), null);
  assert.equal(toNumber(-Infinity), null);
  assert.equal(toNumber(NaN), null);
});

test("toTerms normalizes semester rows, sorts by sty, and ignores invalid rows", () => {
  assert.deepEqual(toTerms(null), []);
  assert.deepEqual(toTerms([]), []);

  const rows = [
    { stynumber: "3", sgpa: "8.50", cgpa: "8.20", earnedcredit: "24" },
    { semester: 1, sgpapoints: 7.8, cgpapoints: 7.8, totalearnedcredit: 22 },
    { stynumberdesc: "2", sgpa: 8.0, cgpa: 7.9, totalcoursecredit: 23 },
    { stynumber: "0", sgpa: 5.0 }, // filtered out because sty <= 0
    { sgpa: 6.0 }, // filtered out because no sty
    { stynumber: "invalid" }, // filtered out because NaN
  ];

  const terms = toTerms(rows);
  assert.equal(terms.length, 3);
  assert.equal(terms[0].sty, 1);
  assert.equal(terms[0].sgpa, 7.8);
  assert.equal(terms[0].cgpa, 7.8);
  assert.equal(terms[0].credits, 22);

  assert.equal(terms[1].sty, 2);
  assert.equal(terms[1].sgpa, 8.0);
  assert.equal(terms[1].cgpa, 7.9);
  assert.equal(terms[1].credits, 23);

  assert.equal(terms[2].sty, 3);
  assert.equal(terms[2].sgpa, 8.5);
  assert.equal(terms[2].cgpa, 8.2);
  assert.equal(terms[2].credits, 24);
});

test("toCourses normalizes course rows, computing points, maxPoints, and fail state", () => {
  assert.deepEqual(toCourses(null), []);
  assert.deepEqual(toCourses([]), []);

  const rows = [
    {
      subjectcode: "18B11CI311",
      subjectdesc: "DATA STRUCTURES",
      grade: "A",
      coursecredit: "4",
      gradepoint: "9",
    },
    {
      subjectno: "18B17CI371",
      subjectname: "DATA STRUCTURES LAB",
      gradeawarded: "A+",
      coursecreditpoint: 1.5,
      gradepoint: 10,
      minorsubject: "Y",
    },
    {
      subject: "PROJECT",
      gradecode: "F",
      credits: 3,
      gradepoint: 0,
      failflag: "Y",
    },
    {
      // empty row without code or name should be dropped
      grade: "A",
    },
  ];

  const courses = toCourses(rows);
  assert.equal(courses.length, 3);

  assert.deepEqual(courses[0], {
    code: "18B11CI311",
    name: "DATA STRUCTURES",
    grade: "A",
    credits: 4,
    gradePoint: 9,
    points: 36,
    maxPoints: 40,
    minor: false,
    fail: false,
  });

  assert.deepEqual(courses[1], {
    code: "18B17CI371",
    name: "DATA STRUCTURES LAB",
    grade: "A+",
    credits: 1.5,
    gradePoint: 10,
    points: 15,
    maxPoints: 15,
    minor: true,
    fail: false,
  });

  assert.deepEqual(courses[2], {
    code: "",
    name: "PROJECT",
    grade: "F",
    credits: 3,
    gradePoint: 0,
    points: 0,
    maxPoints: 30,
    minor: false,
    fail: true,
  });
});

test("totals correctly aggregates user's real semester 1 results and skips zero-credit audit courses", () => {
  const s1Rows = [
    { subjectcode: "CS101", subjectdesc: "Computer Programming", gradepoint: 10, coursecreditpoint: 4, grade: "O" },
    { subjectcode: "MA101", subjectdesc: "Engineering Mathematics", gradepoint: 8, coursecreditpoint: 4, grade: "A" },
    { subjectcode: "PH101", subjectdesc: "Engineering Physics-1", gradepoint: 5, coursecreditpoint: 4, grade: "C" },
    { subjectcode: "HS101", subjectdesc: "English", gradepoint: 7, coursecreditpoint: 3, grade: "B+" },
    { subjectcode: "CS201", subjectdesc: "Computer Programming Lab", gradepoint: 10, coursecreditpoint: 2, grade: "O" },
    { subjectcode: "ME201", subjectdesc: "Workshop Practices", gradepoint: 9, coursecreditpoint: 1.5, grade: "A+" },
    { subjectcode: "PH201", subjectdesc: "Engineering Physics Lab-1", gradepoint: 10, coursecreditpoint: 1, grade: "O" },
    { subjectcode: "HS001", subjectdesc: "Human Values and Professional Ethics", gradepoint: 0, coursecreditpoint: 0, grade: "AP" },
  ];

  const courses = toCourses(s1Rows);
  assert.equal(courses.length, 8);

  const t = totals(courses);
  assert.equal(t.count, 7);
  assert.equal(t.points, 156.5);
  assert.equal(t.max, 195);
  assert.equal(t.credits, 19.5);
  assert.ok(t.sgpa !== null);
  assert.equal(t.sgpa.toFixed(2), "8.03");
});

test("detailRows finds subject array from various JUET response keys", () => {
  assert.deepEqual(detailRows(null), []);
  assert.deepEqual(detailRows(undefined), []);
  assert.deepEqual(detailRows("not an object"), []);
  assert.deepEqual(detailRows({}), []);

  const sample = [{ subjectcode: "CS101" }];
  assert.deepEqual(detailRows({ semesterList: sample }), sample);
  assert.deepEqual(detailRows({ subjectlist: sample }), sample);
  assert.deepEqual(detailRows({ subjectList: sample }), sample);
  assert.deepEqual(detailRows({ gradecard: sample }), sample);
  assert.deepEqual(detailRows({ detail: sample }), sample);
});

test("isFail identifies failing and incomplete grades", () => {
  assert.equal(isFail("F"), true);
  assert.equal(isFail("f"), true);
  assert.equal(isFail(" E "), true);
  assert.equal(isFail("I"), true);
  assert.equal(isFail("AB"), true);
  assert.equal(isFail("ab"), true);
  assert.equal(isFail("X"), true);

  assert.equal(isFail("A+"), false);
  assert.equal(isFail("A"), false);
  assert.equal(isFail("B+"), false);
  assert.equal(isFail("B"), false);
  assert.equal(isFail("C"), false);
  assert.equal(isFail("D"), false);
  assert.equal(isFail("P"), false);
  assert.equal(isFail("—"), false);
});

test("gpaRange determines tight chart y-range", () => {
  assert.deepEqual(gpaRange([]), { min: 0, max: 10 });

  const terms = [
    { sty: 1, sgpa: 7.5, cgpa: 7.5, credits: 20, raw: {} },
    { sty: 2, sgpa: 8.2, cgpa: 7.85, credits: 20, raw: {} },
  ];
  // min value is 7.5 -> Math.floor(7.5) - 1 = 6
  assert.deepEqual(gpaRange(terms), { min: 6, max: 10 });

  const lowTerms = [
    { sty: 1, sgpa: 1.5, cgpa: 1.5, credits: 20, raw: {} },
  ];
  // min value is 1.5 -> Math.floor(1.5) - 1 = 0 (bounded by 0)
  assert.deepEqual(gpaRange(lowTerms), { min: 0, max: 10 });
});

test("formatGpa and formatCredits format numbers gracefully", () => {
  assert.equal(formatGpa(null), "—");
  assert.equal(formatGpa(8.5), "8.50");
  assert.equal(formatGpa(10), "10.00");
  assert.equal(formatGpa(0), "0.00");

  assert.equal(formatCredits(null), "—");
  assert.equal(formatCredits(24), "24");
  assert.equal(formatCredits(13.5), "13.5");
  assert.equal(formatCredits(1.5), "1.5");
  assert.equal(formatCredits(0), "0");
});

const REAL_S1_TO_S4_ROWS = [
  { stynumber: 1, sgpa: 8.03, cgpa: 8.03, earnedcredit: 19.5 },
  { stynumber: 2, sgpa: 8.51, cgpa: 8.29, earnedcredit: 22.5 },
  { stynumber: 3, sgpa: 8.1, cgpa: 8.23, earnedcredit: 20 },
  { stynumber: 4, sgpa: 7.0, cgpa: 7.92, earnedcredit: 21 },
];

test("toTerms computes points from explicit point keys or rounds sgpa * credits to nearest 0.5", () => {
  const realTerms = toTerms(REAL_S1_TO_S4_ROWS);
  assert.deepEqual(
    realTerms.map((t) => t.points),
    [156.5, 191.5, 162, 147],
  );

  const explicit = toTerms([
    { stynumber: 1, sgpa: 8.0, earnedcredit: 20, sgpapoints: 159.5 },
    { stynumber: 2, sgpa: 8.5, earnedcredit: 20, pointssecured: 170 },
    { stynumber: 3, sgpa: 9.0, earnedcredit: 20, points: 180 },
    { stynumber: 4, sgpa: 8.0, earnedcredit: null },
  ]);
  assert.deepEqual(
    explicit.map((t) => t.points),
    [159.5, 170, 180, null],
  );
});

test("formatSubjectName preserves technical acronyms, Roman numerals, mixed tokens, minor words, and hyphen spacing", () => {
  assert.equal(formatSubjectName("INTRODUCTION TO 3D PRINTING"), "Introduction to 3D Printing");
  assert.equal(formatSubjectName("UI/UX LAB"), "UI/UX Lab");
  assert.equal(formatSubjectName("DBMS LAB"), "DBMS Lab");
  assert.equal(formatSubjectName("ENGINEERING PHYSICS-1"), "Engineering Physics-1");
  assert.equal(formatSubjectName("ENGINEERING PHYSICS- 1"), "Engineering Physics-1");
  assert.equal(formatSubjectName("ENGINEERING PHYSICS -1"), "Engineering Physics-1");
  assert.equal(formatSubjectName("ENGINEERING PHYSICS - 2"), "Engineering Physics - 2");
  assert.equal(formatSubjectName("INTERNET OF THINGS (IOT) AND NOSQL"), "Internet of Things (IoT) and NoSQL");
  assert.equal(formatSubjectName("SQL/NOSQL FOR BIG DATA"), "SQL/NoSQL for Big Data");
  assert.equal(formatSubjectName("DATA STRUCTURES AND ALGORITHMS (DSA)"), "Data Structures and Algorithms (DSA)");
  assert.equal(formatSubjectName("AI/ML, DL AND NLP IN CS"), "AI/ML, DL and NLP in CS");
  assert.equal(formatSubjectName("COA, OS, CN AND OOP/OOPS"), "COA, OS, CN and OOP/OOPS");
  assert.equal(formatSubjectName("VLSI, CMOS, FPGA, DSP AND PCB DESIGN"), "VLSI, CMOS, FPGA, DSP and PCB Design");
  assert.equal(formatSubjectName("2D/4D CAD/CAM AND CNC LAB"), "2D/4D CAD/CAM and CNC Lab");
  assert.equal(formatSubjectName("HTML/CSS/XML/PHP API WITH TCP/IP AND HTTP ON AWS"), "HTML/CSS/XML/PHP API with TCP/IP and HTTP on AWS");
  assert.equal(formatSubjectName("RDBMS, DAA, ICT, IT, CSE, ECE, ME, CE, IPR, HRM, ERP"), "RDBMS, DAA, ICT, IT, CSE, ECE, ME, CE, IPR, HRM, ERP");
  assert.equal(formatSubjectName("ENGINEERING MATHEMATICS - I II III IV V VI"), "Engineering Mathematics - I II III IV V VI");
  assert.equal(formatSubjectName("SYSTEMS: IN PRACTICE BY DESIGN - FOR ALL"), "Systems: In Practice by Design - For All");
  assert.equal(formatSubjectName("   "), "");
});

test("GRADE_SCALE and gradeToPoint map JUET letter grades accurately", () => {
  assert.equal(GRADE_SCALE.length, 8);
  assert.equal(gradeToPoint("O"), 10);
  assert.equal(gradeToPoint("A+"), 9);
  assert.equal(gradeToPoint("a"), 8);
  assert.equal(gradeToPoint(" B+ "), 7);
  assert.equal(gradeToPoint("B"), 6);
  assert.equal(gradeToPoint("C"), 5);
  assert.equal(gradeToPoint("P"), 4);
  assert.equal(gradeToPoint("F"), 0);
  assert.equal(gradeToPoint("AP"), null);
  assert.equal(gradeToPoint("—"), null);
  assert.equal(gradeToPoint(""), null);
});

test("cumulativeStats verifies S1-S4 real data and supports upToSty slicing and fallbacks", () => {
  const realTerms = toTerms(REAL_S1_TO_S4_ROWS);
  const all = cumulativeStats(realTerms);
  assert.equal(all.completedTerms, 4);
  assert.equal(all.points, 657);
  assert.equal(all.credits, 83);
  assert.equal(all.maxPoints, 830);
  assert.equal(formatGpa(all.cgpa), "7.92");
  assert.equal(all.defaultTermCredits, 21);

  const upToS2 = cumulativeStats(realTerms, 2);
  assert.equal(upToS2.completedTerms, 2);
  assert.equal(upToS2.points, 348);
  assert.equal(upToS2.credits, 42);
  assert.equal(upToS2.maxPoints, 420);
  assert.equal(formatGpa(upToS2.cgpa), "8.29");

  const empty = cumulativeStats([]);
  assert.deepEqual(empty, {
    completedTerms: 0,
    credits: 0,
    points: 0,
    maxPoints: 0,
    cgpa: null,
    defaultTermCredits: 21,
  });

  const noCredits = cumulativeStats([
    { sty: 1, sgpa: 8.1, cgpa: 8.1, credits: null, points: null, raw: {} },
    { sty: 2, sgpa: 8.5, cgpa: 8.3, credits: 0, points: null, raw: {} },
  ]);
  assert.equal(noCredits.credits, 0);
  assert.equal(noCredits.cgpa, 8.3);
  assert.equal(noCredits.defaultTermCredits, 21);
});

test("forecastCoursesToGrades integrates with totals and handles F and zero-credit courses", () => {
  const courses = [
    { id: "1", name: "DBMS", credits: 4, grade: "O" },
    { id: "2", name: "OS", credits: 4, grade: "A+" },
    { id: "3", name: "Algorithms", credits: 3, grade: "A" },
    { id: "4", name: "Elective", credits: 3, grade: "F" },
    { id: "5", name: "Audit", credits: 0, grade: "P" },
  ];
  const grades = forecastCoursesToGrades(courses);
  assert.equal(grades.length, 5);
  assert.equal(grades[3].fail, true);
  assert.equal(grades[3].points, 0);
  assert.equal(grades[3].maxPoints, 30);

  const sum = totals(grades);
  assert.equal(sum.count, 4);
  assert.equal(sum.credits, 14);
  assert.equal(sum.points, 100);
  assert.equal(sum.max, 140);
  assert.equal(formatGpa(sum.sgpa), "7.14");
});

test("projectTerms merges slider and course forecasts and computes running CGPA", () => {
  const realTerms = toTerms(REAL_S1_TO_S4_ROWS);
  const projected = projectTerms(realTerms, {
    4: { sgpa: 10, credits: 25 }, // ignored because S4 is an actual term
    5: { sgpa: 175 / 21, credits: 21 },
    6: {
      sgpa: 5,
      useCourses: true,
      courses: [
        { id: "c1", name: "AI", credits: 4, grade: "O" },
        { id: "c2", name: "ML", credits: 4, grade: "A+" },
        { id: "c3", name: "NLP", credits: 2, grade: "A" },
      ],
    },
    7: { sgpa: 12 }, // clamped to 10, defaults to 21 credits
  });

  assert.equal(projected.length, 7);
  assert.equal(projected[3].forecasted, undefined);
  assert.equal(formatGpa(projected[3].cgpa), "7.92");

  const s5 = projected[4];
  assert.equal(s5.sty, 5);
  assert.equal(s5.forecasted, true);
  assert.equal(s5.credits, 21);
  assert.equal(Math.round(s5.points), 175);
  assert.equal(formatGpa(s5.cgpa), "8.00");

  const s6 = projected[5];
  assert.equal(s6.sty, 6);
  assert.equal(s6.forecasted, true);
  assert.equal(s6.credits, 10);
  assert.equal(s6.points, 92);
  assert.equal(formatGpa(s6.sgpa), "9.20");
  // cumulative up to S6: (657 + 175 + 92) / (83 + 21 + 10) = 924 / 114 = 8.1052...
  assert.equal(formatGpa(s6.cgpa), "8.11");

  const s7 = projected[6];
  assert.equal(s7.sty, 7);
  assert.equal(s7.forecasted, true);
  assert.equal(s7.sgpa, 10);
  assert.equal(s7.credits, 21);
  assert.equal(s7.points, 210);
  // cumulative up to S7: (924 + 210) / (114 + 21) = 1134 / 135 = 8.40
  assert.equal(formatGpa(s7.cgpa), "8.40");
});

test("requiredSgpaForTargets computes required SGPAs from S1-S4 (657 pts / 83 cr)", () => {
  const realTerms = toTerms(REAL_S1_TO_S4_ROWS);
  const reqs = requiredSgpaForTargets(realTerms, 21);

  assert.deepEqual(
    reqs.map((r) => r.targetCgpa),
    [7.5, 7.92, 8.0, 8.5, 9.0],
  );

  const t75 = reqs.find((r) => r.targetCgpa === 7.5);
  assert.equal(t75.alreadyMet, true);
  assert.equal(t75.achievable, true);

  const maintain = reqs.find((r) => r.label === "Maintain");
  assert.equal(maintain.targetCgpa, 7.92);
  assert.equal(maintain.achievable, true);

  const t80 = reqs.find((r) => r.targetCgpa === 8.0);
  assert.ok(Math.abs(t80.requiredSgpa - 175 / 21) < 1e-12);
  assert.equal(formatGpa(t80.requiredSgpa), "8.33");
  assert.equal(t80.achievable, true);
  assert.equal(t80.alreadyMet, false);

  const t85 = reqs.find((r) => r.targetCgpa === 8.5);
  assert.equal(t85.achievable, false);
  assert.ok(t85.requiredSgpa > 10);

  // When current CGPA already matches a default target (8.00), do not duplicate Maintain
  const exact8 = toTerms([{ stynumber: 1, sgpa: 8.0, cgpa: 8.0, earnedcredit: 20 }]);
  const reqsExact8 = requiredSgpaForTargets(exact8);
  assert.deepEqual(
    reqsExact8.map((r) => r.targetCgpa),
    [7.5, 8.0, 8.5, 9.0],
  );

  // Custom targets including an impossibly low target (< 0 required SGPA)
  const custom = requiredSgpaForTargets(realTerms, 21, [5.0, 8.0]);
  assert.equal(custom.length, 2);
  assert.equal(custom[0].achievable, false);
  assert.equal(custom[0].alreadyMet, true);
  assert.equal(custom[1].achievable, true);
});

test("pruneForecasts and projectTerms reconcile forecasts when portal recovers from empty to S1-S4", () => {
  const savedForecasts = {
    1: { sgpa: 9.0, credits: 21 },
    5: { sgpa: 8.5, credits: 21 },
  };

  // Before upstream publishes results, both S1 and S5 are kept
  assert.deepEqual(Object.keys(pruneForecasts([], savedForecasts)), ["1", "5"]);

  // Portal recovers with real S1-S4
  const realTerms = toTerms(REAL_S1_TO_S4_ROWS);
  const pruned = pruneForecasts(realTerms, savedForecasts);
  assert.deepEqual(pruned, { 5: { sgpa: 8.5, credits: 21 } });

  const projected = projectTerms(realTerms, savedForecasts);
  assert.equal(projected.length, 5);
  assert.equal(projected[0].forecasted, undefined);
  assert.equal(projected[0].sgpa, 8.03);
  assert.equal(projected[4].sty, 5);
  assert.equal(projected[4].forecasted, true);
  // (657 + 8.5 * 21) / (83 + 21) = 835.5 / 104 = 8.03365...
  assert.equal(formatGpa(projected[4].cgpa), "8.03");

  // Target chips recalculate on top of real S1-S4
  const targets = requiredSgpaForTargets(realTerms, 21);
  assert.equal(formatGpa(targets.find((r) => r.targetCgpa === 8.0).requiredSgpa), "8.33");
});

test("pruneForecasts drops S5 forecast once upstream publishes S5", () => {
  const s1ToS5 = toTerms([
    ...REAL_S1_TO_S4_ROWS,
    { stynumber: 5, sgpa: 8.4, cgpa: 8.01, earnedcredit: 21 },
  ]);
  const savedForecasts = { 5: { sgpa: 9.0, credits: 21 } };

  assert.deepEqual(pruneForecasts(s1ToS5, savedForecasts), {});

  const projected = projectTerms(s1ToS5, savedForecasts);
  assert.equal(projected.length, 5);
  assert.equal(projected.some((t) => Boolean(t.forecasted)), false);
  assert.equal(projected[4].sgpa, 8.4);
  assert.equal(projected[4].cgpa, 8.01);
});
