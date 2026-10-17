import test from "node:test";
import assert from "node:assert/strict";

// Setup browser globals before importing useFeature
const values = new Map();
let dispatchedEvents = [];

globalThis.window = {
  dispatchEvent(event) {
    dispatchedEvents.push(event.type);
    return true;
  },
  addEventListener() {},
  removeEventListener() {},
};

globalThis.localStorage = {
  getItem(key) {
    return values.get(key) ?? null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
  removeItem(key) {
    values.delete(key);
  },
  clear() {
    values.clear();
  },
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const {
  getCached,
  setCached,
  STALE_MS,
  sessionCacheKey,
  resolveTargetScope,
  resolveFeatureState,
  getCacheGeneration,
  isCacheGenerationCurrent,
  invalidateCacheGeneration,
  requestFeature,
} = await import("../src/hooks/useFeature.ts");

test("automatic and imperative reads share one request and one cache result", async () => {
  let resolve;
  let calls = 0;
  const run = () => { calls++; return new Promise((done) => { resolve = done; }); };
  const automatic = requestFeature("audit.overview", run);
  const manual = requestFeature("audit.overview", run);
  assert.equal(automatic, manual);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ rows: ["latest"] });
  await Promise.all([automatic, manual]);
  assert.deepEqual(getCached("audit.overview").data, { rows: ["latest"] });
});

test("failed shared reads can be retried and logout prevents late cache writes", async () => {
  await assert.rejects(requestFeature("audit.failed", async () => { throw new Error("failed"); }));
  assert.equal((await requestFeature("audit.failed", async () => "recovered")).data, "recovered");
  let resolve;
  const pending = requestFeature("audit.logout", () => new Promise((done) => { resolve = done; }));
  await Promise.resolve();
  invalidateCacheGeneration();
  resolve("discard");
  await pending;
  assert.equal(getCached("audit.logout").data, null);
});

test("getCached returns null for missing or empty keys", () => {
  assert.deepEqual(getCached(undefined), { data: null, updatedAt: null });
  assert.deepEqual(getCached("nonexistent"), { data: null, updatedAt: null });
});

test("session cache keys are isolated by account and institute", () => {
  const campusOne = sessionCacheKey("att.initial", { username: "u1", instituteid: "i1" });
  const campusTwo = sessionCacheKey("att.initial", { username: "u1", instituteid: "i2" });
  const otherUser = sessionCacheKey("att.initial", { username: "u2", instituteid: "i1" });

  assert.match(campusOne, /^att\.initial:/);
  assert.notEqual(campusOne, campusTwo);
  assert.notEqual(campusOne, otherUser);
});

test("changing a feature cache key immediately resolves to that key's cached state", () => {
  values.clear();
  const oldKey = sessionCacheKey("marks.latest", { username: "u1", instituteid: "i1" });
  const newKey = sessionCacheKey("marks.latest", { username: "u1", instituteid: "i2" });
  const nextData = { rows: [{ subjectcode: "NEW-CAMPUS" }] };
  const updatedAt = setCached(newKey, nextData);
  const oldState = {
    cacheKey: oldKey,
    data: { rows: [{ subjectcode: "OLD-CAMPUS" }] },
    updatedAt: 1,
    error: "old error",
    loading: false,
  };

  assert.deepEqual(resolveFeatureState(oldState, newKey, true), {
    cacheKey: newKey,
    data: nextData,
    updatedAt,
    error: null,
    loading: false,
  });
});

test("changing to an uncached feature key hides old data and enters loading state", () => {
  values.clear();
  const oldState = {
    cacheKey: "marks.latest:u1:i1",
    data: { rows: [{ subjectcode: "OLD-CAMPUS" }] },
    updatedAt: 1,
    error: "old error",
    loading: false,
  };

  assert.deepEqual(resolveFeatureState(oldState, "marks.latest:u1:i2", true), {
    cacheKey: "marks.latest:u1:i2",
    data: null,
    updatedAt: null,
    error: null,
    loading: true,
  });
});

test("logout invalidates cache writes started in the previous session", () => {
  const requestGeneration = getCacheGeneration();
  assert.equal(isCacheGenerationCurrent(requestGeneration), true);

  invalidateCacheGeneration();

  assert.equal(isCacheGenerationCurrent(requestGeneration), false);
});

test("setCached stores data with timestamp and retrieves accurately", () => {
  const payload = { rows: [{ subjectcode: "CS101", attendance: 85 }] };
  const time = setCached("test.key", payload);

  assert.ok(typeof time === "number");
  const cached = getCached("test.key");
  assert.deepEqual(cached.data, payload);
  assert.equal(cached.updatedAt, time);
});

test("an attendance cache write updates consumers without claiming a full sync", () => {
  dispatchedEvents = [];
  globalThis.localStorage.removeItem("juet.portal.last_sync");
  const payload = { rows: [] };
  setCached("att.initial:user123", payload);

  assert.equal(globalThis.localStorage.getItem("juet.portal.last_sync"), null);
  assert.ok(dispatchedEvents.includes("juet:cache-updated"));
  assert.ok(!dispatchedEvents.includes("juet:sync"));
});

test("setCached stores data, timestamp, and optional extra metadata like checksum", () => {
  const key = "att.subject:student1:cs101";
  const data = { L: { total: 11 } };
  const time = setCached(key, data, { checksum: "CS101|11|9|81.8%|L11:9:81.8" });

  const raw = JSON.parse(globalThis.localStorage.getItem(`juet.cache.${key}`));
  assert.deepEqual(raw.data, data);
  assert.equal(raw.updatedAt, time);
  assert.equal(raw.checksum, "CS101|11|9|81.8%|L11:9:81.8");
});

test("writeExtra function computes checksum based on freshly resolved data", () => {
  const key = "att.subject:student1:ma106";
  const resolvedData = { L: { total: 31 }, T: { total: 3 } };
  const writeExtraFn = (d) => ({
    checksum: d.L && d.T ? "MA106|34|31|91.2%" : null,
  });
  const extra = writeExtraFn(resolvedData);
  setCached(key, resolvedData, extra);

  const raw = JSON.parse(globalThis.localStorage.getItem(`juet.cache.${key}`));
  assert.deepEqual(raw.data, resolvedData);
  assert.equal(raw.checksum, "MA106|34|31|91.2%");
});

test("STALE_MS is configured to 2 hours", () => {
  assert.equal(STALE_MS, 2 * 60 * 60 * 1000);
});

test("resolveTargetScope isolates att.subject keys to subject scope", () => {
  assert.equal(resolveTargetScope(undefined, "att.subject:u1:cs101"), "subject");
  assert.equal(resolveTargetScope(undefined, "att.initial:u1"), "attendance");
  assert.equal(resolveTargetScope(undefined, "dashboard:u1"), "dashboard");
  assert.equal(resolveTargetScope("all", "att.subject:u1:cs101"), "all");
});

test("getCached returns isolated wrapper copy so caller mutation does not corrupt memory cache", () => {
  const key = "test.iso.key";
  setCached(key, { count: 1 });
  const first = getCached(key);
  first.updatedAt = 99999999;
  first.extraProp = "corrupted";
  const second = getCached(key);
  assert.notEqual(second.updatedAt, 99999999);
  assert.equal(second.extraProp, undefined);
});
