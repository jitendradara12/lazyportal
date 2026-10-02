import { test, expect } from "@playwright/test";
import { banner, openApp, mockPortal, waitForLogin, renewSession, emitNativePrompt, DISMISSAL_KEY, DISMISSAL_MS, RELEASES_URL } from "./helpers.js";

test("appears once on login and dashboard with a safe GitHub Releases link", async ({ page }) => {
  await openApp(page);
  await expect(banner(page)).toHaveCount(1);
  const apk = banner(page).getByRole("link", { name: /Or download APK/ });
  await expect(apk).toHaveAttribute("href", RELEASES_URL);
  await expect(apk).toHaveAttribute("target", "_blank");
  await expect(apk).toHaveAttribute("rel", "noopener noreferrer");
  await renewSession(page);
  await expect(banner(page)).toHaveCount(1);
});

test("dismissal survives login, logout, and reload without clearing session data", async ({ page }) => {
  await openApp(page);
  await banner(page).getByRole("button", { name: "Dismiss install banner for 14 days" }).click();
  await expect(banner(page)).toHaveCount(0);
  const dismissedAt = await page.evaluate((key) => localStorage.getItem(key), DISMISSAL_KEY);
  expect(Number(dismissedAt)).toBeGreaterThan(0);
  await renewSession(page);
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("juet.portal.session.v1")).username)).toBe("test-student");
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await waitForLogin(page);
  await expect(banner(page)).toHaveCount(0);
  await page.reload();
  await waitForLogin(page);
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), DISMISSAL_KEY)).toBe(dismissedAt);
});

test("dismissal expires on the 14-day boundary", async ({ page }) => {
  const now = new Date("2026-10-01T12:00:00Z");
  await page.clock.setFixedTime(now);
  await openApp(page);
  await banner(page).getByRole("button", { name: "Dismiss install banner for 14 days" }).click();
  await page.clock.setFixedTime(new Date(now.getTime() + DISMISSAL_MS - 1));
  await page.reload();
  await waitForLogin(page);
  await expect(banner(page)).toHaveCount(0);
  await page.clock.setFixedTime(new Date(now.getTime() + DISMISSAL_MS));
  await page.reload();
  await waitForLogin(page);
  await expect(banner(page)).toBeVisible();
});

for (const raw of ["not-a-timestamp", "1", "9999999999999"]) {
  test(`invalid/expired/future dismissal ${raw} does not permanently hide the banner`, async ({ page }) => {
    await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: DISMISSAL_KEY, raw });
    await openApp(page);
    await expect(banner(page)).toBeVisible();
  });
}

test("another tab's dismissal is reflected immediately", async ({ page, context }) => {
  await openApp(page);
  const otherPage = await context.newPage();
  await openApp(otherPage);
  await expect(banner(otherPage)).toBeVisible();
  await banner(page).getByRole("button", { name: "Dismiss install banner for 14 days" }).click();
  await expect(banner(otherPage)).toHaveCount(0);
});

test("blocked localStorage does not break the page or lose an in-memory dismissal on focus", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
  });
  await openApp(page);
  await expect(banner(page)).toBeVisible();
  await banner(page).getByRole("button", { name: "Dismiss install banner for 14 days" }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const standalone of ["display-mode", "navigator"]) {
  test(`is completely absent in ${standalone} standalone mode`, async ({ page }) => {
    await page.addInitScript((standalone) => {
      if (standalone === "navigator") {
        Object.defineProperty(navigator, "standalone", { get: () => true });
      } else {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const result = original(query);
          if (query === "(display-mode: standalone)") Object.defineProperty(result, "matches", { get: () => true });
          return result;
        };
      }
    }, standalone);
    await openApp(page);
    await expect(banner(page)).toHaveCount(0);
    await expect(page.locator(".install-banner-space")).toHaveCount(0);
    await emitNativePrompt(page);
    await expect(banner(page)).toHaveCount(0);
  });
}

test("the keyboard temporarily hides the card without persisting a dismissal", async ({ page }) => {
  await openApp(page);
  await expect(banner(page)).toBeVisible();
  await page.getByLabel("Enrollment no", { exact: true }).focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => window.innerHeight - 250 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator(".install-banner")).toBeHidden();
  await expect(page.locator(".install-banner-space")).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), DISMISSAL_KEY)).toBeNull();
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(banner(page)).toBeVisible();
});

test("reserves enough scroll space to keep footer controls above expanded guidance", async ({ page }) => {
  await openApp(page, { dashboard: true });
  await banner(page).getByRole("button", { name: "How to install" }).click();
  await expect(banner(page).locator(".install-banner-guide")).toBeVisible();
  await expect.poll(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = await page.getByRole("button", { name: "Logout", exact: true }).boundingBox();
    const card = await banner(page).boundingBox();
    return footer.y + footer.height <= card.y;
  }).toBe(true);
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await waitForLogin(page);
});

test("guidance still works without ResizeObserver", async ({ page }) => {
  await page.addInitScript(() => { window.ResizeObserver = undefined; });
  await openApp(page, { dashboard: true });
  await banner(page).getByRole("button", { name: "How to install" }).click();
  await expect(banner(page).locator(".install-banner-guide")).toBeVisible();
  await expect.poll(async () => {
    const cardHeight = await banner(page).evaluate((card) => card.offsetHeight);
    const spacerHeight = await page.locator(".install-banner-space").evaluate((spacer) => spacer.offsetHeight);
    return spacerHeight >= cardHeight;
  }).toBe(true);
});

test("fits a 320px phone, exposes 48px tap targets, and respects reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  const card = banner(page);
  await card.getByRole("button", { name: "How to install" }).click();
  const bounds = await card.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(await card.evaluate((card) => card.scrollWidth <= card.clientWidth)).toBe(true);
  for (const control of await card.locator("button, a").all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(48);
  }
  expect(await card.evaluate((card) => parseFloat(getComputedStyle(card).animationDuration))).toBeLessThan(0.001);
});

test("is scrollable rather than clipped on a short landscape screen with enlarged text", async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await openApp(page);
  await page.evaluate(() => document.activeElement?.blur());
  await page.addStyleTag({ content: ".install-banner h2 { font-size: 32px; } .install-banner p, .install-banner button, .install-banner a, .install-banner li { font-size: 26px; }" });
  await banner(page).getByRole("button", { name: "How to install" }).click();
  const bounds = await banner(page).boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(320);
  expect(await banner(page).evaluate((card) => card.scrollWidth <= card.clientWidth)).toBe(true);
  await banner(page).getByRole("button", { name: "Dismiss install banner for 14 days" }).click();
  await expect(banner(page)).toHaveCount(0);
});

test.describe("desktop visitors", () => {
  test.use({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
    isMobile: false,
    hasTouch: false,
  });
  test("does not show a banner or intercept the browser's native install UI", async ({ page }) => {
    await mockPortal(page);
    await page.goto("/");
    await waitForLogin(page);
    await expect(banner(page)).toHaveCount(0);
    expect(await emitNativePrompt(page)).toBe(false);
  });
});
