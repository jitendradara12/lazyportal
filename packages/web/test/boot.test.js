import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("root shell sets Cache-Control: no-cache while preserving CORS and asset caching", async () => {
  const vercel = JSON.parse(await readFile(new URL("../../../vercel.json", import.meta.url), "utf8"));
  const rootRule = vercel.headers.find((rule) => rule.source === "/");
  assert.ok(rootRule, "expected / header rule in vercel.json");

  const byKey = new Map(rootRule.headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.equal(byKey.get("cache-control"), "no-cache");
  assert.equal(byKey.get("access-control-allow-origin"), "https://localhost");

  const assetsRule = vercel.headers.find((rule) => rule.source === "/assets/:path*");
  assert.ok(assetsRule, "expected /assets/:path* header rule in vercel.json");
  assert.ok(vercel.redirects.some((r) => r.source === "/download"));
});

test("boot shell renders a themed Suspense fallback and unregisters service workers on native", async () => {
  const mainSource = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.doesNotMatch(mainSource, /<Suspense\s+fallback=\{null\}>/);
  assert.match(mainSource, /className="boot-fallback"/);
  assert.match(mainSource, /className="boot-spinner"/);
  assert.match(mainSource, /navigator\.serviceWorker[\s\S]*?getRegistrations\(\)[\s\S]*?\.unregister\(\)/);

  assert.match(stylesSource, /\.boot-fallback\s*\{[^}]*background:\s*var\(--surface\)/);
  assert.match(stylesSource, /\.boot-spinner\s*\{[^}]*border:[^}]*var\(--outlineVariant\)[^}]*border-top-color:\s*var\(--primary\)/);
});
