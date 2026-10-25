import { test, expect } from "@playwright/test";
import { mockPortal, SESSION } from "./helpers.js";

async function setup(page, { native = true, fail = false } = {}) {
  await mockPortal(page);
  const apiCalls = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url()); });
  await page.addInitScript(({ session, native, fail }) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify({ ...session, userid: "student-1", bypassValue: "test-bypass" }));
    for (const [feature, data] of [
      ["att.initial", { header: null, semesters: [{ registrationid: "sem1" }], rows: [] }],
      ["att.lov", { header: null, semesters: [{ registrationid: "sem1" }] }],
    ]) localStorage.setItem(`juet.cache.${feature}:${session.username}:${session.instituteid}`, JSON.stringify({ data, updatedAt: Date.now() }));
    window.__official = { opens: [], clears: 0, close: null };
    if (!native) return;
    window.androidBridge = {};
    window.Capacitor = {
      PluginHeaders: [{ name: "OfficialPortal", methods: [{ name: "open", rtype: "promise" }, { name: "clear", rtype: "promise" }] }],
      nativePromise(plugin, method, options) {
        if (plugin !== "OfficialPortal") throw new Error("Unexpected plugin");
        if (method === "clear") {
          window.__official.clears++;
          window.__official.close?.({});
          return Promise.resolve();
        }
        window.__official.opens.push(options);
        if (fail) return Promise.reject(new Error("Test portal unavailable. Please retry."));
        return new Promise((resolve) => { window.__official.close = resolve; });
      },
    };
  }, { session: SESSION, native, fail });
  await page.goto("/#more");
  await expect(page.getByRole("heading", { name: "More", exact: true })).toBeVisible();
  return apiCalls;
}

const entry = (page) => page.getByRole("button", { name: /Official student portal/ });

test("More opens the Android view once with no hosted API calls and keeps the live page", async ({ page }) => {
  const calls = await setup(page);
  const entryButton = entry(page);
  await expect(entryButton).toBeVisible();
  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
  await entryButton.click();
  await expect(entryButton).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__official.opens.length)).toBe(1);
  const options = await page.evaluate(() => window.__official.opens[0]);
  expect(options.version).toBe(1);
  expect(options.bootstrap).toContain("test-token");
  expect(options.bootstrap).not.toContain("/api/proxy");
  await page.evaluate(() => window.__official.close({ expired: false }));
  await expect(entryButton).toBeEnabled();
  await expect(page).toHaveURL(/#more$/);
  expect(calls).toEqual([]);
});

test("native failure is actionable and retry adds no Vercel API calls", async ({ page }) => {
  const calls = await setup(page, { fail: true });
  await entry(page).click();
  await expect(page.getByRole("alert")).toHaveText("Test portal unavailable. Please retry.");
  await expect(entry(page)).toBeEnabled();
  await entry(page).click();
  await expect.poll(() => page.evaluate(() => window.__official.opens.length)).toBe(2);
  expect(calls).toEqual([]);
});

test("browsers do not expose a hosted fallback", async ({ page }) => {
  const calls = await setup(page, { native: false });
  await expect(entry(page)).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("an expired native session silently recovers before the portal is reopened", async ({ page }) => {
  const calls = await setup(page);
  await page.route("**/api/token/refreshTokenRequest", (route) => route.fulfill({
    json: { response: { msg: "Success", token: "renewed-test-token" } },
  }));
  await entry(page).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__official.close))).toBe(true);
  await page.evaluate(() => window.__official.close({ expired: true }));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("juet.portal.session.v1")).token)).toBe("renewed-test-token");
  await expect(page.getByRole("button", { name: "Reconnect", exact: true })).toHaveCount(0);
  await expect(entry(page)).toBeEnabled();
  await entry(page).click();
  await expect.poll(() => page.evaluate(() => window.__official.opens.length)).toBe(2);
  expect(await page.evaluate(() => window.__official.opens[1].bootstrap)).toContain("renewed-test-token");
  expect(calls.map((url) => new URL(url).pathname)).toEqual(["/api/token/refreshTokenRequest"]);
});

test("failed silent recovery from a native expiry leaves manual reconnect available", async ({ page }) => {
  const calls = await setup(page);
  await entry(page).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__official.close))).toBe(true);
  await page.evaluate(() => window.__official.close({ expired: true }));
  await expect(entry(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();
  await entry(page).click();
  await expect(page.getByRole("alert")).toContainText("Reconnect to your account");
  expect(await page.evaluate(() => window.__official.opens.length)).toBe(1);
  expect(calls.map((url) => new URL(url).pathname)).toEqual(["/api/token/refreshTokenRequest"]);
});

test("native expiry exhausts automatic captchas before showing Reconnect", async ({ page }) => {
  const calls = await setup(page);
  const maxAttempts = await page.evaluate(async (session) => {
    const resource = performance.getEntriesByType("resource").find((r) => new URL(r.name).pathname === "/src/lib/portal.ts");
    const { savedCredentials, MAX_AUTOSOLVE_ATTEMPTS } = await import(resource.name);
    await savedCredentials.save("test-only-password", { username: session.username, usertype: "S" });
    window.__sessionStatuses = [];
    window.addEventListener("juet:session-status", (event) => window.__sessionStatuses.push(event.detail.status));
    return MAX_AUTOSOLVE_ATTEMPTS;
  }, SESSION);
  await page.route("**/api/token/refreshTokenRequest", (route) => route.fulfill({ status: 401, json: {} }));
  let finishLastCaptcha;
  const lastCaptcha = new Promise((resolve) => { finishLastCaptcha = resolve; });
  let captchas = 0;
  await page.route("**/api/token/getcaptcha", async (route) => {
    if (++captchas === maxAttempts) await lastCaptcha;
    // The blank captcha fixture runs through the real solver and returns no guess.
    await route.fallback();
  });
  await entry(page).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__official.close))).toBe(true);
  await page.evaluate(() => window.__official.close({ expired: true }));
  await expect.poll(() => captchas).toBe(maxAttempts);
  await expect(page.getByRole("button", { name: "Reconnect", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__sessionStatuses)).toEqual(["recovering"]);
  finishLastCaptcha();
  await expect(page.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__sessionStatuses)).toEqual(["recovering", "expired"]);
  expect(calls.map((url) => new URL(url).pathname)).toEqual([
    "/api/token/refreshTokenRequest", ...Array(maxAttempts).fill("/api/token/getcaptcha"),
  ]);
});

test("logout clears the native session and main credentials", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__official.clears)).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem("juet.portal.session.v1"))).toBeNull();
});
