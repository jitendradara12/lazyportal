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
  resolveFeatureState,
  getCacheGeneration,
  isCacheGenerationCurrent,
  invalidateCacheGeneration,
} = await import("../src/hooks/useFeature.ts");

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

test("setCached for att.* keys records portal last_sync and dispatches juet:sync", () => {
  dispatchedEvents = [];
  const payload = { rows: [] };
  const time = setCached("att.initial:user123", payload);

  assert.equal(globalThis.localStorage.getItem("juet.portal.last_sync"), String(time));
  assert.ok(dispatchedEvents.includes("juet:sync"));
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

test("STALE_MS is configured to 2 hours", () => {
  assert.equal(STALE_MS, 2 * 60 * 60 * 1000);
});
