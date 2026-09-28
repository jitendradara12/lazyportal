import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeExp, isExpired, createStore, memoryAdapter, markSessionExpired, consumeSessionExpired } from "../src/session.js";

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

  it("expiry flag is one-shot", () => {
    const map = new Map();
    const fake = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    };
    const prev = globalThis.localStorage;
    globalThis.localStorage = fake;
    try {
      assert.equal(consumeSessionExpired(), false);
      markSessionExpired();
      assert.equal(consumeSessionExpired(), true);
      assert.equal(consumeSessionExpired(), false);
    } finally {
      globalThis.localStorage = prev;
    }
  });
});
