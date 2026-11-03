import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import { decrypt } from "../../../core/src/crypto.js";
import { mockPortal, SESSION } from "./helpers.js";

const pixels = gunzipSync(readFileSync(new URL("../../../core/test/fixtures/captcha/pixels.rgba.gz", import.meta.url)));
const imageBytes = 310 * 60 * 4;
const images = await Promise.all([0, 1].map(async i => (await sharp(pixels.subarray(i * imageBytes, (i + 1) * imageBytes), {
  raw: { width: 310, height: 60, channels: 4 },
}).png().toBuffer()).toString("base64")));
const response = image => ({ status: { responseStatus: "Success" }, response: { captcha: { hidden: image === images[0] ? "first" : "fresh", image } } });

async function setup(page, { reject = 0, passwordError = false } = {}) {
  await mockPortal(page);
  let fetched = 0;
  const submitted = [];
  await page.route("**/api/token/getcaptcha", route => route.fulfill({ json: response(images[Math.min(fetched++, 1)]) }));
  await page.route("**/api/token/pretoken-check", async route => {
    submitted.push(JSON.parse(await decrypt(route.request().postData())).captcha);
    await route.fulfill({ json: submitted.length <= reject
      ? { status: { responseStatus: "Failure", errors: ["Invalid captcha submitted."] } }
      : { status: { responseStatus: "Success" }, response: { random: "fixture", otppwd: "fixture" } } });
  });
  await page.route("**/api/token/generatewebtoken", route => route.fulfill({ json: passwordError
    ? { status: { responseStatus: "Failure", errors: ["Wrong password"] } }
    : { status: { responseStatus: "Success" }, response: { regdata: { ...SESSION, enrollmentno: SESSION.username } } } }));
  return { submitted, fetches: () => fetched };
}
async function openLogin(page) {
  await page.goto("/");
  await expect(page.getByLabel("Captcha", { exact: true })).toHaveValue("8ywx3");
  await page.getByLabel("Enrollment no", { exact: true }).fill("test-student");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
}

test("one click retries an automatic rejection with a fresh challenge", async ({ page }) => {
  const state = await setup(page, { reject: 1 });
  await openLogin(page);
  await page.getByRole("button", { name: "Enter portal", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  expect(state.submitted.map(c => [c.hidden, c.captcha])).toEqual([["first", "8ywx3"], ["fresh", "r2g6p"]]);
  expect(state.fetches()).toBe(2);
});

test("a password error preserves the image and answer without retrying", async ({ page }) => {
  const state = await setup(page, { passwordError: true });
  await openLogin(page);
  const image = await page.getByAltText("Captcha image").getAttribute("src");
  await page.getByRole("button", { name: "Enter portal", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Wrong password");
  await expect(page.getByLabel("Captcha", { exact: true })).toHaveValue("8ywx3");
  await expect(page.getByAltText("Captcha image")).toHaveAttribute("src", image);
  expect(state.fetches()).toBe(1);
  expect(state.submitted).toHaveLength(1);
});

test("editing a guess submits once and a rejection leaves a fresh image for manual entry", async ({ page }) => {
  const state = await setup(page, { reject: 8 });
  await openLogin(page);
  await page.getByLabel("Captcha", { exact: true }).fill("ABCDE");
  await expect(page.getByLabel("Captcha", { exact: true })).toHaveValue("abcde");
  await page.getByRole("button", { name: "Enter portal", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Enter the characters from the new image");
  await expect(page.getByLabel("Captcha", { exact: true })).toBeEmpty();
  await expect(page.getByLabel("Captcha", { exact: true })).toBeFocused();
  expect(state.submitted).toHaveLength(1);
  expect(state.fetches()).toBe(2);
});

test("taking over while the next image loads keeps the visible challenge and typed answer", async ({ page }) => {
  await mockPortal(page);
  let calls = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route("**/api/token/getcaptcha", async route => {
    if (++calls > 1) {
      await pending;
      await route.fulfill({ json: response(images[0]) }).catch(() => {});
    } else {
      const blank = await sharp({ create: { width: 310, height: 60, channels: 3, background: "white" } }).png().toBuffer();
      await route.fulfill({ json: response(blank.toString("base64")) });
    }
  });
  await page.goto("/");
  await expect.poll(() => calls).toBe(2);
  const image = await page.getByAltText("Captcha image").getAttribute("src");
  await page.getByRole("button", { name: "Type it myself" }).click();
  await page.getByLabel("Captcha", { exact: true }).fill("abcde");
  release();
  await expect(page.getByText("Type the characters above.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Captcha", { exact: true })).toHaveValue("abcde");
  await expect(page.getByAltText("Captcha image")).toHaveAttribute("src", image);
  await expect(page.getByRole("button", { name: "Type it myself" })).toHaveCount(0);
  expect(calls).toBe(2);
});

test("reconnect retries an automatic rejection using the saved password", async ({ page }) => {
  const state = await setup(page, { reject: 1 });
  await page.addInitScript(() => {
    localStorage.setItem("juet.portal.last_user", "test-student");
    localStorage.setItem("juet.portal.last_usertype", "S");
    localStorage.setItem("juet.portal.saved_pw", "fixture-password");
  });
  await page.goto("/");
  await expect(page.getByLabel("Captcha", { exact: true })).toHaveValue("8ywx3");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.evaluate(async session => {
    const resource = performance.getEntriesByType("resource").find(r => new URL(r.name).pathname === "/src/lib/portal.ts");
    const { store, setSessionStatus } = await import(resource.name);
    store.save(session);
    window.dispatchEvent(new CustomEvent("juet:renewed", { detail: session }));
    setSessionStatus("expired");
  }, SESSION);
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Renew session" });
  await expect(dialog.getByLabel("Captcha", { exact: true })).toHaveValue("r2g6p");
  await dialog.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.submitted.map(c => c.captcha)).toEqual(["r2g6p", "r2g6p"]);
});
