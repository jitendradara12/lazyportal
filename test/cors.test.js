import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEBVIEW_ORIGIN, corsHeaders, preflightHeaders } from "../api/cors.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("the allowed origin is the one the native shell actually uses", () => {
  // capacitor.config.json → server.hostname + server.androidScheme is the
  // WebView's origin; if it drifts, native requests start failing CORS.
  const config = JSON.parse(fs.readFileSync(path.join(root, "capacitor.config.json"), "utf-8"));
  const scheme = config.server?.androidScheme ?? "https";
  const hostname = config.server?.hostname ?? "localhost";
  assert.equal(WEBVIEW_ORIGIN, `${scheme}://${hostname}`);
});
