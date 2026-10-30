import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the actual views with fixture caches; effects do not run, so no portal
// requests are made. This also checks the first frame between chained reads.
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const docAttributes = new Map();
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  documentElement: {
    setAttribute: (k, v) => docAttributes.set(k, v),
    getAttribute: (k) => docAttributes.get(k) ?? null,
  },
  querySelector: () => null,
};
globalThis.window = {
  navigator: globalThis.navigator,
  document: globalThis.document,
  setTimeout: () => 0,
  clearTimeout() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};
const session = { username: "test-student", instituteid: "test-campus", token: "test-token" };
const semester = { registrationid: "sem1", registrationcode: "2026ODDSEM" };
let server, MarksSection, ExamsSection, FacultySection, groupCoursesAndFaculty, MorePage, AttendancePage, SubjectDetailSheet, sessionCacheKey, client, fetchAutosolvedCaptcha, MAX_AUTOSOLVE_ATTEMPTS;
let invalidateCacheGeneration, pauseAttendanceSync, readAttendanceOverview, syncAttendanceDetails, runManualAttendanceRefresh, getManualRefreshQuota, getCached, refreshSubjectDetail, computeSubjectRowChecksum;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });
  ({ MarksSection } = await server.ssrLoadModule("/src/sections/marks.tsx"));
  ({ ExamsSection } = await server.ssrLoadModule("/src/sections/exams.tsx"));
  ({ FacultySection, groupCoursesAndFaculty } = await server.ssrLoadModule("/src/sections/faculty.tsx"));
  ({ MorePage } = await server.ssrLoadModule("/src/pages/MorePage.tsx"));
  ({ AttendancePage } = await server.ssrLoadModule("/src/pages/AttendancePage.tsx"));
  ({ SubjectDetailSheet } = await server.ssrLoadModule("/src/components/SubjectDetailSheet.tsx"));
  ({ sessionCacheKey } = await server.ssrLoadModule("/src/hooks/useFeature.ts"));
  ({ client } = await server.ssrLoadModule("/src/lib/portal.ts"));
  ({ fetchAutosolvedCaptcha, MAX_AUTOSOLVE_ATTEMPTS } = await server.ssrLoadModule("/src/lib/captchaSolve.ts"));
  ({ pauseAttendanceSync, syncAttendanceDetails, runManualAttendanceRefresh } = await server.ssrLoadModule("/src/lib/attendanceSync.ts"));
  ({ getManualRefreshQuota, computeSubjectRowChecksum } = await server.ssrLoadModule("/src/lib/portalSchedule.ts"));
  ({ getCached, invalidateCacheGeneration } = await server.ssrLoadModule("/src/hooks/useFeature.ts"));
  ({ refreshSubjectDetail, readAttendanceOverview } = await server.ssrLoadModule("/src/sections/attendance.tsx"));
});
after(async () => { await server?.close(); });
beforeEach(() => values.clear());

function cache(feature, data, ...parts) {
  const key = sessionCacheKey(feature, session, ...parts);
  values.set(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now() }));
}
function selectSemester(feature) {
  values.set(`juet.portal.sem.${sessionCacheKey("semester", session, feature)}`, "sem1");
}
function render(Component) {
  return renderToStaticMarkup(createElement(Component, { session, onBack() {}, onLogout() {} }));
}

test("marks opening and semester-selection gaps show loading rather than No marks", () => {
  values.set("juet.portal.card.marks", "1");
  for (const seeded of [false, true]) {
    if (seeded) cache("marks.latest", { semesters: [semester], rows: [] });
    const html = render(MarksSection);
    assert.match(html, /Loading…/);
    assert.doesNotMatch(html, /No marks/);
  }
  selectSemester("marks");
  assert.match(render(MarksSection), /No marks records found/);

  cache("marks.latest", {
    semesters: [semester],
    rows: [
      { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "TEST-1", obtainedmarks: 9, fullmarks: 15 },
      { subjectcode: "CS104", subjectdesc: "DATABASE SYSTEMS", eventcode: "TEST-2", obtainedmarks: 13, fullmarks: 25 },
      { subjectcode: "CS204", subjectdesc: "DATABASE SYSTEMS LAB", eventcode: "P-1", obtainedmarks: 10, fullmarks: 15 },
    ],
  });
  const marksHtml = render(MarksSection);
  assert.doesNotMatch(marksHtml, /Filter marks by test|role="tablist"|score-progress/);
  assert.equal((marksHtml.match(/class="score-card"/g) ?? []).length, 2);
  assert.equal((marksHtml.match(/aria-expanded="false"/g) ?? []).length, 1);
  assert.match(marksHtml, /Database Systems exam marks/);
  assert.doesNotMatch(marksHtml, /Database Systems Lab exam marks/);
  assert.match(marksHtml, /<strong>22<\/strong><span class="score-total">\/40<\/span>/);
  assert.match(marksHtml, /<strong>10<\/strong><span class="score-total">\/15<\/span>/);
});

test("exams stay loading through the semester/events/schedule chain", () => {
  values.set("juet.portal.card.exams", "1");
  for (const stage of [0, 1, 2, 3]) {
    if (stage === 1) cache("exams.sems", [semester]);
    if (stage === 2) selectSemester("exams");
    if (stage === 3) cache("exams.events", [{ exameventid: "event1" }], "sem1");
    const html = render(ExamsSection);
    assert.match(html, /Loading…/);
    assert.doesNotMatch(html, /No schedules|No exam schedule published/);
  }
  cache("exams.rows", [], "sem1", "event1");
  assert.match(render(ExamsSection), /No exam schedule published/);
});

test("all-past schedules remain visible as completed timeline stops", () => {
  values.set("juet.portal.card.exams", "1");
  selectSemester("exams");
  cache("exams.sems", [semester]);
  cache("exams.events", [{ exameventid: "event1" }], "sem1");
  cache("exams.rows", [{ datetime: "01/01/2000", datetimeupto: "09:00 am to 11:00 am", subjectdesc: "PAST EXAM (CS101)", roomcode: "LT-4: LECTURE THEATER 4", seatno: "A-1" }], "sem1", "event1");
  const html = render(ExamsSection);
  assert.match(html, /class="exam-stop is-past"/);
  assert.match(html, /aria-label="Crushed"/);
  assert.doesNotMatch(html, /<details|Export upcoming exams/);
  assert.match(html, /<h3 class="exam-subject">Past Exam<\/h3>/);
  assert.doesNotMatch(html, /CS101|Cs101/);
  assert.match(html, /Room<\/span> LT-4/);
  assert.doesNotMatch(html, /LECTURE THEATER/);
  assert.doesNotMatch(html, /1 scheduled/);
});

test("attendance displays overview percentages before class logs arrive", () => {
  selectSemester("attendance");
  cache("att.initial", { semesters: [semester], rows: [{
    subjectid: "subject1", subjectcode: "TEST SUBJECT(CS101)",
    Psubjectcomponentid: "p1", Ppercentage: 83.3,
  }] });
  const html = render(AttendancePage);
  assert.match(html, /83\.3<span class="att-pct-sign">%<\/span>/);
  assert.doesNotMatch(html, /No attendance recorded/);
  // An empty log response still must not contradict a known overview percent.
  cache("att.subject", { P: { student_attdsummarylist: [] } }, "sem1", "subject1");
  assert.doesNotMatch(render(AttendancePage), /No attendance recorded/);
});

test("attendance keeps cached counts and percentages on returning to the page", () => {
  selectSemester("attendance");
  cache("att.initial", { semesters: [semester], rows: [{
    subjectid: "subject1", subjectcode: "TEST SUBJECT(CS101)",
    Psubjectcomponentid: "p1", Ppercentage: 50,
  }] });
  cache("att.subject", { P: { student_attdsummarylist: [{ present: "Y" }, { present: "N" }] } }, "sem1", "subject1");
  const html = render(AttendancePage);
  assert.match(html, /1\/2 classes/);
  assert.match(html, /50\.0<span class="att-pct-sign">%<\/span>/);
});

test("subject sheet never calls a known attendance percentage No classes held", () => {
  const row = { subjectid: "subject1", subjectcode: "TEST LAB(CS101)", Psubjectcomponentid: "p1", Ppercentage: 83.3 };
  const renderSheet = () => renderToStaticMarkup(createElement(SubjectDetailSheet, {
    row, session, registrationid: "sem1", onClose() {}, onLogout() {},
  }));
  assert.doesNotMatch(renderSheet(), /No attendance recorded for this subject/);
  cache("att.subject", { P: { student_attdsummarylist: [] } }, "sem1", "subject1");
  const html = renderSheet();
  assert.match(html, /83\.3%/);
  assert.doesNotMatch(html, /No attendance recorded for this subject/);
  assert.match(html, /No class records available/);
  row.Ppercentage = 0;
  assert.match(renderSheet(), /No attendance recorded for this subject/);
});

// Simulate a browser whose image decoder fails, so a fetched image must remain
// available for manual entry even when autosolving fails.
async function withFailedDecoder(run) {
  const image = globalThis.Image;
  const canvas = globalThis.OffscreenCanvas;
  globalThis.Image = class { async decode() { throw new Error("Cannot decode image"); } };
  globalThis.OffscreenCanvas = class {};
  try { return await run(); }
  finally {
    if (image === undefined) delete globalThis.Image; else globalThis.Image = image;
    if (canvas === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = canvas;
  }
}

test("captcha fetch failure rejects after retries so login/reconnect can display the error", async (t) => {
  const error = new Error("You are offline.");
  const get = t.mock.method(client, "getPublic", async () => { throw error; });
  await withFailedDecoder(async () => {
    await assert.rejects(fetchAutosolvedCaptcha(), (e) => e === error);
    assert.equal(get.mock.callCount(), MAX_AUTOSOLVE_ATTEMPTS);
  });
});

test("captcha fetch failure also surfaces when image/canvas APIs are unavailable", async (t) => {
  const error = new Error("Portal unavailable");
  t.mock.method(client, "getPublic", async () => { throw error; });
  await assert.rejects(fetchAutosolvedCaptcha(), (e) => e === error);
});

test("captcha cancellation stays silent and stops further retries", async (t) => {
  const controller = new AbortController();
  const get = t.mock.method(client, "getPublic", async () => {
    controller.abort();
    throw new Error("Aborted");
  });
  await withFailedDecoder(async () => {
    assert.deepEqual(await fetchAutosolvedCaptcha(5, { signal: controller.signal }), {
      captcha: null, text: "", autoSolved: false,
    });
    assert.equal(get.mock.callCount(), 1);
  });
});

test("failed autosolving still returns a fetched captcha for manual entry", async (t) => {
  t.mock.method(client, "getPublic", async () => ({ response: { captcha: { hidden: "fixture", image: "fixture" } } }));
  await withFailedDecoder(async () => {
    const result = await fetchAutosolvedCaptcha();
    assert.equal(result.captcha.hidden, "fixture");
    assert.equal(result.autoSolved, false);
  });
});

test("captcha fetching can recover after a transient network failure", async (t) => {
  let calls = 0;
  t.mock.method(client, "getPublic", async () => {
    if (++calls === 1) throw new Error("Temporary network failure");
    return { response: { captcha: { hidden: "recovered", image: "fixture" } } };
  });
  await withFailedDecoder(async () => {
    const result = await fetchAutosolvedCaptcha();
    assert.equal(result.captcha.hidden, "recovered");
  });
});

const auditRow = (id, percentage = 100) => ({ subjectid: id, subjectcode: `Test(${id})`, Psubjectcomponentid: id, Ppercentage: percentage });
const auditLogs = (count, present = count) => ({ student_attdsummarylist: Array.from({ length: count }, (_, i) => ({ datetime: `${i + 1}/10/2026 09:00 AM`, present: i < present ? "Y" : "N" })) });
const overview = (rows) => ({ semesters: [semester], header: null, rows });
const base = { registrationid: "sem1", registrationcode: semester.registrationcode };

function cacheHistory(row, count, present = count, age = 0) {
  const key = sessionCacheKey("att.subject", session, "sem1", row.subjectid);
  values.set(`juet.cache.${key}`, JSON.stringify({
    data: { P: auditLogs(count, present) }, updatedAt: Date.now() - age,
    checksum: computeSubjectRowChecksum(row),
  }));
  return key;
}

test("cache-only attendance visits preserve sync time and emit no sync event", async (t) => {
  const row = auditRow("p1");
  cacheHistory(row, 7, 7, 86400000);
  const post = t.mock.method(client, "post", async () => { throw new Error("Unexpected history fetch"); });
  const events = t.mock.method(window, "dispatchEvent");
  for (const previous of [null, "1000", "3000"]) {
    values.delete("juet.portal.last_sync");
    if (previous !== null) values.set("juet.portal.last_sync", previous);
    const overviewUpdatedAt = previous === null ? undefined : 1000;
    assert.equal((await syncAttendanceDetails({ session, rows: [row], base, overviewUpdatedAt })).complete, true);
    assert.equal(values.get("juet.portal.last_sync") ?? null, previous);
  }
  assert.equal(post.mock.callCount(), 0);
  assert.equal(events.mock.callCount(), 0);
});

test("a real overview read advances sync time without refetching unchanged history", async (t) => {
  const row = auditRow("p1");
  cacheHistory(row, 7);
  values.set("juet.portal.last_sync", "1000");
  const post = t.mock.method(client, "post", async () => { throw new Error("Unexpected history fetch"); });
  const events = t.mock.method(window, "dispatchEvent");
  const overviewUpdatedAt = Date.now() - 1000;
  await syncAttendanceDetails({ session, rows: [row], base, overviewUpdatedAt });
  assert.equal(values.get("juet.portal.last_sync"), String(overviewUpdatedAt));
  assert.equal(events.mock.callCount(), 1);
  assert.equal(events.mock.calls[0].arguments[0].type, "juet:sync");
  assert.equal(post.mock.callCount(), 0);
  // Returning to this cached overview later must not advance the timestamp.
  await syncAttendanceDetails({ session, rows: [row], base, overviewUpdatedAt });
  assert.equal(values.get("juet.portal.last_sync"), String(overviewUpdatedAt));
  assert.equal(events.mock.callCount(), 1);
});

test("a completed history read records its actual completion time", async (t) => {
  const row = auditRow("p1");
  const completedAt = Date.now();
  t.mock.method(Date, "now", () => completedAt);
  t.mock.method(client, "post", async () => ({ response: auditLogs(8) }));
  await syncAttendanceDetails({ session, rows: [row], base, overviewUpdatedAt: completedAt - 1000 });
  assert.equal(values.get("juet.portal.last_sync"), String(completedAt));
});

test("unchanged weekly subjects cause no history requests across seven daily checks", async (t) => {
  const rows = [auditRow("p1"), auditRow("p2", 80)];
  cacheHistory(rows[0], 7, 7, 8 * 86400000);
  cacheHistory(rows[1], 5, 4, 8 * 86400000);
  const post = t.mock.method(client, "post", async () => { throw new Error("Unexpected history fetch"); });
  const now = Date.now();
  const clock = t.mock.method(Date, "now", () => now);
  for (let day = 0; day < 7; day++) {
    clock.mock.mockImplementation(() => now + day * 86400000);
    assert.equal((await syncAttendanceDetails({ session, rows, base })).complete, true);
  }
  assert.equal(post.mock.callCount(), 0);
  assert.equal(getManualRefreshQuota(session).used, 0);
});

test("background sync fetches only changed, missing, or incomplete subject history", async (t) => {
  const original = auditRow("unchanged");
  cacheHistory(original, 7, 7, 8 * 86400000);
  const changed = auditRow("changed", 100);
  cacheHistory(changed, 5);
  const incomplete = auditRow("incomplete");
  const key = sessionCacheKey("att.subject", session, "sem1", incomplete.subjectid);
  values.set(`juet.cache.${key}`, JSON.stringify({ data: { P: null }, updatedAt: Date.now(), checksum: computeSubjectRowChecksum(incomplete) }));
  const rows = [original, { ...changed, Ppercentage: 80 }, auditRow("missing"), incomplete];
  const calls = [];
  t.mock.method(client, "post", async (_path, payload) => {
    calls.push(payload.subjectid);
    return { response: auditLogs(5, payload.subjectid === "changed" ? 4 : 5) };
  });
  assert.equal((await syncAttendanceDetails({ session, rows, base })).complete, true);
  assert.deepEqual(calls.sort(), ["changed", "incomplete", "missing"]);
  assert.equal((await syncAttendanceDetails({ session, rows, base })).complete, true);
  assert.equal(calls.length, 3);
});

test("manual refresh skips unchanged history, including weekly subjects across days", async (t) => {
  const rows = [auditRow("p1"), auditRow("weekly", 80)];
  cacheHistory(rows[0], 7, 7, 8 * 86400000);
  cacheHistory(rows[1], 5, 4, 8 * 86400000);
  const post = t.mock.method(client, "post", async () => { throw new Error("Unexpected history fetch"); });
  let reads = 0;
  const result = await runManualAttendanceRefresh({ session, baselineRows: rows, readOverview: async () => { reads++; return overview(rows); } });
  assert.equal(reads, 1);
  assert.equal(result.changed, false);
  assert.equal(result.quota.used, 0);
  assert.equal(result.quota.unchanged, 1);
  assert.equal(post.mock.callCount(), 0);
});

test("manual refresh fetches only the subjects changed in the fresh overview", async (t) => {
  const rows = [auditRow("changed"), auditRow("weekly", 80)];
  for (const row of rows) cacheHistory(row, 5, 4);
  const freshRows = [{ ...rows[0], Ppercentage: 80 }, rows[1]];
  const calls = [];
  t.mock.method(client, "post", async (_path, payload) => {
    calls.push(payload.subjectid);
    return { response: auditLogs(5, 4) };
  });
  const result = await runManualAttendanceRefresh({ session, baselineRows: rows, readOverview: async () => overview(freshRows) });
  assert.equal(result.changed, true);
  assert.equal(result.quota.used, 1);
  assert.deepEqual(calls, ["changed"]);
});

test("a partial failure spends no quota; retry reuses successful siblings and commits once", async (t) => {
  const rows = [auditRow("p1", 80), auditRow("p2", 80)];
  const calls = { p1: 0, p2: 0 };
  let fail = true;
  t.mock.method(client, "post", async (_path, payload) => {
    calls[payload.subjectid]++;
    if (payload.subjectid === "p2" && fail) { const error = new Error("detail failed"); error.status = 500; throw error; }
    return { response: auditLogs(5, 4) };
  });
  const checkpoint = {};
  const run = () => runManualAttendanceRefresh({ session, checkpoint, baselineRows: rows, readOverview: async () => overview(rows) });
  await assert.rejects(run(), /detail failed/);
  assert.equal(getManualRefreshQuota(session).used, 0);
  assert.equal(getManualRefreshQuota(session).unchanged, 0);
  assert.equal(getManualRefreshQuota(session).canRefresh, true);
  assert.equal(values.get("juet.portal.last_sync"), undefined);
  fail = false;
  const result = await run();
  assert.equal(result.quota.used, 1);
  assert.ok(Number(values.get("juet.portal.last_sync")) > 0);
  assert.deepEqual(calls, { p1: 1, p2: 2 });
});

test("manual retry remembers completed changes from a successful sibling", async (t) => {
  const rows = [auditRow("p1"), auditRow("p2")];
  for (const row of rows) cacheHistory({ ...row, Ppercentage: 80 }, 7, 6);
  const checkpoint = {};
  const calls = { p1: 0, p2: 0 };
  let fail = true;
  t.mock.method(client, "post", async (_path, payload) => {
    calls[payload.subjectid]++;
    if (payload.subjectid === "p2" && fail) throw new Error("Try again");
    return { response: auditLogs(payload.subjectid === "p1" ? 8 : 7) };
  });
  const run = () => runManualAttendanceRefresh({ session, checkpoint, baselineRows: rows, readOverview: async () => overview(rows) });
  await assert.rejects(run(), /Try again/);
  assert.equal(getManualRefreshQuota(session).used, 0);
  fail = false;
  const result = await run();
  assert.equal(result.changed, true);
  assert.equal(result.quota.used, 1);
  assert.equal(result.quota.unchanged, 0);
  assert.deepEqual(calls, { p1: 1, p2: 2 });
  assert.equal(checkpoint.changed, false);
});

test("manual retry rechecks a successful sibling if its overview changed", async (t) => {
  let rows = [auditRow("p1"), auditRow("p2")];
  const checkpoint = {};
  const calls = { p1: 0, p2: 0 };
  let fail = true;
  t.mock.method(client, "post", async (_path, payload) => {
    calls[payload.subjectid]++;
    if (payload.subjectid === "p2" && fail) throw new Error("Try again");
    return { response: auditLogs(5, !fail && payload.subjectid === "p1" ? 4 : 5) };
  });
  const run = () => runManualAttendanceRefresh({ session, checkpoint, baselineRows: rows, readOverview: async () => overview(rows) });
  await assert.rejects(run(), /Try again/);
  rows = [{ ...rows[0], Ppercentage: 80 }, rows[1]];
  fail = false;
  assert.equal((await run()).quota.used, 1);
  assert.deepEqual(calls, { p1: 2, p2: 2 });
});

test("a new portal day resets the checkpoint but preserves matching subject caches", async (t) => {
  const rows = [auditRow("p1"), auditRow("p2")];
  const checkpoint = {};
  const calls = { p1: 0, p2: 0 };
  let fail = true;
  t.mock.method(client, "post", async (_path, payload) => {
    calls[payload.subjectid]++;
    if (payload.subjectid === "p2" && fail) throw new Error("Try again");
    return { response: auditLogs(8) };
  });
  const run = () => runManualAttendanceRefresh({ session, checkpoint, baselineRows: rows, readOverview: async () => overview(rows) });
  await assert.rejects(run(), /Try again/);
  const tomorrow = Date.now() + 86400000;
  t.mock.method(Date, "now", () => tomorrow);
  fail = false;
  assert.equal((await run()).quota.used, 1);
  assert.deepEqual(calls, { p1: 1, p2: 2 });
});

test("a completed unchanged refresh counts only as an unchanged check", async (t) => {
  const row = auditRow("p1");
  const key = sessionCacheKey("att.subject", session, "sem1", "p1");
  values.set(`juet.cache.${key}`, JSON.stringify({ data: { P: auditLogs(8) }, updatedAt: Date.now() - 86400000 }));
  t.mock.method(client, "post", async () => ({ response: auditLogs(8) }));
  const result = await runManualAttendanceRefresh({ session, baselineRows: [row], readOverview: async () => overview([row]) });
  assert.equal(result.changed, false);
  assert.equal(result.quota.used, 0);
  assert.equal(result.quota.unchanged, 1);
});

test("cancelling a refresh retains completed reads but does not deduct quota", async (t) => {
  let finish, started;
  const ready = new Promise((resolve) => { started = resolve; });
  let current = true;
  t.mock.method(client, "post", async () => { started(); return new Promise((resolve) => { finish = resolve; }); });
  const row = auditRow("p1");
  const run = runManualAttendanceRefresh({ session, baselineRows: [row], readOverview: async () => overview([row]), isCurrent: () => current });
  await ready;
  current = false;
  finish({ response: auditLogs(8) });
  assert.equal(await run, null);
  assert.equal(getManualRefreshQuota(session).used, 0);
  assert.ok(getCached(sessionCacheKey("att.subject", session, "sem1", "p1")).data);
});

test("malformed component responses never spend refresh quota", async (t) => {
  t.mock.method(client, "post", async () => ({ response: null }));
  const row = auditRow("p1");
  await assert.rejects(runManualAttendanceRefresh({ session, baselineRows: [row], readOverview: async () => overview([row]) }), /incomplete class records/);
  assert.equal(getManualRefreshQuota(session).used, 0);
});

test("a queued subject loaded by expansion is not fetched again when its worker becomes free", async (t) => {
  const rows = [auditRow("p1"), auditRow("p2"), auditRow("p3")];
  const calls = { p1: 0, p2: 0, p3: 0 };
  const pending = {};
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  t.mock.method(client, "post", async (_path, payload) => {
    const id = payload.subjectid;
    calls[id]++;
    if (id !== "p1") return { response: auditLogs(8) };
    return new Promise((resolve) => {
      pending[id] = resolve;
      if (pending.p1) started();
    });
  });
  const batch = syncAttendanceDetails({ session, rows, base });
  await ready;
  await refreshSubjectDetail(session, rows[2], base);
  pending.p1({ response: auditLogs(8) });
  assert.equal((await batch).complete, true);
  assert.deepEqual(calls, { p1: 1, p2: 1, p3: 1 });
});


test("daily overview reads do not renew the registration cache; it expires after a week", async (t) => {
  const start = Date.now();
  let day = 0;
  t.mock.method(Date, "now", () => start + day * 86400000);
  const lov = t.mock.method(client, "postRaw", async () => ({ response: {
    headerlist: [{ stynumber: "4" }], semlist: [{ ...semester, registrationid: day >= 7 ? "sem2" : "sem1" }],
  } }));
  const detail = t.mock.method(client, "post", async () => ({ response: { studentattendancelist: [auditRow("p1")] } }));
  const key = sessionCacheKey("att.lov", session);
  for (day = 0; day < 7; day++) {
    assert.equal((await readAttendanceOverview(session)).semesters[0].registrationid, "sem1");
    assert.equal(getCached(key).updatedAt, start);
  }
  assert.equal(lov.mock.callCount(), 1);
  assert.equal((await readAttendanceOverview(session)).semesters[0].registrationid, "sem2");
  assert.equal(lov.mock.callCount(), 2);
  assert.equal(detail.mock.callCount(), 8);
});

test("a full browser store does not refetch successful subject history on the next visit", async (t) => {
  const row = auditRow("storage-full-subject");
  t.mock.method(localStorage, "setItem", () => { throw new Error("QuotaExceededError"); });
  const post = t.mock.method(client, "post", async () => ({ response: auditLogs(8) }));
  assert.equal((await syncAttendanceDetails({ session, rows: [row], base })).complete, true);
  assert.equal((await syncAttendanceDetails({ session, rows: [row], base })).complete, true);
  assert.equal(post.mock.callCount(), 1);
});

test("malformed object responses preserve the old history and spend no quota", async (t) => {
  const row = auditRow("malformed-object", 80);
  const key = cacheHistory({ ...row, Ppercentage: 100 }, 7);
  let response;
  t.mock.method(client, "post", async () => ({ response }));
  for (response of [{}, { summary: [null] }]) {
    await assert.rejects(runManualAttendanceRefresh({ session, baselineRows: [row], readOverview: async () => overview([row]) }), /incomplete class records/);
    assert.equal(getCached(key).data.P.student_attdsummarylist.length, 7);
  }
  assert.equal(getManualRefreshQuota(session).used, 0);
  assert.equal(getManualRefreshQuota(session).unchanged, 0);
});

test("background detail retry reuses successful subjects and spends no quota", async (t) => {
  const rows = [auditRow("retry1"), auditRow("retry2")];
  const calls = [];
  let fail = true;
  t.mock.method(client, "post", async (_path, payload) => {
    calls.push(payload.subjectid);
    if (payload.subjectid === "retry2" && fail) throw new Error("Try again");
    return { response: auditLogs(5) };
  });
  assert.equal((await syncAttendanceDetails({ session, rows, base })).complete, false);
  fail = false;
  assert.equal((await syncAttendanceDetails({ session, rows, base })).complete, true);
  assert.deepEqual(calls.sort(), ["retry1", "retry2", "retry2"]);
  assert.equal(getManualRefreshQuota(session).used, 0);
  assert.equal(getManualRefreshQuota(session).unchanged, 0);
});

test("an open sheet pauses queued subjects and resume reuses its completed read", async (t) => {
  const rows = [auditRow("pause1"), auditRow("pause2")];
  let finishFirst, firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const calls = [];
  t.mock.method(client, "post", async (_path, payload) => {
    calls.push(payload.subjectid);
    if (payload.subjectid === "pause1") {
      firstStarted();
      await new Promise((resolve) => { finishFirst = resolve; });
    }
    return { response: auditLogs(8) };
  });
  const batch = syncAttendanceDetails({ session, rows, base });
  await started;
  const resume = pauseAttendanceSync();
  try {
    finishFirst();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["pause1"]);
    await refreshSubjectDetail(session, rows[1], base);
    assert.deepEqual(calls, ["pause1", "pause2"]);
  } finally {
    resume();
  }
  assert.equal((await batch).complete, true);
  assert.deepEqual(calls, ["pause1", "pause2"]);
  assert.equal(getManualRefreshQuota(session).used, 0);
});

test("a timed-out manual refresh keeps cache and quota, releases both shared maps, and retries once", async (t) => {
  const { createClient } = await import("../../core/src/client.js");
  const row = auditRow("timeout", 80);
  cacheHistory({ ...row, Ppercentage: 100 }, 7);
  let signal, fail = true, calls = 0;
  const transportClient = createClient({ baseUrl: "https://fixture.invalid", requestTimeoutMs: 10,
    fetchImpl: async (_url, init) => {
      calls++;
      signal = init.signal;
      if (fail) return new Promise(() => {});
      return new Response(JSON.stringify({ response: auditLogs(10, 8) }));
    },
  });
  t.mock.method(client, "post", transportClient.post);
  const run = () => runManualAttendanceRefresh({ session, baselineRows: [row], readOverview: async () => overview([row]) });
  const key = sessionCacheKey("att.subject", session, "sem1", row.subjectid);
  const before = getCached(key);
  await assert.rejects(run, (error) => error.code === "REQUEST_TIMEOUT");
  assert.equal(signal.aborted, true);
  assert.deepEqual(getCached(key), before);
  assert.equal(getManualRefreshQuota(session).used, 0);
  assert.equal(values.get("juet.portal.last_sync"), undefined);
  fail = false;
  const result = await run();
  assert.equal(result.changed, true);
  assert.equal(getManualRefreshQuota(session).used, 1);
  assert.equal(calls, 2);
});

test("a manual refresh cannot commit quota using a shared read from an older overview", async (t) => {
  const oldRow = auditRow("overview-race", 100);
  const row = { ...oldRow, Ppercentage: 80 };
  let resolveOld, startedOld, resolveNew, startedNew;
  const oldStarted = new Promise((resolve) => { startedOld = resolve; });
  const newStarted = new Promise((resolve) => { startedNew = resolve; });
  let calls = 0;
  t.mock.method(client, "post", async () => {
    calls++;
    return new Promise((resolve) => {
      if (calls === 1) { resolveOld = resolve; startedOld(); }
      else { resolveNew = resolve; startedNew(); }
    });
  });
  const expanded = refreshSubjectDetail(session, oldRow, base);
  await oldStarted;
  const manual = runManualAttendanceRefresh({ session, baselineRows: [oldRow], readOverview: async () => overview([row]) });
  // Let manual refresh join the older in-flight read before completing it.
  await new Promise((resolve) => setImmediate(resolve));
  resolveOld({ response: auditLogs(8) });
  await expanded;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getManualRefreshQuota(session).used, 0, "old checksum is not a completed refresh");
  assert.equal(calls, 2, "read again using the newer overview");
  await newStarted;
  resolveNew({ response: auditLogs(10, 8) });
  await manual;
  assert.equal(getManualRefreshQuota(session).used, 1);
});

test("changed overview rows retain labeled saved counts alongside the latest percentage", () => {
  selectSemester("attendance");
  const oldRow = auditRow("saved-counts", 100);
  cacheHistory(oldRow, 8);
  cache("att.initial", { semesters: [semester], rows: [{ ...oldRow, Ppercentage: 80 }] });
  const html = render(AttendancePage);
  assert.match(html, /Saved 8\/8 classes/);
  assert.match(html, /80\.0<span class="att-pct-sign">%<\/span>/);
});

test("a fresh zero overview keeps saved counts without a stale percentage", () => {
  selectSemester("attendance");
  const oldRow = auditRow("fresh-zero", 100);
  cacheHistory(oldRow, 8);
  const row = { ...oldRow, Ppercentage: 0 };
  cache("att.initial", { semesters: [semester], rows: [row] });

  const html = render(AttendancePage);
  assert.match(html, /Saved 8\/8 classes/);
  assert.match(html, /<span class="att-row-pct is-empty">--<\/span>/);
  assert.doesNotMatch(html, /100\.0<span class="att-pct-sign">%<\/span>/);

  const sheet = renderToStaticMarkup(createElement(SubjectDetailSheet, {
    session, row, ...semester, onClose() {}, onLogout() {},
  }));
  assert.match(sheet, /<strong>8<\/strong> \/ 8/);
  assert.match(sheet, /<span class="att-sheet-score ">—<\/span>/);
});

test("adding a tutorial retains saved lecture counts and the sheet calculator", () => {
  selectSemester("attendance");
  const oldRow = { subjectid: "added-tutorial", subjectcode: "Test(PC1)",
    Lsubjectcomponentid: "lecture", LTpercentage: 100 };
  const detail = { L: auditLogs(8) };
  values.set(`juet.cache.${sessionCacheKey("att.subject", session, "sem1", oldRow.subjectid)}`, JSON.stringify({
    data: detail, updatedAt: Date.now(), checksum: computeSubjectRowChecksum(oldRow),
  }));
  const row = { ...oldRow, Tsubjectcomponentid: "new-tutorial", LTpercentage: 80 };
  cache("att.initial", { semesters: [semester], rows: [row] });
  assert.match(render(AttendancePage), /Saved 8\/8 classes/);
  const html = renderToStaticMarkup(createElement(SubjectDetailSheet, {
    session, row, ...semester, onClose() {}, onLogout() {},
  }));
  assert.match(html, /<strong>8<\/strong> \/ 8/);
  assert.match(html, /What-if calculator/);
});

test("partial component retries reuse a completed lecture and spend quota only after the tutorial succeeds", async (t) => {
  const row = { subjectid: "partial-components", subjectcode: "Test(PC1)",
    Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial", LTpercentage: 100 };
  const key = sessionCacheKey("att.subject", session, "sem1", row.subjectid);
  values.set(`juet.cache.${key}`, JSON.stringify({
    data: { L: auditLogs(8), T: auditLogs(3) }, updatedAt: Date.now() - 1000, checksum: "old",
  }));
  const before = getCached(key);
  const calls = [];
  let failTutorial = true;
  t.mock.method(client, "post", async (_path, payload) => {
    const component = payload.cmpidkey[0].subjectcomponentid;
    calls.push(component);
    if (component === "tutorial" && failTutorial) throw new Error("Tutorial unavailable");
    return { response: auditLogs(component === "lecture" ? 9 : 4) };
  });
  const run = () => runManualAttendanceRefresh({ session, baselineRows: [row], readOverview: async () => overview([row]) });
  await assert.rejects(run, /Tutorial unavailable/);
  assert.deepEqual(getCached(key), before);
  assert.equal(getManualRefreshQuota(session).used, 0);
  failTutorial = false;
  await run();
  assert.deepEqual(calls, ["lecture", "tutorial", "tutorial"]);
  assert.equal(getManualRefreshQuota(session).used, 1);
});

for (const change of ["overview", "component", "semester", "account", "institute", "portal day"]) {
  test(`partial components are discarded after a changed ${change}`, async (t) => {
    const row = { subjectid: "partial-scope", subjectcode: "Test(PS1)",
      Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial", LTpercentage: 100 };
    let fail = true, lectureReads = 0;
    t.mock.method(client, "post", async (_path, payload) => {
      if (payload.cmpidkey[0].subjectcomponentid.startsWith("lecture")) { lectureReads++; return { response: auditLogs(9) }; }
      if (fail) throw new Error("Tutorial unavailable");
      return { response: auditLogs(4) };
    });
    await assert.rejects(refreshSubjectDetail(session, row, base));
    fail = false;
    const nextRow = { ...row }, nextSession = { ...session }, nextBase = { ...base };
    if (change === "overview") nextRow.LTpercentage = 90;
    if (change === "component") nextRow.Lsubjectcomponentid = "lecture-new";
    if (change === "semester") nextBase.registrationid = "sem2";
    if (change === "account") nextSession.username = "other-student";
    if (change === "institute") nextSession.instituteid = "other-campus";
    if (change === "portal day") {
      const nextDay = Date.now() + 86400000;
      t.mock.method(Date, "now", () => nextDay);
    }
    await refreshSubjectDetail(nextSession, nextRow, nextBase);
    assert.equal(lectureReads, 2);
  });
}

test("malformed completed components are fetched again and a full success clears partial retry reuse", async (t) => {
  const row = { subjectid: "partial-malformed", subjectcode: "Test(PM1)",
    Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial", LTpercentage: 100 };
  let fail = true, lectureReads = 0;
  t.mock.method(client, "post", async (_path, payload) => {
    if (payload.cmpidkey[0].subjectcomponentid === "lecture") {
      lectureReads++;
      return { response: fail ? {} : auditLogs(9) };
    }
    if (fail) throw new Error("Tutorial unavailable");
    return { response: auditLogs(4) };
  });
  await assert.rejects(refreshSubjectDetail(session, row, base));
  fail = false;
  await refreshSubjectDetail(session, row, base);
  assert.equal(lectureReads, 2, "malformed lecture was not reused");
  await refreshSubjectDetail(session, row, base);
  assert.equal(lectureReads, 3, "full success did not leave a hidden completed cache");
});

test("logout prevents a late component failure from restoring its partial checkpoint", async (t) => {
  const row = { subjectid: "partial-logout", subjectcode: "Test(PL1)",
    Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial", LTpercentage: 100 };
  let failTutorial;
  t.mock.method(client, "post", async (_path, payload) => {
    if (payload.cmpidkey[0].subjectcomponentid === "lecture") return { response: auditLogs(9) };
    return new Promise((_, reject) => { failTutorial = reject; });
  });
  const read = refreshSubjectDetail(session, row, base);
  await new Promise((resolve) => setImmediate(resolve));
  invalidateCacheGeneration();
  values.clear();
  failTutorial(new Error("Late tutorial failure"));
  await assert.rejects(read, /Late tutorial failure/);
  assert.deepEqual([...values.keys()], []);
});

test("a request timeout halts the background sync queue to protect slow portals", async (t) => {
  const rows = [auditRow("to1"), auditRow("to2")];
  const calls = [];
  t.mock.method(client, "post", async (_path, payload) => {
    calls.push(payload.subjectid);
    if (payload.subjectid === "to1") {
      const err = new Error("JUET's portal took too long to respond. Please retry.");
      err.code = "REQUEST_TIMEOUT";
      throw err;
    }
    return { response: auditLogs(5) };
  });
  const res = await syncAttendanceDetails({ session, rows, base });
  assert.equal(res.complete, false);
  assert.deepEqual(calls, ["to1"], "queued subjects were cancelled after timeout");
});

test("a network error or 504 halts the background sync queue", async (t) => {
  const rows = [auditRow("net1"), auditRow("net2")];
  const calls = [];
  t.mock.method(client, "post", async (_path, payload) => {
    calls.push(payload.subjectid);
    if (payload.subjectid === "net1") {
      const err = new Error("Gateway Timeout");
      err.code = "NETWORK_ERROR";
      err.status = 504;
      throw err;
    }
    return { response: auditLogs(5) };
  });
  const res = await syncAttendanceDetails({ session, rows, base });
  assert.equal(res.complete, false);
  assert.deepEqual(calls, ["net1"], "queued subjects were cancelled after network error");
});

test("subjects without attendance complete sync and reuse their empty history checksums", async (t) => {
  const rows = [auditRow("minor", 0), auditRow("internship", 0)];
  const calls = t.mock.method(client, "post", async () => {
    throw Object.assign(new Error("NO Attendance Found"), { code: "PORTAL_ERROR", status: 404, errors: ["NO Attendance Found"] });
  });
  const first = await syncAttendanceDetails({ session, rows, base });
  assert.equal(first.complete, true);
  assert.deepEqual(first.errors, []);
  assert.equal(calls.mock.callCount(), 2);
  assert.equal((await syncAttendanceDetails({ session, rows, base })).complete, true);
  assert.equal(calls.mock.callCount(), 2, "matching empty history is cached like populated history");
  cache("att.initial", overview(rows));
  selectSemester("attendance");
  const html = render(AttendancePage);
  assert.equal((html.match(/No attendance recorded/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Class details unavailable/);
});

test("successful components are saved and visible while a sibling is still pending", async (t) => {
  const row = { subjectid: "progressive", subjectcode: "Test(PR1)",
    Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial", LTpercentage: 100 };
  let finishTutorial;
  t.mock.method(client, "post", async (_path, payload) => {
    if (payload.cmpidkey[0].subjectcomponentid === "tutorial") await new Promise(resolve => { finishTutorial = resolve; });
    return { response: auditLogs(9) };
  });
  const read = refreshSubjectDetail(session, row, base);
  await new Promise(resolve => setImmediate(resolve));
  try {
    const partialKey = sessionCacheKey("att.subject.pending", session, "sem1", row.subjectid);
    assert.deepEqual(getCached(partialKey).data, { L: auditLogs(9) });
    const html = renderToStaticMarkup(createElement(SubjectDetailSheet, {
      session, row, ...semester, onClose() {}, onLogout() {},
    }));
    assert.match(html, /All \(9\)/);
    assert.equal(getCached(sessionCacheKey("att.subject", session, "sem1", row.subjectid)).checksum, undefined);
  } finally { finishTutorial(); await read; }
});

test("sync reports one coherent terminal failure with its unfinished subjects", async (t) => {
  const states = [];
  const rows = [auditRow("state1"), auditRow("state2")];
  t.mock.method(client, "post", async () => { throw Object.assign(new Error("Timed out"), { code: "REQUEST_TIMEOUT" }); });
  const result = await syncAttendanceDetails({ session, rows, base, onProgress: state => states.push(state) });
  assert.equal(result.complete, false);
  assert.deepEqual(states.map(state => state.phase), ["running", "failed"]);
  assert.equal(states.at(-1).done, 1);
  assert.equal(states.at(-1).total, 2);
  assert.deepEqual([...states.at(-1).pending], ["state2"]);
});

test("a paused sync cancels immediately without waiting for the open sheet", async (t) => {
  const resume = pauseAttendanceSync();
  const controller = new AbortController();
  const calls = t.mock.method(client, "post", async () => ({ response: auditLogs(5) }));
  let settled = false;
  const batch = syncAttendanceDetails({ session, rows: [auditRow("paused-cancel")], base, signal: controller.signal })
    .then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(settled, true); }
  finally { resume(); await batch; }
  assert.equal((await batch).complete, false);
  assert.equal(calls.mock.callCount(), 0);
});

test("cancelling a sync releases its owner while a shared history read can finish into cache", async (t) => {
  const row = auditRow("cancel-shared");
  let finish;
  const calls = t.mock.method(client, "post", () => new Promise(resolve => { finish = () => resolve({ response: auditLogs(5) }); }));
  const controller = new AbortController();
  let settled = false;
  const batch = syncAttendanceDetails({ session, rows: [row], base, signal: controller.signal })
    .then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  const joined = refreshSubjectDetail(session, row, base);
  controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(settled, true); }
  finally { finish(); await Promise.all([batch, joined]); }
  assert.equal((await batch).complete, false);
  assert.equal(calls.mock.callCount(), 1);
  assert.deepEqual((await joined).data, { P: auditLogs(5) });
});

test("releasing a sheet twice cannot break the next sheet's pause", async (t) => {
  const oldResume = pauseAttendanceSync();
  oldResume();
  oldResume();
  const resume = pauseAttendanceSync();
  const calls = t.mock.method(client, "post", async () => ({ response: auditLogs(5) }));
  const batch = syncAttendanceDetails({ session, rows: [auditRow("idempotent-pause")], base });
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(calls.mock.callCount(), 0); }
  finally { resume(); await batch; }
  assert.equal(calls.mock.callCount(), 1);
});

test("attendance rows show bunk/attend margin and move the subject code into SubjectDetailSheet", () => {
  const row = { subjectid: "s1", subjectcode: "COMPUTER NETWORKS(CS109)", Psubjectcomponentid: "p1", Ppercentage: 50 };
  cache("att.initial", { header: null, semesters: [semester], rows: [row] });
  cache("att.subject", { P: { student_attdsummarylist: [{ present: "Y" }, { present: "N" }] } }, "sem1", "s1");
  selectSemester("attendance");
  const listHtml = render(AttendancePage);
  assert.match(listHtml, /1\/2 classes/);
  assert.match(listHtml, /Need 2 classes/);
  assert.doesNotMatch(listHtml, /CS109/, "raw subject code is hidden from main list row when class counts exist");

  const sheetHtml = renderToStaticMarkup(createElement(SubjectDetailSheet, {
    session, row, ...semester, onClose() {}, onLogout() {},
  }));
  assert.match(sheetHtml, /Computer Networks/);
  assert.match(sheetHtml, /CS109/, "subject code is displayed in the detail sheet header");
});

test("FacultySection unifies course metadata and faculty assignments into one grouped list", () => {
  const grouped = groupCoursesAndFaculty(
    [
      { subjectcode: "CS109", employeename: "DR. AMIT KUMAR", subjectcomponentcode: "L", credits: 4 },
      { subjectcode: "CS109", employeename: "DR. AMIT KUMAR", subjectcomponentcode: "T", credits: 4 },
      { subjectcode: "CS109", employeename: "PROF. NEHA SHARMA", subjectcomponentcode: "P", credits: 4 },
    ],
    new Map([["CS109", { name: "Computer Networks", type: "Core" }]]),
  );
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].courseName, "Computer Networks");
  assert.equal(grouped[0].courseType, "Core");
  assert.equal(grouped[0].credits, "4");
  assert.deepEqual(grouped[0].instructors, [
    { name: "Dr. Amit Kumar", components: ["L", "T"] },
    { name: "Prof. Neha Sharma", components: ["P"] },
  ]);

  values.set("juet.portal.card.faculty", "1");
  selectSemester("faculty");
  cache("faculty.lov", [semester]);
  cache("faculty.detail", {
    totalcreditpoints: 20,
    rows: [
      { subjectcode: "CS109", employeename: "DR. AMIT KUMAR", subjectcomponentcode: "L", credits: 4 },
    ],
  }, "sem1");
  cache("subjects.latest", {
    semesters: [semester],
    rows: [{ subjectcode: "CS109", subjectdesc: "COMPUTER NETWORKS", subjecttypedesc: "CORE" }],
  });
  const html = render(FacultySection);
  assert.match(html, /Faculty &amp; courses/);
  assert.match(html, /Computer Networks/);
  assert.match(html, /Dr\. Amit Kumar/);
  assert.match(html, /Core/);
  assert.match(html, /4 cr/);
});

test("MorePage renders Appearance theme selector alongside Default attendance target", () => {
  const html = renderToStaticMarkup(createElement(MorePage, {
    session,
    onLogout() {},
    onSelectInstitute() {},
    discreet: false,
    onDiscreetChange() {},
  }));
  assert.match(html, /Appearance/);
  assert.match(html, /aria-label="System"/);
  assert.match(html, /aria-label="Light"/);
  assert.match(html, /aria-label="Dark"/);
  assert.doesNotMatch(html, /Registered subjects/, "duplicate Subjects card is merged into Faculty & courses");
});



