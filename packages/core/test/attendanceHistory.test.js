import test from "node:test";
import assert from "node:assert/strict";
import { getSubjectAttendanceAll, fetchSubjectAttendance } from "../src/features.js";
import { createClient } from "../src/client.js";

const session = { username: "student", instituteid: "i", token: "t" };
const base = { registrationid: "r", registrationcode: "R" };
const row = { subjectid: "s", Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial" };
const history = { summary: [{ present: "Y" }] };

test("subject totals and missing percentages cannot erase positive component history", async () => {
  for (const evidence of [
    { totalclass: 0, totalpresent: 0, Ltotalclass: 5, Ltotalpresent: 4 },
    { Lpercentage: null },
    { totalclass: 5, Ltotalclass: 5, Tpercentage: 100 },
  ]) {
    const calls = [];
    const result = await getSubjectAttendanceAll({ post: async (_path, payload) => {
      calls.push(payload.cmpidkey[0].subjectcomponentid);
      return { response: history };
    } }, session, { ...row, ...evidence }, base);
    assert.deepEqual(calls, ["lecture", "tutorial"]);
    assert.deepEqual(result, { L: history, T: history });
  }
});

test("HTTP failures and generic Not Found errors remain failures", async () => {
  for (const error of [new Error("Not Found"), Object.assign(new Error("No Data Found"), { status: 404 })]) {
    await assert.rejects(getSubjectAttendanceAll({ post: async () => { throw error; } }, session, row, base), e => e === error);
  }
});

test("JUET's HTTP 404 NO Attendance Found response is valid empty history", async () => {
  const client = createClient({ baseUrl: "https://portal.test", fetchImpl: async () => new Response(JSON.stringify({
    status: { responseStatus: "Failure", errors: ["NO Attendance Found"] },
  }), { status: 404 }) });
  assert.deepEqual(await getSubjectAttendanceAll(client, session, row, base), {
    L: { summary: [] }, T: { summary: [] },
  });
});

test("completed components publish before a slow sibling finishes", async () => {
  let finishTutorial;
  const completed = new Map();
  const published = [];
  const request = getSubjectAttendanceAll({ post: async (_path, payload) => {
    if (payload.cmpidkey[0].subjectcomponentid === "tutorial") await new Promise(resolve => { finishTutorial = resolve; });
    return { response: history };
  } }, session, row, base, "current", { completed, onComponent: (type, data) => published.push([type, data]) });
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.deepEqual(published, [["L", history]]);
    assert.deepEqual(completed.get("L"), history);
  } finally { finishTutorial(); await request; }
});

test("an outage cannot be hidden by a later component data error", async () => {
  const outage = Object.assign(new Error("Timed out"), { code: "REQUEST_TIMEOUT" });
  const dataError = new Error("Invalid row");
  await assert.rejects(getSubjectAttendanceAll({ post: async (_path, payload) => {
    if (payload.cmpidkey[0].subjectcomponentid === "lecture") throw outage;
    await new Promise(resolve => setImmediate(resolve));
    throw dataError;
  } }, session, row, base), e => e === outage);
});

test("equivalent component lists share one request", async () => {
  let calls = 0;
  const client = { post: async () => { calls++; return { response: history }; } };
  await Promise.all(["b, a,a", "a,b"].map(components => fetchSubjectAttendance(client, session, "current", { ...base, subjectid: "s", components })));
  assert.equal(calls, 1);
});

test("cancelling one request owner cannot abort another owner's history", async () => {
  const first = new AbortController(), second = new AbortController();
  let finishSecond;
  const client = { post: (_path, _payload, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    if (signal === second.signal) finishSecond = () => resolve({ response: history });
  }) };
  const params = { ...base, subjectid: "s", components: "lecture" };
  const cancelled = fetchSubjectAttendance(client, session, "current", params, { signal: first.signal });
  const retained = fetchSubjectAttendance(client, session, "current", params, { signal: second.signal });
  await Promise.resolve();
  first.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  finishSecond();
  assert.deepEqual(await retained, history);
});
