import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEBVIEW_ORIGIN, corsHeaders, preflightHeaders } from "../shared/cors.js";
import proxyHandler, { buildUpstreamTarget } from "../api/proxy.js";

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
    end() {
      this.ended = true;
    },
    json(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
  };
}

test("WebView origin is allowed and echoed, never wildcarded", () => {
  const headers = corsHeaders(WEBVIEW_ORIGIN);
  assert.equal(headers["Access-Control-Allow-Origin"], WEBVIEW_ORIGIN);
  assert.equal(headers.Vary, "Origin");
});

test("other origins get no allow header", () => {
  for (const origin of [undefined, "", "https://evil.example", "null", "*"]) {
    const headers = corsHeaders(origin);
    assert.equal(headers["Access-Control-Allow-Origin"], undefined, `origin: ${origin}`);
    assert.equal(headers.Vary, "Origin");
  }
});

test("preflight grants the requested headers and methods", () => {
  const headers = preflightHeaders(WEBVIEW_ORIGIN, "Authorization, Content-Type,LocalName");
  assert.match(headers["Access-Control-Allow-Methods"], /POST/);
  assert.match(headers["Access-Control-Allow-Methods"], /OPTIONS/);
  assert.equal(headers["Access-Control-Allow-Headers"], "authorization, content-type, localname");
  assert.ok(Number(headers["Access-Control-Max-Age"]) > 0);
});

test("preflight drops junk instead of echoing it into the response", () => {
  const headers = preflightHeaders(WEBVIEW_ORIGIN, "authorization, bad header\r\nX-Injected: 1");
  assert.equal(headers["Access-Control-Allow-Headers"], "authorization");
  assert.equal(preflightHeaders(WEBVIEW_ORIGIN, undefined)["Access-Control-Allow-Headers"], undefined);
});

test("preflight from a foreign origin allows nothing", () => {
  const headers = preflightHeaders("https://evil.example", "authorization");
  assert.equal(headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(headers["Access-Control-Allow-Headers"], undefined);
  assert.equal(headers["Access-Control-Allow-Methods"], undefined);
});

test("proxy paths stay under the fixed StudentPortalAPI prefix", () => {
  const target = new URL(
    buildUpstreamTarget("token/generatewebtoken", {
      lang: "en US",
      plus: "a+b",
      amp: "a&b",
    })
  );
  assert.equal(target.origin, "https://studentportal.juet.ac.in");
  assert.equal(target.pathname, "/StudentPortalAPI/token/generatewebtoken");
  assert.equal(target.searchParams.get("lang"), "en US");
  assert.equal(target.searchParams.get("plus"), "a+b");
  assert.equal(target.searchParams.get("amp"), "a&b");

  for (const path of [
    "",
    "../studentportal/",
    "token/../../studentportal/",
    "%2e%2e/studentportal/",
    "token/%252e%252e/studentportal/",
    "token\\..\\studentportal",
    "/token/getcaptcha",
    "token/getcaptcha?other=1",
  ]) {
    assert.throws(() => buildUpstreamTarget(path), TypeError, `path: ${path}`);
  }

  assert.throws(
    () => buildUpstreamTarget(["token", "..", "studentportal"]),
    TypeError
  );
});

test("every API endpoint used by core stays under StudentPortalAPI", () => {
  const coreFiles = ["packages/core/src/auth.js", "packages/core/src/features.js"];
  const apiPaths = new Set(
    coreFiles.flatMap((file) => {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      return [...source.matchAll(/"(\/[A-Za-z0-9._/-]+)"/g)].map((match) => match[1]);
    })
  );

  assert.ok(apiPaths.size > 0, "expected to discover API endpoint paths");
  for (const apiPath of apiPaths) {
    const target = new URL(buildUpstreamTarget(apiPath.slice(1)));
    assert.equal(target.origin, "https://studentportal.juet.ac.in", apiPath);
    assert.equal(target.pathname, `/StudentPortalAPI${apiPath}`, apiPath);
  }
});

test("proxy rejects path traversal before making an upstream request", async () => {
  const res = mockResponse();
  await proxyHandler(
    {
      method: "POST",
      headers: { origin: WEBVIEW_ORIGIN },
      query: { path: "../../studentportal/" },
      on() {
        throw new Error("should not read a body for an invalid path");
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "Invalid proxy path" });
  assert.equal(res.headers["Access-Control-Allow-Origin"], WEBVIEW_ORIGIN);
  assert.equal(res.ended, true);
});

test("proxy rejects methods that its CORS policy does not allow", async () => {
  const res = mockResponse();
  await proxyHandler(
    {
      method: "DELETE",
      headers: { origin: WEBVIEW_ORIGIN },
      query: { path: "token/generatewebtoken" },
    },
    res
  );

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, HEAD, POST, OPTIONS");
  assert.equal(res.ended, true);
});

test("the proxy handler answers preflights with the allow headers", async () => {
  // Exercises api/proxy.js itself, not just the helper: this is the response
  // the WebView sees before every POST.
  const headers = {};
  const res = {
    statusCode: null,
    setHeader: (k, v) => (headers[k] = v),
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
    },
  };

  await proxyHandler(
    {
      method: "OPTIONS",
      headers: { origin: WEBVIEW_ORIGIN, "access-control-request-headers": "authorization, content-type, localname" },
    },
    res
  );

  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(headers["Access-Control-Allow-Origin"], WEBVIEW_ORIGIN);
  assert.equal(headers["Access-Control-Allow-Headers"], "authorization, content-type, localname");
  assert.equal(headers.Vary, "Origin");
});

test("the allowed origin is the one the native shell actually uses", () => {
  // capacitor.config.json → server.url is the WebView's origin;
  // if it drifts, native requests start failing CORS.
  const config = JSON.parse(fs.readFileSync(path.join(root, "capacitor.config.json"), "utf-8"));
  const expectedOrigin = config.server?.url
    ? new URL(config.server.url).origin
    : `${config.server?.androidScheme ?? "https"}://${config.server?.hostname ?? "localhost"}`;
  assert.equal(WEBVIEW_ORIGIN, expectedOrigin);
});
