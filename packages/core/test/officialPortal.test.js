import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { prepareOfficialPortal, officialPortalPolicy } from "../src/officialPortal.js";
import { decrypt } from "../src/crypto.js";

const NOW = new Date("2026-10-24T06:00:00Z");
const SESSION = {
  token: "test-token", userid: "student-1", username: "TEST", instituteid: "institute-1",
  membertype: "S", clientid: "client-1", companyid: "company-1", bypassValue: "raw-bypass",
  name: "Student </script><script>bad()</script>", password: "never-share-password", extra: "never-share-extra",
};
const storage = () => {
  const values = new Map([["previous-account", "must-be-cleared"]]);
  return { values, clear: () => values.clear(), setItem: (k, v) => values.set(k, String(v)), getItem: (k) => values.get(k) ?? null };
};

async function runtime({ answer, staticFetch } = {}) {
  const calls = [], staticCalls = [];
  const location = new URL(officialPortalPolicy.origin + officialPortalPolicy.entry);
  const localStorage = storage(), sessionStorage = storage();
  const events = new EventTarget();
  const native = { postMessage(raw) {
    const message = JSON.parse(raw); calls.push(message);
    if (message.id && answer) queueMicrotask(() => {
      const result = answer(message);
      if (result) native.onmessage({ data: JSON.stringify({ id: message.id, status: 200, headers: { "content-type": "application/json" },
        body: btoa(JSON.stringify(result.body ?? { response: { ok: true } })), ...result }) });
    });
  } };
  class BrowserRequest extends Request {
    constructor(input, init) { super(typeof input === "string" ? new URL(input, location).href : input, init); }
  }
  class ProgressEvent extends Event {}
  const sandbox = {
    location, localStorage, sessionStorage, crypto: globalThis.crypto,
    Storage: class Storage {},
    URL, Uint32Array, Uint8Array, TextEncoder, TextDecoder, Headers, Request: BrowserRequest, Response,
    Blob, EventTarget, Event, ProgressEvent, DOMException, AbortController, atob, btoa, setTimeout, clearTimeout,
    navigator: {}, OfficialPortalNative: native,
    addEventListener: events.addEventListener.bind(events),
    fetch: async (input) => { staticCalls.push(input.url); return staticFetch ? staticFetch(input) : new Response("static file"); },
  };
  sandbox.window = sandbox;
  const prepared = await prepareOfficialPortal(SESSION, { now: NOW });
  // The APK injects its own storage prelude before even older live bootstraps.
  const isolation = await readFile(new URL("../../../android/app/src/main/assets/official-portal-storage.js", import.meta.url), "utf8");
  vm.runInNewContext(isolation, sandbox);
  vm.runInNewContext(prepared.bootstrap, sandbox);
  return { sandbox, calls, staticCalls, localStorage: sandbox.localStorage, sessionStorage: sandbox.sessionStorage,
    diskLocalStorage: localStorage, diskSessionStorage: sessionStorage, prepared, events, native };
}

test("APK storage prelude removes legacy credentials and keeps all portal writes off disk", async () => {
  const { sandbox, localStorage, sessionStorage, diskLocalStorage, diskSessionStorage } = await runtime();
  for (const disk of [diskLocalStorage, diskSessionStorage]) assert.equal(disk.values.size, 0);
  localStorage.setItem("Token", "refreshed-token");
  localStorage.updated = 123;
  assert.equal(localStorage.updated, "123");
  assert.equal(localStorage.getItem("updated"), "123");
  assert.ok(Object.keys(localStorage).includes("updated"));
  assert.equal(localStorage.key(localStorage.length - 1), "updated");
  delete localStorage.updated;
  assert.equal(localStorage.getItem("updated"), null);
  assert.equal(localStorage.updated, undefined);
  assert.equal(sessionStorage.getItem("Token"), SESSION.token, "the two stores are independent");
  assert.ok(localStorage instanceof sandbox.Storage);
  assert.deepEqual(Object.getOwnPropertyNames(sandbox.Storage.prototype), ["constructor"], "never patch the shared Storage prototype");
  assert.throws(() => { sandbox.localStorage = diskLocalStorage; }, TypeError);
  for (const disk of [diskLocalStorage, diskSessionStorage]) assert.equal(disk.values.size, 0, "refresh/named writes must stay in memory");
  localStorage.clear();
  assert.equal(localStorage.length, 0);
});

test("handoff seeds exact official keys, encrypts bypass, excludes credentials, and escapes HTML", async () => {
  const { localStorage, sessionStorage, prepared } = await runtime();
  assert.equal(prepared.version, 1);
  assert.ok(!prepared.bootstrap.includes("</script"));
  assert.ok(!prepared.bootstrap.includes(SESSION.password));
  assert.ok(!prepared.bootstrap.includes(SESSION.extra));
  for (const store of [localStorage, sessionStorage]) {
    assert.equal(store.getItem("Token"), SESSION.token);
    assert.equal(store.getItem("Username"), SESSION.username);
    assert.equal(store.getItem("userid"), SESSION.userid);
    assert.equal(store.getItem("instituteid"), SESSION.instituteid);
    assert.equal(store.getItem("name"), SESSION.name);
    assert.equal(store.getItem("previous-account"), null);
    assert.equal(await decrypt(store.getItem("bypassValue"), { now: NOW }), "raw-bypass");
    assert.equal(store.getItem("Today_DATE"), String(NOW.getTime()));
  }
});

test("incomplete sessions cannot launch; a missing native bridge fails closed", async () => {
  for (const key of ["token", "userid", "instituteid"]) {
    await assert.rejects(prepareOfficialPortal({ ...SESSION, [key]: "" }), /Reconnect/);
  }
  const { bootstrap } = await prepareOfficialPortal(SESSION, { now: NOW });
  assert.throws(() => vm.runInNewContext(bootstrap, { window: {} }), /transport unavailable/);
});

test("fetch sends exact encrypted body and headers to native, never Vercel", async () => {
  const { sandbox, calls, staticCalls } = await runtime({ answer: () => ({}) });
  const response = await sandbox.fetch(officialPortalPolicy.upstream + "/StudentPortalAPI/studentgradecard/showstudentgradecard", {
    method: "POST", headers: { Authorization: "Bearer test-token", LocalName: "encrypted-local-name" }, body: "opaque-ciphertext",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { response: { ok: true } });
  assert.equal(calls[0].path, "/studentgradecard/showstudentgradecard");
  assert.equal(calls[0].headers.authorization, "Bearer test-token");
  assert.equal(calls[0].headers.localname, "encrypted-local-name");
  assert.equal(calls[0].body, "opaque-ciphertext");
  assert.deepEqual(staticCalls, []);
});

test("payments, writes, unknown reads, foreign URLs and method bypasses never open the network", async () => {
  const { sandbox, calls, staticCalls } = await runtime({ answer: () => ({}) });
  for (const [url, method] of [
    ["/StudentPortalAPI/onlinefeepayment/paynow", "POST"],
    ["/StudentPortalAPI/studentinformation/savemedicalinfobystudent", "POST"],
    ["/StudentPortalAPI/future/getSomething", "POST"],
    ["/StudentPortalAPI/studentgradecard/showstudentgradecard", "DELETE"],
    ["/StudentPortalAPI/studentgradecard/showstudentgradecard", "GET"],
  ]) assert.equal((await sandbox.fetch(url, { method })).status, 403);
  for (const url of ["https://lazyportal-tan.vercel.app/api/studentgradecard/showstudentgradecard", "https://studentportal.juet.ac.in.evil.test/StudentPortalAPI/clxuser/getmenulist"]) {
    await assert.rejects(sandbox.fetch(url, { method: "POST" }), /Only official/);
  }
  assert.equal(calls.filter((call) => call.id).length, 0);
  assert.deepEqual(staticCalls, []);
  assert.equal(sandbox.navigator.sendBeacon("https://lazyportal-tan.vercel.app/api/x", "body"), false);
  assert.equal(sandbox.open("https://payments.test"), null);
});

test("aborting fetch cancels native work and ignores late replies", async () => {
  const { sandbox, calls, native } = await runtime();
  const abort = new AbortController();
  const response = sandbox.fetch("/StudentPortalAPI/clxuser/getmenulist", { method: "POST", body: "cipher", signal: abort.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const sent = calls.find((call) => call.id);
  abort.abort();
  await assert.rejects(response, { name: "AbortError" });
  assert.ok(calls.some((call) => call.cancel === sent.id));
  assert.doesNotThrow(() => native.onmessage({ data: JSON.stringify({ id: sent.id, status: 200, body: btoa("{}") }) }));
});

test("official logout closes only the isolated view", async () => {
  const { sandbox, events, calls } = await runtime();
  sandbox.location.hash = "#/";
  events.dispatchEvent(new Event("hashchange"));
  assert.deepEqual(calls, [{ event: "close" }]);
});

test("XHR preserves Angular's load/status/header contract and readonly actions get a local 403", async () => {
  const { sandbox, calls, staticCalls } = await runtime({ answer: () => ({ body: btoa('{"rows":[1]}') }) });
  const xhr = new sandbox.XMLHttpRequest();
  const states = [], events = [];
  xhr.addEventListener("readystatechange", () => states.push(xhr.readyState));
  const loaded = new Promise((resolve) => xhr.addEventListener("loadend", resolve));
  xhr.onload = () => events.push("load");
  xhr.open("POST", "/StudentPortalAPI/studentgradecard/showstudentgradecard");
  xhr.setRequestHeader("LocalName", "opaque");
  xhr.send("encrypted-body");
  await loaded;
  assert.equal(xhr.status, 200);
  assert.equal(xhr.responseText, '{"rows":[1]}');
  assert.equal(xhr.response, xhr.responseText);
  assert.equal(xhr.getResponseHeader("content-type"), "application/json");
  assert.deepEqual(states, [1, 2, 3, 4]);
  assert.deepEqual(events, ["load"]);
  assert.equal(calls[0].body, "encrypted-body");
  const denied = new sandbox.XMLHttpRequest();
  const error = new Promise((resolve) => denied.addEventListener("load", resolve));
  denied.open("POST", "/StudentPortalAPI/onlinefeepayment/paynow"); denied.send("body");
  await error;
  assert.equal(denied.status, 403);
  assert.match(JSON.parse(denied.responseText).status.errors[0], /Read-only/);
  assert.equal(calls.filter((call) => call.id).length, 1);
  assert.deepEqual(staticCalls, []);
});

test("XHR abort and timeout finish once and cancel native requests", async () => {
  for (const kind of ["abort", "timeout"]) {
    const { sandbox, calls } = await runtime();
    const xhr = new sandbox.XMLHttpRequest();
    const events = [];
    for (const name of ["load", "error", "abort", "timeout", "loadend"]) xhr.addEventListener(name, () => events.push(name));
    const done = new Promise((resolve) => xhr.addEventListener("loadend", resolve));
    xhr.open("POST", "/StudentPortalAPI/clxuser/getmenulist");
    if (kind === "timeout") xhr.timeout = 10;
    xhr.send("body");
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (kind === "abort") xhr.abort();
    await done;
    assert.deepEqual(events, [kind, "loadend"]);
    assert.ok(calls.some((call) => call.cancel));
  }
});

test("menus retain read pages and hide write/payment routes; failed native refresh signals reconnect", async () => {
  const menu = { response: [{ title: "Student", children: [
    { title: "Attendance", url: "/student/myclassattendance" },
    { title: "Pay", url: "/student/onlinefeepayments" },
    { title: "Password", url: "/student/changepassword" },
  ] }] };
  const { sandbox, calls } = await runtime({ answer: (request) => ({ body: btoa(JSON.stringify(request.path.includes("refresh") ? { response: { msg: "Failure" } } : menu)) }) });
  const result = await (await sandbox.fetch("/StudentPortalAPI/clxuser/getmenulist", { method: "POST" })).json();
  assert.deepEqual(result.response[0].children.map((item) => item.title), ["Attendance"]);
  await sandbox.fetch("/StudentPortalAPI/token/refreshTokenRequest", { method: "POST" });
  assert.ok(calls.some((call) => call.event === "expired"));
});

test("APK policy matches core and no official-portal serverless route is introduced", async () => {
  const generated = JSON.parse(await readFile(new URL("../../../android/app/src/main/assets/official-portal-policy.json", import.meta.url), "utf8"));
  assert.deepEqual(generated, officialPortalPolicy);
  const deployment = JSON.parse(await readFile(new URL("../../../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(deployment.rewrites, [{ source: "/api/:path*", destination: "/api/proxy?path=:path*" }]);
  assert.deepEqual(Object.keys(deployment.functions), ["api/proxy.js"]);
});

test("the supplemental certificate is the published intermediate, not a new root or leaf pin", async () => {
  const pem = await readFile(new URL("../../../android/app/src/main/assets/official-portal-intermediate.pem", import.meta.url));
  const intermediate = new X509Certificate(pem);
  assert.equal(intermediate.ca, true);
  assert.equal(intermediate.fingerprint256, "97:3A:41:27:6F:FD:01:E0:27:A2:AA:D4:9E:34:C3:78:46:D3:E9:76:FF:6A:62:0B:67:12:E3:38:32:04:1A:A6");
  assert.notEqual(intermediate.subject, intermediate.issuer);
  const leaf = new X509Certificate(await readFile(new URL("../../../android/app/src/test/resources/portal-leaf-test.pem", import.meta.url)));
  assert.equal(leaf.verify(intermediate.publicKey), true);
});
