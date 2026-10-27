// Feature modules: one async function per portal read. Each takes (client,
// session, params?) and returns plain data. No crypto here — client.post
// encrypts, client.postRaw sends plain JSON (see client.js header for which).

import { PortalError } from "./errors.js";
import { mergeMarkRows } from "./marks.js";
import { parseMarksReport } from "./marksReport.js";

export const marksReportEndpoints = Object.freeze({
  standard: "/studentsexamview/printstudent-exammarks",
});

export const isMarksReportPath = (path) => /^\/studentsexamview\/printstudent-exammarks\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(path);

// Shared by feature readers and transport-aware refresh policy.
export const featurePostEndpoints = Object.freeze({
  attendance: Object.freeze({
    registrations: "/StudentClassAttendance/getstudentInforegistrationforattendence",
    overview: "/StudentClassAttendance/getstudentattendancedetail",
    current: "/StudentClassAttendance/getstudentsubjectpersentage",
    previous: "/StudentClassAttendance/getpreviousstudentsubjectpersentage",
  }),
  marks: Object.freeze({
    semesters: "/studentcommonsontroller/getsemestercode-exammarks",
    rows: "/studentsexamview/getstudent-exammarks",
  }),
  exams: Object.freeze({
    semesters: "/studentcommonsontroller/getsemestercode-withstudentexamevents",
    events: "/studentcommonsontroller/getstudentexamevents",
    schedule: "/studentsttattview/getstudent-examschedule",
  }),
  more: Object.freeze({
    facultyRegistrations: "/reqsubfaculty/getregistrationList",
    faculties: "/reqsubfaculty/getfaculties",
    choiceSemesters: "/studentchoiceprint/getsemestercodelist",
    choiceSubjects: "/studentchoiceprint/getsubjectpreference",
    gradeInfo: "/studentgradecard/getstudentinfo",
    gradeRegistrations: "/studentgradecard/getregistrationList",
    grades: "/studentgradecard/showstudentgradecard",
    sgpaInfo: "/studentsgpacgpa/loadData",
    sgpaCurrent: "/studentsgpacgpa/checkIfstudentmasterexist",
    sgpaSemesters: "/studentsgpacgpa/getallsemesterdata",
    sgpaDetail: "/studentsgpacgpa/getallsemesterdatadetail",
  }),
});

/** Attendance LOV: header (stynumber) + semester list. Plain JSON (unencrypted) — official app stringifies without AES here. */
export async function getAttendanceRegistrations(client, session) {
  const body = await client.postRaw(featurePostEndpoints.attendance.registrations, {
    instituteid: session.instituteid,
  });
  if (!Array.isArray(body.response?.semlist)) {
    throw new PortalError("Portal returned incomplete attendance registrations. Please retry.", { code: "INVALID_RESPONSE" });
  }
  return {
    header: body.response?.headerlist?.[0] ?? null,
    semesters: body.response.semlist,
  };
}

/** Attendance detail rows carry L/T/P percentages already (no per-subject call needed). */
export async function getAttendanceDetail(client, session, { stynumber, registrationid, registrationcode }) {
  const body = await client.post(featurePostEndpoints.attendance.overview, {
    instituteid: session.instituteid,
    stynumber,
    registrationid,
    registrationcode,
  });
  const rows = body.response?.studentattendancelist;
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new PortalError("Portal returned incomplete attendance records. Please retry.", { code: "INVALID_RESPONSE" });
  }
  return { rows, currentSem: body.response?.currentSem };
}

/** Daily attendance in one call: LOV -> latest registration -> detail rows. */
export async function getAttendance(client, session, cachedLov) {
  let lov = cachedLov;
  if (!lov?.semesters?.length) {
    lov = await getAttendanceRegistrations(client, session);
  }
  const sem = lov.semesters[0];
  if (!sem) return { header: lov.header ?? null, semesters: lov.semesters ?? [], rows: [], currentSem: null };
  try {
    const detail = await getAttendanceDetail(client, session, {
      stynumber: lov.header?.stynumber,
      registrationid: sem.registrationid,
      registrationcode: sem.registrationcode,
    });
    return { header: lov.header ?? null, semesters: lov.semesters, registrationcode: sem.registrationcode, ...detail };
  } catch (err) {
    // retry with fresh LOV only on portal parameter/data errors; bubble auth/network immediately
    const isFatal =
      err?.code === "SESSION_EXPIRED" ||
      err?.code === "NETWORK_ERROR" ||
      err?.code === "INVALID_RESPONSE" ||
      err?.status === 401 ||
      (typeof err?.status === "number" && err.status >= 500);
    if (cachedLov && !isFatal) {
      return getAttendance(client, session);
    }
    throw err;
  }
}

/** Exam semesters. Encrypted {clientid, instituteid}. */
export async function getExamSemesters(client, session) {
  const body = await client.post(featurePostEndpoints.exams.semesters, {
    clientid: session.clientid,
    instituteid: session.instituteid,
  });
  return body.response?.semesterCodeinfo?.semestercode ?? [];
}

/** Exam events for a semester. Encrypted; backend key has a typo (`registationid`). */
export async function getExamEvents(client, session, { registrationid }) {
  const body = await client.post(featurePostEndpoints.exams.events, {
    instituteid: session.instituteid,
    registationid: registrationid,
  });
  return body.response?.eventcode?.examevent ?? [];
}

/** Exam timetable rows: datetime, datetimeupto, subjectdesc, roomcode, seatno. */
export async function getExamSchedule(client, session, { registrationid, exameventid }) {
  const body = await client.post(featurePostEndpoints.exams.schedule, {
    instituteid: session.instituteid,
    registrationid,
    exameventid,
  });
  return body.response?.subjectinfo ?? [];
}

/** Grade card student info (branch/program needed for the grade call). Encrypted {instituteid}. */
export async function getGradeStudentInfo(client, session) {
  const body = await client.post(featurePostEndpoints.more.gradeInfo, {
    instituteid: session.instituteid,
  });
  return body.response?.studentinfo ?? null;
}

/** Grade card semester list. Encrypted {instituteid}. */
export async function getGradeRegistrations(client, session) {
  const body = await client.post(featurePostEndpoints.more.gradeRegistrations, {
    instituteid: session.instituteid,
  });
  return body.response?.registrations ?? [];
}

/** Grade rows: subjectcode, subjectdesc, grade, earnedcredit, gradepoint, minorsubject. */
export async function getGradeCard(client, session, { registrationid, branchid, programid }) {
  const body = await client.post(featurePostEndpoints.more.grades, {
    instituteid: session.instituteid,
    registrationid,
    branchid,
    programid,
  });
  return body.response?.gradecard ?? [];
}

/** Grades in one call: info -> latest registration -> rows. */
export async function getGradesLatest(client, session) {
  const [info, semesters] = await Promise.all([
    getGradeStudentInfo(client, session),
    getGradeRegistrations(client, session),
  ]);
  const sem = semesters[0];
  if (!sem || !info) return { info, semesters, registrationcode: sem?.registrationcode ?? null, rows: [] };
  const rows = await getGradeCard(client, session, {
    registrationid: sem.registrationid,
    branchid: info?.branchid,
    programid: info?.programid,
  });
  return { info, semesters, registrationcode: sem.registrationcode, rows };
}

/** Semesters for the faculty lookup. Encrypted {instituteid}. */
export async function getFacultyRegistrations(client, session) {
  const body = await client.post(featurePostEndpoints.more.facultyRegistrations, {
    instituteid: session.instituteid,
  });
  return body.response?.registrations ?? body.response?.registrationList ?? [];
}

/** Subject-faculty rows + credit total. Encrypted {instituteid, registrationid}. */
export async function getFaculties(client, session, { registrationid }) {
  const body = await client.post(featurePostEndpoints.more.faculties, {
    instituteid: session.instituteid,
    registrationid,
  });
  return {
    rows: body.response?.registrations ?? [],
    totalcreditpoints: body.response?.totalcreditpoints ?? null,
  };
}

// Background attendance sync and an opened detail sheet can request the same
// subject simultaneously, outside useFeature's hook-level deduplication. Share
// only pending reads: never retain results/errors or coalesce auth/login calls.
const subjectAttendanceRequests = new WeakMap();

function shareSubjectAttendanceRead(client, key, run) {
  let pending = subjectAttendanceRequests.get(client);
  if (!pending) {
    pending = new Map();
    subjectAttendanceRequests.set(client, pending);
  }
  const existing = pending.get(key);
  if (existing) return existing;

  const request = Promise.resolve().then(run).finally(() => {
    pending.delete(key);
    if (pending.size === 0) subjectAttendanceRequests.delete(client);
  });
  pending.set(key, request);
  return request;
}

/** One subject-detail read. `previous` selects the previous-day endpoint.
 * Identical concurrent reads share the transport, not a persistent cache. */
export async function fetchSubjectAttendance(client, session, which, { subjectid, registrationid, components, subjectcode, registrationcode }) {
  const endpoint = which === "previous"
    ? featurePostEndpoints.attendance.previous
    : featurePostEndpoints.attendance.current;
  const payload = {
    instituteid: session.instituteid,
    subjectid,
    registrationid,
    cmpidkey: components.split(",").filter(Boolean).map((subjectcomponentid) => ({ subjectcomponentid })),
    subjectcode,
    registrationcode,
  };
  // Client identity + account/token + exact endpoint/payload isolate reads
  // across logins, institutes, semesters, subjects, and L/T/P components.
  const key = JSON.stringify([
    session.username ?? session.enrollmentno,
    session.token,
    endpoint,
    payload,
  ]);
  return shareSubjectAttendanceRead(client, key, async () => {
    const body = await client.post(endpoint, payload);
    return body.response;
  });
}

function isNoAttendance(e) {
  const msg = e?.message || "";
  const errList = Array.isArray(e?.errors) ? e.errors.join(" ") : "";
  return /no attendance/i.test(msg) || /no attendance/i.test(errList);
}

function isComponentKnownEmpty(row, t) {
  const rawTotal = row[`${t}totalclass`] ?? row[`${t}Totalclass`] ?? row[`${t.toLowerCase()}totalclass`];
  if (rawTotal === undefined || rawTotal === null || rawTotal === "") return false;
  const total = Number(rawTotal);
  if (!Number.isFinite(total) || total > 0) return false;

  const rawPres = row[`${t}totalpresent`] ?? row[`${t}Totalpresent`] ?? row[`${t.toLowerCase()}totalpresent`];
  if (rawPres !== undefined && rawPres !== null && rawPres !== "") {
    const pres = Number(rawPres);
    if (Number.isFinite(pres) && pres > 0) return false;
  }

  const rawPct = row[`${t}percentage`] ?? row[`${t}Percentage`] ?? row[`${t.toLowerCase()}percentage`];
  if (rawPct !== undefined && rawPct !== null && rawPct !== "") {
    const numPct = Number(String(rawPct).replace("%", "").trim());
    if (Number.isFinite(numPct) && numPct > 0) return false;
  }
  return true;
}

/** L/T/P detail for one attendance row in parallel. Skips types with no components or known 0-class components. */
export async function getSubjectAttendanceAll(client, session, row, { registrationid, registrationcode }, which = "current") {
  const out = {};
  let lastErr = null;
  const read = (csv) => ({
    subjectid: row.subjectid,
    registrationid,
    components: csv,
    subjectcode: row.individualsubjectcode ?? row.subjectcode,
    registrationcode,
  });
  await Promise.all(
    ["L", "T", "P"].map(async (t) => {
      const csv = row[`${t}subjectcomponentid`];
      if (!csv) return;
      if (which === "current" && isComponentKnownEmpty(row, t)) {
        out[t] = { summary: [] };
        return;
      }
      try {
        out[t] = await fetchSubjectAttendance(client, session, which, read(csv));
      } catch (e) {
        if (isNoAttendance(e)) {
          out[t] = { summary: [] };
          return;
        }
        // Transient network/proxy 502/504 retry: one retry on mobile transport blips
        if (e?.code === "NETWORK_ERROR" || e?.status === 502 || e?.status === 504) {
          try {
            out[t] = await fetchSubjectAttendance(client, session, which, read(csv));
            return;
          } catch (retryErr) {
            if (isNoAttendance(retryErr)) {
              out[t] = { summary: [] };
              return;
            }
            lastErr = retryErr;
            return;
          }
        }
        lastErr = e;
      }
    })
  );
  if (lastErr) {
    throw lastErr;
  }
  return out;
}

/** Choice-print semesters. Encrypted {} -> registrationcodelist. */
export async function getChoiceSemesters(client) {
  const body = await client.post(featurePostEndpoints.more.choiceSemesters, {});
  const rows = body.response?.registrationcodelist ?? [];
  return Array.isArray(rows) ? rows : [];
}

/** Enrolled subjects for a semester. Encrypted {instituteid, clientid, registrationid}. */
export async function getChoiceSubjects(client, session, { registrationid }) {
  const body = await client.post(featurePostEndpoints.more.choiceSubjects, {
    instituteid: session.instituteid,
    clientid: session.clientid,
    registrationid,
  });
  const rows = body.response?.subjectpreferencegrid ?? [];
  return Array.isArray(rows) ? rows : [];
}

/** Registered subjects in one call: LOV -> latest registration -> rows. */
export async function getChoiceSubjectsLatest(client, session) {
  const semesters = await getChoiceSemesters(client);
  const sem = semesters[0];
  if (!sem) return { semesters, registrationcode: null, rows: [] };
  const rows = await getChoiceSubjects(client, session, { registrationid: sem.registrationid });
  return { semesters, registrationcode: sem.registrationcode, rows };
}

/** Marks LOV: semester list. Encrypted — official app AES-encrypts {instituteid} here. */
export async function getMarksSemesters(client, session) {
  const body = await client.post(featurePostEndpoints.marks.semesters, {
    instituteid: session.instituteid,
  });
  return body.response?.semestercode ?? [];
}

/** Marks detail rows + display flags. Encrypted {instituteid, registrationid, companyid}. */
export async function getMarks(client, session, { registrationid, registrationcode, readPdfText }) {
  const body = await client.post(featurePostEndpoints.marks.rows, {
    instituteid: session.instituteid,
    registrationid,
    companyid: session.companyid,
  });
  const detail = {
    rows: body.response?.viewmarksbystudent ?? [],
    fullMarksFlag: body.response?.fullMarksFlag,
    passingMarksFlag: body.response?.passingMarksFlag,
    weightageMarksFlag: body.response?.weightageMarksFlag,
    obtainedweightagemarksflag: body.response?.obtainedweightagemarksflag,
  };
  if (!readPdfText) return detail;
  try {
    const history = await getMarksReport(client, session, { registrationid, registrationcode, readPdfText });
    return { ...detail, rows: mergeMarkRows(history, detail.rows), historyRecovered: true };
  } catch (error) {
    if (error.code === "SESSION_EXPIRED") throw error;
    return { ...detail, historyRecovered: false, historyError: "Earlier exam marks could not be recovered from the portal's report. Please retry." };
  }
}

/** The official PDF retains every event even when the JSON read returns only the latest. */
export async function getMarksReport(client, session, { registrationid, registrationcode, readPdfText }) {
  const path = `${marksReportEndpoints.standard}/${session.instituteid}/${registrationid}/${registrationcode}`;
  if (!isMarksReportPath(path)) throw new PortalError("Invalid marks report selection.", { code: "INVALID_RESPONSE" });
  return parseMarksReport(await readPdfText(await client.getReport(path)), registrationcode);
}

/** Marks in one call: LOV -> latest registration -> detail rows. */
export async function getMarksLatest(client, session, options = {}) {
  const semesters = await getMarksSemesters(client, session);
  const sem = semesters[0];
  if (!sem)
    return {
      semesters,
      registrationcode: null,
      rows: [],
      fullMarksFlag: null,
      passingMarksFlag: null,
      weightageMarksFlag: null,
      obtainedweightagemarksflag: null,
      historyRecovered: true,
    };
  const detail = await getMarks(client, session, { ...options, registrationid: sem.registrationid, registrationcode: sem.registrationcode });
  return { semesters, registrationcode: sem.registrationcode, ...detail };
}

/** SGPA/CGPA student info. Encrypted {instituteid} -> response.studentInfo[0]. */
export async function getSgpaStudentInfo(client, session) {
  try {
    const body = await client.post(featurePostEndpoints.more.sgpaInfo, {
      instituteid: session.instituteid,
    });
    return body.response?.studentInfo?.[0] ?? null;
  } catch (err) {
    if (isSgpa500(err)) return null;
    throw err;
  }
}

/** SGPA/CGPA current semester. Encrypted {instituteid, studentid, name, enrollmentno}. */
export async function getSgpaCurrentSem(client, session, { studentid, name, enrollmentno }) {
  try {
    const body = await client.post(featurePostEndpoints.more.sgpaCurrent, {
      instituteid: session.instituteid,
      studentid,
      name,
      enrollmentno,
    });
    return body.response?.studentlov?.currentsemester ?? null;
  } catch (err) {
    if (isSgpa500(err)) return null;
    throw err;
  }
}

function isSgpa500(err) {
  if (!err || typeof err !== "object") return false;
  if (err.name === "AbortError" || err.code === "ABORT_ERR") return false;
  if (err.code === "SESSION_EXPIRED" || err.status === 401 || err.name === "SessionExpiredError") return false;

  const statusNum = Number(err.status ?? err.statusCode);
  if (Number.isFinite(statusNum) && statusNum >= 500) return true;

  const msg = typeof err.message === "string" ? err.message : "";
  const errList = Array.isArray(err.errors)
    ? err.errors.join(" ")
    : typeof err.errors === "string"
      ? err.errors
      : "";
  const combined = `${msg} ${errList}`;
  return (
    /SQLGrammarException/i.test(combined) ||
    /HTTP\s*5\d\d/i.test(msg) ||
    /5\d\d\s+Internal\s+Server\s+Error/i.test(msg)
  );
}

/** SGPA/CGPA semester list (credit-wise rows with sgpa/cgpa). Encrypted {instituteid, studentid, stynumber}. */
export async function getSgpaSemesters(client, session, { studentid, stynumber }) {
  try {
    const body = await client.post(featurePostEndpoints.more.sgpaSemesters, {
      instituteid: session.instituteid,
      studentid,
      stynumber,
    });
    const list = body.response?.semesterList;
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (isSgpa500(err)) return [];
    throw err;
  }
}

/** SGPA/CGPA semester detail (subject rows). Encrypted {instituteid, studentid, stynumber}. Returns response as-is. */
export async function getSgpaDetail(client, session, { studentid, stynumber }) {
  const body = await client.post(featurePostEndpoints.more.sgpaDetail, {
    instituteid: session.instituteid,
    studentid,
    stynumber,
  });
  return body.response;
}

/** SGPA/CGPA in one call: loadData -> checkexist -> currentsem -> semester list. */
export async function getSgpaLatest(client, session) {
  try {
    const student = await getSgpaStudentInfo(client, session);
    if (!student) return { student: null, currentsem: null, semesters: [] };
    const currentsem =
      (await getSgpaCurrentSem(client, session, {
        studentid: student.studentid,
        name: student.name,
        enrollmentno: student.enrollmentno,
      })) ?? student.stynumber ?? null;
    const semesters = await getSgpaSemesters(client, session, {
      studentid: student.studentid,
      stynumber: currentsem,
    });
    return { student, currentsem, semesters };
  } catch (err) {
    if (isSgpa500(err)) return { student: null, currentsem: null, semesters: [] };
    throw err;
  }
}

