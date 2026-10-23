// Android's isolated portal view consumes this contract. No hosted proxy or
// browser fallback: changing the native allowlist requires rebuilding the APK.
import { encrypt } from "./crypto.js";
import { officialPortalRuntime } from "./officialPortalRuntime.js";

export const officialPortalPolicy = Object.freeze({
  version: 1,
  origin: "https://official.lazyportal.invalid",
  upstream: "https://studentportal.juet.ac.in",
  pagePrefix: "/studentportal/",
  apiPrefix: "/StudentPortalAPI/",
  entry: "/studentportal/#/dashbord",
  // Map the shell's required Material Icons font onto the isolated origin;
  // its CSP can then reject every third-party script and connection.
  assetAliases: {
    "https://fonts.gstatic.com/s/materialicons/v145/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.woff2": "/studentportal/__material-icons.woff2",
  },
  // Reviewed against the official bundle, 2026-10-24. Exact paths, not get*
  // heuristics: even an innocent-looking future endpoint must be reviewed.
  post: [
    "/clxuser/getmenulist",
    "/feedbackformcontroller/getCreadits",
    "/feedbackformcontroller/getDataForFeedback",
    "/onlinefeepayment/getmyactivefeeevents",
    "/onlinefeepayment/loadmyfeedetail",
    "/token/refreshTokenRequest",
    "/StudentClassAttendance/getstudentInforegistrationforattendence",
    "/StudentClassAttendance/getstudentattendancedetail",
    "/StudentClassAttendance/getstudentsubjectpersentage",
    "/StudentClassAttendance/getpreviousstudentsubjectpersentage",
    "/studentcommonsontroller/getsemestercode-exammarks",
    "/studentcommonsontroller/getsemestercode-withstudentexamevents",
    "/studentcommonsontroller/getstudentexamevents",
    "/studentsexamview/getstudent-exammarks",
    "/studentsttattview/getstudent-examschedule",
    "/studentgradecard/getregistrationList",
    "/studentgradecard/getstudentinfo",
    "/studentgradecard/showstudentgradecard",
    "/studentsgpacgpa/loadData",
    "/studentsgpacgpa/checkIfstudentmasterexist",
    "/studentsgpacgpa/getallsemesterdata",
    "/studentsgpacgpa/getallsemesterdatadetail",
    "/reqsubfaculty/getregistrationList",
    "/reqsubfaculty/getfaculties",
    "/reqsubfaculty/getstudentprogrambranch",
    "/reqsubfaculty/getstudents",
    "/studentchoiceprint/getsemestercodelist",
    "/studentchoiceprint/getsubjectpreference",
    "/suppsubjectchoiceprint/getsemestercodelist",
    "/suppsubjectchoiceprint/getsubjectpreference",
    "/myhostelallocationdetail/gethostelallocationdetail",
    "/studentpersinfo/getstudent-personalinformation",
    "/studentinformation/getstudentmedicalinfo",
    "/studentdisciplinarydetails/getstudentdisciplinarydetails",
    "/studentbankdetails/getstudentbankinfo",
    "/studentfeeledger/loadfeesummary",
    "/studentfeeledger/loadfeeheadwisedetails",
    "/studentfeeledger/fetchfeetransaction",
    "/studentfeeledger/getfeewisedetaildata",
    "/registrationslip/getStudentInfo",
    "/registrationslip/getStudentRegistrationInfo",
    "/moocsubjectstatus/getsemestercodelist",
    "/moocsubjectstatus/getsubjectstatus",
    "/adddropsubjectstatus/getsemestercodelist",
    "/adddropsubjectstatus/getsubjectstatus",
    "/servicerequestbystudent/getpendingservicerequestgrid",
    "/servicerequestbystudent/getapprovedrequestgrid",
    "/servicerequestbystudent/getclosedservicerequests",
    "/servicerequestbystudent/getcancelledwalservicerequests",
    "/servicerequestbystudent/getwithdwalservicerequests",
    "/servicerequestbystudent/getfeepaidservicerequests",
  ],
  get: ["/token/getlogoClientWise", "/token/marqeelist", "/token/productversion"],
  routes: [
    "dashbord", "student/myclassattendance", "student/myexaminationschedule",
    "student/eventsubjectmarks", "student/studentgradecard", "student/studentresult",
    "student/studentregisteredfaculty", "student/studentsubjectchoiceprint",
    "student/supplimentarysubjectchoiceprint", "student/hostelallocationdetails",
    "student/studentsPersonalInfo", "student/medicalformforstudent",
    "student/studentdisciplinarydetail", "student/studentbankdetail",
    "student/studentfeeledger", "student/registrationslip", "student/moocsubjectstatus",
    "student/subjectadddropstatus", "student/servicerequest",
  ],
});

/** Prepare only the official app's known storage keys. Never hand off passwords,
 * remembered credentials, or the rest of Lazyportal's localStorage. */
export async function prepareOfficialPortal(session, { now = new Date() } = {}) {
  if (!session?.token || !session?.userid || !session?.instituteid) {
    throw new Error("Reconnect to your account before opening the official portal.");
  }
  const string = (value) => value == null ? "" : String(value);
  const username = string(session.username || session.enrollmentno);
  const membertype = string(session.membertype || (username.startsWith("P") ? "P" : "S"));
  const bypass = session.bypassValue ?? session.bypass;
  const storage = {
    Token: string(session.token), Username: username,
    userid: string(session.userid), clientid: string(session.clientid),
    companyid: string(session.companyid), name: string(session.name),
    membertype, enrollmentno: string(session.enrollmentno),
    instituteid: string(session.instituteid), institutename: string(session.institutename),
    usertypeselected: membertype === "P" ? "P" : "S",
    tokendate: string(session.tokendate || now.toString()), Today_DATE: string(now.getTime()),
    // Fail closed on encryption failure. Sending the raw bypass is not valid.
    bypassValue: bypass == null || bypass === "" ? "" : await encrypt(string(bypass), { now }),
  };
  const config = { ...officialPortalPolicy, storage };
  // The bootstrap goes inside an HTML script, including student-provided names.
  const json = JSON.stringify(config).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return { version: officialPortalPolicy.version, bootstrap: `(${officialPortalRuntime.toString()})(${json});` };
}
