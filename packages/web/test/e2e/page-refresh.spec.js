import { test, expect } from "@playwright/test";
import { decrypt } from "../../../core/src/crypto.js";
import { mockPortal, SESSION } from "./helpers.js";

const semesters = [
  { registrationid: "current", registrationcode: "2026ODDSEM" },
  { registrationid: "past", registrationcode: "2026EVESEM" },
];
const marksRow = { subjectdesc: "Cached subject", obtainedmarks: 8, fullmarks: 10 };

async function setup(page) {
  await mockPortal(page);
  const calls = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/").pop();
    const payload = route.request().postData();
    calls.push({ path, body: payload ? JSON.parse(await decrypt(payload)) : null });
    const responses = {
      "getsemestercode-exammarks": { semestercode: semesters },
      "getstudent-exammarks": { viewmarksbystudent: [{ ...marksRow, subjectdesc: "Updated subject" }] },
      "getsemestercode-withstudentexamevents": { semesterCodeinfo: { semestercode: semesters } },
      getstudentexamevents: { eventcode: { examevent: [{ exameventid: "event" }] } },
      "getstudent-examschedule": { subjectinfo: [] },
      getregistrationList: { registrations: semesters },
      getfaculties: { registrations: [] },
      getsemestercodelist: { registrationcodelist: semesters },
      getsubjectpreference: { subjectpreferencegrid: [] },
      getstudentattendancedetail: { studentattendancelist: [] },
    };
    await route.fulfill({ json: { status: { responseStatus: "Success" }, response: responses[path] ?? {} } });
  });
  await page.addInitScript(({ session, semesters, marksRow }) => {
    if (sessionStorage.getItem("seeded-refresh")) return;
    sessionStorage.setItem("seeded-refresh", "1");
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    const old = Date.now() - 90 * 86400000;
    const cache = (feature, data, parts = [], updatedAt = old) => {
      const key = [feature, session.username, session.instituteid, ...parts].map(encodeURIComponent).join(":");
      localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt }));
    };
    cache("att.initial", { header: { stynumber: "1" }, semesters, rows: [] }, [], Date.now());
    cache("att.lov", { header: { stynumber: "1" }, semesters }, [], Date.now());
    cache("marks.latest", { semesters, rows: [marksRow] });
    cache("marks.detail", { rows: [{ ...marksRow, subjectdesc: "Past subject" }] }, ["past"]);
    cache("exams.sems", semesters);
    cache("exams.events", [{ exameventid: "event" }], ["current"]);
    cache("exams.rows", [], ["current", "event"]);
    cache("faculty.lov", semesters);
    cache("faculty.detail", { rows: [] }, ["current"]);
    cache("subjects.latest", { semesters, rows: [] });
  }, { session: SESSION, semesters, marksRow });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Attendance", exact: true })).toBeVisible();
  return calls;
}

const paths = (calls) => calls.map((c) => c.path).sort();
const navigate = (page, name) => page.getByRole("navigation", { name: "Main" }).getByRole("button", { name, exact: true }).click();

async function refresh(page, label) {
  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeEnabled();
}

test("old caches survive navigation, focus, day rollover and reload without other-page reads", async ({ page }) => {
  const calls = await setup(page);
  for (const name of ["Marks", "Exams", "More", "Attendance", "Marks"]) await navigate(page, name);
  await expect(page.getByText("Cached Subject", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new CustomEvent("juet:refresh-attendance"));
  });
  await page.reload();
  await expect(page.getByText("Cached Subject", { exact: true })).toBeVisible();
  expect(calls).toEqual([]);
});

test("refresh is per page, cooldowns are independent, and More skips collapsed sections", async ({ page }) => {
  const calls = await setup(page);
  for (const name of ["Marks", "Exams", "More", "Attendance"]) await navigate(page, name);
  await refresh(page, "Refresh attendance");
  expect(paths(calls)).toEqual(["getstudentattendancedetail"]);
  calls.length = 0;
  await navigate(page, "Marks");
  await refresh(page, "Refresh marks");
  await expect(page.getByText("Updated Subject", { exact: true })).toBeVisible();
  expect(paths(calls)).toEqual(["getsemestercode-exammarks", "getstudent-exammarks"]);
  calls.length = 0;
  await refresh(page, "Refresh marks");
  expect(calls).toEqual([]);
  await navigate(page, "Exams");
  await refresh(page, "Refresh exams");
  expect(paths(calls)).toEqual(["getsemestercode-withstudentexamevents", "getstudent-examschedule", "getstudentexamevents"].sort());
  calls.length = 0;
  await navigate(page, "More");
  await refresh(page, "Refresh");
  expect(calls).toEqual([]);
  await page.getByRole("button", { name: /^Faculty/ }).click();
  await expect(page.locator("#faculty select")).toHaveValue("current");
  expect(calls).toEqual([]);
  await refresh(page, "Refresh");
  expect(paths(calls)).toEqual(["getfaculties", "getregistrationList"]);
});

test("past marks refresh only the selected semester and failed refresh keeps cached content", async ({ page }) => {
  const calls = await setup(page);
  await navigate(page, "Marks");
  await expect(page.getByText("Cached Subject", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Select semester" }).selectOption("past");
  await expect(page.getByText("Past Subject", { exact: true })).toBeVisible();
  await page.route("**/api/studentsexamview/getstudent-exammarks", async (route) => {
    calls.push({ path: "getstudent-exammarks", body: JSON.parse(await decrypt(route.request().postData())) });
    await route.fulfill({ status: 503, body: "Unavailable" });
  });
  await refresh(page, "Refresh marks");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Past Subject", { exact: true })).toBeVisible();
  expect(paths(calls)).toEqual(["getstudent-exammarks"]);
  expect(calls[0].body.registrationid).toBe("past");
  calls.length = 0;
  await refresh(page, "Refresh marks");
  expect(calls).toEqual([]);
});

for (const semester of ["current", "past"]) test(`${semester} marks refresh retains T1 when the portal returns only T2, including after reload`, async ({ page }) => {
  await setup(page);
  const t1 = { subjectcode: "CS303", subjectdesc: "ARTIFICIAL INTELLIGENCE", eventcode: "TEST-1", obtainedmarks: 7, fullmarks: 15 };
  await page.evaluate(({ session, semesters, t1 }) => {
    const key = ["marks.latest", session.username, session.instituteid].map(encodeURIComponent).join(":");
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data: { semesters, rows: [t1] }, updatedAt: Date.now() }));
    const detailKey = ["marks.detail", session.username, session.instituteid, "past"].map(encodeURIComponent).join(":");
    localStorage.setItem(`juet.cache.${detailKey}`, JSON.stringify({ data: { rows: [t1] }, updatedAt: Date.now() }));
  }, { session: SESSION, semesters, t1 });
  await page.route("**/api/studentsexamview/getstudent-exammarks", (route) => route.fulfill({
    json: { status: { responseStatus: "Success" }, response: { viewmarksbystudent: [
      { ...t1, eventcode: "TEST-2", obtainedmarks: 13, fullmarks: 25 },
    ] } },
  }));
  await navigate(page, "Marks");
  if (semester === "past") await page.getByRole("combobox", { name: "Select semester" }).selectOption("past");
  await expect(page.locator(".score-header .score-value")).toHaveText("7/15");
  await refresh(page, "Refresh marks");
  await expect(page.locator(".score-header .score-value")).toHaveText("20/40");
  await page.locator(".score-header").click();
  await expect(page.locator(".score-exam-label")).toHaveText(["T1", "T2"]);
  await expect(page.locator(".score-exam .score-value")).toHaveText(["7/15", "13/25"]);
  await page.reload();
  await expect(page.locator(".score-header .score-value")).toHaveText("20/40");
  await page.clock.install();
  await page.clock.fastForward(20_001);
  await page.route("**/api/studentsexamview/getstudent-exammarks", (route) => route.fulfill({
    json: { status: { responseStatus: "Success" }, response: { viewmarksbystudent: [
      { ...t1, eventcode: "T1", obtainedmarks: 0 },
    ] } },
  }));
  await refresh(page, "Refresh marks");
  await expect(page.locator(".score-header .score-value")).toHaveText("13/40");
  await page.locator(".score-header").click();
  await expect(page.locator(".score-exam .score-value")).toHaveText(["0/15", "13/25"]);
});

test("a new default semester does not inherit the previous semester's marks", async ({ page }) => {
  await setup(page);
  await page.route("**/api/studentcommonsontroller/getsemestercode-exammarks", (route) => route.fulfill({
    json: { status: { responseStatus: "Success" }, response: { semestercode: [
      { registrationid: "new", registrationcode: "2027EVESEM" }, ...semesters,
    ] } },
  }));
  await navigate(page, "Marks");
  await refresh(page, "Refresh marks");
  await page.getByRole("combobox", { name: "Select semester" }).selectOption("new");
  await expect(page.locator(".score-header .score-value")).toHaveText("8/10");
  await expect(page.locator(".score-card")).toHaveCount(1);
  await expect(page.getByText("Cached Subject", { exact: true })).toHaveCount(0);
});


test("cooldown survives blocked storage, expires after 20s, and offline refresh does no work", async ({ page }) => {
  const calls = await setup(page);
  await navigate(page, "Marks");
  await expect(page.getByText("Cached Subject", { exact: true })).toBeVisible();
  await page.clock.install();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
  });
  await refresh(page, "Refresh marks");
  expect(calls).toHaveLength(2);
  calls.length = 0;
  await refresh(page, "Refresh marks");
  expect(calls).toEqual([]);
  await page.clock.fastForward(20_001);
  await refresh(page, "Refresh marks");
  expect(calls).toHaveLength(2);
  calls.length = 0;
  await page.clock.fastForward(20_001);
  await page.context().setOffline(true);
  await refresh(page, "Refresh marks");
  expect(calls).toEqual([]);
});
