import { test, expect } from "@playwright/test";
import { mockPortal, SESSION } from "./helpers.js";

async function setup(page) {
  await mockPortal(page);
  const requests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
  });
  await page.addInitScript((session) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    localStorage.setItem("juet.portal.install.dismissedAt.v1", String(Date.now()));
    const semesters = [
      { registrationid: "current", registrationcode: "2026ODDSEM" },
      { registrationid: "past", registrationcode: "2026EVESEM" },
    ];
    const cache = (feature, data, parts = []) => {
      const key = [feature, session.username, session.instituteid, ...parts].map(encodeURIComponent).join(":");
      localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data: feature.startsWith("marks.") ? { ...data, historyRecovered: true } : data, updatedAt: Date.now() }));
    };
    cache("att.initial", { header: {}, semesters, rows: [] });
    cache("att.lov", { header: {}, semesters });
    cache("marks.latest", { semesters, rows: [
      { subjectcode: "CS109", subjectdesc: "COMPUTER NETWORKS", eventcode: "TEST-3", obtainedmarks: "28.5", fullmarks: "35" },
      { subjectcode: "CS109", subjectdesc: "COMPUTER NETWORKS", eventcode: "TEST-1", obtainedmarks: "9", fullmarks: "15" },
      { subjectcode: "CS109", subjectdesc: "COMPUTER NETWORKS", eventcode: "TEST-2", obtainedmarks: "20", fullmarks: "25" },
      { subjectcode: "CS110", subjectdesc: "THEORY OF COMPUTATION", eventcode: "TEST-1", obtainedmarks: "14", fullmarks: "15" },
      { subjectcode: "CS110", subjectdesc: "THEORY OF COMPUTATION", eventcode: "TEST-2", obtainedmarks: "21", fullmarks: "25" },
      { subjectcode: "CS212", subjectdesc: "COMPUTER NETWORKS LAB", eventcode: "P-1", obtainedmarks: "9", fullmarks: "15" },
      { subjectcode: "MA106", subjectdesc: "PROBABILITY THEORY AND RANDOM PROCESSES", eventcode: "TEST-1", obtainedmarks: "7.5", fullmarks: "15" },
      { subjectcode: "PH304", subjectdesc: "MATERIALS SCIENCE AND APPLICATIONS", eventcode: "TEST-1", obtainedmarks: "0", fullmarks: "15" },
      { subjectcode: "HS301", subjectdesc: "CONCEPTS OF ECONOMICS", eventcode: "TEST-1", obtainedmarks: "AB", fullmarks: "15" },
    ] });
    cache("marks.detail", { rows: [
      { subjectcode: "CS109", subjectdesc: "COMPUTER NETWORKS", eventcode: "TEST-1", obtainedmarks: 10, fullmarks: 15 },
      { subjectcode: "CS109", subjectdesc: "COMPUTER NETWORKS", eventcode: "TEST-2", obtainedmarks: 15, fullmarks: 25 },
    ] }, ["past"]);
  }, { ...SESSION, enrollmentno: "241B123" });
  await page.goto("/#marks");
  await expect(page.getByRole("heading", { name: "Marks", exact: true })).toBeVisible();
  await expect(page.locator(".score-card")).toHaveCount(6);
  return requests;
}

const course = (page, code) => page.locator(".score-card").filter({ has: page.locator(".att-code", { hasText: code }) });

test("course totals expand independently into ordered exam marks while single-exam courses stay static", async ({ page }) => {
  const requests = await setup(page);
  const networks = course(page, "CS109");
  const theory = course(page, "CS110");
  const toggle = networks.locator("button.score-header");
  await expect(networks.locator(".score-meta")).toHaveText("CS109 · T1, T2, T3");
  await expect(theory.locator(".score-meta")).toHaveText("CS110 · T1, T2");
  await expect(toggle.locator(".score-value")).toHaveText("57.5/75");
  await expect(networks.getByRole("list", { name: "Computer Networks exam marks" })).not.toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(networks.locator(".score-exam-label")).toHaveText(["T1", "T2", "T3"]);
  await expect(networks.locator(".score-exam .score-value")).toHaveText(["9/15", "20/25", "28.5/35"]);
  await theory.locator("button.score-header").click();
  await expect(networks.locator("button.score-header")).toHaveAttribute("aria-expanded", "true");
  await expect(theory.locator("button.score-header")).toHaveAttribute("aria-expanded", "true");
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(networks.locator("button.score-header")).toHaveAttribute("aria-expanded", "false");
  await expect(theory.locator("button.score-header")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("tablist", { name: "Filter marks by test" })).toHaveCount(0);
  const lab = course(page, "CS212");
  await expect(lab.locator(".score-meta")).toHaveText("CS212 · P1");
  await expect(lab.locator(".score-header .score-value")).toHaveText("9/15");
  await expect(lab.locator("button.score-header")).toHaveCount(0);
  await expect(lab.locator(".score-expansion")).toHaveCount(0);
  await expect(course(page, "PH304").locator(".score-header .score-value")).toHaveText("0/15");
  await expect(course(page, "HS301").locator(".score-header .score-value")).toHaveText("AB/15");
  expect(requests).toEqual([]);
});

test("switching semesters replaces course totals and resets expansion", async ({ page }) => {
  const requests = await setup(page);
  await course(page, "CS109").locator("button.score-header").click();
  await page.getByRole("combobox", { name: "Select semester" }).selectOption("past");
  await expect(page.locator(".score-card")).toHaveCount(1);
  await expect(page.locator(".score-header .score-value")).toHaveText("25/40");
  await expect(page.locator("button.score-header")).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("combobox", { name: "Select semester" }).selectOption("current");
  await expect(page.locator(".score-card")).toHaveCount(6);
  await expect(course(page, "CS109").locator(".score-header .score-value")).toHaveText("57.5/75");
  expect(requests).toEqual([]);
});

test("score numbers carry semantic bands on totals and breakdown rows without progress bars", async ({ page }) => {
  await setup(page);
  await expect(page.locator(".score-progress")).toHaveCount(0);
  for (const [code, band] of [
    ["CS109", "neutral"],
    ["CS110", "good"],
    ["CS212", "neutral"],
    ["MA106", "warning"],
    ["PH304", "low"],
    ["HS301", "neutral"],
  ]) {
    const card = course(page, code);
    await expect(card.locator(".score-header .score-value")).toHaveAttribute("data-band", band);
  }
  const networks = course(page, "CS109");
  await networks.locator("button.score-header").click();
  await expect(networks.locator(".score-exam .score-value").nth(0)).toHaveAttribute("data-band", "neutral");
  await expect(networks.locator(".score-exam .score-value").nth(1)).toHaveAttribute("data-band", "good");
  await expect(networks.locator(".score-exam .score-value").nth(2)).toHaveAttribute("data-band", "good");
});

test("Discreet mode hides identity, neutralizes marks and survives reloads", async ({ page }) => {
  const requests = await setup(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  const scores = await page.locator(".score-header .score-value").allTextContents();
  await nav.getByRole("button", { name: "More", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Discreet mode" });
  await expect(toggle).not.toBeChecked();
  await expect(page.locator(".profile")).toContainText("241B123");
  const logoutColor = await page.locator(".more-action.is-danger").evaluate((el) => getComputedStyle(el).color);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect(page.locator(".profile-name")).toHaveText("Student");
  await expect(page.locator(".profile-avatar")).toHaveText("S");
  await expect(page.locator(".profile")).not.toContainText("Test Student");
  await expect(page.locator(".profile")).not.toContainText("241B123");
  expect(await page.locator(".more-action.is-danger").evaluate((el) => getComputedStyle(el).color)).toBe(logoutColor);
  await nav.getByRole("button", { name: "Marks", exact: true }).click();
  for (const colorScheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await expect.poll(() => page.locator(".score-header .score-value strong").evaluateAll((els) =>
      new Set(els.map((el) => getComputedStyle(el).color)).size)).toBe(1);
  }
  expect(await page.locator(".score-header .score-value").allTextContents()).toEqual(scores);
  await nav.getByRole("button", { name: "More", exact: true }).click();
  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(page.locator(".profile-name")).toHaveText("Student");
  await expect(page.locator(".profile")).not.toContainText("241B123");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).not.toBeChecked();
  await expect(page.locator(".profile-name")).toHaveText("Test Student");
  await expect(page.locator(".profile")).toContainText("241B123");
  await nav.getByRole("button", { name: "Marks", exact: true }).click();
  const restoredColors = await page.locator(".score-header .score-value strong").evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
  expect(new Set(restoredColors).size).toBe(4);
  expect(requests).toEqual([]);
});

test("course height animates in both directions and rapid toggles settle correctly", async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const card = course(page, "CS109");
  const sampleToggle = () => card.evaluate(async (element) => {
    const expansion = element.querySelector(".score-expansion");
    element.querySelector(".score-header").click();
    await new Promise(requestAnimationFrame);
    const animation = expansion.getAnimations().find((item) => item.transitionProperty === "grid-template-rows");
    if (!animation) throw new Error("Course height did not animate");
    animation.pause();
    const heights = [0, 80, 360].map((time) => {
      animation.currentTime = time;
      return element.getBoundingClientRect().height;
    });
    animation.finish();
    return heights;
  });
  const opening = await sampleToggle();
  expect(opening[1]).toBeGreaterThan(opening[0]);
  expect(opening[1]).toBeLessThan(opening[2]);
  const closing = await sampleToggle();
  expect(closing[1]).toBeLessThan(closing[0]);
  expect(closing[1]).toBeGreaterThan(closing[2]);
  await card.evaluate(async (element) => {
    const button = element.querySelector(".score-header");
    for (let i = 0; i < 3; i++) {
      button.click();
      await new Promise(requestAnimationFrame);
    }
  });
  await expect(card.locator(".score-header")).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByRole("list")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await card.locator(".score-header").click();
  await expect(card.locator(".score-expansion")).toBeHidden();
});

test("expanded marks fit narrow screens and desktop in both themes", async ({ page }) => {
  await setup(page);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      for (const header of await page.locator(".score-header").all()) {
        if (await header.getAttribute("aria-expanded") === "false") await header.click();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const networks = course(page, "CS109");
      const header = networks.locator(".score-header");
      const subject = await header.locator(".score-info").boundingBox();
      const score = await header.locator(".score-value").boundingBox();
      const examScore = await networks.locator(".score-exam .score-value").first().boundingBox();
      const singleScore = await course(page, "CS212").locator(".score-header .score-value").boundingBox();
      expect(subject.x + subject.width).toBeLessThanOrEqual(score.x);
      expect(Math.abs((score.x + score.width) - (examScore.x + examScore.width))).toBeLessThanOrEqual(1);
      expect(Math.abs((score.x + score.width) - (singleScore.x + singleScore.width))).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `/tmp/marks-${test.info().project.name}-${width}-${colorScheme}.png`, fullPage: true });
    }
  }
});
