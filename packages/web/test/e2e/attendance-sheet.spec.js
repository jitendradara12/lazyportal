import { test, expect } from "@playwright/test";
import { computeSubjectRowChecksum } from "../../src/lib/portalSchedule.ts";
import { decrypt } from "../../../core/src/crypto.js";
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

test("Discreet mode neutralizes attendance overview, advice and class history", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Close subject details" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("switch", { name: "Discreet mode" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Attendance/ }).click();
  const percentage = page.locator(".att-row-pct");
  const originalPercentage = await percentage.textContent();
  const textColor = await page.locator("body").evaluate((el) => getComputedStyle(el).color);
  await expect(percentage).toHaveCSS("color", textColor);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  await expect(page.locator(".att-sheet-score")).toHaveCSS("color", textColor);
  const neutralText = await page.locator(".att-sheet-kpi-label").evaluate((el) => getComputedStyle(el).color);
  await expect(page.locator(".att-advice-inline.bunk").first()).toHaveCSS("color", neutralText);
  await expect(page.locator(".log-badge.present").first()).toHaveCSS("color", neutralText);
  await expect(page.locator(".log-badge.present").first()).toHaveText("Present");
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(percentage).toHaveText(originalPercentage);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("switch", { name: "Discreet mode" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Attendance/ }).click();
  expect(await percentage.evaluate((el) => getComputedStyle(el).color)).not.toBe(textColor);
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

for (const addTutorial of [false, true]) {
test(`${addTutorial ? "adding a tutorial" : "changed overview"} keeps saved history and calculator visible during a failed update`, async ({ page }) => {
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/**/getstudentsubjectpersentage", async (route) => {
    await gate;
    await route.fulfill({ status: 503, body: "Unavailable" });
  });
  await page.evaluate(({ session, addTutorial }) => {
    const key = ["att.initial", session.username, session.instituteid].map(encodeURIComponent).join(":");
    const entry = JSON.parse(localStorage.getItem(`juet.cache.${key}`));
    entry.data.rows[0].Ppercentage = 90;
    if (addTutorial) {
      const row = entry.data.rows[0];
      delete row.Psubjectcomponentid;
      delete row.Ppercentage;
      Object.assign(row, { Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "new-tutorial", LTpercentage: 90 });
      const subjectKey = ["att.subject", session.username, session.instituteid, "sem1", "subject1"].map(encodeURIComponent).join(":");
      const saved = JSON.parse(localStorage.getItem(`juet.cache.${subjectKey}`));
      saved.data = { L: saved.data.P };
      localStorage.setItem(`juet.cache.${subjectKey}`, JSON.stringify(saved));
    }
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    window.dispatchEvent(new CustomEvent("juet:cache-updated", { detail: { key } }));
  }, { session: SESSION, addTutorial });
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  const dialog = page.getByRole("dialog");
  try {
    await expect(dialog.getByRole("button", { name: "All (28)", exact: true })).toBeVisible();
    await expect(dialog.getByRole("radiogroup", { name: "Target percentage", exact: true })).toBeVisible();
    await expect(dialog.locator(".att-sheet-score")).toHaveText("90.0%");
    await expect(dialog.locator(".att-sheet-ratio-val")).toHaveText("28 / 28");
  } finally {
    release();
  }
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "All (28)", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "What-if calculator", exact: true })).toBeVisible();
  await expect(dialog.locator(".att-sheet-ratio-val")).toHaveText("28 / 28");
});
}

test("yesterday's overview failing does not block an uncached subject", async ({ page }) => {
  await page.addInitScript((session) => {
    const key = ["att.initial", session.username, session.instituteid].map(encodeURIComponent).join(":");
    const entry = JSON.parse(localStorage.getItem(`juet.cache.${key}`));
    entry.updatedAt = Date.now() - 86400000;
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    const subject = ["att.subject", session.username, session.instituteid, "sem1", "subject1"].map(encodeURIComponent).join(":");
    localStorage.removeItem(`juet.cache.${subject}`);
  }, SESSION);
  await page.route("**/api/**/getstudentattendancedetail", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.route("**/api/**/getstudentsubjectpersentage", (route) => route.fulfill({ json: {
    status: { responseStatus: "Success" }, response: { student_attdsummarylist: [{ datetime: "28/10/2026 09:00 AM", present: "Y" }] },
  } }));
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "All (1)", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Loading class breakdown…", { exact: true })).toHaveCount(0);
});

test("a timed-out read releases shared work so reopening can retry without losing saved history", async ({ page }) => {
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.clock.install();
  let calls = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/**/getstudentsubjectpersentage", async (route) => {
    calls++;
    if (calls === 1) await gate;
    await route.fulfill({ json: { status: { responseStatus: "Success" }, response: {
      student_attdsummarylist: Array.from({ length: 30 }, () => ({ present: "Y", datetime: "28/10/2026 09:00 AM" })),
    } } });
  });
  await page.evaluate((session) => {
    const key = ["att.initial", session.username, session.instituteid].map(encodeURIComponent).join(":");
    const entry = JSON.parse(localStorage.getItem(`juet.cache.${key}`));
    entry.data.rows[0].Ppercentage = 90;
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    window.dispatchEvent(new CustomEvent("juet:cache-updated", { detail: { key } }));
  }, SESSION);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  await expect.poll(() => calls).toBe(1);
  try {
    await page.clock.fastForward(60_001);
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("too long");
    await expect(page.getByRole("dialog").getByRole("button", { name: "All (28)", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close subject details" }).click();
    await page.clock.runFor(250);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "All (30)", exact: true })).toBeVisible();
    expect(calls).toBe(2);
  } finally {
    release();
  }
});

test("session recovery is visible and its failure preserves saved history with a retry", async ({ page }) => {
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/**/getstudentsubjectpersentage", (route) => route.fulfill({ status: 401, body: "" }));
  await page.route("**/api/token/refreshTokenRequest", async (route) => {
    await gate;
    await route.fulfill({ status: 401, body: "" });
  });
  await page.evaluate((session) => {
    const key = ["att.initial", session.username, session.instituteid].map(encodeURIComponent).join(":");
    const entry = JSON.parse(localStorage.getItem(`juet.cache.${key}`));
    entry.data.rows[0].Ppercentage = 90;
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    window.dispatchEvent(new CustomEvent("juet:cache-updated", { detail: { key } }));
  }, SESSION);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  const dialog = page.getByRole("dialog");
  try {
    await expect(dialog.getByRole("status")).toHaveText("Reconnecting to JUET's portal…");
    await expect(dialog.getByRole("button", { name: "All (28)", exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "All (28)", exact: true })).toBeVisible();
});

test("a newer overview arriving during a breakdown read gets its own revalidation", async ({ page }) => {
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let calls = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/**/getstudentsubjectpersentage", async (route) => {
    calls++;
    if (calls === 1) await gate;
    await route.fulfill({ json: { response: {
      student_attdsummarylist: Array.from({ length: calls === 1 ? 30 : 32 }, () => ({ present: "Y", datetime: "28/10/2026 09:00 AM" })),
    } } });
  });
  const update = (percentage) => page.evaluate(({ session, percentage }) => {
    const key = ["att.initial", session.username, session.instituteid].map(encodeURIComponent).join(":");
    const entry = JSON.parse(localStorage.getItem(`juet.cache.${key}`));
    entry.data.rows[0].Ppercentage = percentage;
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    window.dispatchEvent(new CustomEvent("juet:cache-updated", { detail: { key } }));
  }, { session: SESSION, percentage });
  await update(90);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  await expect.poll(() => calls).toBe(1);
  await update(80);
  release();
  await expect(page.getByRole("dialog").getByRole("button", { name: "All (32)", exact: true })).toBeVisible();
  expect(calls).toBe(2);
});

test("a normal 25-second portal response shows progress and succeeds on its first attempt", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.clock.install();
  let release, calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/**/getstudentsubjectpersentage", async (route) => {
    calls++;
    await gate;
    await route.fulfill({ json: { response: { student_attdsummarylist: [
      { datetime: "28/10/2026 09:00 AM", present: "Y" },
    ] } } });
  });
  await page.evaluate((session) => {
    const key = ["att.initial", session.username, session.instituteid].map(encodeURIComponent).join(":");
    const entry = JSON.parse(localStorage.getItem(`juet.cache.${key}`));
    entry.data.rows[0].Ppercentage = 90;
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    window.dispatchEvent(new CustomEvent("juet:cache-updated", { detail: { key } }));
  }, SESSION);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  await expect.poll(() => calls).toBe(1);
  const dialog = page.getByRole("dialog");
  try {
    await expect(dialog.getByRole("status")).toHaveText("Updating breakdown…");
    await page.clock.runFor(100);
    await page.clock.fastForward(8_001);
    await expect(dialog.getByRole("status")).toContainText("Just wait, JUET's server is responding really slow.");
    await expect(dialog.getByRole("button", { name: "All (28)", exact: true })).toBeVisible();
    for (const [name, width, height] of [["mobile", 412, 839], ["desktop", 1280, 900]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: testInfo.outputPath(`slow-portal-${name}.png`), animations: "disabled" });
    }
    await page.clock.fastForward(17_000);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  } finally {
    release();
  }
  await expect(dialog.getByRole("button", { name: "All (1)", exact: true })).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  expect(calls).toBe(1);
});

test("retrying a failed tutorial preserves saved history and reuses its successful lecture", async ({ page }) => {
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let lectureReads = 0, tutorialReads = 0, releaseTutorial;
  const firstTutorial = new Promise((resolve) => { releaseTutorial = resolve; });
  const record = (present) => ({ present, datetime: "28/10/2026 09:00 AM" });
  await page.route("**/api/**/getstudentsubjectpersentage", async (route) => {
    const payload = JSON.parse(await decrypt(route.request().postData()));
    const lecture = payload.cmpidkey[0].subjectcomponentid === "lecture";
    if (lecture) lectureReads++;
    else tutorialReads++;
    if (!lecture && tutorialReads === 1) {
      await firstTutorial;
      return route.fulfill({ status: 503, body: "Unavailable" });
    }
    await route.fulfill({ json: { response: { student_attdsummarylist: lecture
      ? [record("Y"), record("Y"), record("Y")] : [record("N")] } } });
  });
  await page.evaluate((session) => {
    const key = ["att.initial", session.username, session.instituteid].map(encodeURIComponent).join(":");
    const entry = JSON.parse(localStorage.getItem(`juet.cache.${key}`));
    entry.data.rows[0] = { subjectid: "subject1", subjectcode: "TEST SUBJECT(CS101)",
      Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial", LTpercentage: 75 };
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    const detailKey = ["att.subject", session.username, session.instituteid, "sem1", "subject1"].map(encodeURIComponent).join(":");
    const component = { student_attdsummarylist: [{ present: "Y", datetime: "27/10/2026 09:00 AM" }] };
    localStorage.setItem(`juet.cache.${detailKey}`, JSON.stringify({ data: { L: component, T: component }, updatedAt: Date.now(), checksum: "old" }));
    window.dispatchEvent(new CustomEvent("juet:cache-updated", { detail: { key } }));
  }, SESSION);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status")).toHaveText("Updating breakdown…");
  releaseTutorial();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "All (2)", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "All (4)", exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(lectureReads).toBe(1);
  expect(tutorialReads).toBe(2);
});

test("a cold history shows its completed lecture while the tutorial is still loading", async ({ page }) => {
  const renderLoops = [];
  page.on("console", message => {
    if (/Maximum update depth/.test(message.text())) renderLoops.push(message.text());
  });
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let releaseTutorial;
  const tutorial = new Promise(resolve => { releaseTutorial = resolve; });
  const reads = [];
  await page.route("**/api/**/getstudentsubjectpersentage", async route => {
    const payload = JSON.parse(await decrypt(route.request().postData()));
    const component = payload.cmpidkey[0].subjectcomponentid;
    reads.push(component);
    if (component === "tutorial") await tutorial;
    await route.fulfill({ json: { response: { summary: [{ present: component === "lecture" ? "Y" : "N", datetime: "28/10/2026 09:00 AM" }] } } });
  });
  await page.evaluate(session => {
    const key = ["att.initial", session.username, session.instituteid].map(encodeURIComponent).join(":");
    const entry = JSON.parse(localStorage.getItem(`juet.cache.${key}`));
    entry.data.rows[0] = { subjectid: "subject1", subjectcode: "TEST SUBJECT(CS101)",
      Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial", LTpercentage: 75 };
    const subjectKey = ["att.subject", session.username, session.instituteid, "sem1", "subject1"].map(encodeURIComponent).join(":");
    localStorage.removeItem(`juet.cache.${subjectKey}`);
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    window.dispatchEvent(new CustomEvent("juet:cache-updated", { detail: { key } }));
  }, SESSION);
  await page.getByRole("button", { name: /Test Subject, .*attendance/i }).click();
  const dialog = page.getByRole("dialog");
  try {
    await expect(dialog.getByRole("button", { name: "All (1)", exact: true })).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveText("Updating breakdown…");
    expect(reads.sort()).toEqual(["lecture", "tutorial"]);
    await page.evaluate(() => new Promise(resolve => {
      let frames = 0;
      const frame = () => ++frames === 15 ? resolve() : requestAnimationFrame(frame);
      requestAnimationFrame(frame);
    }));
    expect(renderLoops).toEqual([]);
  } finally { releaseTutorial(); }
  await expect(dialog.getByRole("button", { name: "All (2)", exact: true })).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveCount(0);
});

test("subjects with no attendance cache the portal's empty result without a page error", async ({ page }) => {
  await page.getByRole("button", { name: "Close subject details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let reads = 0;
  await page.route("**/api/**/getstudentsubjectpersentage", route => {
    reads++;
    return route.fulfill({ status: 404, json: { status: { responseStatus: "Failure", errors: ["NO Attendance Found"] } } });
  });
  await page.evaluate(session => {
    const key = ["att.initial", session.username, session.instituteid].map(encodeURIComponent).join(":");
    const entry = JSON.parse(localStorage.getItem(`juet.cache.${key}`));
    entry.data.rows.push(
      { subjectid: "minor", subjectcode: "MINOR PROJECT-1(CS211)", Lsubjectcomponentid: "minor", Lpercentage: 0 },
      { subjectid: "internship", subjectcode: "SUMMER INTERNSHIP(CS003)", Psubjectcomponentid: "internship", Ppercentage: 0 },
    );
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    window.dispatchEvent(new CustomEvent("juet:cache-updated", { detail: { key } }));
  }, SESSION);
  for (const name of ["Minor Project-1", "Summer Internship"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${name},`) })).toContainText("No attendance recorded");
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: /^Minor Project-1,/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("No attendance recorded for this subject.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(reads).toBe(2);
});

test("background caching resumes after the open subject finishes, while its sheet stays open", async ({ page }) => {
  let releaseFirst;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  const reads = [];
  await page.route("**/api/**/getstudentsubjectpersentage", async route => {
    const payload = JSON.parse(await decrypt(route.request().postData()));
    reads.push(payload.subjectid);
    if (payload.subjectid === "subject1") await first;
    await route.fulfill({ json: { response: { summary: [{ present: "Y", datetime: "28/10/2026 09:00 AM" }] } } });
  });
  await page.evaluate(session => {
    const key = ["att.initial", session.username, session.instituteid].map(encodeURIComponent).join(":");
    const entry = JSON.parse(localStorage.getItem(`juet.cache.${key}`));
    entry.data.rows[0].Ppercentage = 90;
    entry.data.rows.push({ subjectid: "subject2", subjectcode: "SECOND SUBJECT(CS102)", Psubjectcomponentid: "p2", Ppercentage: 100 });
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    window.dispatchEvent(new CustomEvent("juet:cache-updated", { detail: { key } }));
  }, SESSION);
  const dialog = page.getByRole("dialog");
  try {
    await expect.poll(() => reads).toEqual(["subject1"]);
    await expect(dialog.getByRole("button", { name: "All (28)", exact: true })).toBeVisible();
  } finally { releaseFirst(); }
  await expect(dialog.getByRole("button", { name: "All (1)", exact: true })).toBeVisible();
  await expect.poll(() => reads).toEqual(["subject1", "subject2"]);
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(session => {
    const key = ["att.subject", session.username, session.instituteid, "sem1", "subject2"].map(encodeURIComponent).join(":");
    return Boolean(JSON.parse(localStorage.getItem(`juet.cache.${key}`))?.checksum);
  }, SESSION)).toBe(true);
});
