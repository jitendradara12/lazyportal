import { test, expect } from "@playwright/test";
import { decrypt } from "../../../core/src/crypto.js";
import { mockPortal, SESSION } from "./helpers.js";
import { fileURLToPath } from "node:url";

for (const readerMode of ["normal browser", "no stream async iterator", "no workers", "no offscreen canvas"]) test(`a fresh login recovers T1 from the report when the API only returns T2: ${readerMode}`, async ({ page }) => {
  await page.addInitScript((mode) => {
    if (mode === "no stream async iterator") delete ReadableStream.prototype[Symbol.asyncIterator];
    if (mode === "no workers") {
      window.Worker = class {
        constructor() { throw new DOMException("Workers unavailable", "SecurityError"); }
      };
    }
    if (mode === "no offscreen canvas") delete window.OffscreenCanvas;
  }, readerMode);
  await mockPortal(page);
  const semesters = [{ registrationid: "current", registrationcode: "2026ODDSEM" }];
  await page.route("**/api/studentcommonsontroller/getsemestercode-exammarks", (route) => route.fulfill({
    json: { response: { semestercode: semesters } },
  }));
  await page.route("**/api/studentsexamview/getstudent-exammarks", (route) => route.fulfill({
    json: { response: { viewmarksbystudent: [
      { subjectcode: "CS303", subjectdesc: "ARTIFICIAL INTELLIGENCE", eventcode: "TEST-2", obtainedmarks: 13, fullmarks: 25 },
    ] } },
  }));
  await page.route("**/api/studentsexamview/printstudent-exammarks/**", (route) => route.fulfill({
    contentType: "application/pdf", path: fileURLToPath(new URL("../fixtures/marks-history.pdf", import.meta.url)),
  }));
  await page.addInitScript((session) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    localStorage.setItem("juet.portal.install.dismissedAt.v1", String(Date.now()));
  }, SESSION);
  await page.goto("/#marks");
  const ai = page.locator(".score-card").filter({ hasText: "CS303" });
  await expect(ai.locator(".score-header .score-value")).toHaveText("20/40", { timeout: 10_000 });
  await ai.locator(".score-header").click();
  await expect(ai.locator(".score-exam-label")).toHaveText(["T1", "T2"]);
  await expect(ai.locator(".score-exam .score-value")).toHaveText(["7/15", "13/25"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

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
    cache("marks.cgpa.latest", {
      student: { studentid: "12345", stynumber: 4 },
      currentsem: 4,
      semesters: [
        { stynumber: 1, sgpa: 8.03, cgpa: 8.03, earnedcredit: 19.5 },
        { stynumber: 2, sgpa: 8.51, cgpa: 8.29, earnedcredit: 22.5 },
        { stynumber: 3, sgpa: 8.1, cgpa: 8.23, earnedcredit: 20 },
        { stynumber: 4, sgpa: 7.0, cgpa: 7.92, earnedcredit: 21 },
      ],
    });
    const s1Detail = {
      semesterList: [
        { subjectcode: "CS101", subjectdesc: "Computer Programming", gradepoint: 10, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 40, grade: "O", fail: "N" },
        { subjectcode: "MA101", subjectdesc: "Engineering Mathematics", gradepoint: 8, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 32, grade: "A", fail: "N" },
        { subjectcode: "PH101", subjectdesc: "Engineering Physics-1", gradepoint: 5, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 20, grade: "C", fail: "N" },
        { subjectcode: "HS101", subjectdesc: "English", gradepoint: 7, coursecreditpoint: 3, earnedcredit: 3, sgpapoints: 21, grade: "B+", fail: "N" },
        { subjectcode: "CS201", subjectdesc: "Computer Programming Lab", gradepoint: 10, coursecreditpoint: 2, earnedcredit: 2, sgpapoints: 20, grade: "O", fail: "N" },
        { subjectcode: "ME201", subjectdesc: "Workshop Practices", gradepoint: 9, coursecreditpoint: 1.5, earnedcredit: 1.5, sgpapoints: 13.5, grade: "A+", fail: "N" },
        { subjectcode: "PH201", subjectdesc: "Engineering Physics Lab-1", gradepoint: 10, coursecreditpoint: 1, earnedcredit: 1, sgpapoints: 10, grade: "O", fail: "N" },
        { subjectcode: "HS001", subjectdesc: "Human Values and Professional Ethics", gradepoint: 0, coursecreditpoint: 0, earnedcredit: 0, sgpapoints: 0, grade: "AP", fail: "N" },
      ],
    };
    const s2Detail = {
      semesterList: [
        { subjectcode: "CS201", subjectdesc: "DATA STRUCTURES AND ALGORITHMS (DSA)", gradepoint: 9, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 36, grade: "A+", fail: "N" },
        { subjectcode: "ME202", subjectdesc: "INTRODUCTION TO 3D PRINTING", gradepoint: 10, coursecreditpoint: 3, earnedcredit: 3, sgpapoints: 30, grade: "O", fail: "N" },
        { subjectcode: "PH202", subjectdesc: "ENGINEERING PHYSICS - 2", gradepoint: 9, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 36, grade: "A+", fail: "N" },
        { subjectcode: "MA201", subjectdesc: "DISCRETE MATHEMATICS", gradepoint: 7, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 28, grade: "B+", fail: "N" },
        { subjectcode: "CS205", subjectdesc: "INTERNET OF THINGS (IOT) AND NOSQL", gradepoint: 8, coursecreditpoint: 3, earnedcredit: 3, sgpapoints: 24, grade: "A", fail: "N" },
        { subjectcode: "CS271", subjectdesc: "DBMS LAB", gradepoint: 9, coursecreditpoint: 1.5, earnedcredit: 1.5, sgpapoints: 13.5, grade: "A+", fail: "N" },
        { subjectcode: "CS272", subjectdesc: "UI/UX LAB", gradepoint: 10, coursecreditpoint: 1, earnedcredit: 1, sgpapoints: 10, grade: "O", fail: "N" },
        { subjectcode: "EC201", subjectdesc: "DIGITAL ELECTRONICS", gradepoint: 7, coursecreditpoint: 2, earnedcredit: 2, sgpapoints: 14, grade: "B+", fail: "N" },
      ],
    };
    const s3Detail = {
      semesterList: [
        { subjectcode: "CS301", subjectdesc: "DESIGN AND ANALYSIS OF ALGORITHMS", gradepoint: 9, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 36, grade: "A+", fail: "N" },
        { subjectcode: "CS302", subjectdesc: "OBJECT ORIENTED PROGRAMMING", gradepoint: 8, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 32, grade: "A", fail: "N" },
        { subjectcode: "CS303", subjectdesc: "COMPUTER NETWORKS", gradepoint: 8, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 32, grade: "A", fail: "N" },
        { subjectcode: "EC301", subjectdesc: "MICROPROCESSORS AND INTERFACING", gradepoint: 7, coursecreditpoint: 3, earnedcredit: 3, sgpapoints: 21, grade: "B+", fail: "N" },
        { subjectcode: "MA301", subjectdesc: "NUMERICAL METHODS", gradepoint: 8, coursecreditpoint: 3, earnedcredit: 3, sgpapoints: 24, grade: "A", fail: "N" },
        { subjectcode: "CS371", subjectdesc: "DAA LAB", gradepoint: 9, coursecreditpoint: 1, earnedcredit: 1, sgpapoints: 9, grade: "A+", fail: "N" },
        { subjectcode: "CS372", subjectdesc: "OOP LAB", gradepoint: 8, coursecreditpoint: 1, earnedcredit: 1, sgpapoints: 8, grade: "A", fail: "N" },
      ],
    };
    const s4Detail = {
      semesterList: [
        { subjectcode: "CS401", subjectdesc: "OPERATING SYSTEMS", gradepoint: 8, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 32, grade: "A", fail: "N" },
        { subjectcode: "CS402", subjectdesc: "DATABASE MANAGEMENT SYSTEMS", gradepoint: 7, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 28, grade: "B+", fail: "N" },
        { subjectcode: "CS403", subjectdesc: "COMPUTER ORGANIZATION AND ARCHITECTURE", gradepoint: 6, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 24, grade: "B", fail: "N" },
        { subjectcode: "MA401", subjectdesc: "PROBABILITY AND STATISTICS", gradepoint: 7, coursecreditpoint: 3, earnedcredit: 3, sgpapoints: 21, grade: "B+", fail: "N" },
        { subjectcode: "HS401", subjectdesc: "ENGINEERING ECONOMICS", gradepoint: 5, coursecreditpoint: 3, earnedcredit: 3, sgpapoints: 15, grade: "C", fail: "N" },
        { subjectcode: "CS471", subjectdesc: "OS LAB", gradepoint: 10, coursecreditpoint: 1, earnedcredit: 1, sgpapoints: 10, grade: "O", fail: "N" },
        { subjectcode: "CS472", subjectdesc: "DBMS LAB", gradepoint: 9, coursecreditpoint: 1, earnedcredit: 1, sgpapoints: 9, grade: "A+", fail: "N" },
        { subjectcode: "CS473", subjectdesc: "COA LAB", gradepoint: 8, coursecreditpoint: 1, earnedcredit: 1, sgpapoints: 8, grade: "A", fail: "N" },
      ],
    };
    cache("marks.cgpa.detail", s1Detail, [1]);
    cache("marks.cgpa.detail", s2Detail, [2]);
    cache("marks.cgpa.detail", s3Detail, [3]);
    cache("marks.cgpa.detail", s4Detail, [4]);
  }, { ...SESSION, enrollmentno: "241B123" });
  await page.goto("/#marks");
  await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
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

test("stale 1-semester marks cache from a prior portal day revalidates and reveals the semester selector", async ({ page }) => {
  await mockPortal(page);
  await page.route("**/api/studentcommonsontroller/getsemestercode-exammarks", (route) => route.fulfill({
    json: {
      response: {
        semestercode: [
          { registrationid: "current", registrationcode: "2026ODDSEM" },
          { registrationid: "past", registrationcode: "2026EVESEM" },
        ],
      },
    },
  }));
  await page.route("**/api/studentsexamview/getstudent-exammarks", async (route) => {
    const body = JSON.parse(await decrypt(route.request().postData()));
    const rows = body.registrationid === "past"
      ? [{ subjectcode: "CS109", subjectdesc: "COMPUTER NETWORKS", eventcode: "TEST-1", obtainedmarks: 10, fullmarks: 15 }]
      : [{ subjectcode: "CS303", subjectdesc: "ARTIFICIAL INTELLIGENCE", eventcode: "TEST-2", obtainedmarks: 13, fullmarks: 25 }];
    return route.fulfill({ json: { response: { viewmarksbystudent: rows } } });
  });
  await page.route("**/api/studentsexamview/printstudent-exammarks/**", (route) => route.fulfill({
    contentType: "application/pdf", path: fileURLToPath(new URL("../fixtures/marks-history.pdf", import.meta.url)),
  }));
  await page.addInitScript((session) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    localStorage.setItem("juet.portal.install.dismissedAt.v1", String(Date.now()));
    const key = ["marks.latest", session.username, session.instituteid].map(encodeURIComponent).join(":");
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify({
      data: {
        semesters: [{ registrationid: "past", registrationcode: "2026EVESEM" }],
        rows: [{ subjectcode: "CS109", subjectdesc: "COMPUTER NETWORKS", eventcode: "TEST-1", obtainedmarks: 10, fullmarks: 15 }],
        historyRecovered: true,
      },
      updatedAt: Date.now() - 2 * 86_400_000,
    }));
  }, SESSION);

  await page.goto("/#marks");
  const picker = page.getByRole("combobox", { name: "Select semester" });
  await expect(picker).toBeVisible();
  await expect(picker.locator("option")).toHaveText(["Odd 2026", "Even 2026"]);
  await picker.selectOption("current");
  await expect(course(page, "CS303").locator(".score-header .score-value")).toHaveText("20/40");
});

test("semester selector still appears and switches to past semester when latest semester marks fail", async ({ page }) => {
  await mockPortal(page);
  await page.route("**/api/studentcommonsontroller/getsemestercode-exammarks", (route) => route.fulfill({
    json: {
      response: {
        semestercode: [
          { registrationid: "current", registrationcode: "2026ODDSEM" },
          { registrationid: "past", registrationcode: "2026EVESEM" },
        ],
      },
    },
  }));
  await page.route("**/api/studentsexamview/getstudent-exammarks", async (route) => {
    const body = JSON.parse(await decrypt(route.request().postData()));
    if (body.registrationid === "current") {
      return route.fulfill({ status: 503, body: "Unavailable" });
    }
    return route.fulfill({
      json: {
        response: {
          viewmarksbystudent: [
            { subjectcode: "CS109", subjectdesc: "COMPUTER NETWORKS", eventcode: "TEST-1", obtainedmarks: 10, fullmarks: 15 },
          ],
        },
      },
    });
  });
  await page.route("**/api/studentsexamview/printstudent-exammarks/**", (route) => route.fulfill({
    contentType: "application/pdf", path: fileURLToPath(new URL("../fixtures/marks-empty-past.pdf", import.meta.url)),
  }));
  await page.addInitScript((session) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    localStorage.setItem("juet.portal.install.dismissedAt.v1", String(Date.now()));
  }, SESSION);

  await page.goto("/#marks");
  const picker = page.getByRole("combobox", { name: "Select semester" });
  await expect(picker).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await picker.selectOption("past");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(course(page, "CS109").locator(".score-header .score-value")).toHaveText("10/15");
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
  await nav.getByRole("button", { name: "Results", exact: true }).click();
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
  await nav.getByRole("button", { name: "Results", exact: true }).click();
  await expect.poll(() => page.locator(".score-header .score-value strong").evaluateAll((els) =>
    new Set(els.map((el) => getComputedStyle(el).color)).size)).toBe(4);
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
      await page.getByRole("radio", { name: "CGPA", exact: true }).click();
      await expect(page.locator(".paper-table")).toBeVisible();
      expect(await page.locator(".paper-table").evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("radio", { name: "Marks", exact: true }).click();
      await expect(page.locator(".score-card").first()).toBeVisible();
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

async function expectNoChartOverlap(page) {
  const label = page.locator(".gpa-col.is-active .gpa-bar-value");
  const dot = page.locator(".gpa-dot.is-active");
  await expect(label).toHaveCSS("opacity", "1");
  const [a, b] = await Promise.all([label.boundingBox(), dot.boundingBox()]);
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  const intersects = !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  expect(intersects).toBe(false);
}

test("CGPA view updates hero across completed semesters, formats subject names, left-aligns grades, and emphasizes points", async ({ page }) => {
  const requests = await setup(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.getByRole("radio", { name: "CGPA" }).click();

  await expect(page.locator(".cgpa-hero-label")).toHaveText("Cumulative GPA");
  await expect(page.locator(".cgpa-hero-value")).toHaveText("7.92");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("After semester 4");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("▼ 0.31 from S3");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("657/830 pts (83 cr)");
  await expect(page.getByRole("radio", { name: /^Semester 4:/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".paper-table")).toContainText("OS Lab");
  await expect(page.locator(".paper-table")).toContainText("DBMS Lab");
  await expectNoChartOverlap(page);

  const gradeLayout = await page.locator(".paper-table").evaluate((table) => {
    const header = table.querySelector("thead th.grade-col");
    const cells = [...table.querySelectorAll("tbody td.paper-grade")];
    const headerRect = header.getBoundingClientRect();
    const cellRects = cells.map((c) => c.getBoundingClientRect());
    const strong = table.querySelector("tbody td.paper-points strong");
    const of = table.querySelector("tbody td.paper-points .paper-of");
    return {
      headerAlign: getComputedStyle(header).textAlign,
      cellAligns: cellRects.map((_, i) => getComputedStyle(cells[i]).textAlign),
      headerLeft: headerRect.left,
      cellLefts: cellRects.map((r) => r.left),
      strongSize: parseFloat(getComputedStyle(strong).fontSize),
      strongWeight: parseInt(getComputedStyle(strong).fontWeight, 10),
      ofSize: parseFloat(getComputedStyle(of).fontSize),
      ofWeight: parseInt(getComputedStyle(of).fontWeight, 10),
      strongColor: getComputedStyle(strong).color,
      ofColor: getComputedStyle(of).color,
    };
  });
  expect(gradeLayout.headerAlign).toBe("left");
  for (const align of gradeLayout.cellAligns) expect(align).toBe("left");
  for (const left of gradeLayout.cellLefts) {
    expect(Math.abs(left - gradeLayout.headerLeft)).toBeLessThanOrEqual(1.5);
  }
  expect(gradeLayout.strongSize).toBeGreaterThanOrEqual(17);
  expect(gradeLayout.strongWeight).toBeGreaterThanOrEqual(700);
  expect(gradeLayout.ofSize).toBeLessThanOrEqual(12.5);
  expect(gradeLayout.ofWeight).toBeLessThan(gradeLayout.strongWeight);
  expect(gradeLayout.ofColor).not.toBe(gradeLayout.strongColor);

  await page.getByRole("radio", { name: /^Semester 2:/ }).click();
  await expect(page.locator(".cgpa-hero-value")).toHaveText("8.29");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("After semester 2");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("▲ 0.26 from S1");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("348/420 pts (42 cr)");
  await expect(page.locator(".cgpa-term-head h2")).toHaveText("Semester 2");
  await expect(page.locator(".paper-table")).toContainText("Introduction to 3D Printing");
  expect(await page.locator(".paper-table").textContent()).not.toContain("3d");
  await expect(page.locator(".paper-table")).toContainText("UI/UX Lab");
  await expect(page.locator(".paper-table")).toContainText("DBMS Lab");
  await expect(page.locator(".paper-table")).toContainText("Internet of Things (IoT) and NoSQL");
  await expect(page.locator(".paper-table")).toContainText("Engineering Physics - 2");
  await expectNoChartOverlap(page);
  expect(requests).toEqual([]);
});

test("CGPA forecaster opens on S5, applies target chips, toggles subject planner, fits 320px and 1280px, and respects Discreet mode", async ({ page }) => {
  const requests = await setup(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.getByRole("radio", { name: "CGPA" }).click();

  await page.getByRole("radio", { name: "Forecast Semester 5" }).click();
  await expect(page.locator(".cgpa-hero-label")).toHaveText("Projected CGPA");
  await expect(page.locator(".cgpa-hero .cgpa-forecast-badge")).toHaveText("Forecast");
  await expect(page.getByRole("button", { name: "Reset forecast" })).toBeVisible();

  const chip80 = page.getByRole("button", { name: "8.00 CGPA → 8.33 SGPA" });
  const chipKeep = page.getByRole("button", { name: "Keep 7.92 → 7.94 SGPA" });
  const chip85 = page.getByRole("button", { name: "8.50 CGPA (needs >10 in 1 sem)" });
  await expect(chip80).toBeEnabled();
  await expect(chipKeep).toBeEnabled();
  await expect(chip85).toBeDisabled();

  await chip80.click();
  await expect(chip80).toHaveClass(/is-active/);
  await expect(page.locator(".cgpa-hero-value")).toHaveText("8.00");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("After semester 5");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("▲ 0.08 from S4");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("832/1040 pts (104 cr)");
  await expect(page.locator(".cgpa-term-stats")).toContainText("8.33");
  await expect(page.locator(".gpa-line path.is-forecast")).toHaveCount(1);
  await expect(page.locator(".gpa-dot.is-forecast.is-active")).toHaveCount(1);
  await expectNoChartOverlap(page);

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.getByRole("radio", { name: "By subject" }).click();
  const planner = page.locator(".planner-table");
  await expect(planner).toBeVisible();
  await expect(planner.locator("tbody select.planner-grade-select")).toHaveCount(8);

  await planner.locator("tbody select.planner-grade-select").nth(0).selectOption("O");
  await planner.locator("tbody select.planner-grade-select").nth(1).selectOption("A+");
  await planner.locator("tbody select.planner-grade-select").nth(3).selectOption("B+");
  await expect(page.locator(".cgpa-hero-value")).toHaveText("8.02");
  await expect(page.locator(".cgpa-term-stats")).toContainText("8.43");

  await planner.locator(".planner-credit-btn").first().click();
  await expect(planner.locator(".planner-credit-btn").first()).toHaveText("3 cr");
  await page.getByRole("button", { name: "+ Add subject" }).click();
  await expect(planner.locator("tbody select.planner-grade-select")).toHaveCount(9);

  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await page.getByRole("radio", { name: "By subject" }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await planner.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
      await page.getByRole("radio", { name: "Quick slider" }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.locator(".cgpa-targets").evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    }
  }

  await page.reload();
  await expect(page.getByRole("radio", { name: "CGPA", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".cgpa-hero .cgpa-forecast-badge")).toHaveText("Forecast");
  await expect(page.locator(".gpa-col.is-forecast")).toHaveCount(1);

  await page.getByRole("radio", { name: /^Semester 4:/ }).click();
  await expect(page.locator(".cgpa-hero .cgpa-forecast-badge")).toHaveText("Forecast saved");
  await page.getByRole("radio", { name: /Forecast Semester 5/ }).click();
  await chip80.click();
  const activeColorsBefore = await page.evaluate(() => ({
    badgeBg: getComputedStyle(document.querySelector(".cgpa-hero .cgpa-forecast-badge")).backgroundColor,
    chipBg: getComputedStyle(document.querySelector(".cgpa-target-chip.is-active")).backgroundColor,
    barBorder: getComputedStyle(document.querySelector(".gpa-col.is-forecast.is-active .gpa-bar")).borderTopColor,
  }));

  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("switch", { name: "Discreet mode" }).click();
  await nav.getByRole("button", { name: "Results", exact: true }).click();

  for (const colorScheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.getByRole("radio", { name: /^Semester 2:/ }).click();
    const upColor = await page.locator(".cgpa-delta.is-up").evaluate((el) => getComputedStyle(el).color);
    await page.getByRole("radio", { name: /^Semester 4:/ }).click();
    const downColor = await page.locator(".cgpa-delta.is-down").evaluate((el) => getComputedStyle(el).color);
    const onSurface = await page.locator(".cgpa-hero-value").evaluate((el) => getComputedStyle(el).color);
    expect(upColor).toBe(onSurface);
    expect(downColor).toBe(onSurface);
  }

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.getByRole("radio", { name: /Forecast Semester 5/ }).click();
  const activeColorsDiscreet = await page.evaluate(() => ({
    badgeBg: getComputedStyle(document.querySelector(".cgpa-hero .cgpa-forecast-badge")).backgroundColor,
    chipBg: getComputedStyle(document.querySelector(".cgpa-target-chip.is-active")).backgroundColor,
    barBorder: getComputedStyle(document.querySelector(".gpa-col.is-forecast.is-active .gpa-bar")).borderTopColor,
  }));
  expect(activeColorsDiscreet.badgeBg).not.toBe(activeColorsBefore.badgeBg);
  expect(activeColorsDiscreet.chipBg).not.toBe(activeColorsBefore.chipBg);
  expect(activeColorsDiscreet.barBorder).not.toBe(activeColorsBefore.barBorder);

  await page.getByRole("button", { name: "Reset forecast" }).click();
  await expect(page.locator(".cgpa-hero-label")).toHaveText("Cumulative GPA");
  await expect(page.locator(".cgpa-hero-value")).toHaveText("7.92");
  await expect(page.locator(".gpa-col.is-forecast")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("empty portal CGPA state shows interactive S1-S8 forecast buttons, hides redundant semester picker, and keeps unavailable notice while forecasting", async ({ page }) => {
  await mockPortal(page);
  const requests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
  });
  await page.addInitScript((session) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    localStorage.setItem("juet.portal.install.dismissedAt.v1", String(Date.now()));
    localStorage.setItem(
      `juet.portal.${["semester", session.username, session.instituteid, "grades"].map(encodeURIComponent).join(":")}`,
      "past",
    );
    const cache = (feature, data, parts = []) => {
      const key = [feature, session.username, session.instituteid, ...parts].map(encodeURIComponent).join(":");
      localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now() }));
    };
    const semesters = [{ registrationid: "odd", registrationcode: "2026ODDSEM" }];
    cache("att.initial", { header: {}, semesters, rows: [] });
    cache("att.lov", { header: {}, semesters });
    cache("marks.latest", { semesters, rows: [], historyRecovered: true });
    cache("marks.cgpa.latest", {
      student: { studentid: "12345", stynumber: 1 },
      currentsem: 1,
      semesters: [],
    });
    cache("marks.grades.latest", {
      info: null,
      semesters: [
        { registrationid: "odd", registrationcode: "2026ODDSEM" },
        { registrationid: "past", registrationcode: "2025EVESEM" },
      ],
      rows: [],
    });
  }, { ...SESSION, enrollmentno: "251B123" });

  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/#marks");
  await page.getByRole("radio", { name: "CGPA", exact: true }).click();

  await expect(page.getByRole("combobox", { name: "Select semester" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Results aren't on JUET's portal yet" })).toBeVisible();
  await expect(page.locator(".cgpa-empty")).toContainText("you're in semester 1 now.");
  await expect(page.locator(".gpa-cols [role='radio']")).toHaveCount(8);
  await expect(page.locator(".gpa-future-plus")).toHaveCount(8);

  await page.getByRole("radio", { name: "Forecast Semester 1" }).click();
  await expect(page.locator(".cgpa-hero-label")).toHaveText("Projected CGPA");
  await expect(page.locator(".cgpa-hero-value")).toHaveText("8.00");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("After semester 1");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("168/210 pts (21 cr)");
  await expect(page.locator(".cgpa-targets")).toContainText("8.50 CGPA → 8.50 SGPA");
  await expect(page.locator(".cgpa-empty.is-compact")).toBeVisible();
  await expect(page.locator(".cgpa-empty.is-compact")).toContainText("Results aren't on JUET's portal yet");
  await expect(page.locator(".cgpa-empty.is-compact")).toContainText("you're in semester 1 now.");
  await expect(page.getByRole("combobox", { name: "Select semester" })).toHaveCount(0);
  await expectNoChartOverlap(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("radio", { name: "Forecast Semester 5" }).click();
  await expect(page.locator(".cgpa-hero-meta")).toContainText("After semester 5");
  await expect(page.locator(".gpa-col.is-forecast")).toHaveCount(2);

  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Reset forecast" }).click();
  await expect(page.locator(".cgpa-hero")).toHaveCount(0);
  await expect(page.locator(".cgpa-empty:not(.is-compact)")).toBeVisible();
  await expect(page.locator(".gpa-future-plus")).toHaveCount(8);
  expect(requests).toEqual([]);
});

test("refresh reconciles newly published S5 over active S5 forecast and loads real S5 subjects", async ({ page }) => {
  await setup(page);
  const detailCalls = [];
  await page.route("**/api/studentsgpacgpa/**", async (route) => {
    const endpoint = new URL(route.request().url()).pathname.split("/").pop();
    const payload = route.request().postData();
    const body = payload ? JSON.parse(await decrypt(payload)) : null;
    if (endpoint === "loadData") {
      return route.fulfill({ json: { status: { responseStatus: "Success" }, response: { studentInfo: [{ studentid: "12345", name: "Test Student", enrollmentno: "241B123", stynumber: 5 }] } } });
    }
    if (endpoint === "checkIfstudentmasterexist") {
      return route.fulfill({ json: { status: { responseStatus: "Success" }, response: { studentlov: { currentsemester: 5 } } } });
    }
    if (endpoint === "getallsemesterdata") {
      return route.fulfill({
        json: {
          status: { responseStatus: "Success" },
          response: {
            semesterList: [
              { stynumber: 1, sgpa: 8.03, cgpa: 8.03, earnedcredit: 19.5 },
              { stynumber: 2, sgpa: 8.51, cgpa: 8.29, earnedcredit: 22.5 },
              { stynumber: 3, sgpa: 8.1, cgpa: 8.23, earnedcredit: 20 },
              { stynumber: 4, sgpa: 7.0, cgpa: 7.92, earnedcredit: 21 },
              { stynumber: 5, sgpa: 8.6, cgpa: 8.05, earnedcredit: 20 },
            ],
          },
        },
      });
    }
    if (endpoint === "getallsemesterdatadetail") {
      detailCalls.push(body?.stynumber);
      const rows = body?.stynumber === 5
        ? [
            { subjectcode: "CS501", subjectdesc: "COMPILER DESIGN", gradepoint: 9, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 36, grade: "A+", fail: "N" },
            { subjectcode: "CS502", subjectdesc: "CLOUD COMPUTING", gradepoint: 8, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 32, grade: "A", fail: "N" },
            { subjectcode: "CS571", subjectdesc: "COMPILER DESIGN LAB", gradepoint: 10, coursecreditpoint: 1, earnedcredit: 1, sgpapoints: 10, grade: "O", fail: "N" },
          ]
        : [
            { subjectcode: "CS401", subjectdesc: "OPERATING SYSTEMS", gradepoint: 8, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 32, grade: "A", fail: "N" },
          ];
      return route.fulfill({ json: { status: { responseStatus: "Success" }, response: { semesterList: rows } } });
    }
    return route.fallback();
  });

  await page.getByRole("radio", { name: "CGPA", exact: true }).click();
  await page.getByRole("radio", { name: "Forecast Semester 5" }).click();
  await expect(page.locator(".cgpa-hero-label")).toHaveText("Projected CGPA");
  await expect(page.locator(".cgpa-hero .cgpa-forecast-badge")).toHaveText("Forecast");
  await expect(page.locator(".gpa-col.is-forecast")).toHaveCount(1);

  const refreshBtn = page.getByRole("button", { name: "Refresh results", exact: true });
  await expect(refreshBtn).toBeEnabled();
  await refreshBtn.click();

  await expect(page.locator(".cgpa-hero-label")).toHaveText("Cumulative GPA");
  await expect(page.locator(".cgpa-hero-value")).toHaveText("8.05");
  await expect(page.locator(".cgpa-hero-meta")).toContainText("After semester 5");
  await expect(page.locator(".cgpa-hero .cgpa-forecast-badge")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset forecast" })).toHaveCount(0);
  await expect(page.locator(".gpa-col.is-forecast")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Semester 5: SGPA 8.60, CGPA 8.05" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".paper-table")).toContainText("Compiler Design");
  await expect(page.locator(".paper-table")).toContainText("Cloud Computing");
  expect(detailCalls).toContain(4);
  expect(detailCalls).toContain(5);

  const storedForecasts = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("juet.portal.marks.cgpa.forecast"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(storedForecasts).toBeNull();
});

test("refresh from empty portal state prunes superseded S1 forecast while keeping future S5 forecast", async ({ page }) => {
  await mockPortal(page);
  await page.route("**/api/studentsgpacgpa/**", async (route) => {
    const endpoint = new URL(route.request().url()).pathname.split("/").pop();
    const payload = route.request().postData();
    const body = payload ? JSON.parse(await decrypt(payload)) : null;
    if (endpoint === "loadData") {
      return route.fulfill({ json: { status: { responseStatus: "Success" }, response: { studentInfo: [{ studentid: "12345", name: "Test Student", enrollmentno: "241B123", stynumber: 4 }] } } });
    }
    if (endpoint === "checkIfstudentmasterexist") {
      return route.fulfill({ json: { status: { responseStatus: "Success" }, response: { studentlov: { currentsemester: 4 } } } });
    }
    if (endpoint === "getallsemesterdata") {
      return route.fulfill({
        json: {
          status: { responseStatus: "Success" },
          response: {
            semesterList: [
              { stynumber: 1, sgpa: 8.03, cgpa: 8.03, earnedcredit: 19.5 },
              { stynumber: 2, sgpa: 8.51, cgpa: 8.29, earnedcredit: 22.5 },
              { stynumber: 3, sgpa: 8.1, cgpa: 8.23, earnedcredit: 20 },
              { stynumber: 4, sgpa: 7.0, cgpa: 7.92, earnedcredit: 21 },
            ],
          },
        },
      });
    }
    if (endpoint === "getallsemesterdatadetail") {
      expect(body?.stynumber).toBe(4);
      return route.fulfill({
        json: {
          status: { responseStatus: "Success" },
          response: {
            semesterList: [
              { subjectcode: "CS401", subjectdesc: "OPERATING SYSTEMS", gradepoint: 8, coursecreditpoint: 4, earnedcredit: 4, sgpapoints: 32, grade: "A", fail: "N" },
            ],
          },
        },
      });
    }
    return route.fallback();
  });

  await page.addInitScript((session) => {
    if (sessionStorage.getItem("seeded-empty-refresh")) return;
    sessionStorage.setItem("seeded-empty-refresh", "1");
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    localStorage.setItem("juet.portal.install.dismissedAt.v1", String(Date.now()));
    const semesters = [{ registrationid: "odd", registrationcode: "2026ODDSEM" }];
    const cache = (feature, data, parts = []) => {
      const key = [feature, session.username, session.instituteid, ...parts].map(encodeURIComponent).join(":");
      localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now() }));
    };
    cache("att.initial", { header: {}, semesters, rows: [] });
    cache("att.lov", { header: {}, semesters });
    cache("marks.latest", { semesters, rows: [], historyRecovered: true });
    cache("marks.cgpa.latest", { student: { studentid: "12345", stynumber: 1 }, currentsem: 1, semesters: [] });
    cache("marks.grades.latest", { info: null, semesters, rows: [] });
  }, { ...SESSION, enrollmentno: "241B123" });

  await page.goto("/#marks");
  await page.getByRole("radio", { name: "CGPA", exact: true }).click();
  await page.getByRole("radio", { name: "Forecast Semester 1" }).click();
  await page.getByRole("radio", { name: "Forecast Semester 5" }).click();
  await page.getByRole("radio", { name: /Forecast Semester 1/ }).click();
  await expect(page.locator(".gpa-col.is-forecast")).toHaveCount(2);

  const refreshBtn = page.getByRole("button", { name: "Refresh results", exact: true });
  await expect(refreshBtn).toBeEnabled();
  await refreshBtn.click();

  await expect(page.locator(".cgpa-hero-label")).toHaveText("Cumulative GPA");
  await expect(page.locator(".cgpa-hero-value")).toHaveText("7.92");
  await expect(page.locator(".cgpa-hero .cgpa-forecast-badge")).toHaveText("Forecast saved");
  await expect(page.locator(".gpa-col.is-forecast")).toHaveCount(1);
  await expect(page.locator(".paper-table")).toContainText("Operating Systems");
  await expect(page.locator(".cgpa-empty")).toHaveCount(0);

  await page.getByRole("radio", { name: /Forecast Semester 5/ }).click();
  await page.getByRole("button", { name: "8.00 CGPA → 8.33 SGPA" }).click();
  await expect(page.locator(".cgpa-hero-value")).toHaveText("8.00");
});
