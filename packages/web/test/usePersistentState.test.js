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

const { resolvePersistentValue } = await import("../src/hooks/usePersistentState.ts");

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
