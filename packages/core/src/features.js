// Feature: navigation menu + fee summary. Template for future features.
// Each feature = (client, session, params) => typed data. No crypto here.

export async function getNavigation(client, session) {
  const body = await client.post("/clxuser/getmenulist", {
    userid: session.userid,
    instituteid: session.instituteid,
    membertype: session.membertype,
    bypassValue: session.bypassValue ?? session.bypass ?? undefined,
  });
  return body.response?.[0]?.children ?? body.response;
}

/** Attendance LOV: header (stynumber) + semester list. Plain JSON (unencrypted) — official app stringifies without AES here. */
export async function getAttendanceRegistrations(client, session) {
  const body = await client.postRaw("/StudentClassAttendance/getstudentInforegistrationforattendence", {
    instituteid: session.instituteid,
  });
  return {
    header: body.response?.headerlist?.[0] ?? null,
    semesters: body.response?.semlist ?? [],
  };
}

/** Attendance detail rows carry L/T/P percentages already (no per-subject call needed). */
export async function getAttendanceDetail(client, session, { stynumber, registrationid, registrationcode }) {
  const body = await client.post("/StudentClassAttendance/getstudentattendancedetail", {
    instituteid: session.instituteid,
    stynumber,
    registrationid,
    registrationcode,
  });
  return {
    rows: body.response?.studentattendancelist ?? [],
    currentSem: body.response?.currentSem,
  };
}

/** Daily attendance in one call: LOV -> latest registration -> detail rows. */
export async function getAttendance(client, session) {
  const { header, semesters } = await getAttendanceRegistrations(client, session);
  const sem = semesters[0];
  if (!sem) return { header, semesters, rows: [], currentSem: null };
  const detail = await getAttendanceDetail(client, session, {
    stynumber: header?.stynumber,
    registrationid: sem.registrationid,
    registrationcode: sem.registrationcode,
  });
  return { header, semesters, registrationcode: sem.registrationcode, ...detail };
}

/** Fee summary rows (raw JSON endpoint, unencrypted). Returns array, [] on odd shapes. */
export async function getFeeSummary(client, session) {
  const body = await client.postRaw("/studentfeeledger/loadfeesummary", {
    instituteid: session.instituteid,
  });
  const rows = body.response?.feesummarydata ?? body.response ?? [];
  return Array.isArray(rows) ? rows : [];
}

/** Marks LOV: semester list. Encrypted — official app AES-encrypts {instituteid} here. */
export async function getMarksSemesters(client, session) {
  const body = await client.post("/studentcommonsontroller/getsemestercode-exammarks", {
    instituteid: session.instituteid,
  });
  return body.response?.semestercode ?? [];
}

/** Marks detail rows + display flags. Encrypted {instituteid, registrationid, companyid}. */
export async function getMarks(client, session, { registrationid }) {
  const body = await client.post("/studentsexamview/getstudent-exammarks", {
    instituteid: session.instituteid,
    registrationid,
    companyid: session.companyid,
  });
  return {
    rows: body.response?.viewmarksbystudent ?? [],
    fullMarksFlag: body.response?.fullMarksFlag,
    passingMarksFlag: body.response?.passingMarksFlag,
    weightageMarksFlag: body.response?.weightageMarksFlag,
    obtainedweightagemarksflag: body.response?.obtainedweightagemarksflag,
  };
}

/** Marks in one call: LOV -> latest registration -> detail rows. */
export async function getMarksLatest(client, session) {
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
    };
  const detail = await getMarks(client, session, { registrationid: sem.registrationid });
  return { semesters, registrationcode: sem.registrationcode, ...detail };
}
