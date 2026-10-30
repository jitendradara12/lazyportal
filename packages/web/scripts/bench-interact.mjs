// Interaction benchmark: cycles through every tab and reports main-thread time (4x CPU throttle).
//   (vite preview running on :4173)  CHROME=/path/to/chrome node packages/web/scripts/bench-interact.mjs [cycles]
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://127.0.0.1:4173";
const CYCLES = Number(process.argv[2] ?? 10);
const ok = (response) => ({ status: { responseStatus: "Success" }, response });
const rows = Array.from({ length: 8 }, (_, i) => ({
  subjectcode: `S${i}`, subjectid: String(i), individualsubjectcode: `CS${i}`,
  Lsubjectcomponentid: `l${i}`, Lpercentage: 70 + i * 3, LTpercentage: 70 + i * 3,
}));
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
const page = await ctx.newPage();
await page.route("**/api/**", (r) => {
  const u = r.request().url();
  r.fulfill({ json: u.includes("Inforegistration") ? ok({ headerlist: [{ stynumber: "1" }], semlist: [{ registrationid: "1", registrationcode: "26E" }] })
    : u.includes("attendancedetail") ? ok({ studentattendancelist: rows }) : ok({}) });
});
await page.route("**/_vercel/**", (r) => r.fulfill({ status: 204 }));
await page.route("https://va.vercel-scripts.com/**", (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
await page.addInitScript(() => localStorage.setItem("juet.portal.session.v1", JSON.stringify({ token: "t", username: "b", instituteid: "i" })));
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
await page.goto(BASE + "/");
await page.getByRole("heading", { name: "Attendance", exact: true }).waitFor();
const nav = page.getByRole("navigation");
const labels = ["Marks", "Exams", "Calendar", "More", "Attendance"];
// Visit every tab once so lazily loaded code and first renders are excluded from the steady-state measure.
for (const l of labels) { await nav.getByText(l, { exact: true }).first().click(); await page.waitForTimeout(400); }
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const read = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
const per0 = {};
for (const l of labels) { const b = await read(); await page.evaluate((l) => { [...document.querySelectorAll("nav button, nav a")].find((x) => x.textContent.trim().startsWith(l)).click(); }, l); await page.waitForTimeout(300); const a = await read(); per0[l] = ((a.ScriptDuration - b.ScriptDuration) * 1000).toFixed(0) + "ms"; }
console.log("single switch script time:", per0);
const before = await read();
const t0 = Date.now();
// Click via the DOM so Playwright's own actionability scripts are not measured.
await page.evaluate(async ({ CYCLES, labels }) => {
  const buttons = (l) => [...document.querySelectorAll("nav button, nav a")].find((b) => b.textContent.trim().startsWith(l));
  for (let i = 0; i < CYCLES; i++) for (const l of labels) {
    buttons(l).click();
    await new Promise((r) => setTimeout(r, 60));
  }
}, { CYCLES, labels });
const after = await read();
const per = (k) => (((after[k] - before[k]) * 1000) / (CYCLES * labels.length)).toFixed(1);
console.log(`per tab switch @4x CPU: script ${per("ScriptDuration")}ms  layout ${per("LayoutDuration")}ms  style ${per("RecalcStyleDuration")}ms  task ${per("TaskDuration")}ms`);
await browser.close();
