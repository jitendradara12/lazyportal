import test from "node:test";
import assert from "node:assert/strict";
import { REFRESH_POLICIES, selectRefreshPolicy } from "../src/lib/refreshPolicy.ts";

test("refresh limits follow proxy usage, with independent quota overrides", () => {
  assert.deepEqual(selectRefreshPolicy(true), { attendanceQuota: true, throttleMs: 20_000 });
  assert.deepEqual(selectRefreshPolicy(false), { attendanceQuota: false, throttleMs: 2_000 });
  assert.deepEqual(selectRefreshPolicy(true, "off"), { attendanceQuota: false, throttleMs: 20_000 });
  assert.deepEqual(selectRefreshPolicy(false, "on"), { attendanceQuota: true, throttleMs: 2_000 });
  assert.equal(selectRefreshPolicy(true, "invalid"), REFRESH_POLICIES.proxy);
});
