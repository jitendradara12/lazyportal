import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { mockPortal, SESSION } from "./helpers.js";

async function setup(page, hash = "more") {
  await mockPortal(page);
  await page.clock.install({ time: new Date("2026-10-25T12:00:00+05:30") });
  await page.addInitScript((session) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    localStorage.setItem("juet.portal.install.dismissedAt.v1", String(Date.now()));
  }, SESSION);
  await page.goto(`/#${hash}`);
}

async function calendarContent(download) {
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  return content;
}

test("Calendar navigation opens the fifth tab, filters and exports fixed dates", async ({ page }) => {
  await setup(page, "attendance");
  const navigation = page.getByRole("navigation", { name: "Main" });
  await expect(navigation.getByRole("button")).toHaveCount(5);
  await navigation.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "Calendar", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Academic calendar", exact: true })).toBeVisible();
  await expect(page.getByLabel("Academic semester")).toHaveValue("2026-27-odd");
  await expect(page.getByRole("heading", { name: "Technical fest (JYC)", exact: true })).toBeVisible();
  await expect(page.getByText("Proposed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Calendar unavailable while dates are proposed" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Test 1", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Holidays & breaks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Technical fest (JYC)", exact: true })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Deepawali break", exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "Add Deepawali break to calendar", exact: true });
  await add.click();
  const google = page.getByRole("link", { name: "Google Calendar", exact: true });
  expect(new URL(await google.getAttribute("href")).searchParams.get("dates")).toBe("20261106/20261115");
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export upcoming academic events" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("juet-2026-27-odd.ics");
  const content = await calendarContent(download);
  expect(content).toContain("DTSTART;VALUE=DATE:20261106\r\nDTEND;VALUE=DATE:20261115");
  expect(content).not.toContain("SUMMARY:Test");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Attendance", exact: true })).toBeVisible();
});

test("semester changes preserve date guidance, student audiences and contribution link", async ({ page }) => {
  await setup(page, "calendar");
  await page.getByLabel("Academic semester").selectOption("2026-27-even");
  await expect(page.getByRole("heading", { name: "Holi break", exact: true })).toBeVisible();
  await expect(page.getByText("Before 15 May 2027", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Within 15 days of registration", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "First year registration", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Faculty summer vacation", exact: true })).not.toBeVisible();
  await page.getByLabel("Calendar audience").selectOption("all");
  await expect(page.getByRole("heading", { name: "Faculty summer vacation", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Make a pull request." })).toHaveAttribute("href", "https://github.com/jitendradara12/lazyportal/blob/master/packages/web/src/data/academic-calendars/README.md");
  await page.getByRole("group", { name: "Event categories" }).getByRole("button", { name: "Exams", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Holi break", exact: true })).not.toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export upcoming academic events" }).click();
  const content = await calendarContent(await downloadPromise);
  expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(7);
  expect(content).not.toContain("SUMMARY:Holi");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("heading", { name: "More", exact: true })).toBeVisible();
});

test("calendar search finds past events and guidance, respects filters and resets on close", async ({ page }, testInfo) => {
  await setup(page, "calendar");
  const toggle = page.getByRole("button", { name: "Search calendar", exact: true });
  await toggle.click();
  const search = page.getByRole("searchbox", { name: "Search calendar events" });
  await expect(search).toBeFocused();
  await search.fill("  DEEPAWALI  ");
  await expect(page.getByRole("status")).toHaveText("2 results");
  await expect(page.getByRole("heading", { name: "Deepawali break", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Technical fest (JYC)", exact: true })).not.toBeVisible();
  const dir = new URL("../../../../.impeccable/review/", import.meta.url).pathname;
  await mkdir(dir, { recursive: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (testInfo.project.name === "android-chrome") await page.screenshot({ path: `${dir}calendar-search-${width}.png`, animations: "disabled", scale: "css" });
  }
  await page.getByRole("group", { name: "Event categories" }).getByRole("button", { name: "Exams", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("0 results");
  await expect(page.getByText("No events match your search. Try another term or change the filters.")).toBeVisible();
  await page.getByRole("button", { name: "All events", exact: true }).click();
  await search.fill("Test 1");
  await expect(page.getByRole("heading", { name: "Test 1", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("1 result");
  await search.fill("within 15 days");
  await expect(page.getByRole("heading", { name: "DPMC formation and meeting", exact: true })).toBeVisible();
  await search.fill("8 Nov 2026");
  await expect(page.getByRole("heading", { name: "Deepawali", exact: true })).toBeVisible();
  await search.fill("Faculty winter vacation");
  await expect(page.getByRole("status")).toHaveText("0 results");
  await page.getByLabel("Calendar audience").selectOption("all");
  await expect(page.getByRole("heading", { name: "Faculty winter vacation", exact: true })).toBeVisible();
  await search.fill("");
  await expect(page.getByRole("heading", { name: "Search results", exact: true })).not.toBeVisible();
  await search.fill("missing event");
  await search.press("Escape");
  await expect(search).not.toBeVisible();
  await expect(toggle).toBeFocused();
  await expect(page.getByRole("heading", { name: "Deepawali break", exact: true })).toBeVisible();
  await toggle.click();
  await expect(search).toHaveValue("");
  await page.getByRole("button", { name: "Close calendar search", exact: true }).first().click();
  await expect(search).not.toBeVisible();
});

test("academic calendar fits mobile and desktop", async ({ page }, testInfo) => {
  await setup(page, "calendar");
  await expect(page.getByRole("heading", { name: "Academic calendar", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deepawali break", exact: true })).toBeVisible();
  const dir = new URL("../../../../.impeccable/review/", import.meta.url).pathname;
  await mkdir(dir, { recursive: true });
  for (const [name, width] of [["small-mobile", 320], ["mobile", 390], ["desktop", 1440]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (testInfo.project.name === "android-chrome") await page.screenshot({ path: `${dir}${name}.png`, fullPage: true, scale: "css", animations: "disabled" });
    if (testInfo.project.name === "android-chrome") {
      await page.screenshot({ path: `${dir}${name}-viewport.png`, fullPage: false, scale: "css", animations: "disabled" });
      await page.locator(".academic-contribute").screenshot({ path: `${dir}${name}-footer.png`, scale: "css" });
    }
  }
});

for (const supportsAllDay of [true, false]) {
  test(`native academic events use all-day support=${supportsAllDay} safely`, async ({ page }) => {
    await page.addInitScript((supported) => {
      window.androidBridge = {};
      window.__calendarCalls = [];
      window.Capacitor = {
        PluginHeaders: [{ name: "ExamCalendar", methods: [
          { name: "insert", rtype: "promise" }, { name: "exportCalendar", rtype: "promise" },
          ...(supported ? [{ name: "getCapabilities", rtype: "promise" }] : []),
        ] }],
        nativePromise: async (plugin, method, data) => {
          window.__calendarCalls.push({ plugin, method, data });
          if (method === "getCapabilities") return { allDay: true };
          return {};
        },
      };
    }, supportsAllDay);
    await setup(page, "calendar");
    await page.getByRole("button", { name: "Add Deepawali break to calendar", exact: true }).click();
    if (supportsAllDay) {
      await expect.poll(() => page.evaluate(() => window.__calendarCalls.length)).toBe(2);
      const calls = await page.evaluate(() => window.__calendarCalls);
      expect(calls.map((call) => call.method)).toEqual(["getCapabilities", "insert"]);
      expect(calls[1].data.allDay).toBe(true);
      expect(calls[1].data.start).toBe(Date.parse("2026-11-06T00:00:00Z"));
      expect(calls[1].data.end).toBe(Date.parse("2026-11-15T00:00:00Z"));
      await expect(page.getByRole("link", { name: "Google Calendar" })).not.toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "Google Calendar" })).toBeVisible();
      expect(await page.evaluate(() => window.__calendarCalls)).toHaveLength(0);
      await page.getByRole("button", { name: "Calendar file (.ics)" }).click();
      const [call] = await page.evaluate(() => window.__calendarCalls);
      expect(call.method).toBe("exportCalendar");
      expect(call.data.content).toContain("DTSTART;VALUE=DATE:20261106");
      expect(call.data.filename).toBe("juet-2026-27-odd.ics");
    }
  });
}

test("Attendance navigation leaves Calendar in one tap", async ({ page }) => {
  await setup(page, "attendance");
  const navigation = page.getByRole("navigation", { name: "Main" });
  await expect(navigation.getByRole("button")).toHaveCount(5);
  await navigation.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "Calendar", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Attendance" }).click();
  await expect(page.getByRole("heading", { name: "Attendance", exact: true })).toBeVisible();
});
