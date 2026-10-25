import test from "node:test";
import assert from "node:assert/strict";
import { PROD_API_BASE, resolveApiBase } from "../src/lib/apiBase.js";

test("browser builds call the same-origin proxy", () => {
  assert.equal(resolveApiBase(), "/api");
  assert.equal(resolveApiBase({ nativePlatform: false }), "/api");
});

test("VITE_API_BASE overrides the browser default (preview deployments)", () => {
  assert.equal(
    resolveApiBase({ nativePlatform: false, envBase: "https://preview.example/api" }),
    "https://preview.example/api"
  );
});

test("native proxy compatibility base is absolute", () => {
  assert.equal(resolveApiBase({ nativePlatform: true }), PROD_API_BASE);
  assert.match(resolveApiBase({ nativePlatform: true }), /^https:\/\//);
});

test("native ignores VITE_API_BASE but honours VITE_NATIVE_API_BASE", () => {
  assert.equal(
    resolveApiBase({ nativePlatform: true, envBase: "https://preview.example/api" }),
    PROD_API_BASE
  );
  assert.equal(
    resolveApiBase({ nativePlatform: true, envNativeBase: "https://fork.example/api" }),
    "https://fork.example/api"
  );
});

test("proxy base has no trailing slash", () => {
  // BASE_URL is used as `${BASE_URL}${endpoint}` where endpoint starts with "/".
  assert.ok(!PROD_API_BASE.endsWith("/"), PROD_API_BASE);
  assert.ok(PROD_API_BASE.endsWith("/api"), PROD_API_BASE);
  assert.equal(resolveApiBase({ envBase: "https://preview.example/api/" }), "https://preview.example/api");
  assert.equal(
    resolveApiBase({ nativePlatform: true, envNativeBase: "https://fork.example/api/" }),
    "https://fork.example/api"
  );
});
