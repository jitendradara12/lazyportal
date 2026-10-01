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
