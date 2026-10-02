import { test, expect, devices } from "@playwright/test";
import { banner, openApp } from "./helpers.js";

test("Safari has visual Share/Add instructions and accessible inline steps", async ({ page }) => {
  await openApp(page);
  const card = banner(page);
  await expect(card.locator(".install-banner-copy")).toContainText("Tap Share");
  await expect(card.locator(".install-banner-copy")).toContainText("Add to Home Screen");
  await expect(card.locator(".install-banner-copy svg")).toHaveCount(2);
  const toggle = card.getByRole("button", { name: /How to install|Hide steps/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const guideId = await toggle.getAttribute("aria-controls");
  await expect(page.locator(`[id="${guideId}"]`)).toBeHidden();
  await toggle.focus();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  const guide = page.locator(`[id="${guideId}"]`);
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("listitem")).toHaveCount(2);
  await expect(guide).toContainText("Safari’s toolbar");
  await expect(guide).toContainText("then tap Add");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByRole("link")).toContainText("Android only");
});

test("desktop-mode iPadOS receives Safari guidance, not a desktop banner or APK-only UI", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
      Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
    });
    const page = await context.newPage();
    await openApp(page);
    await expect(banner(page).locator(".install-banner-copy")).toContainText("Tap Share");
  } finally {
    await context.close();
  }
});

test("iOS Chrome asks users to open Safari before following the guide", async ({ browser }) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    userAgent: devices["iPhone 13"].userAgent.replace(/Version\/\S+/, "CriOS/128.0"),
  });
  try {
    const page = await context.newPage();
    await openApp(page);
    await expect(banner(page).locator(".install-banner-copy")).toContainText("Open this page in Safari");
    await banner(page).getByRole("button", { name: "How to install" }).click();
    await expect(banner(page).locator(".install-banner-guide")).toContainText("First, open this page in Safari");
  } finally {
    await context.close();
  }
});
