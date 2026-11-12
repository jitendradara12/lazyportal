import test from "node:test";
import assert from "node:assert/strict";

const values = new Map();
globalThis.localStorage = {
  getItem(key) {
    return values.has(key) ? values.get(key) : null;
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

const { resolvePersistentValue, resolvePersistentEventValue, writePersistentValue } = await import("../src/hooks/usePersistentState.ts");

test("changing the persisted key reads that key instead of carrying over the previous value", () => {
  values.clear();
  localStorage.setItem("juet.portal.sem.user1:institute1:attendance", "semester-1");
  localStorage.setItem("juet.portal.sem.user1:institute2:attendance", "semester-2");

  const stored = { key: "sem.user1:institute1:attendance", value: "semester-1" };
  assert.equal(
    resolvePersistentValue(stored, "sem.user1:institute2:attendance", null),
    "semester-2",
  );
});

test("a missing value for a changed key falls back to its initial value", () => {
  values.clear();
  const stored = { key: "old-key", value: "old-value" };

  assert.equal(resolvePersistentValue(stored, "new-key", "default-value"), "default-value");
});

test("writePersistentValue broadcasts detail.value and resolvePersistentEventValue preserves it when storage throws", () => {
  const originalSetItem = localStorage.setItem;
  const originalGetItem = localStorage.getItem;
  const originalWindow = globalThis.window;
  const originalCustomEvent = globalThis.CustomEvent;
  const events = [];
  try {
    values.clear();
    localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    localStorage.getItem = () => { throw new Error("SecurityError"); };
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
    globalThis.window = {
      dispatchEvent(event) {
        events.push(event);
        return true;
      },
    };

    writePersistentValue("theme", "dark");
    assert.equal(events.length, 1);
    assert.deepEqual(resolvePersistentEventValue(events[0], "theme", null), { match: true, value: "dark" });

    // Clearing a non-null-default preference falls back to initial instead of null
    writePersistentValue("attendance.default_target", null);
    assert.equal(events.length, 2);
    assert.deepEqual(resolvePersistentEventValue(events[1], "attendance.default_target", "70"), { match: true, value: "70" });

    // Unrelated keys do not match
    assert.deepEqual(resolvePersistentEventValue(events[0], "other-key", "fallback"), { match: false, value: "fallback" });

    // Cross-tab StorageEvent (no detail) falls back to initial when storage throws
    assert.deepEqual(
      resolvePersistentEventValue({ key: "juet.portal.theme" }, "theme", "light"),
      { match: true, value: "light" },
    );
  } finally {
    localStorage.setItem = originalSetItem;
    localStorage.getItem = originalGetItem;
    globalThis.window = originalWindow;
    globalThis.CustomEvent = originalCustomEvent;
  }
});
