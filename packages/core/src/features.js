// Feature modules: one async function per portal read. Each takes (client,
// session, params?) and returns plain data. No crypto here — client.post
// encrypts, client.postRaw sends plain JSON (see client.js header for which).

import { PortalError } from "./errors.js";
import { mergeMarkRows, parseMarksReport } from "./marks.js";

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
    gradeInfo: "/studentgradecard/getstudentinfo",
    gradeRegistrations: "/studentgradecard/getregistrationList",
    grades: "/studentgradecard/showstudentgradecard",
    sgpaInfo: "/studentsgpacgpa/loadData",
    sgpaCurrent: "/studentsgpacgpa/checkIfstudentmasterexist",
    sgpaSemesters: "/studentsgpacgpa/getallsemesterdata",
    sgpaDetail: "/studentsgpacgpa/getallsemesterdatadetail",
  }),
});

function asArray(val) {
  return Array.isArray(val) ? val : [];
}

/** Attendance LOV: header (stynumber) + semester list. Plain JSON (unencrypted) — official app stringifies without AES here. */
export async function getAttendanceRegistrations(client, session, { signal } = {}) {
  const body = await client.postRaw(featurePostEndpoints.attendance.registrations, {
    instituteid: session.instituteid,
  }, { signal });
  if (!Array.isArray(body.response?.semlist)) {
    throw new PortalError("Portal returned incomplete attendance registrations. Please retry.", { code: "INVALID_RESPONSE" });
  }
  return {
    header: asArray(body.response?.headerlist)[0] ?? null,
    semesters: body.response.semlist,
  };
}

/** Attendance detail rows carry L/T/P percentages already (no per-subject call needed). */
export async function getAttendanceDetail(client, session, { stynumber, registrationid, registrationcode }, { signal } = {}) {
  const body = await client.post(featurePostEndpoints.attendance.overview, {
    instituteid: session.instituteid,
    stynumber,
    registrationid,
    registrationcode,
  }, { signal });
  const rows = body.response?.studentattendancelist;
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new PortalError("Portal returned incomplete attendance records. Please retry.", { code: "INVALID_RESPONSE" });
  }
  return { rows, currentSem: body.response?.currentSem };
}

/** Daily attendance in one call: LOV -> latest registration -> detail rows. */
export async function getAttendance(client, session, cachedLov, { signal } = {}) {
  const usedCache = Array.isArray(cachedLov?.semesters) && cachedLov.semesters.length > 0;
  const lov = usedCache ? cachedLov : await getAttendanceRegistrations(client, session, { signal });
  const sems = asArray(lov?.semesters);
  const sem = sems[0];
  if (!sem) return { header: lov?.header ?? null, semesters: sems, rows: [], currentSem: null };
  try {
    const detail = await getAttendanceDetail(client, session, {
      stynumber: lov?.header?.stynumber,
      registrationid: sem.registrationid,
      registrationcode: sem.registrationcode,
    }, { signal });
    return { header: lov?.header ?? null, semesters: sems, registrationcode: sem.registrationcode, ...detail };
  } catch (err) {
    // retry with fresh LOV only on portal parameter/data errors; bubble auth/network immediately
    const isFatal =
      signal?.aborted || err?.name === "AbortError" || err?.code === "ABORT_ERR" ||
      err?.code === "SESSION_EXPIRED" ||
      err?.code === "NETWORK_ERROR" ||
      err?.code === "REQUEST_TIMEOUT" ||
      err?.code === "INVALID_RESPONSE" ||
      err?.status === 401 ||
      (typeof err?.status === "number" && err.status >= 500);
    if (usedCache && !isFatal) {
      return getAttendance(client, session, undefined, { signal });
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
  return asArray(body.response?.semesterCodeinfo?.semestercode);
}

/** Exam events for a semester. Encrypted; backend key has a typo (`registationid`). */
export async function getExamEvents(client, session, { registrationid }) {
  const body = await client.post(featurePostEndpoints.exams.events, {
    instituteid: session.instituteid,
    registationid: registrationid,
  });
  return asArray(body.response?.eventcode?.examevent);
}

/** Exam timetable rows: datetime, datetimeupto, subjectdesc, roomcode, seatno. */
export async function getExamSchedule(client, session, { registrationid, exameventid }) {
  const body = await client.post(featurePostEndpoints.exams.schedule, {
    instituteid: session.instituteid,
    registrationid,
    exameventid,
  });
  return asArray(body.response?.subjectinfo);
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
  return asArray(body.response?.registrations);
}

/** Grade rows: subjectcode, subjectdesc, grade, earnedcredit, gradepoint, minorsubject. */
export async function getGradeCard(client, session, { registrationid, branchid, programid }) {
  const body = await client.post(featurePostEndpoints.more.grades, {
    instituteid: session.instituteid,
    registrationid,
    branchid,
    programid,
  });
  return asArray(body.response?.gradecard);
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
    branchid: info.branchid,
    programid: info.programid,
  });
  return { info, semesters, registrationcode: sem.registrationcode, rows };
}

/** Semesters for the faculty lookup. Encrypted {instituteid}. */
export async function getFacultyRegistrations(client, session) {
  const body = await client.post(featurePostEndpoints.more.facultyRegistrations, {
    instituteid: session.instituteid,
  });
  const regs = body.response?.registrations;
  return Array.isArray(regs) ? regs : asArray(body.response?.registrationList);
}

/** Subject-faculty rows + credit total. Encrypted {instituteid, registrationid}. */
export async function getFaculties(client, session, { registrationid }) {
  const body = await client.post(featurePostEndpoints.more.faculties, {
    instituteid: session.instituteid,
    registrationid,
  });
  return {
    rows: asArray(body.response?.registrations),
    totalcreditpoints: body.response?.totalcreditpoints ?? null,
  };
}

// Background attendance sync and an opened detail sheet can request the same
// subject simultaneously, outside useFeature's hook-level deduplication. Share
// only pending reads: never retain results/errors or coalesce auth/login calls.
const subjectAttendanceRequests = new WeakMap();

function shareSubjectAttendanceRead(client, key, run, signal) {
  let scopes = subjectAttendanceRequests.get(client);
  if (!scopes) {
    scopes = new Map();
    subjectAttendanceRequests.set(client, scopes);
  }
  let pending = scopes.get(signal);
  if (!pending) scopes.set(signal, pending = new Map());
  const existing = pending.get(key);
  if (existing) return existing;

  const request = Promise.resolve().then(run).finally(() => {
    pending.delete(key);
    if (pending.size === 0) scopes.delete(signal);
    if (scopes.size === 0) subjectAttendanceRequests.delete(client);
  });
  pending.set(key, request);
  return request;
}

export function getAttendanceComponentIds(value) {
  return [...new Set(String(value ?? "").split(",").map(s => s.trim())
    .filter(s => s && s !== "0" && s !== "null" && s !== "undefined"))].sort();
}

/** One subject-detail read. `previous` selects the previous-day endpoint.
 * Identical reads with the same cancellation owner share the transport. */
export async function fetchSubjectAttendance(client, session, which, { subjectid, registrationid, components, subjectcode, registrationcode }, { signal } = {}) {
  const endpoint = which === "previous"
    ? featurePostEndpoints.attendance.previous
    : featurePostEndpoints.attendance.current;
  const payload = {
    instituteid: session.instituteid,
    subjectid,
    registrationid,
    cmpidkey: getAttendanceComponentIds(components).map((subjectcomponentid) => ({ subjectcomponentid })),
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
    const body = await client.post(endpoint, payload, signal ? { signal } : undefined);
    return body.response;
  }, signal);
}

function isNoAttendance(e) {
  if (isAttendanceUnavailable(e) || (e?.status >= 400 && e.status !== 404)) return false;
  const messages = [e?.message, ...(Array.isArray(e?.errors) ? e.errors : [e?.errors])];
  // JUET uses 404 + this business response for subjects without attendance.
  // An HTTP 404 by itself still means the request failed.
  const pattern = e?.status === 404
    ? /^\s*no\s+attendance(?:\s+details?)?\s+found[.!]?\s*$/i
    : /\bno\s+(?:attendance|data|records?)\b|\b(?:attendance|data|records?)\s+not\s+found\b/i;
  return messages.some(message => typeof message === "string" && pattern.test(message));
}

/** Failures that should stop queued history reads instead of hammering JUET. */
export function isAttendanceUnavailable(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR" ||
    ["SESSION_EXPIRED", "NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(error?.code) ||
    error?.status === 401 || error?.status === 429 || error?.status >= 500;
}

function findComponentProp(row, t, name) {
  const keys = [
    `${t}${name}`,
    `${t}${name[0].toUpperCase()}${name.slice(1)}`,
    `${t.toLowerCase()}${name}`,
  ];
  for (const k of keys) {
    if (k in row && row[k] !== undefined) return row[k];
  }
  return undefined;
}

function isComponentKnownEmpty(row, t) {
  const rawTotal = findComponentProp(row, t, "totalclass");
  if (rawTotal == null || String(rawTotal).trim() === "" || Number(rawTotal) !== 0) return false;

  const rawPres = findComponentProp(row, t, "totalpresent");
  if (rawPres !== undefined && rawPres !== null && rawPres !== "") {
    const pres = Number(rawPres);
    if (Number.isFinite(pres) && pres > 0) return false;
  }

  const rawPct = findComponentProp(row, t, "percentage");
  if (Number(String(rawPct ?? "").replace("%", "").trim()) > 0) return false;
  return true;
}

/** Whether this row needs any component reads rather than locally known empties. */
export function hasSubjectAttendanceRequests(row, which = "current") {
  return ["L", "T", "P"].some(type =>
    getAttendanceComponentIds(row[`${type}subjectcomponentid`]).length > 0 &&
    (which !== "current" || !isComponentKnownEmpty(row, type))
  );
}

/** L/T/P detail in parallel. The caller may retain successful components for
 * retries of one exact overview snapshot; completed results stay caller-owned.
 * onUnavailable reports the first outage immediately while siblings finish. */
export async function getSubjectAttendanceAll(client, session, row, { registrationid, registrationcode }, which = "current", { completed, onComponent, onUnavailable, signal } = {}) {
  const out = {};
  const errors = [];
  let unavailable = false;
  const fail = (error) => {
    errors.push(error);
    if (!unavailable && isAttendanceUnavailable(error)) {
      unavailable = true;
      onUnavailable?.(error);
    }
  };
  const publish = (type, data) => {
    out[type] = data;
    completed?.set(type, data);
    onComponent?.(type, data);
  };
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
      if (signal?.aborted) { fail(signal.reason ?? new DOMException("The operation was aborted", "AbortError")); return; }
      if (completed?.has(t)) {
        out[t] = completed.get(t);
        return;
      }
      if (!getAttendanceComponentIds(csv).length || (which === "current" && isComponentKnownEmpty(row, t))) {
        publish(t, { summary: [] });
        return;
      }
      try {
        out[t] = await fetchSubjectAttendance(client, session, which, read(csv), { signal });
      } catch (e) {
        if (isNoAttendance(e)) {
          out[t] = { summary: [] };
        } else {
          fail(e);
          return;
        }
      }
      publish(t, out[t]);
    })
  );
  if (errors.length) throw errors.find(isAttendanceUnavailable) ?? errors[0];
  return out;
}

/** Marks LOV: semester list. Encrypted — official app AES-encrypts {instituteid} here. */
export async function getMarksSemesters(client, session) {
  const body = await client.post(featurePostEndpoints.marks.semesters, {
    instituteid: session.instituteid,
  });
  return asArray(body.response?.semestercode);
}

/** Marks detail rows + display flags. Encrypted {instituteid, registrationid, companyid}. */
export async function getMarks(client, session, { registrationid, registrationcode, readPdfText }) {
  const body = await client.post(featurePostEndpoints.marks.rows, {
    instituteid: session.instituteid,
    registrationid,
    companyid: session.companyid,
  });
  const detail = {
    rows: asArray(body.response?.viewmarksbystudent),
    fullMarksFlag: body.response?.fullMarksFlag,
    passingMarksFlag: body.response?.passingMarksFlag,
    weightageMarksFlag: body.response?.weightageMarksFlag,
    obtainedweightagemarksflag: body.response?.obtainedweightagemarksflag,
  };
  if (!readPdfText) return detail;
  let recoveryStep = "report request";
  try {
    const history = await getMarksReport(client, session, { registrationid, registrationcode,
      readPdfText: async (data) => {
        recoveryStep = "PDF decoding";
        const pages = await readPdfText(data);
        recoveryStep = "marks table matching";
        return pages;
      },
    });
    return { ...detail, rows: mergeMarkRows(history, detail.rows), historyRecovered: true };
  } catch (error) {
    if (error.code === "SESSION_EXPIRED") throw error;
    return { ...detail, historyRecovered: false,
      historyError: `Earlier exam marks could not be recovered from the portal's report. Please retry. Failed step: ${recoveryStep}.` };
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
  options.onSemesters?.(semesters);
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

async function catchSgpa500(run, fallback) {
  try {
    return await run();
  } catch (err) {
    if (isSgpa500(err)) return fallback;
    throw err;
  }
}

/** SGPA/CGPA student info. Encrypted {instituteid} -> response.studentInfo[0]. */
export function getSgpaStudentInfo(client, session) {
  return catchSgpa500(async () => {
    const body = await client.post(featurePostEndpoints.more.sgpaInfo, {
      instituteid: session.instituteid,
    });
    return asArray(body.response?.studentInfo)[0] ?? null;
  }, null);
}

/** SGPA/CGPA current semester. Encrypted {instituteid, studentid, name, enrollmentno}. */
export function getSgpaCurrentSem(client, session, { studentid, name, enrollmentno }) {
  return catchSgpa500(async () => {
    const body = await client.post(featurePostEndpoints.more.sgpaCurrent, {
      instituteid: session.instituteid,
      studentid,
      name,
      enrollmentno,
    });
    return body.response?.studentlov?.currentsemester ?? null;
  }, null);
}

function isSgpa500(err) {
  if (!err || typeof err !== "object") return false;
  if (err.name === "AbortError" || err.code === "ABORT_ERR") return false;
  if (err.code === "SESSION_EXPIRED" || err.status === 401 || err.name === "SessionExpiredError") return false;
  if (Number(err.status ?? err.statusCode) === 500) return true;
  const msg = typeof err.message === "string" ? err.message : "";
  const errList = Array.isArray(err.errors) ? err.errors.join(" ") : typeof err.errors === "string" ? err.errors : "";
  return /SQLGrammarException/i.test(`${msg} ${errList}`) || /HTTP\s*500\b|500\s+Internal\s+Server\s+Error/i.test(msg);
}

/** SGPA/CGPA semester list (credit-wise rows with sgpa/cgpa). Encrypted {instituteid, studentid, stynumber}. */
export function getSgpaSemesters(client, session, { studentid, stynumber }) {
  return catchSgpa500(async () => {
    const body = await client.post(featurePostEndpoints.more.sgpaSemesters, {
      instituteid: session.instituteid,
      studentid,
      stynumber,
    });
    return asArray(body.response?.semesterList);
  }, []);
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
}

