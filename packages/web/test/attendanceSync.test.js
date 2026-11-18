import test, { after } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};
globalThis.window = new EventTarget();
const cacheDir = await mkdtemp(join(tmpdir(), "attendance-sync-"));
const server = await createServer({
  configFile: false, root: new URL("../", import.meta.url).pathname,
  cacheDir, server: { middlewareMode: true }, appType: "custom",
});
after(async () => { await server.close(); await rm(cacheDir, { recursive: true, force: true }); });
const {
  syncAttendanceDetails,
  pauseAttendanceSync,
  runManualAttendanceRefresh,
  refreshSubjectDetail,
  getCachedSubjectDetailEntry,
  setCachedSubjectDetail,
} = await server.ssrLoadModule("/src/lib/attendanceSync.ts");
const { client } = await server.ssrLoadModule("/src/lib/portal.ts");
const { invalidateCacheGeneration } = await server.ssrLoadModule("/src/hooks/useFeature.ts");

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function options(username) {
  return {
    session: { username, instituteid: "test", token: "test-token" },
    base: { registrationid: "current", registrationcode: "2026ODDSEM" },
    rows: Array.from({ length: 9 }, (_, i) => ({
      subjectid: `s${i}`, subjectcode: `CS${i}`, Lsubjectcomponentid: `l${i}`, Lpercentage: 100,
    })),
  };
}
const response = { response: { summary: [{ present: "Y", datetime: "28/10/2026 09:00 AM" }] } };

test("cold history overlaps five subjects, refills without waiting for the slowest, and caches every result", async () => {
  const gates = Array.from({ length: 9 }, deferred);
  const reads = [];
  let active = 0, peak = 0;
  client.post = async (_endpoint, payload) => {
    const i = Number(payload.subjectid.slice(1));
    reads.push(i);
    peak = Math.max(peak, ++active);
    await gates[i].promise;
    active--;
    return response;
  };
  const progress = [];
  const input = options("cold");
  const run = syncAttendanceDetails({ ...input, onProgress: state => progress.push(state) });
  let sheet;
  try {
    await setImmediate();
    assert.deepEqual(reads, [0, 1, 2, 3, 4], "a slow first subject must not block the next four");
    sheet = refreshSubjectDetail(input.session, input.rows[2], input.base);
    await setImmediate();
    assert.deepEqual(reads, [0, 1, 2, 3, 4], "an open sheet shares its in-flight subject read");
    gates[1].resolve();
    await setImmediate();
    assert.deepEqual(reads, [0, 1, 2, 3, 4, 5], "a freed slot starts the next subject immediately");
    assert.equal(peak, 5);
  } finally { gates.forEach(gate => gate.resolve()); await Promise.all([run, sheet]); }
  assert.equal((await run).complete, true);
  assert.equal(reads.length, 9);
  assert.equal(new Set(reads).size, 9);
  assert.equal(peak, 5);
  assert.deepEqual(progress.at(-1), { phase: "complete", pending: new Set(), done: 9, total: 9 });
  assert.equal((await syncAttendanceDetails(input)).complete, true);
  assert.equal(reads.length, 9, "unchanged history performs no additional reads");
});

test("an outage stops queued subjects, retains in-flight successes, and retries only missing history", async () => {
  const failed = deferred(), successful = deferred();
  const reads = [];
  client.post = async (_endpoint, payload) => {
    reads.push(payload.subjectid);
    if (payload.subjectid === "s0") {
      await failed.promise;
      throw Object.assign(new Error("Unavailable"), { status: 503 });
    }
    await successful.promise;
    return response;
  };
  const input = options("outage");
  const run = syncAttendanceDetails(input);
  await setImmediate();
  failed.resolve();
  await setImmediate();
  assert.deepEqual(reads, ["s0", "s1", "s2", "s3", "s4"]);
  successful.resolve();
  const result = await run;
  assert.equal(result.complete, false);
  assert.equal(result.errors.length, 1);
  client.post = async (_endpoint, payload) => { reads.push(payload.subjectid); return response; };
  assert.equal((await syncAttendanceDetails(input)).complete, true);
  assert.equal(reads.filter(id => id === "s0").length, 2);
  assert.equal(reads.filter(id => id === "s1").length, 1);
  assert.equal(reads.filter(id => id === "s2").length, 1);
  assert.equal(reads.length, 10);
});

test("cancelling a batch releases its waiters and starts no queued subjects", async () => {
  const gate = deferred();
  const reads = [], details = [], progress = [];
  client.post = async (_endpoint, payload) => { reads.push(payload.subjectid); await gate.promise; return response; };
  const controller = new AbortController();
  const run = syncAttendanceDetails({
    ...options("cancel"), signal: controller.signal,
    onDetail: id => details.push(id), onProgress: state => progress.push(state),
  });
  await setImmediate();
  controller.abort();
  assert.equal((await run).complete, false);
  assert.equal(progress.at(-1).phase, "cancelled");
  gate.resolve();
  await setImmediate();
  assert.deepEqual(reads, ["s0", "s1", "s2", "s3", "s4"]);
  assert.deepEqual(details, [], "late results cannot update a cancelled view");
});

test("an open sheet pauses queued work until its history finishes, then all workers resume", async () => {
  let resume = pauseAttendanceSync();
  const gate = deferred();
  const reads = [];
  client.post = async (_endpoint, payload) => { reads.push(payload.subjectid); await gate.promise; return response; };
  const run = syncAttendanceDetails(options("sheet"));
  try {
    await setImmediate();
    assert.deepEqual(reads, []);
    resume();
    await setImmediate();
    assert.deepEqual(reads, ["s0", "s1", "s2", "s3", "s4"]);
    resume = pauseAttendanceSync();
    gate.resolve();
    await setImmediate();
    assert.deepEqual(reads, ["s0", "s1", "s2", "s3", "s4"], "finishing workers must respect an open sheet");
  } finally { resume(); gate.resolve(); await run; }
  assert.equal((await run).complete, true);
  assert.equal(reads.length, 9);
});

test("a component outage stops queued subjects before its slow sibling finishes", async () => {
  const lecture = deferred(), tutorial = deferred(), other = deferred();
  const reads = [];
  client.post = async (_endpoint, payload) => {
    reads.push(payload.subjectid);
    if (payload.subjectid === "s0" && payload.cmpidkey[0].subjectcomponentid === "tutorial") {
      await tutorial.promise;
      throw Object.assign(new Error("Unavailable"), { status: 503 });
    }
    await (payload.subjectid === "s0" ? lecture.promise : other.promise);
    return response;
  };
  const input = options("component-outage");
  input.rows[0].Tsubjectcomponentid = "tutorial";
  const run = syncAttendanceDetails(input);
  try {
    await setImmediate();
    tutorial.resolve();
    await setImmediate();
    other.resolve();
    await setImmediate();
    assert.equal(new Set(reads).size, 5, "a known outage must stop new subjects while lecture is pending");
  } finally { tutorial.resolve(); other.resolve(); lecture.resolve(); await run; }
  assert.equal((await run).complete, false);
});

test("zero-request subjects finish before slow subjects consume every worker", async () => {
  const resume = pauseAttendanceSync();
  const gate = deferred();
  client.post = async () => { await gate.promise; return response; };
  const input = options("zero-request");
  input.rows.push({ subjectid: "empty", Lsubjectcomponentid: "zero", Ltotalclass: 0, Ltotalpresent: 0 });
  const details = [];
  const run = syncAttendanceDetails({ ...input, onDetail: id => details.push(id) });
  try { await setImmediate(); assert.deepEqual(details, ["empty"]); }
  finally { resume(); gate.resolve(); await run; }
});

const logs = (total, present = total) => ({ summary: Array.from({ length: total }, (_, i) => ({
  present: i < present ? "Y" : "N", datetime: `${i + 1}/10/2026 09:00 AM`,
})) });

test("a changed lecture reuses its unchanged tutorial instead of refetching both", async () => {
  const input = options("component-reuse");
  const row = { ...input.rows[0], Ltotalclass: 2, Ltotalpresent: 2,
    Tsubjectcomponentid: "tutorial", Tpercentage: 100, Ttotalclass: 1, Ttotalpresent: 1 };
  const reads = [];
  client.post = async (_endpoint, payload) => {
    const type = payload.cmpidkey[0].subjectcomponentid === "tutorial" ? "T" : "L";
    reads.push(type);
    return { response: logs(type === "L" ? row.Ltotalclass : 1) };
  };
  await refreshSubjectDetail(input.session, row, input.base);
  row.Ltotalclass = row.Ltotalpresent = 3;
  const refreshed = await refreshSubjectDetail(input.session, row, input.base);
  assert.deepEqual(reads, ["L", "T", "L"]);
  assert.deepEqual(refreshed.data.T, logs(1));
});

test("a contradictory partial checkpoint rechecks reused components before becoming provisional", async () => {
  const input = options("partial-checkpoint-recheck");
  const row = { subjectid: "s0", Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial",
    Lpercentage: 100, Tpercentage: 100, totalclass: 2, totalpresent: 2 };
  let first = true;
  const reads = [];
  client.post = async (_path, payload) => {
    const type = payload.cmpidkey[0].subjectcomponentid === "lecture" ? "L" : "T";
    reads.push(type);
    if (first && type === "T") throw new Error("Tutorial unavailable");
    return { response: logs(type === "L" && !first ? 2 : 1) };
  };
  await assert.rejects(refreshSubjectDetail(input.session, row, input.base), /Tutorial unavailable/);
  first = false;
  const fresh = { ...row, totalclass: 3, totalpresent: 3 };
  const result = await syncAttendanceDetails({ ...input, rows: [fresh] });
  assert.equal(result.complete, true);
  assert.equal(result.provisional, false, "a stale reused lecture must not be mistaken for a portal disagreement");
  assert.deepEqual(reads, ["L", "T", "T", "L"], "retry only the reused lecture, retaining the fresh tutorial");
  const entry = getCachedSubjectDetailEntry(input.session.username, input.base.registrationid, fresh, input.session.instituteid);
  assert.deepEqual(entry.data, { L: logs(2), T: logs(1) });
  await syncAttendanceDetails({ ...input, rows: [fresh] });
  assert.equal(reads.length, 4, "verified recovery is cached without further reads");
});

for (const outcome of ["disagreement", "outage"]) test(`rechecking a reused component handles a real ${outcome} without retrying fresh components`, async () => {
  const input = options(`partial-recheck-${outcome}`);
  const row = { subjectid: "s0", Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial",
    Lpercentage: 100, Tpercentage: 100, totalclass: 2, totalpresent: 2 };
  let stage = "initial";
  const reads = [];
  client.post = async (_path, payload) => {
    const type = payload.cmpidkey[0].subjectcomponentid === "lecture" ? "L" : "T";
    reads.push(type);
    if (stage === "initial" && type === "T") throw new Error("Tutorial unavailable");
    if (stage === "recheck" && outcome === "outage" && type === "L") {
      throw Object.assign(new Error("Unavailable"), { status: 503 });
    }
    return { response: logs(stage === "recovered" && type === "L" ? 2 : 1) };
  };
  await assert.rejects(refreshSubjectDetail(input.session, row, input.base), /Tutorial unavailable/);
  stage = "recheck";
  const fresh = { ...row, totalclass: 3, totalpresent: 3 };
  const result = await syncAttendanceDetails({ ...input, rows: [fresh] });
  assert.deepEqual(reads, ["L", "T", "T", "L"]);
  if (outcome === "disagreement") {
    assert.equal(result.complete, true);
    assert.equal(result.provisional, true);
    await syncAttendanceDetails({ ...input, rows: [fresh] });
    assert.equal(reads.length, 4, "a confirmed disagreement settles after one recheck");
  } else {
    assert.equal(result.complete, false);
    assert.equal(result.errors[0].status, 503);
    stage = "recovered";
    const recovered = await syncAttendanceDetails({ ...input, rows: [fresh] });
    assert.equal(recovered.complete, true);
    assert.equal(recovered.provisional, false);
    assert.deepEqual(reads, ["L", "T", "T", "L", "L"], "retry retains the fresh tutorial and discards the stale lecture");
  }
});

test("a malformed fresh component cannot discard a valid reused checkpoint", async () => {
  const input = options("partial-recheck-malformed");
  const row = { subjectid: "s0", Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial",
    Lpercentage: 100, Tpercentage: 100, totalclass: 2, totalpresent: 2 };
  let stage = "initial";
  const reads = [];
  client.post = async (_path, payload) => {
    const type = payload.cmpidkey[0].subjectcomponentid === "lecture" ? "L" : "T";
    reads.push(type);
    if (stage === "initial" && type === "T") throw new Error("Tutorial unavailable");
    if (stage === "malformed") {
      if (type === "L") throw Object.assign(new Error("Unexpected lecture retry"), { status: 503 });
      return { response: {} };
    }
    return { response: logs(stage === "recovered" && type === "L" ? 2 : 1) };
  };
  await assert.rejects(refreshSubjectDetail(input.session, row, input.base), /Tutorial unavailable/);
  stage = "malformed";
  const fresh = { ...row, totalclass: 3, totalpresent: 3 };
  await assert.rejects(refreshSubjectDetail(input.session, fresh, input.base), /incomplete class records/);
  assert.deepEqual(reads, ["L", "T", "T"]);
  stage = "recovered";
  const result = await syncAttendanceDetails({ ...input, rows: [fresh] });
  assert.equal(result.complete, true);
  assert.equal(result.provisional, false);
  assert.deepEqual(reads, ["L", "T", "T", "T", "L"]);
});

test("a stale portal reply cannot replace saved history that agrees with the overview", async () => {
  const input = options("stale-reply");
  const row = { ...input.rows[0], Lpercentage: 94.4 };
  const saved = { L: logs(36, 34) };
  setCachedSubjectDetail(input.session, input.base.registrationid, row, saved);
  client.post = async () => ({ response: logs(32, 30) });
  await refreshSubjectDetail(input.session, row, input.base).catch(() => {});
  const entry = getCachedSubjectDetailEntry(input.session.username, input.base.registrationid, row, input.session.instituteid);
  assert.deepEqual(entry.data, saved);
});

test("a mismatched first history stays visible as provisional without blocking recovery", async () => {
  const input = options("provisional");
  const row = { ...input.rows[0], Lpercentage: 94.4 };
  let reads = 0;
  client.post = async () => { reads++; return { response: logs(32, 30) }; };
  const result = await runManualAttendanceRefresh({ ...input, baselineRows: [row],
    readOverview: async () => ({ rows: [row], semesters: [input.base] }),
  });
  assert.equal(result.provisional, true);
  const entry = getCachedSubjectDetailEntry(input.session.username, input.base.registrationid, row, input.session.instituteid);
  assert.deepEqual(entry.data, { L: logs(32, 30) });
  assert.equal(entry.provisional, true);
  assert.equal((await syncAttendanceDetails({ ...input, rows: [row] })).complete, true);
  assert.equal(reads, 1, "reopening must not repeatedly request the same contradictory portal snapshot");
  client.post = async () => ({ response: logs(36, 34) });
  const corrected = await runManualAttendanceRefresh({ ...input, baselineRows: [row],
    readOverview: async () => ({ rows: [row], semesters: [input.base] }),
  });
  assert.equal(corrected.provisional, false);
  assert.deepEqual(getCachedSubjectDetailEntry(input.session.username, input.base.registrationid, row, input.session.instituteid).data, { L: logs(36, 34) });
});

test("a new aggregate count or LT percentage cannot be blocked by unchanged component percentages", async () => {
  for (const mode of ["counts", "percentage"]) {
    const input = options(`aggregate-${mode}`);
    const row = { subjectid: "s0", Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial",
      Lpercentage: 80, Tpercentage: 100,
      ...(mode === "counts" ? { totalclass: 11, totalpresent: 9 } : { LTpercentage: 81.8 }) };
    let tutorialCount = 1, reads = 0;
    client.post = async (_path, payload) => {
      reads++;
      return { response: payload.cmpidkey[0].subjectcomponentid === "lecture" ? logs(10, 8) : logs(tutorialCount) };
    };
    await refreshSubjectDetail(input.session, row, input.base);
    tutorialCount = 2;
    if (mode === "counts") { row.totalclass = 12; row.totalpresent = 10; }
    else row.LTpercentage = 83.3;
    const result = await refreshSubjectDetail(input.session, row, input.base);
    assert.equal(reads, 4, "a contradicting reused full history must make real reads");
    assert.deepEqual(result.data.T, logs(2));
  }
});

test("an old session's late outage cannot stop a fresh session's sync", async () => {
  const old = deferred(), fresh = deferred();
  const input = options("generation");
  let first = true, reads = 0;
  client.post = async () => {
    reads++;
    if (first) { first = false; await old.promise; throw Object.assign(new Error("Old outage"), { status: 503 }); }
    await fresh.promise;
    return response;
  };
  const expired = refreshSubjectDetail(input.session, input.rows[0], input.base).catch(() => {});
  await setImmediate();
  invalidateCacheGeneration();
  const run = syncAttendanceDetails({ ...input, session: { ...input.session, token: "new" } });
  await setImmediate();
  old.resolve();
  await expired;
  fresh.resolve();
  assert.equal((await run).complete, true);
  assert.equal(reads, 10);
});

test("an overnight read cannot certify yesterday's history as today's cache", async t => {
  let now = Date.UTC(2026, 10, 3, 20, 29, 59);
  t.mock.method(Date, "now", () => now);
  const gate = deferred();
  client.post = async () => { await gate.promise; return response; };
  const input = options("rollover");
  const run = refreshSubjectDetail(input.session, input.rows[0], input.base);
  await setImmediate();
  now += 2000;
  gate.resolve();
  await assert.rejects(run, /day|retry/i);
  assert.equal(getCachedSubjectDetailEntry(input.session.username, input.base.registrationid, input.rows[0], input.session.instituteid).data, null);
});

test("an outage wakes paused workers without waiting for the unrelated open sheet", async () => {
  const fail = deferred(), success = deferred();
  const input = options("paused-outage");
  client.post = async (_path, payload) => {
    if (payload.subjectid === "s0") { await fail.promise; throw Object.assign(new Error("Unavailable"), { status: 503 }); }
    await success.promise;
    return response;
  };
  let settled = false;
  const run = syncAttendanceDetails(input).then(result => { settled = true; return result; });
  await setImmediate();
  const resume = pauseAttendanceSync();
  try {
    success.resolve();
    await setImmediate();
    fail.resolve();
    await setImmediate();
    assert.equal(settled, true);
  } finally { resume(); fail.resolve(); success.resolve(); await run; }
  assert.equal((await run).complete, false);
});
