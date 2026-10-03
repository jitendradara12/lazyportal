import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import officialPortalHandler from "../api/official-portal.js";
import {
  OFFICIAL_PORTAL_BRIDGE_KEY,
  OFFICIAL_PORTAL_PREFIX,
  injectOfficialPortalBootstrap,
  makeOfficialPortalBootstrapScript,
  rewriteOfficialPortalText,
} from "../shared/officialPortal.js";
import {
  buildOfficialPortalTarget,
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
  assert.equal(normalized.headers["content-security-policy"], undefined);
  assert.equal(normalized.headers["x-frame-options"], undefined);
  assert.equal(normalized.headers.location, `${OFFICIAL_PORTAL_PREFIX}/#/home`);
  assert.match(html, /<script>\(/);
  assert.match(html, /src="\/officialportal\/main\.js"/);
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
});
