import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFeeSummary, getPayslipDues, getFeeEvents, getAttendance, getMarksSemesters, getMarks, getMarksLatest, getExamSemesters, getExamEvents, getExamSchedule, getGradesLatest, getPersonalInfo, getPendingServiceRequests, getMedicalInfo, getSgpaStudentInfo, getSgpaCurrentSem, getSgpaSemesters, getSgpaDetail, getSgpaLatest, getApprovedRequests, getClosedRequests, getPaidRequests, getWithdrawnRequests, getCancelledRequests, getFacultyRegistrations, getSubjectAttendanceAll, getChoiceSemesters, getChoiceSubjects, getChoiceSubjectsLatest } from "../src/features.js";

describe("features", () => {
  it("getFeeSummary posts raw instituteid and returns rows", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { feesummarydata: [{ dueamount: "10" }] } };
      },
    };
    const rows = await getFeeSummary(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/studentfeeledger/loadfeesummary", { instituteid: "i1" }]);
    assert.equal(rows.length, 1);
  });

  it("getFeeSummary returns [] on odd shapes", async () => {
    const fake = {
      async postRaw() {
        return { response: { feesummarydata: { dueamount: "10" } } };
      },
    };
    assert.deepEqual(await getFeeSummary(fake, { instituteid: "i1" }), []);
  });

  it("getPayslipDues posts encrypted enrollmentno", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { studentlist: [{ dueamount: "5" }] } };
      },
    };
    const rows = await getPayslipDues(fake, { enrollmentno: "E1" });
    assert.deepEqual(seen, ["/feepayslipcontroller/getdueamountdetails", { enrollmentno: "E1" }]);
    assert.equal(rows.length, 1);
  });

  it("getFeeEvents posts encrypted instituteid+maineventid", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { formdatetodate: [{ eventid: "e1" }] } };
      },
    };
    const rows = await getFeeEvents(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/onlinefeepayment/getmyactivefeeevents", { instituteid: "i1", maineventid: "" }]);
    assert.equal(rows.length, 1);
  });

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

  it("getSubjectAttendanceAll rejects if any component fails with an unexpected error even if another succeeds", async () => {
    const fake = {
      async post(endpoint, payload) {
        if (payload.cmpidkey?.[0]?.subjectcomponentid === "c_tut") {
          return { response: { summary: [{ present: "Y" }] } };
        }
        throw new Error("502 Bad Gateway");
      },
    };
    const row = {
      subjectid: "s1", subjectcode: "SC1",
      Lsubjectcomponentid: "c_lec",
      Tsubjectcomponentid: "c_tut",
    };
    await assert.rejects(
      getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" }),
      /502 Bad Gateway/
    );
  });

  it("getSubjectAttendanceAll retries transient 502/network errors once before succeeding", async () => {
    let lecAttempts = 0;
    const fake = {
      async post(endpoint, payload) {
        if (payload.cmpidkey?.[0]?.subjectcomponentid === "c_lec") {
          lecAttempts++;
          if (lecAttempts === 1) {
            const err = new Error("Upstream unreachable");
            err.status = 502;
            throw err;
          }
          return { response: { summary: [{ present: "Y" }] } };
        }
        return { response: { summary: [{ present: "Y" }] } };
      },
    };
    const row = {
      subjectid: "s1", subjectcode: "SC1",
      Lsubjectcomponentid: "c_lec",
      Tsubjectcomponentid: "c_tut",
    };
    const out = await getSubjectAttendanceAll(fake, { instituteid: "i1" }, row, { registrationid: "r1", registrationcode: "RC1" });
    assert.equal(lecAttempts, 2, "retried lecture component once");
    assert.ok(out.L);
    assert.ok(out.T);
  });






  it("getChoiceSemesters posts empty object and returns registrationcodelist", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { registrationcodelist: [{ registrationid: "r1", registrationcode: "REG-1" }] } };
      },
    };
    const sems = await getChoiceSemesters(fake);
    assert.deepEqual(seen, ["/studentchoiceprint/getsemestercodelist", {}]);
    assert.equal(sems.length, 1);
    assert.equal(sems[0].registrationid, "r1");
  });

  it("getChoiceSemesters returns [] on odd shapes", async () => {
    const fake = { async post() { return { response: { registrationcodelist: {} } }; } };
    assert.deepEqual(await getChoiceSemesters(fake), []);
  });

  it("getChoiceSubjects posts instituteid/clientid/registrationid and returns grid", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { subjectpreferencegrid: [{ subjectcode: "S1" }] } };
      },
    };
    const rows = await getChoiceSubjects(fake, { instituteid: "i1", clientid: "c1" }, { registrationid: "r1" });
    assert.deepEqual(seen, [
      "/studentchoiceprint/getsubjectpreference",
      { instituteid: "i1", clientid: "c1", registrationid: "r1" },
    ]);
    assert.equal(rows.length, 1);
  });

  it("getChoiceSubjectsLatest uses first semester and returns rows", async () => {
    const fake = {
      async post(endpoint, payload) {
        if (endpoint.endsWith("getsemestercodelist")) {
          return { response: { registrationcodelist: [{ registrationid: "r1", registrationcode: "REG-1" }] } };
        }
        assert.equal(payload.registrationid, "r1");
        return { response: { subjectpreferencegrid: [{ subjectcode: "S1" }] } };
      },
    };
    const out = await getChoiceSubjectsLatest(fake, { instituteid: "i1", clientid: "c1" });
    assert.equal(out.rows.length, 1);
    assert.equal(out.registrationcode, "REG-1");
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
        return { response: {} };
      },
      async postRaw(endpoint) {
        calls.push(endpoint);
        return { response: {} };
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

  it("getPersonalInfo posts raw instituteid and returns general+qualification", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { generalinformation: { name: "N" }, qualification: [] } };
      },
    };
    const info = await getPersonalInfo(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/studentpersinfo/getstudent-personalinformation", { instituteid: "i1" }]);
    assert.equal(info.general.name, "N");
  });

  it("getMedicalInfo posts raw instituteid and returns response", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { bloodgroup: "O+" } };
      },
    };
    const info = await getMedicalInfo(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/studentinformation/getstudentmedicalinfo", { instituteid: "i1" }]);
    assert.equal(info.bloodgroup, "O+");
  });

  it("getPendingServiceRequests posts raw instituteid and returns pendingList", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { pendingList: [{ requestno: "R1" }] } };
      },
    };
    const rows = await getPendingServiceRequests(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/servicerequestbystudent/getpendingservicerequestgrid", { instituteid: "i1" }]);
    assert.equal(rows.length, 1);
  });

  it("getApprovedRequests posts raw instituteid and returns approvedList", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { approvedList: [{ requestno: "R1" }] } };
      },
    };
    const rows = await getApprovedRequests(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/servicerequestbystudent/getapprovedrequestgrid", { instituteid: "i1" }]);
    assert.equal(rows.length, 1);
  });

  it("getClosedRequests posts raw instituteid and returns closedRequestList", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { closedRequestList: [{ requestno: "R1" }] } };
      },
    };
    const rows = await getClosedRequests(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/servicerequestbystudent/getclosedservicerequests", { instituteid: "i1" }]);
    assert.equal(rows.length, 1);
  });

  it("getPaidRequests posts raw instituteid and returns feePaidList", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { feePaidList: [{ requestno: "R1" }] } };
      },
    };
    const rows = await getPaidRequests(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/servicerequestbystudent/getfeepaidservicerequests", { instituteid: "i1" }]);
    assert.equal(rows.length, 1);
  });

  it("getWithdrawnRequests posts raw instituteid and returns withdwalRequestList", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { withdwalRequestList: [{ requestno: "R1" }] } };
      },
    };
    const rows = await getWithdrawnRequests(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/servicerequestbystudent/getwithdwalservicerequests", { instituteid: "i1" }]);
    assert.equal(rows.length, 1);
  });

  it("getCancelledRequests posts raw instituteid and returns cencelledRequestList", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { cencelledRequestList: [{ requestno: "R1" }] } };
      },
    };
    const rows = await getCancelledRequests(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/servicerequestbystudent/getcancelledwalservicerequests", { instituteid: "i1" }]);
    assert.equal(rows.length, 1);
  });
});
