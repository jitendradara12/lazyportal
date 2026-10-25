import { test, expect } from "@playwright/test";
import { computeSubjectRowChecksum } from "../../src/lib/portalSchedule.ts";
import { mockPortal, SESSION, waitForLogin } from "./helpers.js";

async function mockNative(page) {
  await page.addInitScript(() => {
    window.__native = { enabled: false, haptics: 0, hides: 0 };
    window.androidBridge = {};
    window.Capacitor = {
      PluginHeaders: [{ name: "NativeInteractions", methods: [
        { name: "addListener", rtype: "callback" },
        ...["removeAllListeners", "removeListener", "setBackEnabled", "defaultBack", "haptic", "hideKeyboard"].map((name) => ({ name, rtype: "promise" })),
      ] }],
      nativeCallback(_plugin, method, _options, callback) {
        if (method === "addListener") window.__native.back = callback;
        return "test-listener";
      },
      async nativePromise(_plugin, method, options) {
        if (method === "setBackEnabled") window.__native.enabled = options.enabled;
        if (method === "haptic") window.__native.haptics++;
        if (method === "hideKeyboard") window.__native.hides++;
      },
    };
  });
}

async function dashboard(page) {
  await mockPortal(page);
  await mockNative(page);
  const row = { subjectid: "subject1", subjectcode: "TEST SUBJECT(CS101)", Psubjectcomponentid: "p1", Ppercentage: 100 };
  await page.addInitScript(({ session, row, checksum }) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    const semesters = [{ registrationid: "sem1", registrationcode: "2026ODDSEM" }];
    const cache = (feature, data, parts = [], extra = {}) => {
      const key = [feature, session.username, session.instituteid, ...parts].map(encodeURIComponent).join(":");
      localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now(), ...extra }));
    };
    cache("att.initial", { header: null, semesters, rows: [row] });
    cache("att.lov", { header: null, semesters });
    cache("exams.sems", semesters);
    cache("exams.events", [{ exameventid: "event1" }], ["sem1"]);
    cache("exams.rows", [{ subjectdesc: "TEST EXAM (CS101)", datetime: "01/12/2099", datetimefrom: "09:00 AM", datetimeupto: "12:00 PM" }], ["sem1", "event1"]);
    cache("att.subject", { P: { student_attdsummarylist: [{ datetime: "1/10/2026 09:00 AM", present: "Y" }] } }, ["sem1", "subject1"], { checksum });
  }, { session: SESSION, row, checksum: computeSubjectRowChecksum(row) });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Attendance", exact: true })).toBeVisible();
}

const back = async (page) => {
  await expect.poll(() => page.evaluate(() => window.__native.enabled)).toBe(true);
  await page.evaluate(() => window.__native.back({}));
};

test("Android Back closes attendance, returns home, then releases system Back", async ({ page }) => {
  await dashboard(page);
  await expect.poll(() => page.evaluate(() => window.__native.enabled)).toBe(false);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await back(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__native.enabled)).toBe(false);
  await page.getByRole("navigation").getByRole("button", { name: "Marks", exact: true }).click();
  await back(page);
  await expect(page.getByRole("navigation").getByRole("button", { name: "Attendance", exact: true })).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.evaluate(() => window.__native.enabled)).toBe(false);
});

test("hidden attendance sheets do not intercept Back from another tab", async ({ page }) => {
  await dashboard(page);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  await page.evaluate(() => { window.location.hash = "marks"; });
  await expect(page.getByRole("navigation").getByRole("button", { name: "Marks", exact: true })).toHaveAttribute("aria-current", "page");
  await back(page);
  await expect(page.getByRole("dialog")).toBeVisible();
  await back(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("selection haptics happen on changes and skip repeated selection", async ({ page }) => {
  await dashboard(page);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  await page.getByRole("radio", { name: "80%", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__native.haptics)).toBe(1);
  await page.getByRole("radio", { name: "80%", exact: true }).click();
  expect(await page.evaluate(() => window.__native.haptics)).toBe(1);
  await page.getByRole("button", { name: "What-if calculator" }).click();
  await page.getByRole("button", { name: "Increase Attend" }).click();
  await expect.poll(() => page.evaluate(() => window.__native.haptics)).toBe(2);
});

test("calendar menus close before leaving Exams", async ({ page }) => {
  await dashboard(page);
  await page.getByRole("navigation").getByRole("button", { name: "Exams", exact: true }).click();
  await page.getByRole("button", { name: /Add Test Exam to calendar/i }).click();
  await expect(page.getByRole("group", { name: "Add to calendar" })).toBeVisible();
  await back(page);
  await expect(page.getByRole("group", { name: "Add to calendar" })).toHaveCount(0);
  await expect(page.getByRole("navigation").getByRole("button", { name: "Exams", exact: true })).toHaveAttribute("aria-current", "page");
  await back(page);
  await expect.poll(() => page.evaluate(() => window.__native.enabled)).toBe(false);
});

test("reconnect takes Back before the subject sheet underneath it", async ({ page }) => {
  await dashboard(page);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  await page.evaluate(async () => {
    const resource = performance.getEntriesByType("resource").find((r) => new URL(r.name).pathname === "/src/lib/portal.ts");
    const { setSessionStatus } = await import(resource.name);
    setSessionStatus("expired");
  });
  await page.getByRole("button", { name: "Reconnect", exact: true }).dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Renew session" })).toBeVisible();
  await back(page);
  await expect(page.getByRole("dialog", { name: "Renew session" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Test Subject" })).toBeVisible();
  await back(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("reconnect scrolls its dialog to keep captcha visible above the keyboard", async ({ page }) => {
  await dashboard(page);
  await page.evaluate(async () => {
    const resource = performance.getEntriesByType("resource").find((r) => new URL(r.name).pathname === "/src/lib/portal.ts");
    const { setSessionStatus } = await import(resource.name);
    setSessionStatus("expired");
  });
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Renew session" });
  await expect(dialog.getByLabel("Password", { exact: true })).toBeVisible();
  const captcha = dialog.getByLabel("Captcha", { exact: true });
  await captcha.focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 360 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).toHaveAttribute("data-keyboard-open", "");
  await expect.poll(() => captcha.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(344);
  await expect(dialog.locator(".auth-captcha-group")).toBeInViewport({ ratio: 1 });
  await expect.poll(() => dialog.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("login keyboard advances fields and keeps the active field above a reduced viewport", async ({ page }) => {
  await mockPortal(page);
  await page.goto("/");
  await waitForLogin(page);
  await page.locator("#auth-username").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Captcha", { exact: true })).toBeFocused();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 360 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).toHaveAttribute("data-keyboard-open", "");
  await expect.poll(() => page.getByLabel("Captcha", { exact: true }).evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(360);
  await expect.poll(() => page.locator(".auth-captcha-group").evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-keyboard-open", "");
});
