import test from "node:test";
import assert from "node:assert/strict";
import { lazyImport } from "../src/lib/lazyImport.ts";

test("only recovery of the failed chunk resets its reload guard", async (t) => {
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  const previousLocation = globalThis.location;
  let reloads = 0;
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  globalThis.location = { reload: () => { reloads++; } };
  t.after(() => {
    globalThis.sessionStorage = previousStorage;
    globalThis.location = previousLocation;
  });
  const error = new Error("Missing chunk");
  const fail = () => Promise.reject(error);
  void lazyImport(fail, "marks")();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 1);

  await lazyImport(async () => "more loaded", "more")();
  let secondRejected = false;
  void lazyImport(fail, "marks")().catch(err => { assert.equal(err, error); secondRejected = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 1);
  assert.equal(secondRejected, true);

  assert.equal(await lazyImport(async () => "marks recovered", "marks")(), "marks recovered");
  void lazyImport(fail, "exams")();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 2);
});
