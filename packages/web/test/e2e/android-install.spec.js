import { test, expect } from "@playwright/test";
import { banner, openApp, waitForLogin, renewSession, emitNativePrompt, DISMISSAL_KEY, RELEASES_URL } from "./helpers.js";

test("captures the event, preserves it across login, and prompts only on a trusted tap", async ({ page }) => {
  await openApp(page);
  expect(await emitNativePrompt(page)).toBe(true);
  await expect(banner(page).getByRole("button", { name: "Install app", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__installTest.calls)).toBe(0);
  await renewSession(page);
  await expect(banner(page)).toHaveCount(1);
  await banner(page).getByRole("button", { name: "Install app", exact: true }).click();
  expect(await page.evaluate(() => window.__installTest.calls)).toBe(1);
  expect(await page.evaluate(() => window.__installTest.hadUserActivation)).toBe(true);
  await expect(banner(page)).toHaveCount(0);
});

test("shows a disabled busy state while the native dialog is open", async ({ page }) => {
  await openApp(page);
  await emitNativePrompt(page, { pending: true });
  await banner(page).getByRole("button", { name: "Install app", exact: true }).click();
  const opening = banner(page).getByRole("button", { name: "Opening installer…", exact: true });
  await expect(opening).toBeDisabled();
  await expect(opening).toHaveAttribute("aria-busy", "true");
  expect(await page.evaluate(() => window.__installTest.calls)).toBe(1);
  await page.evaluate(() => window.__installTest.resolve({ outcome: "accepted" }));
  await expect(banner(page)).toHaveCount(0);
});

test("native cancellation persists the cooldown across reloads", async ({ page }) => {
  await openApp(page);
  await emitNativePrompt(page, { outcome: "dismissed" });
  await banner(page).getByRole("button", { name: "Install app", exact: true }).click();
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate((key) => Number(localStorage.getItem(key)), DISMISSAL_KEY)).toBeGreaterThan(0);
  await page.reload();
  await waitForLogin(page);
  await expect(banner(page)).toHaveCount(0);
  expect(await emitNativePrompt(page)).toBe(true);
  expect(await page.evaluate(() => window.__installTest.calls)).toBe(0);
});

test("a failed prompt exposes manual steps and APK fallback without reusing the event", async ({ page }) => {
  await openApp(page);
  await emitNativePrompt(page, { fail: true });
  await banner(page).getByRole("button", { name: "Install app", exact: true }).click();
  await expect(banner(page).getByRole("alert")).toContainText("Installation couldn't start");
  await expect(banner(page).getByRole("button", { name: "Install app", exact: true })).toHaveCount(0);
  await banner(page).getByRole("button", { name: "How to install" }).click();
  await expect(banner(page).locator(".install-banner-guide")).toContainText("browser’s menu");
  await expect(banner(page).getByRole("link", { name: "Or download APK", exact: true })).toHaveAttribute("href", RELEASES_URL);
  expect(await page.evaluate(() => window.__installTest.calls)).toBe(1);
});

test("appinstalled removes a pending banner even if installation happened elsewhere", async ({ page }) => {
  await openApp(page);
  await emitNativePrompt(page, { pending: true });
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(banner(page)).toHaveCount(0);
});

test("without an install event, the Android guide has no dead install button", async ({ page }) => {
  await openApp(page);
  await expect(banner(page).getByRole("button", { name: "Install app", exact: true })).toHaveCount(0);
  await banner(page).getByRole("button", { name: "How to install" }).click();
  await expect(banner(page).locator(".install-banner-guide")).toContainText("Add to Home Screen");
});

test("installed Android apps can download the latest APK from More without leaving the app", async ({ page, context }) => {
  await page.addInitScript(() => { window.androidBridge = {}; });
  // Redirect destinations bypass routing, so mock the APK at the public URL.
  await context.route(RELEASES_URL, (route) => route.fulfill({
    contentType: "application/vnd.android.package-archive",
    headers: { "content-disposition": 'attachment; filename="app-release.apk"' },
    body: "mock APK",
  }));
  await openApp(page, { dashboard: true });
  await expect(banner(page)).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More", exact: true }).click();
  const update = page.getByRole("link", { name: "Download latest APK", exact: true });
  await expect(update).toHaveAttribute("href", RELEASES_URL);
  await expect(update).toHaveAttribute("target", "_blank");
  await expect(update).toHaveAttribute("rel", "noopener noreferrer");
  await expect(update).toHaveAccessibleDescription("Open the downloaded APK to update the app.");
  const downloading = context.waitForEvent("download");
  await update.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("app-release.apk");
  expect(await download.failure()).toBeNull();
  await expect(page.getByRole("heading", { name: "More", exact: true })).toBeVisible();
});

test("browser users do not see an Android app update action", async ({ page }) => {
  await openApp(page, { dashboard: true });
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download latest APK", exact: true })).toHaveCount(0);
});

async function mockAppVersion(page, version) {
  await page.addInitScript((version) => {
    window.androidBridge = {};
    window.Capacitor = {
      PluginHeaders: [{ name: "NativeInteractions", methods: [{ name: "getAppVersion", rtype: "promise" }] }],
      async nativePromise(_plugin, method) {
        if (method === "getAppVersion") {
          window.__appVersionChecks = (window.__appVersionChecks ?? 0) + 1;
          return { version };
        }
      },
    };
  }, version);
}

for (const [installed, label] of [["1.0.3", "Update 1.0.3 → 1.0.4"], ["1.0.4", "App up to date"], ["1.0.5", "App up to date"]]) {
  test(`installed ${installed} shows ${label} and checks only once across tab visits`, async ({ page }) => {
    await mockAppVersion(page, installed);
    await openApp(page, { dashboard: true });
    let checks = 0;
    await page.route("https://api.github.com/repos/jitendradara12/lazyportal/releases/latest", (route) => {
      checks++;
      return route.fulfill({ json: { tag_name: "v1.0.4", assets: [{ name: "app-release.apk", state: "uploaded" }] } });
    });
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("button", { name: "More", exact: true }).click();
    if (installed === "1.0.3") {
      await expect(page.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", "https://github.com/jitendradara12/lazyportal/releases/download/v1.0.4/app-release.apk");
    } else {
      await expect(page.getByRole("status").filter({ hasText: label })).toContainText(`Version ${installed}`);
      await expect(page.getByRole("link", { name: "Download latest APK", exact: true })).toHaveCount(0);
    }
    await nav.getByRole("button", { name: "Attendance", exact: true }).click();
    await nav.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    expect(checks).toBe(1);
    expect(await page.evaluate(() => window.__appVersionChecks)).toBe(1);
  });
}

test("a failed release check keeps the installed version and manual download", async ({ page }) => {
  await mockAppVersion(page, "1.0.3");
  await openApp(page, { dashboard: true });
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More", exact: true }).click();
  const download = page.getByRole("link", { name: "Download latest APK", exact: true });
  await expect(download).toHaveAttribute("href", RELEASES_URL);
  await expect(download).toHaveAccessibleDescription("Version 1.0.3. Couldn't check for updates. Download manually.");
});
