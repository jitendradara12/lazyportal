import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeExp, isExpired, createStore, memoryAdapter } from "../src/session.js";

function jwt(exp) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ exp })}.sig`;
}

describe("session", () => {
  it("decodes exp, detects expiry with skew", () => {
    const t = jwt(1_000_000);
    assert.equal(decodeExp(t), 1_000_000);
    assert.equal(isExpired(t, { nowSec: 999_000 }), false);
    assert.equal(isExpired(t, { nowSec: 999_950, skewSec: 60 }), true);
  });

  it("opaque tokens never count as expired (server 401 decides)", () => {
    assert.equal(isExpired("opaque"), false);
  });

  it("store roundtrips and loadValid respects expiry", () => {
    const store = createStore(memoryAdapter());
    assert.equal(store.load(), null);
    store.save({ token: jwt(2_000_000), userid: "u1" });
    assert.equal(store.load().userid, "u1");
    assert.equal(store.loadValid({ nowSec: 1_000_000 }).userid, "u1");
    assert.equal(store.loadValid({ nowSec: 3_000_000 }), null);
    store.clear();
    assert.equal(store.load(), null);
  });
});
