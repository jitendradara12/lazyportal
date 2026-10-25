import { test, expect } from "@playwright/test";
import { portalApiPolicy } from "../../../core/src/portalTransport.js";
import { computeSubjectRowChecksum, getPortalDayKey } from "../../src/lib/portalSchedule.ts";
import { mockPortal, SESSION } from "./helpers.js";

async function setup(page, { missingAttendance = false, missingDetail = false, seededAttendance = false, fail = false, failDiscovery = false } = {}) {
  await mockPortal(page);
  const hosted = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) hosted.push(request.url());
  });
  const row = { subjectid: "subject1", subjectcode: "TEST SUBJECT(CS101)", Psubjectcomponentid: "p1", Ppercentage: 100 };
  const semesters = [{ registrationid: "sem1", registrationcode: "2026ODDSEM" }];
  await page.addInitScript(({ policy, session, fail, failDiscovery, seededAttendance, row, semesters, checksum, portalDay }) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    if (seededAttendance) {
      const cache = (feature, data, parts = [], extra = {}) => {
        const key = [feature, session.username, session.instituteid, ...parts].map(encodeURIComponent).join(":");
        localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now(), ...extra }));
      };
      cache("att.initial", { header: null, semesters, rows: [row] });
      cache("att.lov", { header: null, semesters });
      cache("att.subject", { P: { student_attdsummarylist: [{ datetime: "01/10/2026 09:00 AM", present: "Y" }] } }, ["sem1", "subject1"], { checksum });
      localStorage.setItem(`juet.portal.refresh_quota.${session.username.toUpperCase()}:${session.instituteid}`,
        JSON.stringify({ day: portalDay, count: 1, unchanged: 3, lastUnchangedAt: Date.now() }));
    }
    window.__portalHttp = { requests: [], capabilities: 0 };
    window.androidBridge = {};
    window.Capacitor = {
      PluginHeaders: [{ name: "PortalHttp", methods: ["request", "capabilities", "cancel"].map((name) => ({ name, rtype: "promise" })) }],
      nativePromise(plugin, method, options) {
        if (plugin !== "PortalHttp") throw new Error("Unexpected plugin");
        if (method === "capabilities") {
          window.__portalHttp.capabilities++;
          return failDiscovery ? Promise.reject(new Error("Plugin unavailable")) : Promise.resolve(policy);
        }
        if (method === "cancel") return Promise.resolve();
        window.__portalHttp.requests.push(options);
        if (fail) return Promise.reject(new Error("Native network unavailable"));
        const response = options.path.endsWith("refreshTokenRequest")
          ? { msg: "Success", token: "renewed-token" } : options.path.endsWith("getstudentattendancedetail")
          ? { studentattendancelist: [row] } : options.path.endsWith("getsemestercode-exammarks")
          ? { semestercode: semesters } : options.path.endsWith("getstudent-exammarks")
          ? { viewmarksbystudent: [] } : { headerlist: [{ stynumber: "student1" }], semlist: seededAttendance ? semesters : [] };
        return Promise.resolve({ status: 200, headers: { "content-type": "application/json" },
          body: btoa(JSON.stringify({ status: { responseStatus: "Success" }, response })) });
      },
    };
  }, { policy: missingAttendance ? { ...portalApiPolicy, post: [] } : missingDetail
    ? { ...portalApiPolicy, post: portalApiPolicy.post.filter((path) => !path.endsWith("getstudentsubjectpersentage")) } : portalApiPolicy,
    session: SESSION, fail, failDiscovery, seededAttendance, row, semesters, checksum: computeSubjectRowChecksum(row), portalDay: getPortalDayKey() });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  return hosted;
}

test("dashboard and session recovery use native API while the app stays hosted", async ({ page }) => {
  const hosted = await setup(page);
  await expect.poll(() => page.evaluate(() => window.__portalHttp.requests.length)).toBeGreaterThan(0);
  const request = await page.evaluate(() => window.__portalHttp.requests[0]);
  expect(request.path).toBe("/StudentClassAttendance/getstudentInforegistrationforattendence");
  expect(request.headers.authorization).toBe("Bearer test-token");
  expect(JSON.parse(request.body)).toEqual({ instituteid: SESSION.instituteid });
  // Exercise the singleton used by the page, including its unchanged refresh state machine.
  const recovered = await page.evaluate(async () => {
    const resource = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === "/src/lib/portal.ts");
    const { client } = await import(resource.name);
    return client.recoverSession("test-token");
  });
  expect(recovered).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("juet.portal.session.v1")).token)).toBe("renewed-token");
  expect(await page.evaluate(() => window.__portalHttp.capabilities)).toBe(1);
  expect(hosted).toEqual([]);
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:5173\//);
  await page.reload();
  expect(hosted).toEqual([]);
});

test("an older installed policy uses the proxy for missing reviewed reads", async ({ page }) => {
  const hosted = await setup(page, { missingAttendance: true });
  await expect.poll(() => hosted.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__portalHttp.requests)).toEqual([]);
});

test("unavailable native discovery uses the proxy before sending any native API request", async ({ page }) => {
  const hosted = await setup(page, { failDiscovery: true });
  await expect.poll(() => hosted.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__portalHttp.requests)).toEqual([]);
  expect(await page.evaluate(() => window.__portalHttp.capabilities)).toBe(1);
});

test("native network errors show retry without proxying the same request", async ({ page }) => {
  const hosted = await setup(page, { fail: true });
  await expect(page.getByRole("button", { name: "Retry", exact: true }).first()).toBeVisible();
  expect(hosted).toEqual([]);
});

test("direct native attendance bypasses exhausted proxy quotas and allows another check after two seconds", async ({ page }) => {
  const hosted = await setup(page, { seededAttendance: true });
  const button = page.getByRole("button", { name: "Refresh attendance", exact: true });
  await expect(button).toHaveAttribute("title", "Refresh attendance");
  await page.clock.install();
  const quotaKey = `juet.portal.refresh_quota.${SESSION.username.toUpperCase()}:${SESSION.instituteid}`;
  const before = await page.evaluate((key) => localStorage.getItem(key), quotaKey);
  const reads = () => page.evaluate(() => window.__portalHttp.requests.filter((request) => request.path.endsWith("getstudentattendancedetail")).length);
  await button.click();
  await expect.poll(reads).toBe(1);
  await expect(button).toBeEnabled();
  await page.clock.fastForward(2_001);
  await button.click();
  await expect.poll(reads).toBe(2);
  await expect(button).toBeEnabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), quotaKey)).toBe(before);
  expect(hosted).toEqual([]);
});

test("a partially supported attendance batch retains proxy quotas even if its overview can run natively", async ({ page }) => {
  const hosted = await setup(page, { seededAttendance: true, missingDetail: true });
  await expect.poll(() => page.evaluate(() => window.__portalHttp.capabilities)).toBe(1);
  const button = page.getByRole("button", { name: "Refresh attendance", exact: true });
  await expect(button).toHaveAttribute("title", "Up to date with portal");
  await button.click();
  await expect(page.getByRole("status")).toHaveText("Up to date with portal");
  expect(await page.evaluate(() => window.__portalHttp.requests)).toEqual([]);
  expect(hosted).toEqual([]);
});

test("marks refresh also uses the two-second native cooldown", async ({ page }) => {
  const hosted = await setup(page, { seededAttendance: true });
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Marks", exact: true }).click();
  const reads = () => page.evaluate(() => window.__portalHttp.requests.filter((request) => request.path.endsWith("getstudent-exammarks")).length);
  await expect.poll(reads).toBe(1);
  const button = page.getByRole("button", { name: "Refresh marks", exact: true });
  await expect(button).toBeEnabled();
  await page.clock.install();
  await button.click();
  await expect.poll(reads).toBe(2);
  await expect(button).toBeEnabled();
  await page.clock.fastForward(2_001);
  await button.click();
  await expect.poll(reads).toBe(3);
  expect(hosted).toEqual([]);
});
