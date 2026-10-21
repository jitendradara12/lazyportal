import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/credentials.js";

const account = { username: "test-student", usertype: "S" };
const PASSWORD_KEY = "juet.portal.credentials.v1";
const LEGACY_KEY = "juet.portal.saved_pw";
function fixture() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  let key;
  const keys = {
    load: async () => key,
    getOrCreate: async (candidate) => (key ??= structuredClone(candidate)),
  };
  const options = { storage: () => storage, keys };
  return { values, storage, keys, options, store: createStore(options) };
}
function seedLegacy(f) {
  f.values.set(LEGACY_KEY, "legacy-secret");
  f.values.set("juet.portal.last_user", account.username);
  f.values.set("juet.portal.last_usertype", account.usertype);
}

test("saved password survives a new store without plaintext or an exportable key", async () => {
  const f = fixture();
  assert.equal(await f.store.save("秘密🔒-password", account), true);
  const record = JSON.parse(f.values.get(PASSWORD_KEY));
  assert.equal(record.version, 1);
  assert.equal(Buffer.from(record.iv, "base64").length, 12);
  assert.ok(!JSON.stringify([...f.values]).includes("秘密🔒-password"));
  const key = await f.keys.load();
  assert.equal(key.extractable, false);
  await assert.rejects(globalThis.crypto.subtle.exportKey("raw", key));
  assert.equal(await createStore(f.options).load(account), "秘密🔒-password");
});

test("every save gets a fresh nonce and ciphertext", async () => {
  const f = fixture();
  await f.store.save("same-password", account);
  const first = JSON.parse(f.values.get(PASSWORD_KEY));
  await f.store.save("same-password", account);
  const next = JSON.parse(f.values.get(PASSWORD_KEY));
  assert.notEqual(first.iv, next.iv);
  assert.notEqual(first.data, next.data);
});

test("legacy migration deletes plaintext immediately and preserves remembered login", async () => {
  const f = fixture();
  seedLegacy(f);
  const pending = f.store.migrate();
  assert.equal(f.values.has(LEGACY_KEY), false);
  assert.equal(f.store.has(account), true);
  await pending;
  assert.equal(await createStore(f.options).load(account), "legacy-secret");
  assert.equal(f.values.has(LEGACY_KEY), false);
});

test("load also migrates legacy passwords and normalizes student/parent identities", async () => {
  const f = fixture();
  seedLegacy(f);
  assert.equal(await f.store.load({ ...account, username: " TEST-STUDENT " }), "legacy-secret");
  await f.store.save("parent-secret", { username: "24b001", usertype: "P" });
  assert.equal(await f.store.load({ username: "P24B001", usertype: "P" }), "parent-secret");
  assert.equal(await f.store.load({ username: "24b001", usertype: "S" }), "");
  assert.equal(f.store.has(account), false);
});

test("tampered ciphertext, nonce, or account metadata cannot decrypt", async () => {
  for (const field of ["data", "iv", "username"]) {
    const f = fixture();
    await f.store.save("secret", account);
    const record = JSON.parse(f.values.get(PASSWORD_KEY));
    record[field] = field === "username" ? "OTHER-USER" : `${record[field][0] === "A" ? "B" : "A"}${record[field].slice(1)}`;
    f.values.set(PASSWORD_KEY, JSON.stringify(record));
    assert.equal(await f.store.load(field === "username" ? { ...account, username: "OTHER-USER" } : account), "");
  }
});

test("missing keys and malformed records return no password without throwing", async () => {
  const f = fixture();
  await f.store.save("secret", account);
  f.keys.load = async () => null;
  assert.equal(await createStore(f.options).load(account), "");
  f.values.set(PASSWORD_KEY, "invalid-json");
  assert.equal(f.store.has(account), false);
  assert.equal(await f.store.load(account), "");
});

test("blocked IndexedDB retains an encrypted tab-only copy, never plaintext storage", async () => {
  const f = fixture();
  f.keys.getOrCreate = async () => { throw new Error("Blocked"); };
  assert.equal(await f.store.save("secret", account), true);
  assert.equal(f.values.has(PASSWORD_KEY), false);
  assert.equal(f.values.has(LEGACY_KEY), false);
  assert.equal(await f.store.load(account), "secret");
  f.store.clear();
  assert.equal(await f.store.load(account), "");
});

test("blocked localStorage retains remembered login in the current tab", async () => {
  const f = fixture();
  const store = createStore({ ...f.options, storage() { throw new Error("Blocked"); } });
  assert.equal(await store.save("secret", account), true);
  assert.equal(await store.load(account), "secret");
  assert.equal(store.has(account), true);
  store.clear();
  assert.equal(store.has(account), false);
});

test("unavailable crypto never falls back to saving plaintext", async () => {
  const f = fixture();
  seedLegacy(f);
  const store = createStore({ ...f.options, crypto: () => undefined });
  await store.migrate();
  assert.equal(f.values.has(LEGACY_KEY), false);
  assert.equal(await store.save("secret", account), false);
  assert.equal(await store.load(account), "");
});

test("clear cancels in-flight migration and saves", async () => {
  for (const migrate of [false, true]) {
    const f = fixture();
    if (migrate) seedLegacy(f);
    const pending = migrate ? f.store.migrate() : f.store.save("secret", account);
    f.store.clear();
    await pending;
    assert.equal(f.values.has(LEGACY_KEY), false);
    assert.equal(f.values.has(PASSWORD_KEY), false);
    assert.equal(await f.store.load(account), "");
  }
});

test("clear invalidates a decryption already waiting for its key", async () => {
  const f = fixture();
  await f.store.save("secret", account);
  const key = await f.keys.load();
  let resume, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  f.keys.load = () => new Promise((resolve) => { resume = resolve; started(); });
  const pending = f.store.load(account);
  await waiting;
  f.store.clear();
  resume(key);
  assert.equal(await pending, "");
});

test("latest save wins even if an earlier encryption finishes later", async () => {
  const f = fixture();
  let resume, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const original = f.keys.getOrCreate;
  let calls = 0;
  f.keys.getOrCreate = async (candidate) => {
    const key = await original(candidate);
    if (++calls === 1) await new Promise((resolve) => { resume = resolve; started(); });
    return key;
  };
  const oldSave = f.store.save("old-secret", account);
  await waiting;
  assert.equal(await f.store.save("new-secret", account), true);
  resume();
  assert.equal(await oldSave, false);
  assert.equal(await f.store.load(account), "new-secret");
});
