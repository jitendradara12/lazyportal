// Feature modules: one async function per portal read. Each takes (client,
// session, params?) and returns plain data. No crypto here — client.post
// encrypts, client.postRaw sends plain JSON (see client.js header for which).

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

/** Exam semesters. Encrypted {clientid, instituteid}. */
export async function getExamSemesters(client, session) {
  const body = await client.post("/studentcommonsontroller/getsemestercode-withstudentexamevents", {
    clientid: session.clientid,
    instituteid: session.instituteid,
  });
  return body.response?.semesterCodeinfo?.semestercode ?? [];
}

/** Exam events for a semester. Encrypted; backend key has a typo (`registationid`). */
export async function getExamEvents(client, session, { registrationid }) {
  const body = await client.post("/studentcommonsontroller/getstudentexamevents", {
    instituteid: session.instituteid,
    registationid: registrationid,
  });
  return body.response?.eventcode?.examevent ?? [];
}

/** Exam timetable rows: datetime, datetimeupto, subjectdesc, roomcode, seatno. */
export async function getExamSchedule(client, session, { registrationid, exameventid }) {
  const body = await client.post("/studentsttattview/getstudent-examschedule", {
    instituteid: session.instituteid,
    registrationid,
    exameventid,
  });
  return body.response?.subjectinfo ?? [];
}

/** Grade card student info (branch/program needed for the grade call). Encrypted {instituteid}. */
export async function getGradeStudentInfo(client, session) {
  const body = await client.post("/studentgradecard/getstudentinfo", {
    instituteid: session.instituteid,
  });
  return body.response?.studentinfo ?? null;
}

/** Grade card semester list. Encrypted {instituteid}. */
export async function getGradeRegistrations(client, session) {
  const body = await client.post("/studentgradecard/getregistrationList", {
    instituteid: session.instituteid,
  });
  return body.response?.registrations ?? [];
}

/** Grade rows: subjectcode, subjectdesc, grade, earnedcredit, gradepoint, minorsubject. */
export async function getGradeCard(client, session, { registrationid, branchid, programid }) {
  const body = await client.post("/studentgradecard/showstudentgradecard", {
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

/** Personal info. Plain JSON (official app skips AES here). */
export async function getPersonalInfo(client, session) {
  const body = await client.postRaw("/studentpersinfo/getstudent-personalinformation", {
    instituteid: session.instituteid,
  });
  return {
    general: body.response?.generalinformation ?? null,
    qualification: body.response?.qualification ?? null,
  };
}

/** Pending service requests. Plain JSON. Read-only list. */
export async function getPendingServiceRequests(client, session) {
  const body = await client.postRaw("/servicerequestbystudent/getpendingservicerequestgrid", {
    instituteid: session.instituteid,
  });
  return body.response?.pendingList ?? [];
}

/** Payslip dues by enrollment. Encrypted. Read-only. */
export async function getPayslipDues(client, session) {
  const body = await client.post("/feepayslipcontroller/getdueamountdetails", {
    enrollmentno: session.enrollmentno,
  });
  return body.response?.studentlist ?? [];
}

/** Announcements. Auth-free GET. */
export async function getNotices(client) {
  const body = await client.getPublic("/token/marqeelist");
  const text = body.response?.text;
  return Array.isArray(text) ? text : text == null ? [] : [text];
}

/** Medical info. Plain JSON (official app sends {} unencrypted). */
export async function getMedicalInfo(client, session) {
  const body = await client.postRaw("/studentinformation/getstudentmedicalinfo", {
    instituteid: session.instituteid,
  });
  return body.response ?? null;
}

/** Semesters for the faculty lookup. Encrypted {instituteid}. */
export async function getFacultyRegistrations(client, session) {
  const body = await client.post("/reqsubfaculty/getregistrationList", {
    instituteid: session.instituteid,
  });
  return body.response?.registrations ?? body.response?.registrationList ?? [];
}

/** Subject-faculty rows + credit total. Encrypted {instituteid, registrationid}. */
export async function getFaculties(client, session, { registrationid }) {
  const body = await client.post("/reqsubfaculty/getfaculties", {
    instituteid: session.instituteid,
    registrationid,
  });
  return {
    rows: body.response?.registrations ?? [],
    totalcreditpoints: body.response?.totalcreditpoints ?? null,
  };
}

/** Faculty lookup in one call: latest registration -> rows. */
export async function getFacultiesLatest(client, session) {
  const semesters = await getFacultyRegistrations(client, session);
  const sem = semesters[0];
  if (!sem) return { semesters, registrationcode: null, rows: [], totalcreditpoints: null };
  const detail = await getFaculties(client, session, { registrationid: sem.registrationid });
  return { semesters, registrationcode: sem.registrationcode ?? null, ...detail };
}

/** Active fee events (what is due now, read-only). Encrypted {instituteid, maineventid:""}. */
export async function getFeeEvents(client, session) {
  const body = await client.post("/onlinefeepayment/getmyactivefeeevents", {
    instituteid: session.instituteid,
    maineventid: "",
  });
  return body.response?.formdatetodate ?? [];
}

/** One subject-detail call. `previous` selects the previous-day endpoint. */
export async function fetchSubjectAttendance(client, session, which, { subjectid, registrationid, components, subjectcode, registrationcode }) {
  const body = await client.post(
    which === "previous"
      ? "/StudentClassAttendance/getpreviousstudentsubjectpersentage"
      : "/StudentClassAttendance/getstudentsubjectpersentage",
    {
      instituteid: session.instituteid,
      subjectid,
      registrationid,
      cmpidkey: components.split(",").filter(Boolean).map((subjectcomponentid) => ({ subjectcomponentid })),
      subjectcode,
      registrationcode,
    }
  );
  return body.response;
}

/** Per-subject attendance detail (which dates/components missed). One call per L/T/P type. */
export async function getSubjectAttendance(client, session, args) {
  return fetchSubjectAttendance(client, session, "current", args);
}

/** Previous-day variant of getSubjectAttendance. Same payload, mirrored endpoint. */
export async function getPreviousSubjectAttendance(client, session, args) {
  return fetchSubjectAttendance(client, session, "previous", args);
}

/** L/T/P detail for one attendance row in parallel. Skips types with no components. */
export async function getSubjectAttendanceAll(client, session, row, { registrationid, registrationcode }, which = "current") {
  const out = {};
  await Promise.all(
    ["L", "T", "P"].map(async (t) => {
      const csv = row[`${t}subjectcomponentid`];
      if (!csv) return;
      out[t] = await fetchSubjectAttendance(client, session, which, {
        subjectid: row.subjectid,
        registrationid,
        components: csv,
        subjectcode: row.individualsubjectcode ?? row.subjectcode,
        registrationcode,
      });
    })
  );
  return out;
}

/** Bank info (read-only; refunds depend on it). Encrypted {instituteid}. */
export async function getBankInfo(client, session) {
  const body = await client.post("/studentbankdetails/getstudentbankinfo", {
    instituteid: session.instituteid,
  });
  return body.response ?? null;
}

/** Photo upload window state. Plain JSON; response is a message string. */
export async function getPhotoWindow(client, session) {
  const body = await client.postRaw("/studentpersinfo/checkphotouploadevent", {
    instituteid: session.instituteid,
  });
  return body.response ?? null;
}

/** Choice-print semesters. Encrypted {} -> registrationcodelist. */
export async function getChoiceSemesters(client) {
  const body = await client.post("/studentchoiceprint/getsemestercodelist", {});
  return body.response?.registrationcodelist ?? [];
}

/** Enrolled subjects for a semester. Encrypted {instituteid, clientid, registrationid}. */
export async function getChoiceSubjects(client, session, { registrationid }) {
  const body = await client.post("/studentchoiceprint/getsubjectpreference", {
    instituteid: session.instituteid,
    clientid: session.clientid,
    registrationid,
  });
  return body.response?.subjectpreferencegrid ?? [];
}

/** Enrolled subjects in one call: latest semester -> rows. */
export async function getChoiceLatest(client, session) {
  const semesters = await getChoiceSemesters(client);
  const sem = semesters[0];
  if (!sem) return { semesters, registrationcode: null, rows: [] };
  const rows = await getChoiceSubjects(client, session, { registrationid: sem.registrationid });
  return { semesters, registrationcode: sem.registrationcode ?? null, rows };
}

/** Previous-day L/T/P fan-out, mirroring getSubjectAttendanceAll. */
export async function getPreviousSubjectAttendanceAll(client, session, row, ctx) {
  return getSubjectAttendanceAll(client, session, row, ctx, "previous");
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

/** SGPA/CGPA student info. Encrypted {instituteid} -> response.studentInfo[0]. */
export async function getSgpaStudentInfo(client, session) {
  const body = await client.post("/studentsgpacgpa/loadData", {
    instituteid: session.instituteid,
  });
  return body.response?.studentInfo?.[0] ?? null;
}

/** SGPA/CGPA current semester. Encrypted {instituteid, studentid, name, enrollmentno}. */
export async function getSgpaCurrentSem(client, session, { studentid, name, enrollmentno }) {
  const body = await client.post("/studentsgpacgpa/checkIfstudentmasterexist", {
    instituteid: session.instituteid,
    studentid,
    name,
    enrollmentno,
  });
  return body.response?.studentlov?.currentsemester ?? null;
}

/** SGPA/CGPA semester list (credit-wise rows with sgpa/cgpa). Encrypted {instituteid, studentid, stynumber}. */
export async function getSgpaSemesters(client, session, { studentid, stynumber }) {
  const body = await client.post("/studentsgpacgpa/getallsemesterdata", {
    instituteid: session.instituteid,
    studentid,
    stynumber,
  });
  return body.response?.semesterList ?? [];
}

/** SGPA/CGPA semester detail (subject rows). Encrypted {instituteid, studentid, stynumber}. Returns response as-is. */
export async function getSgpaDetail(client, session, { studentid, stynumber }) {
  const body = await client.post("/studentsgpacgpa/getallsemesterdatadetail", {
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

/** Approved service requests. Plain JSON {instituteid}. Read-only list. */
export async function getApprovedRequests(client, session) {
  const body = await client.postRaw("/servicerequestbystudent/getapprovedrequestgrid", {
    instituteid: session.instituteid,
  });
  return body.response?.approvedList ?? [];
}

/** Closed service requests. Plain JSON {instituteid}. Read-only list. */
export async function getClosedRequests(client, session) {
  const body = await client.postRaw("/servicerequestbystudent/getclosedservicerequests", {
    instituteid: session.instituteid,
  });
  return body.response?.closedRequestList ?? [];
}

/** Fee-paid service requests. Plain JSON {instituteid}. Read-only list. */
export async function getPaidRequests(client, session) {
  const body = await client.postRaw("/servicerequestbystudent/getfeepaidservicerequests", {
    instituteid: session.instituteid,
  });
  return body.response?.feePaidList ?? [];
}

/** Withdrawn service requests. Plain JSON {instituteid}. Read-only list. */
export async function getWithdrawnRequests(client, session) {
  const body = await client.postRaw("/servicerequestbystudent/getwithdwalservicerequests", {
    instituteid: session.instituteid,
  });
  return body.response?.withdwalRequestList ?? [];
}

/** Cancelled service requests. Plain JSON {instituteid}. Read-only list. Backend key has a typo (`cencelled`). */
export async function getCancelledRequests(client, session) {
  const body = await client.postRaw("/servicerequestbystudent/getcancelledwalservicerequests", {
    instituteid: session.instituteid,
  });
  return body.response?.cencelledRequestList ?? [];
}

/** No-dues form flag. Encrypted {instituteid}. Returns response as-is. */
export async function getNoDuesForm(client, session) {
  const body = await client.post("/noduesstatus/showform", {
    instituteid: session.instituteid,
  });
  return body.response;
}

/** No-dues fee status. Encrypted {instituteid}. Returns response as-is. */
export async function getNoDuesFeeStatus(client, session) {
  const body = await client.post("/noduesstatus/getfeestatus", {
    instituteid: session.instituteid,
  });
  return body.response;
}

/** No-dues activities. Encrypted {instituteid}. Backend path has a typo (`activites`). Returns response as-is. */
export async function getNoDuesActivities(client, session) {
  const body = await client.post("/noduesstatus/getactivites", {
    instituteid: session.instituteid,
  });
  return body.response;
}

/** Hostel allocation detail. Plain JSON {instituteid} — official app sends it unencrypted here. */
export async function getHostelDetail(client, session) {
  const body = await client.postRaw("/myhostelallocationdetail/gethostelallocationdetail", {
    instituteid: session.instituteid,
  });
  return {
    present: body.response?.presenthosteldetail,
    authorities: body.response?.presenthostelauthoritiesdetail,
  };
}

/** Disciplinary details. Encrypted {} (empty object). */
export async function getDisciplinary(client, session) {
  const body = await client.post("/studentdisciplinarydetails/getstudentdisciplinarydetails", {});
  return body.response?.studentdisciplinarydetails ?? [];
}
