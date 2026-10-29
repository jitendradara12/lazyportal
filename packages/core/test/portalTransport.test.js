import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPortalTransport, portalApiPolicy } from "../src/portalTransport.js";
import { featurePostEndpoints, marksReportEndpoints } from "../src/features.js";
import { officialPortalPolicy } from "../src/officialPortal.js";
import { createClient } from "../src/client.js";
import { fetchCaptcha, login, refreshSession } from "../src/auth.js";
import { decrypt } from "../src/crypto.js";

const baseUrl = "https://app.test/api";
const path = "/StudentClassAttendance/getstudentattendancedetail";
const now = () => new Date("2026-10-24T06:00:00Z");
const reply = (body, status = 200) => ({ status, body: Buffer.from(JSON.stringify(body)).toString("base64"),
  headers: { "content-type": "application/json" } });
function setup(options = {}) {
  const requests = [], proxies = [], cancellations = [];
  let capabilities = 0;
  const native = {
    capabilities: async () => { capabilities++; return options.policy ?? portalApiPolicy; },
    request: async (request) => { requests.push(request); return options.answer?.(request) ?? reply({ response: { name: "विद्यार्थी" } }); },
    cancel: async (request) => { cancellations.push(request); },
  };
  const fetchImpl = async (...args) => { proxies.push(args); return new Response('{"response":{"proxy":true}}'); };
  return { native, requests, proxies, cancellations, fetchImpl, capabilities: () => capabilities,
    fetch: createPortalTransport({ baseUrl, native, fetchImpl }).fetch };
}

test("APK API policy matches core, covers existing reads/auth, and keeps official login blocked", async () => {
  const generated = JSON.parse(await readFile(new URL("../../../android/app/src/main/assets/portal-api-policy.json", import.meta.url), "utf8"));
  assert.deepEqual(generated, portalApiPolicy);
  const features = await readFile(new URL("../src/features.js", import.meta.url), "utf8");
  for (const [, endpoint] of features.matchAll(/"(\/[A-Za-z][A-Za-z0-9_/-]+)"/g)) {
    assert.ok(portalApiPolicy.post.includes(endpoint) || Object.values(marksReportEndpoints).includes(endpoint), `missing reviewed read ${endpoint}`);
  }
  for (const endpoint of ["/token/pretoken-check", "/token/generatewebtoken"]) {
    assert.ok(portalApiPolicy.post.includes(endpoint));
    assert.ok(!officialPortalPolicy.post.includes(endpoint));
  }
  assert.ok(portalApiPolicy.get.includes("/token/getcaptcha"));
});

test("browsers and old APKs retain the original fetch", () => {
  const fetchImpl = () => {};
  assert.equal(createPortalTransport({ baseUrl, fetchImpl }).fetch, fetchImpl);
});

test("reviewed marks reports use the proxy on existing APKs and reject unrelated report routes", async () => {
  const s = setup();
  const transport = createPortalTransport({ baseUrl, native: s.native, fetchImpl: s.fetchImpl });
  assert.equal(await transport.usesProxyFor("GET", Object.values(marksReportEndpoints)), true);
  await transport.fetch(baseUrl + "/studentsexamview/printstudent-exammarks/i1/sem1/2026ODDSEM");
  assert.equal(s.requests.length, 0);
  assert.equal(s.proxies.length, 1);
  await assert.rejects(transport.fetch(baseUrl + "/studentsexamview/printstudent-exammarks/i1/sem1/2026ODDSEM/extra"), { code: "UNSUPPORTED_ENDPOINT" });
});

test("policy queries share the actual routing decision, including mixed APK capabilities and forced proxy", async () => {
  const missing = featurePostEndpoints.attendance.current;
  const s = setup({ policy: { ...portalApiPolicy, post: portalApiPolicy.post.filter((path) => path !== missing) } });
  const transport = createPortalTransport({ baseUrl, native: s.native, fetchImpl: s.fetchImpl });
  assert.equal(await transport.usesProxyFor("POST", Object.values(featurePostEndpoints.attendance)), true);
  assert.equal(await transport.usesProxyFor("POST", Object.values(featurePostEndpoints.marks)), false);
  await transport.fetch(baseUrl + missing, { method: "POST" });
  await transport.fetch(baseUrl + featurePostEndpoints.marks.rows, { method: "POST" });
  assert.equal(s.proxies.length, 1);
  assert.equal(s.requests.length, 1);
  assert.equal(s.capabilities(), 1);
  const forced = createPortalTransport({ baseUrl, native: s.native, fetchImpl: s.fetchImpl, mode: "proxy" });
  assert.equal(forced.fetch, s.fetchImpl);
  assert.equal(await forced.usesProxyFor("POST", Object.values(featurePostEndpoints.marks)), true);
  const browser = createPortalTransport({ baseUrl, fetchImpl: s.fetchImpl });
  assert.equal(await browser.usesProxyFor("POST", Object.values(featurePostEndpoints.attendance)), true);
  const unsupported = createPortalTransport({ baseUrl, native: { capabilities: async () => ({ ...portalApiPolicy, version: 0 }) } });
  assert.equal(await unsupported.usesProxyFor("POST", Object.values(featurePostEndpoints.marks)), true);
});

test("failed or malformed capability discovery selects proxy before dispatch and stays consistent with policy", async () => {
  for (const capabilities of [
    () => Promise.reject(Object.assign(new Error("Unavailable"), { code: "UNAVAILABLE" })),
    () => { throw new Error("Older bridge"); },
    () => null,
    () => ({ version: 1, post: {}, get: [] }),
    () => ({ version: 1, post: [], get: [null] }),
  ]) {
    const s = setup();
    let probes = 0;
    s.native.capabilities = () => { probes++; return capabilities(); };
    const transport = createPortalTransport({ baseUrl, native: s.native, fetchImpl: s.fetchImpl });
    assert.equal(await transport.usesProxyFor("POST", Object.values(featurePostEndpoints.attendance)), true);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await transport.fetch(baseUrl + "/token/getcaptcha")).status, 200);
    }
    assert.equal(probes, 1);
    assert.equal(s.requests.length, 0);
    assert.equal(s.proxies.length, 2);
  }
});

test("native transport preserves opaque encrypted bytes/headers, Unicode responses and HTTP status", async () => {
  const s = setup();
  const client = createClient({ baseUrl, fetchImpl: s.fetch, getToken: () => "token", now });
  const body = await client.post(path, { instituteid: "i1" });
  assert.equal(body.response.name, "विद्यार्थी");
  assert.deepEqual(JSON.parse(await decrypt(s.requests[0].body, { now: now() })), { instituteid: "i1" });
  assert.equal(s.requests[0].headers.authorization, "Bearer token");
  assert.equal(s.requests[0].headers["content-type"], "application/json");
  assert.ok(s.requests[0].headers.localname);
  assert.equal(s.requests[0].path, path);
  await client.getPublic("/token/getcaptcha");
  assert.equal(s.capabilities(), 1);
  assert.equal(s.requests[1].body, "");
  assert.deepEqual(s.requests[1].headers, { accept: "application/json" });
  assert.equal(s.proxies.length, 0);
  const empty = setup({ answer: () => reply(null, 204) });
  assert.equal((await empty.fetch(baseUrl + path, { method: "POST" })).status, 204);
});

test("login, captcha and concurrent session recovery use native networking", async () => {
  let token = "expired";
  let refreshes = 0;
  const s = setup({ answer: (request) => {
    if (request.path === "/token/getcaptcha") return reply({ response: { captcha: { hidden: "hidden", image: "png" } } });
    if (request.path === "/token/pretoken-check") return reply({ response: { random: "random", otppwd: "otp" } });
    if (request.path === "/token/generatewebtoken") return reply({ response: { regdata: { token: "fresh", username: "TEST" } } });
    if (request.path === "/token/refreshTokenRequest") { refreshes++; return reply({ response: { msg: "Success", token: "renewed" } }); }
    return request.headers.authorization === "Bearer expired"
      ? reply({ message: "expired" }, 401) : reply({ response: { ok: true } });
  } });
  const client = createClient({ baseUrl, fetchImpl: s.fetch, getToken: () => token, now,
    onRefresh: async (signal) => {
      const result = await refreshSession(client, { username: "TEST", tokendate: "today" }, { signal });
      token = result.token;
      return result.ok;
    } });
  const captcha = await fetchCaptcha(client);
  const session = await login(client, { username: "test", password: "secret", captchaText: "ABCDE", captcha });
  assert.equal(session.token, "fresh");
  assert.ok(!s.requests[2].body.includes("secret"));
  const results = await Promise.all([client.post(path, {}), client.post(path, {})]);
  assert.ok(results.every((body) => body.response.ok));
  assert.equal(refreshes, 1);
  assert.deepEqual(JSON.parse(s.requests.find((request) => request.path.endsWith("refreshTokenRequest")).body),
    { username: "TEST", tokendate: "today" });
  assert.equal(s.proxies.length, 0);
});

test("only unsupported installed capabilities choose proxy before a native request", async () => {
  for (const policy of [{ ...portalApiPolicy, post: [] }, { ...portalApiPolicy, version: 0 }]) {
    const s = setup({ policy });
    const init = { method: "POST", body: "unchanged", headers: { Authorization: "Bearer t" } };
    await s.fetch(baseUrl + path, init);
    assert.deepEqual(s.proxies, [[baseUrl + path, init]]);
    assert.equal(s.requests.length, 0);
  }
  for (const answer of [() => { throw new Error("offline"); }, () => reply({ response: {} }, 500)]) {
    const s = setup({ answer });
    await s.fetch(baseUrl + path, { method: "POST" }).catch(() => {});
    assert.equal(s.proxies.length, 0, "never retry a sent native request through Vercel");
  }
});

test("unreviewed endpoints, URL escapes, writes and payments never use either transport", async () => {
  const s = setup();
  for (const [url, method] of [
    [baseUrl + "/onlinefeepayment/paynow", "POST"], [baseUrl + "/future/getSomething", "POST"],
    [baseUrl + path + "?x=1", "POST"], [baseUrl + path, "PUT"],
    [baseUrl + "/../token/getcaptcha", "GET"], ["https://evil.test/api" + path, "POST"],
  ]) await assert.rejects(s.fetch(url, { method }), { code: "UNSUPPORTED_ENDPOINT" });
  assert.equal(s.requests.length + s.proxies.length + s.capabilities(), 0);
});

test("abort before dispatch and while waiting on capabilities never sends a request", async () => {
  const s = setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(s.fetch(baseUrl + path, { method: "POST", signal: controller.signal }), { name: "AbortError" });
  const waiting = new AbortController();
  let release;
  s.native.capabilities = () => new Promise((resolve) => { release = resolve; });
  const pending = s.fetch(baseUrl + path, { method: "POST", signal: waiting.signal });
  await Promise.resolve();
  waiting.abort();
  await assert.rejects(pending, { name: "AbortError" });
  release(portalApiPolicy);
  await Promise.resolve();
  assert.equal(s.requests.length + s.proxies.length + s.cancellations.length, 0);
});

test("in-flight abort cancels exactly its native ID and ignores late responses", async () => {
  let release, started;
  const dispatched = new Promise((resolve) => { started = resolve; });
  const s = setup({ answer: () => new Promise((resolve) => { release = resolve; started(); }) });
  const controller = new AbortController();
  const pending = s.fetch(baseUrl + path, { method: "POST", signal: controller.signal });
  await dispatched;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(s.cancellations, [{ id: s.requests[0].id }]);
  release(reply({ late: true }));
  await Promise.resolve();
  assert.equal(s.proxies.length, 0);
});

test("stalled native capability discovery falls back once before sending any portal request", async () => {
  let finishCapabilities, discoveries = 0, proxyCalls = 0;
  const transport = createPortalTransport({ baseUrl, capabilityTimeoutMs: 5,
    native: {
      capabilities() { discoveries++; return new Promise((resolve) => { finishCapabilities = resolve; }); },
      request() { throw new Error("Stale capabilities must not change the chosen route"); },
    },
    fetchImpl: async () => { proxyCalls++; return new Response("{}"); },
  });
  const paths = Object.values(featurePostEndpoints.attendance);
  const routed = await Promise.race([
    transport.usesProxyFor("POST", paths),
    new Promise((resolve) => setTimeout(() => resolve("hung"), 50)),
  ]);
  assert.equal(routed, true);
  assert.equal(proxyCalls, 0);
  finishCapabilities({ version: 1, post: paths, get: [] });
  await transport.fetch(`${baseUrl}${paths[0]}`, { method: "POST" });
  assert.equal(discoveries, 1);
  assert.equal(proxyCalls, 1);
});

test("native attendance failure does not start a second wait through the proxy", async () => {
  const detailPath = featurePostEndpoints.attendance.current;
  const error = Object.assign(new Error("Could not reach JUET's portal. Please retry."), { code: "NETWORK_ERROR" });
  const s = setup({ answer: () => Promise.reject(error) });
  await assert.rejects(s.fetch(baseUrl + detailPath, { method: "POST" }), err => err === error);
  assert.equal(s.requests.length, 1);
  assert.equal(s.proxies.length, 0);
});

test("native network failure on non-attendance endpoints does not fall back to proxy", async () => {
  const marksPath = featurePostEndpoints.marks.rows;
  const error = Object.assign(new Error("Could not reach JUET's portal. Please retry."), { code: "NETWORK_ERROR" });
  const s = setup({ answer: () => Promise.reject(error) });
  await assert.rejects(s.fetch(baseUrl + marksPath, { method: "POST" }), (err) => err === error);
  assert.equal(s.requests.length, 1);
  assert.equal(s.proxies.length, 0);
});

test("native overview failure also leaves retry to the user", async () => {
  const overviewPath = featurePostEndpoints.attendance.overview;
  const error = Object.assign(new Error("Could not reach JUET's portal. Please retry."), { code: "NETWORK_ERROR" });
  const s = setup({ answer: () => Promise.reject(error) });
  await assert.rejects(s.fetch(baseUrl + overviewPath, { method: "POST" }), err => err === error);
  assert.equal(s.requests.length, 1);
  assert.equal(s.proxies.length, 0);
});

test("older APKs without high read timeout route attendance breakdown directly to proxy and overview natively", async () => {
  const olderPolicy = { ...portalApiPolicy, timeoutMs: 20_000 };
  const s = setup({ policy: olderPolicy });
  const resDetail = await s.fetch(baseUrl + featurePostEndpoints.attendance.current, { method: "POST" });
  assert.equal(resDetail.status, 200);
  assert.equal(s.requests.length, 0, "native was bypassed to avoid 20s wasted wait");
  assert.equal(s.proxies.length, 1, "routed directly to proxy");
  const resOverview = await s.fetch(baseUrl + featurePostEndpoints.attendance.overview, { method: "POST" });
  assert.equal(resOverview.status, 200);
  assert.equal(s.requests.length, 1, "overview runs natively");
});

test("released APKs without timeout metadata bypass their 20s native timeout before dispatch", async () => {
  const { timeoutMs, ...olderPolicy } = portalApiPolicy;
  const s = setup({ policy: olderPolicy });
  const res = await s.fetch(baseUrl + featurePostEndpoints.attendance.current, { method: "POST" });
  assert.equal(s.requests.length, 0);
  assert.equal(s.proxies.length, 1);
  assert.equal(res.status, 200);
});



