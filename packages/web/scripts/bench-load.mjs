// Cold/warm load benchmark against `vite preview` (build first).
//   npm --workspace @juet/web run build
//   npm --workspace @juet/web exec vite preview -- --port 4173 &
//   CHROME=/path/to/chrome node packages/web/scripts/bench-load.mjs [runs]
// Mocked portal, 4x CPU throttle, ~Fast 4G. Reports medians per scenario.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://127.0.0.1:4173";
const RUNS = Number(process.argv[2] ?? 5);
const SESSION = { token: "t", username: "bench", name: "Bench", instituteid: "i" };
const png = "iVBORw0KGgoAAAANSUhEUgAAATYAAAA8CAIAAABjMgEsAAAAyElEQVR4nO3TMQEAMAyAsPo33TrYO45EAQ+zQNj8DgBeLAppFoU0i0KaRSHNopBmUUizKKRZFNIsCmkWhTSLQppFIc2ikGZRSLMopFkU0iwKaRaFNItCmkUhzaKQZlFIsyikWRTSLAppFoU0i0KaRSHNopBmUUizKKRZFNIsCmkWhTSLQppFIc2ikGZRSLMopFkU0iwKaRaFNItCmkUhzaKQZlFIsyikWRTSLAppFoU0i0KaRSHNopBmUUizKKRZFNIsCmkWhbQDlfEqwDC7A+kAAAAASUVORK5CYII=";

const rows = Array.from({ length: 8 }, (_, i) => ({
  subjectcode: `S${i}`, subjectid: String(i), individualsubjectcode: `CS${i}`,
  Lsubjectcomponentid: `l${i}`, Lpercentage: 70 + i * 3, LTpercentage: 70 + i * 3,
}));

function mock(url) {
  const ok = (response) => ({ status: { responseStatus: "Success" }, response });
  if (url.includes("getstudentInforegistrationforattendence")) {
    return ok({ headerlist: [{ stynumber: "1" }], semlist: [{ registrationid: "1", registrationcode: "26E" }] });
  }
  if (url.includes("getstudentattendancedetail")) return ok({ studentattendancelist: rows });
  if (url.includes("captcha")) return ok({ captcha: { hidden: "x", image: png } });
  return ok({});
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function once(browser, scenario, warm) {
  const context = warm?.context ?? await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route("**/api/**", (r) => r.fulfill({ json: mock(r.request().url()) }));
  await page.route("**/_vercel/**", (r) => r.fulfill({ status: 204 }));
  await page.route("https://va.vercel-scripts.com/**", (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  if (scenario === "dashboard" && !warm) {
    await page.addInitScript((s) => { if (!localStorage.getItem("juet.portal.session.v1")) localStorage.setItem("juet.portal.session.v1", JSON.stringify(s)); }, SESSION);
  }
  // Time of first render of the target heading, observed in-page so polling cost is not measured.
  await page.addInitScript((target) => {
    const t = target.toLowerCase();
    const check = () => [...document.querySelectorAll("h1,h2")].some((h) => h.textContent.trim().toLowerCase().startsWith(t));
    const mo = new MutationObserver(() => { if (window.__ready === undefined && check()) { window.__ready = performance.now(); mo.disconnect(); } });
    mo.observe(document, { childList: true, subtree: true });
  }, scenario === "dashboard" ? "Attendance" : "Sign in");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (!warm) await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let bytes = 0, jsBytes = 0, requests = 0;
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; requests++; });
  const types = new Map();
  cdp.on("Network.responseReceived", (e) => types.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) => { if (types.get(e.requestId) === "Script") jsBytes += e.encodedDataLength; });
  await page.goto(BASE + "/", { waitUntil: "commit" });
  const marker = scenario === "dashboard"
    ? page.getByRole("heading", { name: "Attendance", exact: true })
    : page.getByRole("heading", { name: "Sign in", exact: true });
  await marker.waitFor({ timeout: 60_000 });
  const m = await page.evaluate(async () => {
    const ready = window.__ready ?? -1;
    await new Promise((r) => setTimeout(r, 1500));
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    return { fcp, ready, load: nav.loadEventEnd, dcl: nav.domContentLoadedEventEnd };
  });
  await page.close();
  if (!warm) await context.close();
  return { ...m, bytes, jsBytes, requests };
}

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox"] });
for (const scenario of ["login", "dashboard"]) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await once(browser, scenario));
  const pick = (k) => Math.round(median(runs.map((r) => r[k])));
  console.log(`${scenario.padEnd(10)} FCP ${pick("fcp")}ms  ready ${pick("ready")}ms  DCL ${pick("dcl")}ms  load ${pick("load")}ms  transferred ${(pick("bytes") / 1024).toFixed(0)}KB (JS ${(pick("jsBytes") / 1024).toFixed(0)}KB, ${pick("requests")} reqs)`);
}
await browser.close();
