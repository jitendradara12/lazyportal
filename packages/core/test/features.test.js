import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAttendance, isFutureSemester, getMarksSemesters, getMarks, getMarksLatest, getExamSemesters, getExamEvents, getExamSchedule, getGradesLatest, getGradeRegistrations, getGradeCard, getFacultyRegistrations, getFaculties, getSgpaStudentInfo, getSgpaCurrentSem, getSgpaSemesters, getSgpaDetail, getSgpaLatest, getSubjectAttendanceAll } from "../src/features.js";

describe("features", () => {
  it("getAttendance chains LOV default semester into detail", async () => {
    const calls = [];
    const fake = {
      async postRaw(endpoint, payload) {
        calls.push([endpoint, payload]);
        return {
          response: {
            headerlist: [{ stynumber: "4" }],
            semlist: [{ registrationid: "r1", registrationcode: "REG-1" }],
          },
        };
      },
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        return { response: { studentattendancelist: [{ subjectcode: "S1" }], currentSem: "1" } };
      },
    };
    const { rows } = await getAttendance(fake, { instituteid: "i1" });
    assert.equal(rows.length, 1);
    assert.deepEqual(calls[1][1], {
      instituteid: "i1",
      stynumber: "4",
      registrationid: "r1",
      registrationcode: "REG-1",
    });
  });

  it("getAttendance returns empty rows when no semesters", async () => {
    const fake = {
      async postRaw() { return { response: { headerlist: [], semlist: [] } }; },
      async post() { throw new Error("should not be called"); },
    };
    const { rows } = await getAttendance(fake, {});
    assert.deepEqual(rows, []);
  });

  it("attendance forwards cancellation through both reads and never retries an abort", async () => {
    const controller = new AbortController();
    const signals = [];
    const lov = { semesters: [{ registrationid: "r1" }] };
    let fail = false, lovReads = 0;
    const fake = {
      async postRaw(_path, _payload, options) {
        lovReads++;
        signals.push(options?.signal);
        return { response: { semlist: lov.semesters } };
      },
      async post(_path, _payload, options) {
        signals.push(options?.signal);
        if (fail) throw new DOMException("Cancelled", "AbortError");
        return { response: { studentattendancelist: [] } };
      },
    };
    await getAttendance(fake, {}, undefined, { signal: controller.signal });
    assert.deepEqual(signals, [controller.signal, controller.signal]);
    fail = true;
    await assert.rejects(getAttendance(fake, {}, lov, { signal: controller.signal }), { name: "AbortError" });
    assert.equal(lovReads, 1);
  });

  it("getAttendance reuses cachedLov without postRaw", async () => {
    let postRawCalled = false;
    const fake = {
      async postRaw() {
        postRawCalled = true;
        throw new Error("should not call LOV when cachedLov provided");
      },
      async post() {
        return { response: { studentattendancelist: [{ subjectcode: "S1" }], currentSem: "1" } };
      },
    };
    const cachedLov = {
      header: { stynumber: "4" },
      semesters: [{ registrationid: "r1", registrationcode: "REG-1" }],
    };
    const res = await getAttendance(fake, { instituteid: "i1" }, cachedLov);
    assert.equal(postRawCalled, false);
    assert.equal(res.rows.length, 1);
  });

  it("getAttendance falls back to fresh LOV if cachedLov detail fetch fails", async () => {
    let attempts = 0;
    const fake = {
      async postRaw() {
        return {
          response: {
            headerlist: [{ stynumber: "5" }],
            semlist: [{ registrationid: "r2", registrationcode: "REG-2" }],
          },
        };
      },
      async post(endpoint, payload) {
        attempts++;
        if (payload.registrationid === "stale-r1") throw new Error("Stale registration");
        return { response: { studentattendancelist: [{ subjectcode: "S2" }], currentSem: "2" } };
      },
    };
    const staleLov = {
      header: { stynumber: "4" },
      semesters: [{ registrationid: "stale-r1", registrationcode: "REG-1" }],
    };
    const res = await getAttendance(fake, { instituteid: "i1" }, staleLov);
    assert.equal(attempts, 2);
    assert.equal(res.registrationcode, "REG-2");
    assert.equal(res.rows[0].subjectcode, "S2");
  });

  it("malformed successful attendance responses reject without an extra LOV request", async () => {
    const cachedLov = { semesters: [{ registrationid: "r1" }] };
    for (const response of [null, {}, { studentattendancelist: {} }, { studentattendancelist: [null] }]) {
      let lovReads = 0;
      const fake = {
        async post() { return { response }; },
        async postRaw() { lovReads++; return { response: { semlist: [] } }; },
      };
      await assert.rejects(getAttendance(fake, {}, cachedLov), { code: "INVALID_RESPONSE" });
      assert.equal(lovReads, 0);
    }
    await assert.rejects(getAttendance({ async postRaw() { return { response: {} }; } }, {}), { code: "INVALID_RESPONSE" });
  });

  it("an explicitly empty attendance list is valid", async () => {
    const fake = {
      async postRaw() { return { response: { semlist: [{ registrationid: "r1", registrationcode: "REG-1" }] } }; },
      async post() { return { response: { studentattendancelist: [] } }; },
    };
    assert.deepEqual((await getAttendance(fake, {}, { semesters: [{ registrationid: "r1" }] })).rows, []);
  });

  it("getAttendance does not re-fetch LOV or probe past semester when active cached semester is empty", async () => {
    let lovCalls = 0;
    const detailCalls = [];
    const fake = {
      async postRaw() {
        lovCalls++;
        return { response: { semlist: [] } };
      },
      async post(_endpoint, payload) {
        detailCalls.push(payload.registrationid);
        return { response: { studentattendancelist: [] } };
      },
    };
    const cachedLov = {
      header: { stynumber: "4" },
      semesters: [
        { registrationid: "current", registrationcode: "2026ODDSEM" },
        { registrationid: "past", registrationcode: "2026EVESEM" },
      ],
    };
    const res = await getAttendance(fake, { instituteid: "i1" }, cachedLov);
    assert.equal(lovCalls, 0);
    assert.deepEqual(detailCalls, ["current"]);
    assert.deepEqual(res.rows, []);
  });

  it("getAttendance falls back to semesters[1] when upcoming semesters[0] has no rows", async () => {
    const calls = [];
    const fake = {
      async postRaw() {
        return {
          response: {
            headerlist: [{ stynumber: "4" }],
            semlist: [
              { registrationid: "r2099", registrationcode: "2099EVEN" },
              { registrationid: "r2026", registrationcode: "2026ODD" },
            ],
          },
        };
      },
      async post(_endpoint, payload) {
        calls.push(payload.registrationid);
        if (payload.registrationid === "r2099") return { response: { studentattendancelist: [], currentSem: "5" } };
        return { response: { studentattendancelist: [{ subjectcode: "CS101" }], currentSem: "4" } };
      },
    };
    const res = await getAttendance(fake, { instituteid: "i1" });
    assert.deepEqual(calls, ["r2099", "r2026"]);
    assert.equal(res.registrationid, "r2026");
    assert.equal(res.registrationcode, "2026ODD");
    assert.equal(res.semesters[0].registrationid, "r2099");
    assert.equal(res.rows[0].subjectcode, "CS101");
  });

  it("getMarksLatest falls back to semesters[1] when upcoming semesters[0] has no rows", async () => {
    const fake = {
      async post(endpoint, payload) {
        if (endpoint.includes("getsemestercode")) {
          return {
            response: {
              semestercode: [
                { registrationid: "r2099", registrationcode: "2099EVEN" },
                { registrationid: "r2026", registrationcode: "2026ODD" },
              ],
            },
          };
        }
        if (payload.registrationid === "r2099") return { response: { viewmarksbystudent: [] } };
        return { response: { viewmarksbystudent: [{ subjectcode: "CS101", obtainedmarks: 18 }] } };
      },
    };
    const out = await getMarksLatest(fake, { instituteid: "i1", companyid: "c1" });
    assert.equal(out.registrationid, "r2026");
    assert.equal(out.registrationcode, "2026ODD");
    assert.equal(out.semesters[0].registrationid, "r2099");
    assert.equal(out.rows.length, 1);
  });

  it("getGradesLatest falls back to semesters[1] when upcoming semesters[0] has no rows", async () => {
    const fake = {
      async post(endpoint, payload) {
        if (endpoint.includes("getstudentinfo")) return { response: { studentinfo: { branchid: "b1", programid: "p1" } } };
        if (endpoint.includes("getregistrationList")) {
          return {
            response: {
              registrations: [
                { registrationid: "r2099", registrationcode: "2099EVEN" },
                { registrationid: "r2026", registrationcode: "2026ODD" },
              ],
            },
          };
        }
        if (payload.registrationid === "r2099") return { response: { gradecard: [] } };
        return { response: { gradecard: [{ subjectcode: "CS101", grade: "A" }] } };
      },
    };
    const out = await getGradesLatest(fake, { instituteid: "i1" });
    assert.equal(out.registrationid, "r2026");
    assert.equal(out.registrationcode, "2026ODD");
    assert.equal(out.rows.length, 1);
  });

  it("getMarksLatest falls back to semesters[1] when upcoming semesters[0] throws future-facility error", async () => {
    const fake = {
      async post(endpoint, payload) {
        if (endpoint.includes("getsemestercode")) {
          return {
            response: {
              semestercode: [
                { registrationid: "r2099", registrationcode: "2099EVESEM" },
                { registrationid: "r2026", registrationcode: "2026ODDSEM" },
              ],
            },
          };
        }
        if (payload.registrationid === "r2099") {
          throw new Error("This facility will be available from 01-January-2099");
        }
        return { response: { viewmarksbystudent: [{ subjectcode: "CS101", obtainedmarks: 18 }] } };
      },
    };
    const out = await getMarksLatest(fake, { instituteid: "i1", companyid: "c1" });
    assert.equal(out.registrationid, "r2026");
    assert.equal(out.registrationcode, "2026ODDSEM");
    assert.equal(out.rows.length, 1);
  });

  it("getAttendance falls back to semesters[1] when upcoming semesters[0] throws non-fatal portal error", async () => {
    const fake = {
      async postRaw() {
        return {
          response: {
            headerlist: [{ stynumber: "4" }],
            semlist: [
              { registrationid: "r2099", registrationcode: "2099EVESEM" },
              { registrationid: "r2026", registrationcode: "2026ODDSEM" },
            ],
          },
        };
      },
      async post(_endpoint, payload) {
        if (payload.registrationid === "r2099") {
          throw new Error("This facility will be available from 01-January-2099");
        }
        return { response: { studentattendancelist: [{ subjectcode: "CS101" }], currentSem: "4" } };
      },
    };
    const res = await getAttendance(fake, { instituteid: "i1" });
    assert.equal(res.registrationid, "r2026");
    assert.equal(res.registrationcode, "2026ODDSEM");
    assert.equal(res.rows.length, 1);
  });

  it("isFutureSemester respects injected now and falls back to registrationdesc", () => {
    const jan2027 = new Date(2027, 0, 15);
    assert.equal(isFutureSemester({ registrationcode: "2027EVESEM" }, jan2027), false);
    assert.equal(isFutureSemester({ registrationcode: "2027ODDSEM" }, jan2027), true);
    assert.equal(isFutureSemester({ registrationcode: "2027ODDSEM" }, new Date(2027, 6, 1)), false);
    assert.equal(isFutureSemester({ registrationdesc: "2099EVESEM" }, jan2027), true);
    assert.equal(isFutureSemester({ registrationcode: "", registrationdesc: "2099EVESEM" }, jan2027), true);
    assert.equal(isFutureSemester({ registrationcode: "2026ODDSEM", registrationdesc: "2099EVESEM" }, jan2027), false);
  });

  it("getAttendance with cachedLov falls back directly to semesters[1] on future-semester non-fatal error without re-fetching LOV", async () => {
    let lovCalls = 0;
    const detailCalls = [];
    const fake = {
      async postRaw() {
        lovCalls++;
        return { response: { headerlist: [], semlist: [] } };
      },
      async post(_endpoint, payload) {
        detailCalls.push(payload.registrationid);
        if (payload.registrationid === "r2099") {
          throw new Error("This facility will be available from 01-January-2099");
        }
        return { response: { studentattendancelist: [{ subjectcode: "CS101" }], currentSem: "4" } };
      },
    };
    const cachedLov = {
      header: { stynumber: "4" },
      semesters: [
        { registrationid: "r2099", registrationcode: "2099EVESEM" },
        { registrationid: "r2026", registrationcode: "2026ODDSEM" },
      ],
    };
    const res = await getAttendance(fake, { instituteid: "i1" }, cachedLov);
    assert.equal(lovCalls, 0);
    assert.deepEqual(detailCalls, ["r2099", "r2026"]);
    assert.equal(res.registrationid, "r2026");
    assert.equal(res.registrationcode, "2026ODDSEM");
    assert.equal(res.semesters, cachedLov.semesters);
    assert.equal(res.rows.length, 1);
  });

  it("getAttendance with cachedLov still refreshes LOV when future fallback returns null or primary is non-future", async () => {
    // 1. Future semesters[0] errors and semesters[1] returns 0 rows -> refreshes LOV
    let lovCalls = 0;
    const detailCalls = [];
    const fakeEmptyFallback = {
      async postRaw() {
        lovCalls++;
        return {
          response: {
            headerlist: [{ stynumber: "5" }],
            semlist: [{ registrationid: "r-fresh", registrationcode: "2026ODDSEM" }],
          },
        };
      },
      async post(_endpoint, payload) {
        detailCalls.push(payload.registrationid);
        if (payload.registrationid === "r2099") {
          throw new Error("This facility will be available from 01-January-2099");
        }
        if (payload.registrationid === "r-stale-prev") {
          return { response: { studentattendancelist: [] } };
        }
        return { response: { studentattendancelist: [{ subjectcode: "CS201" }], currentSem: "5" } };
      },
    };
    const res1 = await getAttendance(fakeEmptyFallback, { instituteid: "i1" }, {
      header: { stynumber: "4" },
      semesters: [
        { registrationid: "r2099", registrationcode: "2099EVESEM" },
        { registrationid: "r-stale-prev", registrationcode: "2026ODDSEM" },
      ],
    });
    assert.equal(lovCalls, 1);
    assert.deepEqual(detailCalls, ["r2099", "r-stale-prev", "r-fresh"]);
    assert.equal(res1.registrationid, "r-fresh");

    // 2. Non-future semesters[0] errors on cachedLov -> refreshes LOV immediately without probing semesters[1]
    let nonFutureLovCalls = 0;
    const nonFutureDetailCalls = [];
    const fakeNonFuture = {
      async postRaw() {
        nonFutureLovCalls++;
        return {
          response: {
            headerlist: [{ stynumber: "5" }],
            semlist: [{ registrationid: "r-new", registrationcode: "2026ODDSEM" }],
          },
        };
      },
      async post(_endpoint, payload) {
        nonFutureDetailCalls.push(payload.registrationid);
        if (payload.registrationid === "r-stale") throw new Error("Stale registration");
        return { response: { studentattendancelist: [{ subjectcode: "CS301" }], currentSem: "5" } };
      },
    };
    const res2 = await getAttendance(fakeNonFuture, { instituteid: "i1" }, {
      header: { stynumber: "4" },
      semesters: [
        { registrationid: "r-stale", registrationcode: "2026ODDSEM" },
        { registrationid: "r-old", registrationcode: "2026EVESEM" },
      ],
    });
    assert.equal(nonFutureLovCalls, 1);
    assert.deepEqual(nonFutureDetailCalls, ["r-stale", "r-new"]);
    assert.equal(res2.registrationid, "r-new");

    // 3. Uncached LOV with future semesters[0] throwing and empty semesters[1] calls semesters[1] only once
    const uncachedDetailCalls = [];
    const fakeUncached = {
      async postRaw() {
        return {
          response: {
            headerlist: [{ stynumber: "4" }],
            semlist: [
              { registrationid: "r2099", registrationcode: "2099EVESEM" },
              { registrationid: "r2026", registrationcode: "2026ODDSEM" },
            ],
          },
        };
      },
      async post(_endpoint, payload) {
        uncachedDetailCalls.push(payload.registrationid);
        if (payload.registrationid === "r2099") throw new Error("Not available yet");
        return { response: { studentattendancelist: [] } };
      },
    };
    await assert.rejects(() => getAttendance(fakeUncached, { instituteid: "i1" }), /Not available yet/);
    assert.deepEqual(uncachedDetailCalls, ["r2099", "r2026"]);
  });

  it("getMarksLatest falls back to semesters[1] without fetching future PDF report when readPdfText is provided", async () => {
    const reportPaths = [];
    const fake = {
      async post(endpoint, payload) {
        if (endpoint.includes("getsemestercode")) {
          return {
            response: {
              semestercode: [
                { registrationid: "r2099", registrationdesc: "2099EVESEM" },
                { registrationid: "r2026", registrationcode: "2026ODDSEM" },
              ],
            },
          };
        }
        if (payload.registrationid === "r2099") return { response: { viewmarksbystudent: [] } };
        return { response: { viewmarksbystudent: [{ subjectcode: "CS303", eventcode: "TEST-2", obtainedmarks: 13, fullmarks: 25 }] } };
      },
      async getReport(path) {
        reportPaths.push(path);
        if (path.endsWith("/r2099/undefined")) throw new Error("Should not request future PDF");
        return new Uint8Array([1]);
      },
    };
    const item = (text, x, y, width = 20) => ({ text, x, y, width });
    const readPdfText = async () => [[
      item("Registration Code: 2026ODDSEM", 20, 800),
      item("TEST-1", 320, 740),
      item("OM/FM", 280, 720),
      item("SAMPLE", 20, 680),
      item("(CS303)", 20, 665),
      item("7/15", 280, 672),
    ]];
    const out = await getMarksLatest(fake, { instituteid: "i1", companyid: "c1" }, { readPdfText });
    assert.deepEqual(reportPaths, ["/studentsexamview/printstudent-exammarks/i1/r2026/2026ODDSEM"]);
    assert.equal(out.registrationid, "r2026");
    assert.equal(out.registrationcode, "2026ODDSEM");
    assert.equal(out.historyRecovered, true);
    assert.equal(out.rows.length, 2);
  });

  it("getMarksLatest returns historyRecovered: true for single or all-empty future semester without requesting PDF", async () => {
    const reportPaths = [];
    const fakeSingle = {
      async post(endpoint) {
        if (endpoint.includes("getsemestercode")) {
          return { response: { semestercode: [{ registrationid: "r2099", registrationcode: "2099EVESEM" }] } };
        }
        return { response: { viewmarksbystudent: [] } };
      },
      async getReport(path) {
        reportPaths.push(path);
        throw new Error("Should not request future PDF");
      },
    };
    const singleOut = await getMarksLatest(fakeSingle, { instituteid: "i1", companyid: "c1" }, {
      readPdfText: async () => { throw new Error("Should not decode PDF"); },
    });
    assert.deepEqual(reportPaths, []);
    assert.equal(singleOut.registrationid, "r2099");
    assert.equal(singleOut.registrationcode, "2099EVESEM");
    assert.deepEqual(singleOut.rows, []);
    assert.equal(singleOut.historyRecovered, true);
    assert.equal("historyError" in singleOut, false);

    // When semesters[1] also has no rows (even if its PDF fails), returns future primary cleanly
    const fakeBothEmpty = {
      async post(endpoint) {
        if (endpoint.includes("getsemestercode")) {
          return {
            response: {
              semestercode: [
                { registrationid: "r2099", registrationcode: "2099EVESEM" },
                { registrationid: "r2026", registrationcode: "2026ODDSEM" },
              ],
            },
          };
        }
        return { response: { viewmarksbystudent: [] } };
      },
      async getReport(path) {
        reportPaths.push(path);
        throw new Error("No marks report");
      },
    };
    const bothEmptyOut = await getMarksLatest(fakeBothEmpty, { instituteid: "i1", companyid: "c1" }, {
      readPdfText: async () => [],
    });
    assert.deepEqual(reportPaths, ["/studentsexamview/printstudent-exammarks/i1/r2026/2026ODDSEM"]);
    assert.equal(bothEmptyOut.registrationid, "r2099");
    assert.equal(bothEmptyOut.historyRecovered, true);
    assert.equal("historyError" in bothEmptyOut, false);
  });

  it("getMarksLatest preserves PDF recovery error on non-future empty semesters[0] instead of hiding behind semesters[1]", async () => {
    const fake = {
      async post(endpoint, payload) {
        if (endpoint.includes("getsemestercode")) {
          return {
            response: {
              semestercode: [
                { registrationid: "r2026", registrationcode: "2026ODDSEM" },
                { registrationid: "r2025", registrationcode: "2025EVESEM" },
              ],
            },
          };
        }
        if (payload.registrationid === "r2026") return { response: { viewmarksbystudent: [] } };
        return { response: { viewmarksbystudent: [{ subjectcode: "CS101", obtainedmarks: 18 }] } };
      },
      async getReport() {
        throw new Error("Report service down");
      },
    };
    const out = await getMarksLatest(fake, { instituteid: "i1", companyid: "c1" }, {
      readPdfText: async () => [],
    });
    assert.equal(out.registrationid, "r2026");
    assert.equal(out.historyRecovered, false);
    assert.match(out.historyError, /could not be recovered/);
  });

  it("getAttendance does not retry LOV on fatal auth or network error", async () => {
    let postRawCalled = false;
    const fake = {
      async postRaw() {
        postRawCalled = true;
        return { response: {} };
      },
      async post() {
        const err = new Error("Session expired");
        err.code = "SESSION_EXPIRED";
        err.status = 401;
        throw err;
      },
    };
    const cachedLov = {
      header: { stynumber: "4" },
      semesters: [{ registrationid: "r1", registrationcode: "REG-1" }],
    };
    await assert.rejects(
      () => getAttendance(fake, { instituteid: "i1" }, cachedLov),
      { code: "SESSION_EXPIRED" }
    );
    assert.equal(postRawCalled, false);
  });

  it("getMarksSemesters posts encrypted instituteid and returns list", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { semestercode: [{ registrationid: "r1" }] } };
      },
    };
    const sems = await getMarksSemesters(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/studentcommonsontroller/getsemestercode-exammarks", { instituteid: "i1" }]);
    assert.equal(sems.length, 1);
  });

  it("getMarks posts encrypted instituteid/registrationid/companyid and returns rows+flags", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return {
          response: {
            viewmarksbystudent: [{ subjectcode: "S1" }],
            fullMarksFlag: "Y",
            passingMarksFlag: "N",
            weightageMarksFlag: "N",
            obtainedweightagemarksflag: "N",
          },
        };
      },
    };
    const detail = await getMarks(fake, { instituteid: "i1", companyid: "c1" }, { registrationid: "r1" });
    assert.deepEqual(seen, [
      "/studentsexamview/getstudent-exammarks",
      { instituteid: "i1", registrationid: "r1", companyid: "c1" },
    ]);
    assert.equal(detail.rows.length, 1);
    assert.equal(detail.fullMarksFlag, "Y");
  });

  it("getMarksLatest chains LOV default semester into detail", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        if (endpoint.endsWith("getsemestercode-exammarks")) {
          return {
            response: {
              semestercode: [{ registrationid: "r1", registrationcode: "REG-1" }],
            },
          };
        }
        return {
          response: {
            viewmarksbystudent: [{ subjectcode: "S1" }],
            fullMarksFlag: "Y",
            passingMarksFlag: "N",
            weightageMarksFlag: "N",
            obtainedweightagemarksflag: "N",
          },
        };
      },
    };
    const out = await getMarksLatest(fake, { instituteid: "i1", companyid: "c1" });
    assert.equal(out.rows.length, 1);
    assert.equal(out.registrationcode, "REG-1");
    assert.deepEqual(calls[1][1], { instituteid: "i1", registrationid: "r1", companyid: "c1" });
  });

  it("getMarksLatest returns empty rows when no semesters", async () => {
    const fake = {
      async post(endpoint) {
        if (endpoint.endsWith("getsemestercode-exammarks")) return { response: { semestercode: [] } };
        throw new Error("should not be called");
      },
    };
    const { rows } = await getMarksLatest(fake, {});
    assert.deepEqual(rows, []);
  });

  it("getMarksLatest notifies onSemesters before detail read fails", async () => {
    let seen = null;
    const fake = {
      async post(endpoint) {
        if (endpoint.endsWith("getsemestercode-exammarks")) {
          return { response: { semestercode: [{ registrationid: "r2" }, { registrationid: "r1" }] } };
        }
        throw new Error("marks down");
      },
    };
    await assert.rejects(
      () => getMarksLatest(fake, { instituteid: "i1" }, { onSemesters: (s) => { seen = s; } }),
      /marks down/,
    );
    assert.deepEqual(seen, [{ registrationid: "r2" }, { registrationid: "r1" }]);
  });

  it("getExamSemesters posts encrypted clientid+instituteid", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { semesterCodeinfo: { semestercode: [{ registrationid: "r1" }] } } };
      },
    };
    const sems = await getExamSemesters(fake, { clientid: "c", instituteid: "i1" });
    assert.deepEqual(seen, [
      "/studentcommonsontroller/getsemestercode-withstudentexamevents",
      { clientid: "c", instituteid: "i1" },
    ]);
    assert.equal(sems.length, 1);
  });

  it("getExamEvents keeps the backend registationid typo", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { eventcode: { examevent: [{ exameventid: "e1" }] } } };
      },
    };
    const events = await getExamEvents(fake, { instituteid: "i1" }, { registrationid: "r1" });
    assert.deepEqual(seen, [
      "/studentcommonsontroller/getstudentexamevents",
      { instituteid: "i1", registationid: "r1" },
    ]);
    assert.equal(events.length, 1);
  });

  it("getExamSchedule posts registrationid+exameventid", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { subjectinfo: [{ subjectdesc: "Math" }] } };
      },
    };
    const rows = await getExamSchedule(fake, { instituteid: "i1" }, { registrationid: "r1", exameventid: "e1" });
    assert.deepEqual(seen, [
      "/studentsttattview/getstudent-examschedule",
      { instituteid: "i1", registrationid: "r1", exameventid: "e1" },
    ]);
    assert.equal(rows.length, 1);
  });

  it("getGradesLatest chains info+registrations into grade rows", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        if (endpoint.endsWith("getstudentinfo")) {
          return { response: { studentinfo: { branchid: "b1", programid: "p1" } } };
        }
        if (endpoint.endsWith("getregistrationList")) {
          return { response: { registrations: [{ registrationid: "r1", registrationcode: "REG-1" }] } };
        }
        return { response: { gradecard: [{ subjectcode: "S1", grade: "A" }] } };
      },
    };
    const out = await getGradesLatest(fake, { instituteid: "i1" });
    assert.equal(out.rows.length, 1);
    assert.deepEqual(out.info, { branchid: "b1", programid: "p1" });
    assert.deepEqual(calls[2][1], { instituteid: "i1", registrationid: "r1", branchid: "b1", programid: "p1" });
  });

  it("getGradesLatest returns empty rows when no registrations", async () => {
    const fake = {
      async post(endpoint) {
        if (endpoint.endsWith("getstudentinfo")) return { response: { studentinfo: { branchid: "b1", programid: "p1" } } };
        if (endpoint.endsWith("getregistrationList")) return { response: { registrations: [] } };
        throw new Error("should not be called");
      },
    };
    const out = await getGradesLatest(fake, { instituteid: "i1" });
    assert.deepEqual(out.rows, []);
    assert.equal(out.registrationcode, null);
  });




  it("getSgpaStudentInfo posts encrypted instituteid and returns studentInfo[0]", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { studentInfo: [{ studentid: "s1", stynumber: "4" }] } };
      },
    };
    const student = await getSgpaStudentInfo(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/studentsgpacgpa/loadData", { instituteid: "i1" }]);
    assert.equal(student.studentid, "s1");
  });

  it("getSgpaCurrentSem posts encrypted instituteid/studentid/name/enrollmentno", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { studentlov: { currentsemester: "4" } } };
      },
    };
    const sem = await getSgpaCurrentSem(fake, { instituteid: "i1" }, { studentid: "s1", name: "N", enrollmentno: "E1" });
    assert.deepEqual(seen, [
      "/studentsgpacgpa/checkIfstudentmasterexist",
      { instituteid: "i1", studentid: "s1", name: "N", enrollmentno: "E1" },
    ]);
    assert.equal(sem, "4");
  });

  it("getSgpaSemesters posts encrypted instituteid/studentid/stynumber and returns semesterList", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { semesterList: [{ stynumber: "4", sgpa: "8.5" }] } };
      },
    };
    const rows = await getSgpaSemesters(fake, { instituteid: "i1" }, { studentid: "s1", stynumber: "4" });
    assert.deepEqual(seen, [
      "/studentsgpacgpa/getallsemesterdata",
      { instituteid: "i1", studentid: "s1", stynumber: "4" },
    ]);
    assert.equal(rows.length, 1);
  });

  it("getSgpaDetail posts encrypted instituteid/studentid/stynumber and returns response", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { semesterList: [{ subjectcode: "S1" }] } };
      },
    };
    const res = await getSgpaDetail(fake, { instituteid: "i1" }, { studentid: "s1", stynumber: "4" });
    assert.deepEqual(seen, [
      "/studentsgpacgpa/getallsemesterdatadetail",
      { instituteid: "i1", studentid: "s1", stynumber: "4" },
    ]);
    assert.equal(res.semesterList.length, 1);
  });

  it("getSgpaLatest chains loadData -> checkexist -> semester list", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        if (endpoint.endsWith("/loadData")) {
          return { response: { studentInfo: [{ studentid: "s1", name: "N", enrollmentno: "E1", stynumber: "3" }] } };
        }
        if (endpoint.endsWith("checkIfstudentmasterexist")) {
          return { response: { studentlov: { currentsemester: "4" } } };
        }
        return { response: { semesterList: [{ stynumber: "4", sgpa: "8.5" }] } };
      },
    };
    const out = await getSgpaLatest(fake, { instituteid: "i1" });
    assert.equal(out.currentsem, "4");
    assert.equal(out.semesters.length, 1);
    assert.deepEqual(calls[2][1], { instituteid: "i1", studentid: "s1", stynumber: "4" });
  });

  it("getSgpaLatest returns empty semesters when no student", async () => {
    const fake = {
      async post(endpoint) {
        if (endpoint.endsWith("/loadData")) return { response: { studentInfo: [] } };
        throw new Error("should not be called");
      },
    };
    const out = await getSgpaLatest(fake, { instituteid: "i1" });
    assert.deepEqual(out.semesters, []);
  });

  it("getSgpaLatest falls back to stynumber when currentsemester is null", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        if (endpoint.endsWith("/loadData")) {
          return { response: { studentInfo: [{ studentid: "s1", name: "N", enrollmentno: "E1", stynumber: "3" }] } };
        }
        if (endpoint.endsWith("checkIfstudentmasterexist")) {
          return { response: { studentlov: { currentsemester: null } } };
        }
        return { response: { semesterList: [{ stynumber: "3" }] } };
      },
    };
    const out = await getSgpaLatest(fake, { instituteid: "i1" });
    assert.equal(out.currentsem, "3");
    assert.deepEqual(calls[2][1], { instituteid: "i1", studentid: "s1", stynumber: "3" });
  });

  it("getSgpaSemesters catches HTTP 500 error and returns empty array", async () => {
    const fake = {
      async post() {
        const err = new Error("Internal Server Error");
        err.status = 500;
        throw err;
      },
    };
    const rows = await getSgpaSemesters(fake, { instituteid: "i1" }, { studentid: "s1", stynumber: "4" });
    assert.deepEqual(rows, []);
  });

  it("getSgpaSemesters catches string status '500' or statusCode 500", async () => {
    const fake = {
      async post() {
        const err = new Error("Internal Server Error");
        err.status = "500";
        throw err;
      },
    };
    const rows = await getSgpaSemesters(fake, { instituteid: "i1" }, { studentid: "s1", stynumber: "4" });
    assert.deepEqual(rows, []);
  });

  it("getSgpaSemesters catches HTTP 500 pattern in error message", async () => {
    const fake = {
      async post() {
        throw new Error("Request failed (HTTP 500)");
      },
    };
    const rows = await getSgpaSemesters(fake, { instituteid: "i1" }, { studentid: "s1", stynumber: "4" });
    assert.deepEqual(rows, []);
  });

  it("getSgpaSemesters catches SQLGrammarException error and returns empty array", async () => {
    const fake = {
      async post() {
        const err = new Error("org.hibernate.exception.SQLGrammarException: could not extract ResultSet");
        throw err;
      },
    };
    const rows = await getSgpaSemesters(fake, { instituteid: "i1" }, { studentid: "s1", stynumber: "4" });
    assert.deepEqual(rows, []);
  });

  it("getSgpaSemesters catches SQLGrammarException when errors is a string or array", async () => {
    const fake = {
      async post() {
        const err = new Error("Database query failed");
        err.errors = "SQLGrammarException: relation does not exist";
        throw err;
      },
    };
    const rows = await getSgpaSemesters(fake, { instituteid: "i1" }, { studentid: "s1", stynumber: "4" });
    assert.deepEqual(rows, []);
  });

  it("getSgpaSemesters safely handles null or non-array semesterList", async () => {
    const fake = {
      async post() {
        return { response: { semesterList: null } };
      },
    };
    const rows = await getSgpaSemesters(fake, { instituteid: "i1" }, { studentid: "s1", stynumber: "4" });
    assert.deepEqual(rows, []);
  });

  it("getSgpaSemesters rethrows AbortError without swallowing it", async () => {
    const fake = {
      async post() {
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        err.status = 500;
        throw err;
      },
    };
    await assert.rejects(
      () => getSgpaSemesters(fake, { instituteid: "i1" }, { studentid: "s1", stynumber: "4" }),
      (err) => err?.name === "AbortError"
    );
  });

  it("getSgpaSemesters rethrows non-500 non-SQL errors (e.g. 401)", async () => {
    const fake = {
      async post() {
        const err = new Error("Session expired");
        err.status = 401;
        err.code = "SESSION_EXPIRED";
        throw err;
      },
    };
    await assert.rejects(
      () => getSgpaSemesters(fake, { instituteid: "i1" }, { studentid: "s1", stynumber: "4" }),
      (err) => err?.status === 401
    );
  });

  it("getSgpaLatest degrades gracefully when getallsemesterdata throws 500", async () => {
    const fake = {
      async post(endpoint) {
        if (endpoint.endsWith("/loadData")) {
          return { response: { studentInfo: [{ studentid: "s1", name: "N", enrollmentno: "E1", stynumber: "3" }] } };
        }
        if (endpoint.endsWith("checkIfstudentmasterexist")) {
          return { response: { studentlov: { currentsemester: "4" } } };
        }
        const err = new Error("org.hibernate.exception.SQLGrammarException");
        err.status = 500;
        throw err;
      },
    };
    const out = await getSgpaLatest(fake, { instituteid: "i1" });
    assert.equal(out.currentsem, "4");
    assert.equal(out.student.studentid, "s1");
    assert.deepEqual(out.semesters, []);
  });

  it("getSgpaLatest falls back to stynumber when checkIfstudentmasterexist throws 500", async () => {
    const fake = {
      async post(endpoint) {
        if (endpoint.endsWith("/loadData")) {
          return { response: { studentInfo: [{ studentid: "s1", name: "N", enrollmentno: "E1", stynumber: "3" }] } };
        }
        if (endpoint.endsWith("checkIfstudentmasterexist")) {
          const err = new Error("Internal Server Error");
          err.status = 500;
          throw err;
        }
        return { response: { semesterList: [{ stynumber: "3", sgpa: "8.5" }] } };
      },
    };
    const out = await getSgpaLatest(fake, { instituteid: "i1" });
    assert.equal(out.currentsem, "3");
    assert.equal(out.student.studentid, "s1");
    assert.deepEqual(out.semesters, [{ stynumber: "3", sgpa: "8.5" }]);
  });

  it("getSgpaLatest degrades gracefully when loadData throws 500", async () => {
    const fake = {
      async post() {
        const err = new Error("Portal down");
        err.status = 500;
        throw err;
      },
    };
    const out = await getSgpaLatest(fake, { instituteid: "i1" });
    assert.deepEqual(out, { student: null, currentsem: null, semesters: [] });
  });

  it("getSgpaLatest rethrows 502/503/504 gateway outages instead of caching empty data", async () => {
    for (const status of [502, 503, 504]) {
      const fake = {
        async post() {
          const err = new Error("JUET's portal is down (not us).");
          err.status = status;
          throw err;
        },
      };
      await assert.rejects(
        () => getSgpaLatest(fake, { instituteid: "i1" }),
        (err) => err?.status === status
      );
    }
  });














  it("getFacultyRegistrations empty list means no detail call", async () => {
    const fake = {
      async post(endpoint) {
        if (endpoint.endsWith("getregistrationList")) return { response: { registrations: [] } };
        throw new Error("should not be called");
      },
    };
    assert.deepEqual(await getFacultyRegistrations(fake, { instituteid: "i1" }), []);
  });


  it("getSubjectAttendanceAll fans out over L/T/P components", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        return { response: { summary: [] } };
      },
    };
    const row = {
      subjectid: "s1", subjectcode: "SC1", individualsubjectcode: "ISC1",
      Lsubjectcomponentid: "c1,c2", Tsubjectcomponentid: "", Psubjectcomponentid: "c3",
    };
    const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
    assert.deepEqual(Object.keys(out).sort(), ["L", "P"]);
    assert.deepEqual(calls[0][1].cmpidkey, [{ subjectcomponentid: "c1" }, { subjectcomponentid: "c2" }]);
    assert.equal(calls[0][1].subjectcode, "ISC1");
  });

  it("retries only failed components of the exact attendance snapshot", async () => {
    const calls = [];
    let failTutorial = true;
    const fake = { async post(endpoint, payload) {
      const type = payload.cmpidkey[0].subjectcomponentid;
      calls.push(type);
      if (type === "t" && failTutorial) throw new Error("tutorial unavailable");
      return { response: { summary: [{ present: "Y" }] } };
    } };
    const session = { username: "student", instituteid: "i1", token: "token" };
    const row = { subjectid: "s1", Lsubjectcomponentid: "l", Tsubjectcomponentid: "t", Lpercentage: 80 };
    const base = { registrationid: "r1", registrationcode: "RC1" };
    const completed = new Map();
    const read = () => getSubjectAttendanceAll(fake, session, row, base, "current", { completed });
    await assert.rejects(read(), /tutorial unavailable/);
    failTutorial = false;
    const result = await read();
    assert.deepEqual(Object.keys(result).sort(), ["L", "T"]);
    assert.deepEqual(calls, ["l", "t", "t"], "successful lecture must survive tutorial retry");
    assert.deepEqual([...completed.keys()].sort(), ["L", "T"]);
    // A new snapshot gets a new checkpoint from the caller.
    await getSubjectAttendanceAll(fake, session, { ...row, Lpercentage: 90 }, base, "current", { completed: new Map() });
    assert.deepEqual(calls.slice(-2), ["l", "t"]);
  });

  it("getSubjectAttendanceAll handles NO Attendance Found as empty summary", async () => {
    const fake = {
      async post() {
        const err = new Error("NO Attendance Found");
        err.errors = ["NO Attendance Found"];
        throw err;
      },
    };
    const row = {
      subjectid: "s1", subjectcode: "SC1",
      Lsubjectcomponentid: "c1",
    };
    const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
    assert.deepEqual(out, { L: { summary: [] } });
  });

  for (const msg of [
    "No Data Found", "No Record Found", "No data exist", "no attendance detail found",
    "Record Not Found", "Data Not Found", "Attendance Not Found", "No Records Found",
  ]) {
    it(`getSubjectAttendanceAll handles "${msg}" as empty summary`, async () => {
      const fake = {
        async post() {
          const err = new Error(msg);
          err.errors = [msg];
          throw err;
        },
      };
      const row = {
        subjectid: "s1", subjectcode: "SC1",
        Lsubjectcomponentid: "c1",
      };
      const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
      assert.deepEqual(out, { L: { summary: [] } });
    });
  }

  it("getSubjectAttendanceAll reads components with unknown percentages", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        return { response: { summary: [{ present: "Y" }] } };
      },
    };
    const row = {
      subjectid: "s1",
      subjectcode: "SC1",
      Lsubjectcomponentid: "c_lec",
      Lpercentage: 85,
      Tsubjectcomponentid: "c_tut",
      Tpercentage: null,
    };
    const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
    assert.equal(calls.length, 2);
    assert.deepEqual(out.L, { summary: [{ present: "Y" }] });
    assert.deepEqual(out.T, { summary: [{ present: "Y" }] });
  });

  it("getSubjectAttendanceAll does not infer component totals from the subject total", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        return { response: { summary: [] } };
      },
    };
    const row = {
      subjectid: "s1",
      subjectcode: "SC1",
      totalclass: 0,
      totalpresent: 0,
      Lsubjectcomponentid: "c_lec",
      Lpercentage: 0,
      Tsubjectcomponentid: "c_tut",
      Tpercentage: 0,
    };
    const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
    assert.equal(calls.length, 2);
    assert.deepEqual(out.L, { summary: [] });
    assert.deepEqual(out.T, { summary: [] });
  });

  it("getSubjectAttendanceAll does not infer an empty tutorial from lecture totals", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        return { response: { summary: [{ present: "Y" }] } };
      },
    };
    const row = {
      subjectid: "s1",
      subjectcode: "SC1",
      totalclass: 20,
      totalpresent: 17,
      Lsubjectcomponentid: "c_lec",
      Ltotalclass: 20,
      Ltotalpresent: 17,
      Lpercentage: 85,
      Tsubjectcomponentid: "c_tut",
    };
    const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
    assert.equal(calls.length, 2);
    assert.deepEqual(out.L, { summary: [{ present: "Y" }] });
    assert.deepEqual(out.T, { summary: [{ present: "Y" }] });
  });

  it("getSubjectAttendanceAll reads unknown totals even when percentages are blank", async () => {
    for (const emptyPct of ["", "-", " — ", "N/A", null]) {
      const calls = [];
      const fake = {
        async post(endpoint, payload) {
          calls.push([endpoint, payload]);
          return { response: { summary: [{ present: "Y" }] } };
        },
      };
      const row = {
        subjectid: "s1",
        subjectcode: "SC1",
        Lsubjectcomponentid: "c_lec",
        Lpercentage: 85,
        Tsubjectcomponentid: "c_tut",
        Tpercentage: emptyPct,
      };
      const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
      assert.equal(calls.length, 2, `unknown Tpercentage ${JSON.stringify(emptyPct)} is not zero classes`);
      assert.deepEqual(out.L, { summary: [{ present: "Y" }] });
      assert.deepEqual(out.T, { summary: [{ present: "Y" }] });
    }
  });

  it("getSubjectAttendanceAll skips network POST when component ID is 0 or null string", async () => {
    for (const invalidId of ["0", "null", "undefined", "  "]) {
      const calls = [];
      const fake = {
        async post(endpoint, payload) {
          calls.push([endpoint, payload]);
          return { response: { summary: [{ present: "Y" }] } };
        },
      };
      const row = {
        subjectid: "s1",
        subjectcode: "SC1",
        Lsubjectcomponentid: "c_lec",
        Lpercentage: 85,
        Tsubjectcomponentid: invalidId,
      };
      const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
      assert.equal(calls.length, 1, `skips T when Tsubjectcomponentid is ${JSON.stringify(invalidId)}`);
      assert.deepEqual(out.L, { summary: [{ present: "Y" }] });
      assert.deepEqual(out.T, { summary: [] });
    }
  });

  it("getSubjectAttendanceAll skips network POST when row explicitly reports 0 classes for a component", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        return { response: { summary: [{ present: "Y" }] } };
      },
    };
    const row = {
      subjectid: "s1",
      subjectcode: "SC1",
      Lsubjectcomponentid: "c_lec",
      Ltotalclass: 12,
      Ltotalpresent: 10,
      Lpercentage: 83.3,
      Tsubjectcomponentid: "c_tut",
      Ttotalclass: 0,
      Ttotalpresent: 0,
      Tpercentage: 0,
    };
    const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
    assert.equal(calls.length, 1, "only fetches L component, skipping 0-class T component");
    assert.deepEqual(out.L, { summary: [{ present: "Y" }] });
    assert.deepEqual(out.T, { summary: [] });
  });

  it("getSubjectAttendanceAll does not infer empty practicals from L/T totals", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        return { response: { summary: [{ present: "Y" }] } };
      },
    };
    const row = {
      subjectid: "s1",
      subjectcode: "SC1",
      totalclass: 30,
      totalpresent: 25,
      Lsubjectcomponentid: "c_lec",
      Ltotalclass: 20,
      Tsubjectcomponentid: "c_tut",
      Ttotalclass: 10,
      Psubjectcomponentid: "c_prac",
    };
    const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
    assert.equal(calls.length, 3);
    assert.deepEqual(out.P, { summary: [{ present: "Y" }] });
  });

  it("getSubjectAttendanceAll does not skip component if totalpresent > 0 or percentage > 0 even if totalclass is 0", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        return { response: { summary: [{ present: "Y" }] } };
      },
    };
    const row = {
      subjectid: "s1",
      subjectcode: "SC1",
      Lsubjectcomponentid: "c_lec",
      Ltotalclass: 0,
      Ltotalpresent: 1, // skewed or corrupted: classes attended > 0
      Lpercentage: 0,
      Tsubjectcomponentid: "c_tut",
      Ttotalclass: 0,
      Ttotalpresent: 0,
      Tpercentage: "25.0%", // skewed: percentage > 0
    };
    const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
    assert.equal(calls.length, 2, "does not skip L (present > 0) or T (percentage > 0)");
    assert.deepEqual(out.L, { summary: [{ present: "Y" }] });
    assert.deepEqual(out.T, { summary: [{ present: "Y" }] });
  });

  it("getSubjectAttendanceAll rejects if any component fails with an unexpected error even if another succeeds", async () => {
    const fake = {
      async post(endpoint, payload) {
        if (payload.cmpidkey?.[0]?.subjectcomponentid === "c_tut") {
          return { response: { summary: [{ present: "Y" }] } };
        }
        const err = new Error("Database query failed");
        err.status = 500;
        throw err;
      },
    };
    const row = {
      subjectid: "s1", subjectcode: "SC1",
      Lsubjectcomponentid: "c_lec",
      Tsubjectcomponentid: "c_tut",
    };
    await assert.rejects(
      getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" }),
      /Database query failed/
    );
  });

  for (const failure of [
    { code: "NETWORK_ERROR" }, { code: "REQUEST_TIMEOUT" },
    { status: 502 }, { status: 504 }, { status: 500 }, { status: 401 },
  ]) it(`getSubjectAttendanceAll leaves ${JSON.stringify(failure)} retries to the caller`, async () => {
    let calls = 0;
    const error = Object.assign(new Error("Unavailable"), failure);
    const fake = { async post() { calls++; throw error; } };
    const row = { subjectid: "s1", subjectcode: "SC1", Lsubjectcomponentid: "c_lec" };
    const read = () => getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
    await assert.rejects(read, (err) => err === error);
    assert.equal(calls, 1);
    fake.post = async () => { calls++; return { response: { summary: [] } }; };
    assert.deepEqual(await read(), { L: { summary: [] } });
    assert.equal(calls, 2);
  });

  it("getSubjectAttendanceAll previous branch hits mirrored endpoint", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        return { response: { summary: [] } };
      },
    };
    const row = { subjectid: "s1", subjectcode: "SC1", Psubjectcomponentid: "c9" };
    const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" }, "previous");
    assert.deepEqual(Object.keys(out), ["P"]);
    assert.ok(calls.every(([e]) => e.endsWith("getpreviousstudentsubjectpersentage")));
  });

  it("fetchSubjectAttendance current branch posts percentage endpoint", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { summary: [] } };
      },
    };
    const { fetchSubjectAttendance } = await import("../src/features.js");
    await fetchSubjectAttendance(fake, { instituteid: "i1" }, "current", {
      subjectid: "s1", registrationid: "r1", components: "c1,c2",
      subjectcode: "SC1", registrationcode: "RC1",
    });
    assert.deepEqual(seen, [
      "/StudentClassAttendance/getstudentsubjectpersentage",
      { instituteid: "i1", subjectid: "s1", registrationid: "r1", cmpidkey: [{ subjectcomponentid: "c1" }, { subjectcomponentid: "c2" }], subjectcode: "SC1", registrationcode: "RC1" },
    ]);
  });

  it("leaf getters pass through their endpoints", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push(endpoint);
        return { response: { studentattendancelist: [] } };
      },
      async postRaw(endpoint) {
        calls.push(endpoint);
        return { response: { semlist: [] } };
      },
    };
    const { getAttendanceRegistrations: reg, getAttendanceDetail: det, getGradeStudentInfo: gsi,
      getGradeRegistrations: gr, getGradeCard: gc, getFacultyRegistrations: fr, getFaculties: fac } =
      await import("../src/features.js");
    await reg(fake, { instituteid: "i1" });
    await det(fake, { instituteid: "i1" }, { stynumber: "s", registrationid: "r", registrationcode: "c" });
    await gsi(fake, { instituteid: "i1" });
    await gr(fake, { instituteid: "i1" });
    await gc(fake, { instituteid: "i1" }, { registrationid: "r", branchid: "b", programid: "p" });
    await fr(fake, { instituteid: "i1" });
    await fac(fake, { instituteid: "i1" }, { registrationid: "r" });
    for (const e of [
      "/StudentClassAttendance/getstudentInforegistrationforattendence",
      "/StudentClassAttendance/getstudentattendancedetail",
      "/studentgradecard/getstudentinfo",
      "/studentgradecard/getregistrationList",
      "/studentgradecard/showstudentgradecard",
      "/reqsubfaculty/getregistrationList",
      "/reqsubfaculty/getfaculties",
    ]) assert.ok(calls.includes(e), e);
  });

  it("normalizes unexpected non-array shapes to arrays across exam, marks, grades, and faculty reads", async () => {
    const fake = {
      async post() {
        return {
          response: {
            semesterCodeinfo: { semestercode: { notAnArray: true } },
            eventcode: { examevent: "invalid-string" },
            subjectinfo: null,
            semestercode: 12345,
            registrations: { single: "obj" },
            gradecard: null,
            viewmarksbystudent: { bad: true },
          },
        };
      },
    };
    const session = { clientid: "c1", instituteid: "i1", companyid: "co1" };
    assert.deepEqual(await getExamSemesters(fake, session), []);
    assert.deepEqual(await getExamEvents(fake, session, { registrationid: "r1" }), []);
    assert.deepEqual(await getExamSchedule(fake, session, { registrationid: "r1", exameventid: "e1" }), []);
    assert.deepEqual(await getMarksSemesters(fake, session), []);
    assert.deepEqual((await getMarks(fake, session, { registrationid: "r1", registrationcode: "c1" })).rows, []);
    assert.deepEqual(await getGradeRegistrations(fake, session), []);
    assert.deepEqual(await getGradeCard(fake, session, { registrationid: "r", branchid: "b", programid: "p" }), []);
    assert.deepEqual(await getFacultyRegistrations(fake, session), []);
    const facultyRes = await getFaculties(fake, session, { registrationid: "r" });
    assert.deepEqual(facultyRes.rows, []);

    const fallbackFake = {
      async post() {
        return { response: { registrations: { single: "obj" }, registrationList: [{ registrationid: "r2" }] } };
      },
    };
    assert.deepEqual(await getFacultyRegistrations(fallbackFake, session), [{ registrationid: "r2" }]);
  });

  it("getAttendance ignores non-array cachedLov.semesters and fetches fresh LOV once", async () => {
    let lovCalls = 0;
    const fake = {
      async postRaw() {
        lovCalls++;
        return { response: { headerlist: [{ stynumber: 2 }], semlist: [{ registrationid: "r1", registrationcode: "S1" }] } };
      },
      async post() {
        return { response: { studentattendancelist: [{ subjectcode: "CS1" }], currentSem: "S1" } };
      },
    };
    const res = await getAttendance(fake, { instituteid: "i1" }, { semesters: "not-an-array" });
    assert.equal(lovCalls, 1);
    assert.equal(res.rows.length, 1);
  });
});
