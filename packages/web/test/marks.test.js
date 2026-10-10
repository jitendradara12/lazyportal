import test from "node:test";
import assert from "node:assert/strict";

const { formatEventCode } = await import("../src/lib/marks.ts");

test("formatEventCode converts test events to compact T/P format", () => {
  assert.equal(formatEventCode("TEST-1"), "T1");
  assert.equal(formatEventCode("TEST-2"), "T2");
  assert.equal(formatEventCode("TEST-3"), "T3");
  assert.equal(formatEventCode("TEST 1"), "T1");
  assert.equal(formatEventCode("test1"), "T1");
  assert.equal(formatEventCode("P-1"), "P1");
  assert.equal(formatEventCode("P-2"), "P2");
  assert.equal(formatEventCode("p-3"), "P3");
  assert.equal(formatEventCode("P 1"), "P1");
  assert.equal(formatEventCode("T-1"), "T1");
  assert.equal(formatEventCode("T 1"), "T1");
  assert.equal(formatEventCode("PRAC-1"), "P1");
  assert.equal(formatEventCode(1), "1");
  assert.equal(formatEventCode(null), "");
  assert.equal(formatEventCode(""), "");
  assert.equal(formatEventCode(undefined), "");
  assert.equal(formatEventCode("MID-SEM"), "MID-SEM");
});
