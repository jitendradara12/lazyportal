import test from "node:test";
import assert from "node:assert/strict";
import { lazyImport } from "../src/lib/lazyImport.ts";

test("only recovery of the failed chunk resets its reload guard", async (t) => {
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  const previousLocation = globalThis.location;
  let reloads = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  globalThis.location = { reload: () => { reloads++; } };
  t.after(() => {
    t.mock.timers.reset();
    globalThis.sessionStorage = previousStorage;
    globalThis.location = previousLocation;
  });
  const error = new Error("Missing chunk");
  const fail = () => Promise.reject(error);
  void lazyImport(fail, "marks")().catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 1);

  await lazyImport(async () => "more loaded", "more")();
  let secondRejected = false;
  void lazyImport(fail, "marks")().catch(err => { assert.equal(err, error); secondRejected = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 1);
  assert.equal(secondRejected, true);

  assert.equal(await lazyImport(async () => "marks recovered", "marks")(), "marks recovered");
  void lazyImport(fail, "exams")().catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 2);
});

test("offline failures never trigger a page reload", async (t) => {
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  const previousLocation = globalThis.location;
  const prevOnLine = Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine");
  let reloads = 0;
  let online = false;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  globalThis.location = { reload: () => { reloads++; } };
  Object.defineProperty(globalThis.navigator, "onLine", { get: () => online, configurable: true });
  t.after(() => {
    t.mock.timers.reset();
    globalThis.sessionStorage = previousStorage;
    globalThis.location = previousLocation;
    if (prevOnLine) Object.defineProperty(globalThis.navigator, "onLine", prevOnLine);
    else delete globalThis.navigator.onLine;
  });

  const error = new Error("Chunk unavailable");
  const load = lazyImport(() => Promise.reject(error), "marks");

  await assert.rejects(load(), err => err === error);
  assert.equal(reloads, 0);
  assert.equal(values.size, 0);

  online = true;
  void load().catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 1);
});

test("rejects with the chunk error after 4000ms if reload does not navigate", async (t) => {
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  const previousLocation = globalThis.location;
  let reloads = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  globalThis.location = { reload: () => { reloads++; } };
  t.after(() => {
    t.mock.timers.reset();
    globalThis.sessionStorage = previousStorage;
    globalThis.location = previousLocation;
  });

  const error = new Error("Stalled chunk");
  let settled = false;
  let caught;
  void lazyImport(() => Promise.reject(error), "login")().catch((err) => {
    settled = true;
    caught = err;
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 1);
  assert.equal(values.get("juet.chunk-reload"), "login");

  t.mock.timers.tick(3999);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);

  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, true);
  assert.equal(caught, error);
});
