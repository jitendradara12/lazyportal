import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFeeSummary, getNavigation, getAttendance, getMarksSemesters, getMarks, getMarksLatest } from "../src/features.js";

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
});
