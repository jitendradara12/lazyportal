import { test, expect } from "@playwright/test";
import { computeSubjectRowChecksum } from "../../src/lib/portalSchedule.ts";
import { mockPortal, SESSION } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await mockPortal(page);
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
    cache("att.subject", { P: { student_attdsummarylist: Array.from({ length: 28 }, (_, i) => ({ datetime: `${i + 1}/10/2026 09:00 AM`, present: "Y" })) } }, ["sem1", "subject1"], { checksum });
  }, { session: SESSION, row, checksum: computeSubjectRowChecksum(row) });
  await page.goto("/");
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // Wait for the entrance animation before measuring the handle.
  await page.getByRole("dialog").evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });
});

async function pull(page, distance, { cancel = false, slow = false } = {}) {
  const handle = page.locator(".att-sheet-handle");
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + distance, { steps: 5 });
  await expect.poll(() => page.getByRole("dialog").evaluate((el) => getComputedStyle(el).translate)).toBe(`0px ${distance}px`);
  if (slow) await page.waitForTimeout(150);
  if (cancel) await handle.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
}

test("More saves the default target across reloads and calculator overrides", async ({ page }) => {
  const calculator = page.getByRole("radiogroup", { name: "Target percentage", exact: true });
  await expect(calculator.getByRole("radio", { name: "70%", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  for (const target of [80, 90, 70]) {
    await page.goto("/#more");
    const preference = page.getByRole("radiogroup", { name: "Default attendance target", exact: true });
    await preference.getByRole("radio", { name: `${target}%`, exact: true }).click();
    await page.reload();
    await expect(preference.getByRole("radio", { name: `${target}%`, exact: true })).toBeChecked();
    await page.goto("/#attendance");
    await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
    await expect(calculator.getByRole("radio", { name: `${target}%`, exact: true })).toBeChecked();
    await calculator.getByRole("radio", { name: `${target === 70 ? 90 : 70}%`, exact: true }).click();
    await page.getByRole("button", { name: "Close subject details" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
    await expect(calculator.getByRole("radio", { name: `${target}%`, exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Close subject details" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("short pulls and cancelled drags return to position; long pulls dismiss", async ({ page }) => {
  await pull(page, 20, { slow: true });
  await expect.poll(() => page.getByRole("dialog").evaluate((el) => getComputedStyle(el).translate)).toBe("0px");
  await pull(page, 60, { cancel: true });
  await expect.poll(() => page.getByRole("dialog").evaluate((el) => getComputedStyle(el).translate)).toBe("0px");
  await pull(page, 120);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("history scrolls without dismissing; the close button still works", async ({ page, browserName }) => {
  const dialog = page.getByRole("dialog");
  if (browserName === "webkit") {
    // Playwright cannot send wheel or touch swipes to mobile WebKit.
    await dialog.evaluate((el) => el.scrollBy(0, 300));
  } else {
    await dialog.hover();
    await page.mouse.wheel(0, 300);
  }
  await expect.poll(() => dialog.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) => { el.scrollTop = 0; });
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(dialog).toHaveCount(0);
});

test("a native touch drag dismisses the mobile sheet", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Native touch swipes require Chromium's input API");
  const box = await page.locator(".att-sheet-handle").boundingBox();
  const client = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let distance = 20; distance <= 120; distance += 20) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + distance }] });
  }
  await expect.poll(() => page.getByRole("dialog").evaluate((el) => getComputedStyle(el).translate)).toBe("0px 120px");
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("desktop keeps its centered dialog and Escape dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator(".att-sheet-handle")).toBeHidden();
  const box = await page.getByRole("dialog").boundingBox();
  expect(Math.abs(box.x + box.width / 2 - 500)).toBeLessThan(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
