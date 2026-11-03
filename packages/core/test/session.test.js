import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeExp, isExpired, createStore, memoryAdapter, browserLocalAdapter, markSessionExpired, consumeSessionExpired } from "../src/session.js";

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

  it("load returns an isolated copy so external mutations do not corrupt cache", () => {
    const store = createStore(memoryAdapter());
    const original = { token: jwt(2_000_000), userid: "u1" };
    store.save(original);
    original.userid = "mutated-after-save";
    const s1 = store.load();
    assert.equal(s1.userid, "u1");
    s1.userid = "mutated-after-load";
    const s2 = store.load();
    assert.equal(s2.userid, "u1");
  });

  it("full browser storage keeps login and renewed tokens usable in the current tab", (t) => {
    const values = new Map([["unrelated", "keep"]]);
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    const previous = globalThis.localStorage;
    globalThis.localStorage = storage;
    t.after(() => { globalThis.localStorage = previous; });
    const store = createStore(browserLocalAdapter());
    const write = t.mock.method(storage, "setItem", () => { throw new Error("QuotaExceededError"); });
    store.save({ token: "login" });
    assert.equal(store.load()?.token, "login");

    write.mock.restore();
    store.save({ token: "persisted" });
    const failedWrite = t.mock.method(storage, "setItem", () => { throw new Error("QuotaExceededError"); });
    store.save({ token: "renewed" });
    assert.equal(store.load()?.token, "renewed");
    assert.equal(JSON.parse(values.get("juet.portal.session.v1")).token, "persisted");

    const failedRemove = t.mock.method(storage, "removeItem", () => { throw new Error("SecurityError"); });
    store.clear();
    assert.equal(store.load(), null);
    assert.equal(values.get("unrelated"), "keep");

    failedWrite.mock.restore();
    failedRemove.mock.restore();
    store.save({ token: "persisted-again" });
    assert.equal(JSON.parse(values.get("juet.portal.session.v1")).token, "persisted-again");
    values.set("juet.portal.session.v1", JSON.stringify({ token: "another-tab" }));
    assert.equal(store.load()?.token, "another-tab");
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
