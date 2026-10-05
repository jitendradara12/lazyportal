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

const { getCached, setCached, STALE_MS } = await import("../src/hooks/useFeature.ts");

test("getCached returns null for missing or empty keys", () => {
  assert.deepEqual(getCached(undefined), { data: null, updatedAt: null });
  assert.deepEqual(getCached("nonexistent"), { data: null, updatedAt: null });
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

test("STALE_MS is configured to 2 hours", () => {
  assert.equal(STALE_MS, 2 * 60 * 60 * 1000);
});
