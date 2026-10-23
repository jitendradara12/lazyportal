import { test, expect } from "@playwright/test";
import { mockPortal, SESSION } from "./helpers.js";

async function setup(page) {
  await mockPortal(page);
  await page.clock.install({ time: new Date("2026-10-23T08:00:00+05:30") });
  await page.addInitScript((session) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    localStorage.setItem("juet.portal.install.dismissedAt.v1", String(Date.now()));
    const semesters = [{ registrationid: "current", registrationcode: "2026ODDSEM" }];
    const cache = (feature, data, parts = []) => {
      const key = [feature, session.username, session.instituteid, ...parts].map(encodeURIComponent).join(":");
      localStorage.setItem(`juet.cache.${key}`, JSON.stringify({ data, updatedAt: Date.now() }));
    };
    cache("att.initial", { header: {}, semesters, rows: [] });
    cache("att.lov", { header: {}, semesters });
    cache("exams.sems", semesters);
    cache("exams.events", [{ exameventid: "event" }], ["current"]);
    cache("exams.rows", [
      { datetime: "22/10/2026", datetimeupto: "09:30 am to 12:30 pm", subjectdesc: "Computer Networks", roomcode: "LT-3", seatno: "B5" },
      { datetime: "23/10/2026", datetimeupto: "09:30 am to 12:30 pm", subjectdesc: "Artificial Intelligence", roomcode: "LT-3", seatno: "B5" },
      { datetime: "26/10/2026", datetimeupto: "09:30 am to 12:30 pm", subjectdesc: "Probability Theory and Random Processes", roomcode: "LT-4", seatno: "C8" },
      { subjectdesc: "Economics" },
    ], ["current", "event"]);
  }, SESSION);
  await page.goto("/#exams");
  await expect(page.getByRole("heading", { name: "Exams", exact: true })).toBeVisible();
}

test("timeline, icon-only actions and calendar contents work on mobile", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("img", { name: "Crushed", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Up next", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Upcoming", exact: true })).not.toBeVisible();
  const toggle = page.locator("summary[aria-label='Later exams (1)']");
  await expect(toggle).toHaveAccessibleName("Later exams (1)");
  await toggle.click();
  await expect(page.getByRole("img", { name: "Upcoming", exact: true })).toBeVisible();
  await expect(page.locator(".exam-timeline .exam-subject")).toHaveText([
    "Probability Theory and Random Processes", "Artificial Intelligence", "Computer Networks",
  ]);
  await toggle.click();
  await expect(page.getByRole("heading", { name: "Probability Theory and Random Processes", exact: true })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Artificial Intelligence", exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "Add Artificial Intelligence to calendar", exact: true });
  await expect(add).toHaveText("");
  await add.click();
  const google = page.getByRole("link", { name: "Google Calendar", exact: true });
  await expect(google).toBeVisible();
  const url = new URL(await google.getAttribute("href"));
  expect(url.searchParams.get("location")).toBe("LT3-B5");
  expect(url.searchParams.get("dates")).toBe("20261023T040000Z/20261023T070000Z");
  await page.keyboard.press("Escape");
  await expect(google).not.toBeVisible();
  await expect(add).toBeFocused();
  await expect(page.getByRole("button", { name: "Calendar unavailable until exam times are announced" })).toBeDisabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export upcoming exams", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("exams.ics");
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(content).not.toContain("SUMMARY:Computer Networks");
  expect(content).toContain("LOCATION:LT3-B5");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `/tmp/exams-${test.info().project.name}.png`, fullPage: true });
  await page.clock.fastForward(2 * 60 * 60 * 1000);
  await expect(page.getByRole("img", { name: "In progress", exact: true })).toBeVisible();
  await page.clock.fastForward(3 * 60 * 60 * 1000);
  await expect(page.getByRole("img", { name: "Crushed", exact: true })).toHaveCount(2);
  await expect(page.locator(".exam-future-group")).toHaveCount(0);
  await expect(page.locator(".exam-stop.is-next .exam-subject")).toHaveText("Probability Theory and Random Processes");
});

test("per-exam calendar file and outside dismissal", async ({ page }) => {
  await setup(page);
  const add = page.getByRole("button", { name: "Add Artificial Intelligence to calendar", exact: true });
  await add.click();
  await page.getByRole("heading", { name: "Exams", exact: true }).click();
  await expect(page.getByRole("link", { name: "Google Calendar" })).not.toBeVisible();
  await add.click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Calendar file (.ics)", exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  expect(content).toContain("SUMMARY:Artificial Intelligence");
});

test("native bridge receives exam details and falls back when unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    window.__calendarCalls = [];
    window.Capacitor = {
      PluginHeaders: [{ name: "ExamCalendar", methods: [{ name: "insert", rtype: "promise" }] }],
      nativePromise: async (plugin, method, event) => {
        window.__calendarCalls.push({ plugin, method, event });
        if (window.__calendarFail) throw new Error("No calendar app");
      },
    };
  });
  await setup(page);
  const add = page.getByRole("button", { name: "Add Artificial Intelligence to calendar", exact: true });
  await add.click();
  await expect.poll(() => page.evaluate(() => window.__calendarCalls.length)).toBe(1);
  const [call] = await page.evaluate(() => window.__calendarCalls);
  expect(call.plugin).toBe("ExamCalendar");
  expect(call.method).toBe("insert");
  expect(call.event.location).toBe("LT3-B5");
  expect(call.event.start).toBe(Date.parse("2026-10-23T09:30:00+05:30"));
  await expect(page.getByRole("link", { name: "Google Calendar" })).not.toBeVisible();
  await page.evaluate(() => { window.__calendarFail = true; });
  await add.click();
  await expect(page.getByRole("link", { name: "Google Calendar" })).toBeVisible();
});

test("desktop timeline and calendar picker fit without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page);
  await page.getByRole("button", { name: "Add Artificial Intelligence to calendar", exact: true }).click();
  await expect(page.getByRole("link", { name: "Google Calendar" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/exams-desktop-${test.info().project.name}.png`, fullPage: true });
});
