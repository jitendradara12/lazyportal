import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import officialPortalHandler from "../api/official-portal.js";
import {
  OFFICIAL_PORTAL_BRIDGE_KEY,
  OFFICIAL_PORTAL_PREFIX,
  buildOfficialPortalBridgePayload,
  injectOfficialPortalBootstrap,
  makeOfficialPortalBootstrapScript,
  rewriteOfficialPortalText,
} from "../shared/officialPortal.js";
import {
  buildOfficialPortalResponseHeaders,
  buildOfficialPortalTarget,
  isCacheableOfficialPortalAsset,
  isOfficialPortalHtmlContent,
  normalizeOfficialPortalResponse,
} from "../shared/officialPortalProxy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mockResponse() {
  const headers = {};
  return {
    headers,
    statusCode: null,
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    end(body) {
      this.body = body;
      this.ended = true;
    },
    send(body) {
      this.body = body;
      this.ended = true;
    },
  };
}

test("official portal paths stay under the fixed studentportal prefix", () => {
  const target = new URL(
    buildOfficialPortalTarget("assets/main.1234.js", {
      v: "42",
      lang: "en US",
    })
  );
  assert.equal(target.origin, "https://studentportal.juet.ac.in");
  assert.equal(target.pathname, "/studentportal/assets/main.1234.js");
  assert.equal(target.searchParams.get("v"), "42");
  assert.equal(target.searchParams.get("lang"), "en US");

  const root = new URL(buildOfficialPortalTarget(""));
  assert.equal(root.pathname, "/studentportal/");

  for (const path of [
    "../StudentPortalAPI/token/getcaptcha",
    "../../etc/passwd",
    "%2e%2e/studentportal",
    "assets/%2Fsecret.js",
    "/assets/main.js",
    "assets//main.js",
  ]) {
    assert.throws(() => buildOfficialPortalTarget(path), TypeError, `path: ${path}`);
  }
});

test("official portal text rewrites frontend and API URLs onto same-origin proxies", () => {
  const input = [
    'href="https://studentportal.juet.ac.in/studentportal/assets/main.js"',
    'src="/studentportal/assets/chunk.js"',
    'fetch("https://studentportal.juet.ac.in/StudentPortalAPI/token/getcaptcha")',
    'axios.post("/StudentPortalAPI/token/generatewebtoken")',
  ].join("\n");

  const output = rewriteOfficialPortalText(input);
  assert.match(output, /href="\/officialportal\/assets\/main\.js"/);
  assert.match(output, /src="\/officialportal\/assets\/chunk\.js"/);
  assert.match(output, /fetch\("\/api\/token\/getcaptcha"\)/);
  assert.match(output, /axios\.post\("\/api\/token\/generatewebtoken"\)/);
});

test("official portal bootstrap injects before app code and preserves the bridge key", () => {
  const html = "<html><head><title>x</title></head><body><app-root></app-root></body></html>";
  const injected = injectOfficialPortalBootstrap(html);
  assert.ok(injected.includes(OFFICIAL_PORTAL_BRIDGE_KEY));
  assert.ok(injected.includes("__lazyportalOfficialSession"));
  assert.ok(injected.indexOf("<script>") < injected.indexOf("<title>x</title>"));
});

test("official portal response normalization strips frame blockers and injects bootstrap", () => {
  const upstream = {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'",
      "x-frame-options": "DENY",
      location: "https://studentportal.juet.ac.in/studentportal/#/home",
    },
    body: Buffer.from("<html><head></head><body><script src=\"/studentportal/main.js\"></script></body></html>"),
  };

  const normalized = normalizeOfficialPortalResponse(upstream, { method: "GET" });
  const html = normalized.body.toString("utf8");
  assert.equal(normalized.headers["x-frame-options"], undefined);
  // Upstream framing policy is replaced, not just stripped: same-origin app
  // framing keeps working, arbitrary-site clickjacking does not.
  assert.equal(
    normalized.headers["content-security-policy"],
    "frame-ancestors 'self' https://localhost capacitor://localhost"
  );
  assert.equal(normalized.headers.location, `${OFFICIAL_PORTAL_PREFIX}/#/home`);
  assert.match(html, /<script>\(/);
  assert.match(html, /src="\/officialportal\/main\.js"/);
  // HTML shell carries the per-session bootstrap: never cache it.
  assert.match(normalized.headers["cache-control"] ?? "", /no-store/);
});

test("official portal leaves JS bundles byte-identical and cacheable at the edge", () => {
  const js = 'fetch("https://studentportal.juet.ac.in/StudentPortalAPI/token/x")';
  const upstream = {
    status: 200,
    headers: {
      "content-type": "application/javascript",
      "cache-control": "private, no-cache",
    },
    body: Buffer.from(js),
  };

  const normalized = normalizeOfficialPortalResponse(upstream, {
    method: "GET",
    target: "https://studentportal.juet.ac.in/studentportal/main.abc123.js",
  });
  // Zero server-side rewriting: the injected fetch/XHR patch rewires API URLs
  // at runtime. Any rewrite here is pure CPU/memory overhead per invocation.
  assert.equal(normalized.body.toString("utf8"), js);
  assert.ok(!normalized.body.toString("utf8").includes("<script>("));
  assert.match(normalized.headers["cache-control"] ?? "", /s-maxage=86400/);
  assert.match(normalized.headers["cdn-cache-control"] ?? "", /s-maxage=86400/);
});

test("official portal overrides upstream private cache directives on assets", () => {
  const headers = buildOfficialPortalResponseHeaders(
    { "content-type": "text/css", "cache-control": "private, no-cache", age: "42" },
    {
      target: "https://studentportal.juet.ac.in/studentportal/styles.abc123.css",
      contentType: "text/css",
      status: 200,
    }
  );
  assert.match(headers["cache-control"] ?? "", /s-maxage/);
  assert.equal(headers.age, undefined);
});

test("official portal never caches errors or upstream cookies", () => {
  const notFound = buildOfficialPortalResponseHeaders(
    { "content-type": "application/javascript" },
    {
      target: "https://studentportal.juet.ac.in/studentportal/main.abc123.js",
      contentType: "application/javascript",
      status: 404,
    }
  );
  assert.match(notFound["cache-control"] ?? "", /no-store/);

  const loginish = normalizeOfficialPortalResponse(
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": ["JSESSIONID=abc; Path=/; HttpOnly"],
      },
      body: Buffer.from("<html><head></head><body></body></html>"),
    },
    { method: "GET", target: "https://studentportal.juet.ac.in/studentportal/" }
  );
  assert.equal(loginish.headers["set-cookie"], undefined);
});

test("official portal asset cacheability follows file extension, not content sniffing", () => {
  for (const p of [
    "/studentportal/main.abc123.js",
    "/studentportal/styles.css",
    "/studentportal/assets/logo.png",
    "/studentportal/assets/font.woff2",
    "/studentportal/assets/data.json",
  ]) {
    assert.equal(isCacheableOfficialPortalAsset(p), true, p);
  }
  for (const p of ["/studentportal/", "/studentportal", "/studentportal/#/dashbord", ""]) {
    assert.equal(isCacheableOfficialPortalAsset(p), false, p);
  }
  assert.equal(isOfficialPortalHtmlContent("text/html; charset=utf-8"), true);
  assert.equal(isOfficialPortalHtmlContent("application/javascript"), false);
});

test("official portal proxy rejects path traversal before making an upstream request", async () => {
  const res = mockResponse();
  await officialPortalHandler(
    {
      method: "GET",
      headers: {},
      query: { path: "../../studentportal/" },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "Invalid official portal path" });
});

test("official portal proxy only allows GET and HEAD", async () => {
  const res = mockResponse();
  await officialPortalHandler(
    {
      method: "POST",
      headers: {},
      query: { path: "" },
    },
    res
  );

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, HEAD");
  assert.equal(res.ended, true);
});

test("vercel rewrites cover officialportal with and without a trailing slash", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const rewrites = config.rewrites ?? [];
  const pairs = rewrites.map(({ source, destination }) => `${source} -> ${destination}`);

  assert.ok(
    pairs.includes("/officialportal -> /api/official-portal"),
    "missing /officialportal rewrite"
  );
  assert.ok(
    pairs.includes("/officialportal/ -> /api/official-portal"),
    "missing /officialportal/ rewrite"
  );
  assert.ok(
    pairs.includes("/studentportal/:path* -> /api/official-portal?path=:path*"),
    "missing /studentportal safety-net rewrite for absolute asset URLs"
  );
});

test("official portal opens the dashboard route instead of the login route", () => {
  const source = fs.readFileSync(path.join(root, "packages/web/src/lib/officialPortal.ts"), "utf8");
  assert.match(source, /#\/dashbord/);
});

test("official portal bootstrap is valid JS and seeds the exact official keys", async () => {
  const { default: vm } = await import("node:vm");
  const script = makeOfficialPortalBootstrapScript();
  // Would have thrown SyntaxError before the nested-template fix (Bearer + regex escapes).
  new vm.Script(script);
  for (const key of ["Username", "tokendate", "Today_DATE", "clientidforlink", "usertypeselected", "Token"]) {
    assert.ok(script.includes(`"${key}"`), `bootstrap missing exact key ${key}`);
  }
  assert.ok(script.includes("/^\\/StudentPortalAPI/"), "bootstrap regex escaping broken");
  assert.ok(script.includes("/^Bearer\\s+/"), "bootstrap Bearer regex escaping broken");
  // Native cross-origin handoff: explicit origin allowlist, token-shape check,
  // no-op when storage already matches (prevents reload loops).
  assert.ok(script.includes('addEventListener("message"'), "bootstrap missing postMessage handoff");
  assert.ok(script.includes("https://localhost"), "bootstrap missing native origin");
  assert.ok(script.includes("location.reload()"), "bootstrap missing single-reload handoff");
});

test("official portal bootstrap seeds exact keys and stays cleared after logout", async () => {
  const vm = await import("node:vm");
  const script = makeOfficialPortalBootstrapScript();
  const session = {
    token: "tok123",
    username: "221B001",
    userid: "u1",
    clientid: "c1",
    membertype: "S",
    enrollmentno: "221B001",
    name: "Stu",
    instituteid: "7",
    institutename: "JUET",
    tokendate: "somedate",
  };
  const raw = JSON.stringify(session);

  function FakeStorage() {
    this.map = new Map();
  }
  FakeStorage.prototype.getItem = function (k) {
    const v = this.map.get(String(k));
    return v === undefined ? null : v;
  };
  FakeStorage.prototype.setItem = function (k, v) {
    this.map.set(String(k), String(v));
  };
  FakeStorage.prototype.removeItem = function (k) {
    this.map.delete(String(k));
  };
  FakeStorage.prototype.clear = function () {
    this.map.clear();
  };

  function runHarness({ seedRaw = null, origin = "https://host" } = {}) {
    const localStorage = new FakeStorage();
    const sessionStorage = new FakeStorage();
    if (seedRaw) localStorage.setItem(OFFICIAL_PORTAL_BRIDGE_KEY, seedRaw);
    const listeners = {};
    let reloads = 0;
    const sandbox = {
      window: {
        localStorage,
        sessionStorage,
        location: {
          origin,
          reload() {
            reloads += 1;
          },
        },
        addEventListener(type, fn) {
          (listeners[type] ??= []).push(fn);
        },
      },
      localStorage,
      sessionStorage,
      Storage: FakeStorage,
      XMLHttpRequest: { prototype: { open() {}, send() {}, setRequestHeader() {} } },
      queueMicrotask,
      setTimeout: () => 0,
      URL,
    };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    return { localStorage, sessionStorage, listeners, reloads: () => reloads };
  }

  // Seeded session: exact official keys land in storage.
  const seeded = runHarness({ seedRaw: raw });
  assert.equal(seeded.localStorage.getItem("Token"), "tok123");
  assert.equal(seeded.localStorage.getItem("Username"), "221B001");
  assert.equal(seeded.localStorage.getItem("tokendate"), "somedate");
  assert.ok((seeded.localStorage.getItem("Today_DATE") ?? "").length > 0);
  assert.equal(seeded.sessionStorage.getItem("clientidforlink"), "c1");

  // App wipes a single key mid-session (bridge intact): fallback + reseed.
  seeded.localStorage.map.delete("Token");
  assert.equal(seeded.localStorage.getItem("Token"), "tok123");

  // Logout: bridge removed, storages cleared — reads stay cleared, nothing
  // resurrects (previously the patched clear() re-seeded the dead session).
  seeded.localStorage.removeItem(OFFICIAL_PORTAL_BRIDGE_KEY);
  seeded.localStorage.clear();
  seeded.sessionStorage.clear();
  assert.equal(seeded.localStorage.getItem("Token"), null);
  assert.equal(seeded.localStorage.getItem("Username"), null);

  // Native handoff: empty cross-origin storage + parent postMessage stores the
  // bridge and reloads exactly once; wrong origin / bad payload are dropped.
  const fresh = runHarness({ origin: "https://localhost" });
  const onMessage = fresh.listeners.message?.[0];
  assert.ok(onMessage, "message listener registered before early return");
  onMessage({ origin: "https://evil.example", data: { type: OFFICIAL_PORTAL_BRIDGE_KEY, raw } });
  assert.equal(fresh.localStorage.getItem(OFFICIAL_PORTAL_BRIDGE_KEY), null);
  onMessage({ origin: "https://localhost", data: { type: "other", raw } });
  assert.equal(fresh.localStorage.getItem(OFFICIAL_PORTAL_BRIDGE_KEY), null);
  onMessage({ origin: "https://localhost", data: { type: OFFICIAL_PORTAL_BRIDGE_KEY, raw: "not-json" } });
  assert.equal(fresh.localStorage.getItem(OFFICIAL_PORTAL_BRIDGE_KEY), null);
  onMessage({
    origin: "https://localhost",
    data: { type: OFFICIAL_PORTAL_BRIDGE_KEY, raw },
  });
  assert.equal(fresh.localStorage.getItem(OFFICIAL_PORTAL_BRIDGE_KEY), raw);
  assert.equal(fresh.reloads(), 1);
  // Re-delivery of the same bridge is a no-op (no reload loop).
  onMessage({
    origin: "https://localhost",
    data: { type: OFFICIAL_PORTAL_BRIDGE_KEY, raw },
  });
  assert.equal(fresh.reloads(), 1);
});

test("official portal inject falls back when html has no head or body", () => {
  const out = injectOfficialPortalBootstrap("<p>hi</p>");
  assert.ok(out.includes(OFFICIAL_PORTAL_BRIDGE_KEY));
  assert.ok(out.startsWith("<script>("));
});

test("official portal bridge upgrades bypassValue to ciphertext, raw on failure", async () => {
  const session = { token: "t", username: "u", bypassValue: "rawbypass" };
  const enc = JSON.parse(
    await buildOfficialPortalBridgePayload(session, async (s) => `ENC(${s})`)
  );
  assert.equal(enc.bypassValue, "ENC(rawbypass)");
  assert.equal(enc.token, "t");

  const fallback = JSON.parse(
    await buildOfficialPortalBridgePayload(session, async () => {
      throw new Error("no subtlecrypto");
    })
  );
  assert.equal(fallback.bypassValue, "rawbypass");

  const empty = JSON.parse(
    await buildOfficialPortalBridgePayload({ token: "t" }, async (s) => `ENC(${s})`)
  );
  assert.equal(empty.bypassValue, "");
});

test("official portal URL resolves to the hosted proxy inside the native shell", () => {
  const lib = fs.readFileSync(
    path.join(root, "packages/web/src/lib/officialPortal.ts"),
    "utf8"
  );
  assert.match(lib, /isNativePlatform/);
  assert.match(lib, /VITE_NATIVE_API_BASE|PROD_API_BASE/);
  const page = fs.readFileSync(
    path.join(root, "packages/web/src/pages/OfficialPortalPage.tsx"),
    "utf8"
  );
  assert.match(page, /postMessage/);
  assert.ok(!page.includes('postMessage(') || page.includes("iframeOrigin"), "bridge post must use an explicit targetOrigin, never \"*\"");
});
