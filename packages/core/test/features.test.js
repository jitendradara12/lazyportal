import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFeeSummary, getNavigation, getAttendance, getMarksSemesters, getMarks, getMarksLatest,
  getExamSemesters, getExamEvents, getExamSchedule, getGradesLatest, getPersonalInfo,
  getPendingServiceRequests, getPayslipDues, getSgpaStudentInfo, getSgpaCurrentSem,
  getSgpaSemesters, getSgpaDetail, getSgpaLatest, getApprovedRequests, getClosedRequests,
  getPaidRequests, getWithdrawnRequests, getCancelledRequests, getNoDuesForm,
  getNoDuesFeeStatus, getNoDuesActivities, getHostelDetail, getDisciplinary,
  getNotices, getMedicalInfo, getFacultiesLatest } from "../src/features.js";

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

  it("getNavigation unwraps children", async () => {
    const fake = {
      async post() {
        return { response: [{ children: [{ title: "A" }] }] };
      },
    };
    assert.deepEqual(await getNavigation(fake, {}), [{ title: "A" }]);
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

  it("getPersonalInfo posts raw instituteid", async () => {
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

  it("getPendingServiceRequests posts raw instituteid", async () => {
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

  it("getNoDuesForm posts encrypted instituteid and returns response", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { formflag: true } };
      },
    };
    const res = await getNoDuesForm(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/noduesstatus/showform", { instituteid: "i1" }]);
    assert.equal(res.formflag, true);
  });

  it("getNoDuesFeeStatus posts encrypted instituteid and returns response", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: [{ fee: "0" }] };
      },
    };
    const res = await getNoDuesFeeStatus(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/noduesstatus/getfeestatus", { instituteid: "i1" }]);
    assert.equal(res.length, 1);
  });

  it("getNoDuesActivities posts encrypted instituteid and returns response", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: [{ activity: "LIB" }] };
      },
    };
    const res = await getNoDuesActivities(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/noduesstatus/getactivites", { instituteid: "i1" }]);
    assert.equal(res.length, 1);
  });

  it("getHostelDetail posts raw instituteid and returns present+authorities", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { presenthosteldetail: { hosteldescription: "H1" }, presenthostelauthoritiesdetail: [{ employeename: "W" }] } };
      },
    };
    const out = await getHostelDetail(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/myhostelallocationdetail/gethostelallocationdetail", { instituteid: "i1" }]);
    assert.equal(out.present.hosteldescription, "H1");
    assert.equal(out.authorities.length, 1);
  });

  it("getDisciplinary posts encrypted empty object and returns list", async () => {
    let seen;
    const fake = {
      async post(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { studentdisciplinarydetails: [{ misconduct: "M1" }] } };
      },
    };
    const rows = await getDisciplinary(fake, {});
    assert.deepEqual(seen, ["/studentdisciplinarydetails/getstudentdisciplinarydetails", {}]);
    assert.equal(rows.length, 1);
  });

  it("getNotices uses public GET and normalizes text", async () => {
    const fake = {
      async getPublic(endpoint) {
        assert.equal(endpoint, "/token/marqeelist");
        return { response: { text: ["a", "b"] } };
      },
    };
    assert.deepEqual(await getNotices(fake), ["a", "b"]);
  });

  it("getMedicalInfo posts raw instituteid", async () => {
    let seen;
    const fake = {
      async postRaw(endpoint, payload) {
        seen = [endpoint, payload];
        return { response: { studentMap: [] } };
      },
    };
    const out = await getMedicalInfo(fake, { instituteid: "i1" });
    assert.deepEqual(seen, ["/studentinformation/getstudentmedicalinfo", { instituteid: "i1" }]);
    assert.ok(out.studentMap);
  });

  it("getFacultiesLatest chains registrations into faculty rows", async () => {
    const calls = [];
    const fake = {
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        if (endpoint.endsWith("getregistrationList")) {
          return { response: { registrations: [{ registrationid: "r1", registrationcode: "REG-1" }] } };
        }
        return { response: { registrations: [{ subjectcode: "S1" }], totalcreditpoints: "20" } };
      },
    };
    const out = await getFacultiesLatest(fake, { instituteid: "i1" });
    assert.equal(out.rows.length, 1);
    assert.equal(out.totalcreditpoints, "20");
    assert.deepEqual(calls[1][1], { instituteid: "i1", registrationid: "r1" });
  });
});
