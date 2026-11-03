// Offline benchmark against public, manually labeled images. No portal requests.
// CHROME=/path/to/chrome node packages/web/scripts/bench-captcha.mjs
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";

const fixtures = new URL("../../core/test/fixtures/captcha/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("labels.json", fixtures), "utf8"));
const pixels = gunzipSync(await readFile(new URL("pixels.rgba.gz", fixtures)));
const browser = await chromium.launch({ executablePath: process.env.CHROME });
try {
  const page = await browser.newPage();
  await page.route("http://captcha.test/**", async route => {
    const name = new URL(route.request().url()).pathname;
    if (name === "/") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Captcha benchmark</title>" });
    if (!["/captcha.js", "/captchaGlyphs.js"].includes(name)) return route.abort();
    await route.fulfill({ contentType: "text/javascript", body: await readFile(new URL(`../../core/src${name}`, import.meta.url), "utf8") });
  });
  await page.goto("http://captcha.test/");
  const rows = await page.evaluate(async ({ manifest, pixels }) => {
    const { solveCaptcha } = await import("/captcha.js");
    const canvas = document.createElement("canvas");
    canvas.width = manifest.width;
    canvas.height = manifest.height;
    const ctx = canvas.getContext("2d");
    const bytes = canvas.width * canvas.height * 4;
    const decoded = Uint8ClampedArray.from(atob(pixels), c => c.charCodeAt(0));
    const rows = [];
    for (const [i, sample] of manifest.samples.entries()) {
      ctx.putImageData(new ImageData(decoded.slice(i * bytes, (i + 1) * bytes), canvas.width, canvas.height), 0, 0);
      const start = performance.now();
      const actual = await solveCaptcha({ imageDataUrl: canvas.toDataURL("image/png") });
      rows.push({ ...sample, actual, ms: performance.now() - start });
    }
    return rows;
  }, { manifest, pixels: pixels.toString("base64") });
  const exact = rows.filter(r => r.actual === r.expected).length;
  const validation = rows.filter(r => r.set === "validation" && r.actual === r.expected).length;
  const times = rows.map(r => r.ms).sort((a, b) => a - b);
  console.log(`${exact}/${rows.length} exact; ${validation}/24 validation; median ${times[Math.floor(times.length / 2)].toFixed(0)}ms including image encoding/decoding`);
  for (const row of rows.filter(r => r.actual !== r.expected)) console.log(`  ${row.expected} → ${row.actual || "manual"}`);
  assert.ok(exact >= 32 && validation >= 21, "Captcha recognition regressed");
} finally {
  await browser.close();
}
