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
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
const session = { username: "test-student", instituteid: "test-campus", token: "test-token" };
const semester = { registrationid: "sem1", registrationcode: "2026ODDSEM" };
let server, MarksSection, ExamsSection, AttendancePage, SubjectDetailSheet, sessionCacheKey, client, fetchAutosolvedCaptcha;
let syncAttendanceDetails, runManualAttendanceRefresh, getManualRefreshQuota, getCached, refreshSubjectDetail, computeSubjectRowChecksum;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });
  ({ MarksSection } = await server.ssrLoadModule("/src/sections/marks.tsx"));
  ({ ExamsSection } = await server.ssrLoadModule("/src/sections/exams.tsx"));
  ({ AttendancePage } = await server.ssrLoadModule("/src/pages/AttendancePage.tsx"));
  ({ SubjectDetailSheet } = await server.ssrLoadModule("/src/components/SubjectDetailSheet.tsx"));
  ({ sessionCacheKey } = await server.ssrLoadModule("/src/hooks/useFeature.ts"));
  ({ client } = await server.ssrLoadModule("/src/lib/portal.ts"));
  ({ fetchAutosolvedCaptcha } = await server.ssrLoadModule("/src/lib/captchaSolve.ts"));
  ({ syncAttendanceDetails, runManualAttendanceRefresh } = await server.ssrLoadModule("/src/lib/attendanceSync.ts"));
  ({ getManualRefreshQuota, computeSubjectRowChecksum } = await server.ssrLoadModule("/src/lib/portalSchedule.ts"));
  ({ getCached } = await server.ssrLoadModule("/src/hooks/useFeature.ts"));
  ({ refreshSubjectDetail } = await server.ssrLoadModule("/src/sections/attendance.tsx"));
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

test("all-past schedules are collapsed and no longer counted as scheduled", () => {
  values.set("juet.portal.card.exams", "1");
  selectSemester("exams");
  cache("exams.sems", [semester]);
  cache("exams.events", [{ exameventid: "event1" }], "sem1");
  cache("exams.rows", [{ datetime: "01/01/2000", datetimeupto: "09:00 am to 11:00 am", subjectdesc: "PAST EXAM" }], "sem1", "event1");
  const html = render(ExamsSection);
  assert.match(html, /No upcoming exams/);
  assert.match(html, /<details class="past-exams"><summary>Past exams \(1\)<\/summary>/);
  assert.doesNotMatch(html, /1 scheduled/);
});

test("attendance displays overview percentages before class logs arrive", () => {
  selectSemester("attendance");
  cache("att.initial", { semesters: [semester], rows: [{
    subjectid: "subject1", subjectcode: "TEST SUBJECT(CS101)",
    Psubjectcomponentid: "p1", Ppercentage: 83.3,
  }] });
  const html = render(AttendancePage);
  assert.match(html, /83\.3%<\/span>/);
  assert.doesNotMatch(html, /No classes yet/);
  // An empty log response still must not contradict a known overview percent.
  cache("att.subject", { P: { student_attdsummarylist: [] } }, "sem1", "subject1");
  assert.doesNotMatch(render(AttendancePage), /No classes yet/);
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
  assert.match(html, /50\.0%<\/span>/);
});

test("subject sheet never calls a known attendance percentage No classes held", () => {
  const row = { subjectid: "subject1", subjectcode: "TEST LAB(CS101)", Psubjectcomponentid: "p1", Ppercentage: 83.3 };
  const renderSheet = () => renderToStaticMarkup(createElement(SubjectDetailSheet, {
    row, session, registrationid: "sem1", onClose() {}, onLogout() {},
  }));
  assert.doesNotMatch(renderSheet(), /No classes held yet/);
  cache("att.subject", { P: { student_attdsummarylist: [] } }, "sem1", "subject1");
  const html = renderSheet();
  assert.match(html, /83\.3%/);
  assert.doesNotMatch(html, /No classes held yet/);
  assert.match(html, /No class records available/);
  row.Ppercentage = 0;
  assert.match(renderSheet(), /No classes held yet/);
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
    assert.equal(get.mock.callCount(), 5);
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

test("an explicit refresh detects 7/7 becoming 8/8 even with a matching cache from today", async (t) => {
  const row = auditRow("p1");
  const key = sessionCacheKey("att.subject", session, "sem1", "p1");
  values.set(`juet.cache.${key}`, JSON.stringify({ data: { P: auditLogs(7) }, updatedAt: Date.now(), checksum: computeSubjectRowChecksum(row) }));
  const post = t.mock.method(client, "post", async () => ({ response: auditLogs(8) }));
  const result = await runManualAttendanceRefresh({ session, baselineRows: [row], readOverview: async () => overview([row]) });
  assert.equal(result.changed, true);
  assert.equal(result.quota.used, 1);
  assert.equal(getCached(key).data.P.student_attdsummarylist.length, 8);
  await syncAttendanceDetails({ session, rows: [row], base });
  const html = renderToStaticMarkup(createElement(SubjectDetailSheet, { session, row, registrationid: "sem1", onClose() {}, onLogout() {} }));
  assert.match(html, /8<\/strong> \/ 8/);
  assert.equal(post.mock.callCount(), 1);
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
  const checkpoint = { details: new Map() };
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

test("manual retry remembers hidden count changes from a successful sibling", async (t) => {
  const rows = [auditRow("p1"), auditRow("p2")];
  for (const row of rows) cacheHistory(row, 7);
  const checkpoint = { details: new Map() };
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
  assert.equal(checkpoint.details.size, 0);
});

test("manual retry rechecks a successful sibling if its overview changed", async (t) => {
  let rows = [auditRow("p1"), auditRow("p2")];
  const checkpoint = { details: new Map() };
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

test("a new portal day invalidates successful reads from an unfinished manual batch", async (t) => {
  const rows = [auditRow("p1"), auditRow("p2")];
  const checkpoint = { details: new Map() };
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
  assert.deepEqual(calls, { p1: 2, p2: 2 });
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
    if (id === "p3") return { response: auditLogs(8) };
    return new Promise((resolve) => {
      pending[id] = resolve;
      if (pending.p1 && pending.p2) started();
    });
  });
  const batch = syncAttendanceDetails({ session, rows, base });
  await ready;
  await refreshSubjectDetail(session, rows[2], base);
  pending.p1({ response: auditLogs(8) });
  pending.p2({ response: auditLogs(8) });
  assert.equal((await batch).complete, true);
  assert.deepEqual(calls, { p1: 1, p2: 1, p3: 1 });
});
