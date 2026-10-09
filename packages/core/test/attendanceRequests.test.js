import test from "node:test";
import assert from "node:assert/strict";
import { fetchSubjectAttendance, getSubjectAttendanceAll } from "../src/features.js";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const session = { username: "student1", token: "token1", instituteid: "i1" };
const params = {
  subjectid: "s1", registrationid: "r1", registrationcode: "RC1",
  subjectcode: "CS101", components: "l1,l2",
};

test("background sync and an open subject share pending L/T/P reads, not completed results", async () => {
  const gate = deferred();
  const calls = [];
  const client = {
    async post(endpoint, payload) {
      calls.push({ endpoint, payload });
      await gate.promise;
      return { response: { components: payload.cmpidkey, summary: [{ present: "Y" }] } };
    },
  };
  const row = {
    subjectid: "s1", subjectcode: "CS101",
    Lsubjectcomponentid: "l1,l2", Tsubjectcomponentid: "t1", Psubjectcomponentid: "p1",
  };
  const base = { registrationid: "r1", registrationcode: "RC1" };
  const background = getSubjectAttendanceAll(client, session, row, base);
  const sheet = getSubjectAttendanceAll(client, { ...session }, { ...row }, { ...base });
  await Promise.resolve();
  assert.equal(calls.length, 3, "one request per component, not six");
  gate.resolve();
  const [first, second] = await Promise.all([background, sheet]);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), ["L", "P", "T"]);

  const refreshed = await getSubjectAttendanceAll(client, session, row, base);
  assert.equal(calls.length, 6, "a subsequent refresh still makes fresh requests");
  assert.notEqual(refreshed.L, first.L);
});

test("pending reads are isolated by client, account, token, and exact request parameters", async () => {
  const gate = deferred();
  const calls = [];
  const makeClient = () => ({
    async post(endpoint, payload) {
      calls.push({ endpoint, payload });
      await gate.promise;
      return { response: { endpoint, payload } };
    },
  });
  const client = makeClient();
  const variants = [
    [client, session, "current", params],
    [makeClient(), session, "current", params],
    [client, { ...session, username: "student2" }, "current", params],
    [client, { ...session, token: "token2" }, "current", params],
    [client, { ...session, instituteid: "i2" }, "current", params],
    [client, session, "previous", params],
    [client, session, "current", { ...params, subjectid: "s2" }],
    [client, session, "current", { ...params, registrationid: "r2" }],
    [client, session, "current", { ...params, registrationcode: "RC2" }],
    [client, session, "current", { ...params, subjectcode: "CS102" }],
    [client, session, "current", { ...params, components: "t1" }],
  ];
  const reads = variants.map((args) => fetchSubjectAttendance(...args));
  // Copying objects must not defeat deduplication of an identical read.
  reads.push(fetchSubjectAttendance(client, { ...session }, "current", { ...params }));
  await Promise.resolve();
  assert.equal(calls.length, variants.length);
  gate.resolve();
  const results = await Promise.all(reads);
  assert.deepEqual(results[0], results.at(-1));
  assert.equal(calls.filter((call) => call.endpoint.includes("previous")).length, 1);
});

test("enrollment identity isolates reads when the session has no username", async () => {
  const gate = deferred();
  let calls = 0;
  const client = {
    async post() {
      calls++;
      await gate.promise;
      return { response: {} };
    },
  };
  const reads = ["E1", "E2"].map((enrollmentno) => fetchSubjectAttendance(
    client, { instituteid: "i1", enrollmentno }, "current", params,
  ));
  await Promise.resolve();
  assert.equal(calls, 2);
  gate.resolve();
  await Promise.all(reads);
});

for (const failure of ["rejection", "synchronous throw"]) {
  test(`a shared ${failure} is removed so later retries can succeed`, async () => {
    const error = new Error("temporary portal failure");
    let calls = 0;
    const client = {
      post() {
        calls++;
        if (calls === 1) {
          if (failure === "synchronous throw") throw error;
          return Promise.reject(error);
        }
        return Promise.resolve({ response: { summary: [] } });
      },
    };
    await Promise.all([
      assert.rejects(fetchSubjectAttendance(client, session, "current", params), (err) => err === error),
      assert.rejects(fetchSubjectAttendance(client, session, "current", params), (err) => err === error),
    ]);
    assert.equal(calls, 1);
    const retried = await fetchSubjectAttendance(client, session, "current", params);
    assert.equal(calls, 2);
    assert.deepEqual(retried, { summary: [] });
  });
}

test("finishing one subject does not discard another subject's pending read", async () => {
  const gates = { s1: deferred(), s2: deferred() };
  const calls = [];
  const client = {
    async post(endpoint, payload) {
      calls.push(payload.subjectid);
      await gates[payload.subjectid].promise;
      return { response: { subjectid: payload.subjectid } };
    },
  };
  const first = fetchSubjectAttendance(client, session, "current", params);
  const otherParams = { ...params, subjectid: "s2" };
  const second = fetchSubjectAttendance(client, session, "current", otherParams);
  gates.s1.resolve();
  await first;
  const joinedSecond = fetchSubjectAttendance(client, session, "current", otherParams);
  await Promise.resolve();
  assert.deepEqual(calls, ["s1", "s2"]);
  gates.s2.resolve();
  assert.deepEqual(await second, await joinedSecond);
});
