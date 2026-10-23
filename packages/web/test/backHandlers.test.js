import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackHandlers } from "../src/lib/backHandlers.js";

test("Back dismisses one topmost overlay before navigation, then releases system Back", () => {
  const calls = [], enabled = [];
  const back = createBackHandlers((value) => enabled.push(value));
  const removePage = back.add(() => calls.push("home"), 0);
  const removeSheet = back.add(() => calls.push("sheet"), 100);
  const removeModal = back.add(() => calls.push("modal"), 200);
  assert.equal(back.dispatch(), true);
  assert.deepEqual(calls, ["modal"]);
  removeModal();
  back.dispatch();
  assert.deepEqual(calls, ["modal", "sheet"]);
  removeSheet();
  back.dispatch();
  assert.deepEqual(calls, ["modal", "sheet", "home"]);
  removePage();
  assert.equal(back.dispatch(), false);
  assert.equal(back.enabled, false);
  assert.equal(enabled.at(-1), false);
});

test("equal-priority overlays unwind in opening order and cleanup is idempotent", () => {
  const calls = [];
  const back = createBackHandlers();
  const removeFirst = back.add(() => calls.push("first"), 100);
  const removeSecond = back.add(() => calls.push("second"), 100);
  back.dispatch();
  removeFirst();
  removeFirst();
  back.dispatch();
  assert.deepEqual(calls, ["second", "second"]);
  removeSecond();
  assert.equal(back.dispatch(), false);
});
