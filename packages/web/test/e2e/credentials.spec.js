import { test, expect } from "@playwright/test";
import { decrypt } from "../../../core/src/crypto.js";
import { mockPortal, waitForLogin } from "./helpers.js";

const account = { username: "test-student", usertype: "S" };
const password = "test-only-secret-🔒";
const storageKey = "juet.portal.credentials.v1";

async function seedLegacy(page) {
  await mockPortal(page);
  // Only seed once, so reload actually tests persistence rather than reseeding.
  await page.addInitScript(({ account, password }) => {
    if (sessionStorage.getItem("seeded-credentials")) return;
    sessionStorage.setItem("seeded-credentials", "1");
    localStorage.setItem("juet.portal.last_user", account.username);
    localStorage.setItem("juet.portal.last_usertype", account.usertype);
    localStorage.setItem("juet.portal.saved_pw", password);
  }, { account, password });
  await page.goto("/");
  await waitForLogin(page);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey)).not.toBeNull();
}

// Share the app's module instance even when an existing Vite server has an HMR URL.
async function readSaved(page) {
  return page.evaluate(async (account) => {
    const { savedCredentials } = await import(performance.getEntriesByType("resource").find((r) => new URL(r.name).pathname === "/src/lib/portal.ts").name);
    return savedCredentials.load(account);
  }, account);
}

async function mockLogin(page, { reject = false } = {}) {
  const submitted = [];
  await page.route("**/api/token/pretoken-check", (route) => route.fulfill({
    json: { status: { responseStatus: "Success" }, response: { random: "fixture", otppwd: "fixture" } },
  }));
  await page.route("**/api/token/generatewebtoken", async (route) => {
    submitted.push(JSON.parse(await decrypt(route.request().postData())).passwordotpvalue);
    await route.fulfill({
      json: reject
        ? { status: { responseStatus: "Failure", errors: ["Wrong password"] } }
        : { status: { responseStatus: "Success" }, response: { regdata: {
          token: "test-token", name: "Test Student", membertype: "S", enrollmentno: "TEST-STUDENT", institutelist: [],
        } } },
    });
  });
  return submitted;
}

test("migrates plaintext, keeps the input empty, and decrypts after a reload", async ({ page }) => {
  await seedLegacy(page);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => ({ ...localStorage }));
  expect(stored["juet.portal.saved_pw"]).toBeUndefined();
  expect(JSON.stringify(stored)).not.toContain(password);
  expect(await readSaved(page)).toBe(password);
  await page.reload();
  await waitForLogin(page);
  expect(await readSaved(page)).toBe(password);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");

  const keyInfo = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("juet.portal.credentials", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const key = await new Promise((resolve) => {
      const r = db.transaction("keys").objectStore("keys").get("password");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    try { await crypto.subtle.exportKey("raw", key); return { extractable: key.extractable, exported: true }; }
    catch { return { extractable: key.extractable, exported: false }; }
  });
  expect(keyInfo).toEqual({ extractable: false, exported: false });
});

test("saved login submits the decrypted password and logout removes it", async ({ page }) => {
  await seedLegacy(page);
  const submitted = await mockLogin(page);
  await page.getByLabel("Captcha", { exact: true }).fill("abcde");
  await page.getByRole("button", { name: "Enter portal" }).click();
  await expect(page.getByRole("button", { name: "Logout", exact: true })).toBeVisible();
  expect(submitted).toEqual([password]);
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect(await readSaved(page)).toBe("");
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
});

test("new logins encrypt passwords and disabling remember removes them", async ({ page }) => {
  await mockPortal(page);
  const submitted = await mockLogin(page);
  await page.goto("/");
  await waitForLogin(page);
  await page.getByLabel("Enrollment no", { exact: true }).fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Captcha", { exact: true }).fill("abcde");
  await page.getByRole("button", { name: "Enter portal" }).click();
  await expect(page.getByRole("button", { name: "Logout", exact: true })).toBeVisible();
  expect(await readSaved(page)).toBe(password);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(password);

  // Expire just the app session, retaining the remembered credentials.
  await page.evaluate(() => localStorage.removeItem("juet.portal.session.v1"));
  await page.reload();
  await waitForLogin(page);
  await page.getByText("Remember me (only saved locally)", { exact: true }).click();
  await expect(page.getByLabel("Remember me (only saved locally)")).not.toBeChecked();
  await page.getByLabel("Captcha", { exact: true }).fill("abcde");
  await page.getByRole("button", { name: "Enter portal" }).click();
  await expect(page.getByRole("button", { name: "Logout", exact: true })).toBeVisible();
  expect(submitted).toEqual([password, password]);
  expect(await readSaved(page)).toBe("");
});

test("clearing saved profile removes ciphertext and requires a fresh password", async ({ page }) => {
  await seedLegacy(page);
  await page.getByRole("button", { name: "Clear saved credentials", exact: true }).click();
  await expect(page.getByLabel("Enrollment no", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  expect(await readSaved(page)).toBe("");
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
});

async function showExpiredDashboard(page) {
  await page.evaluate(async (account) => {
    const { store } = await import(performance.getEntriesByType("resource").find((r) => new URL(r.name).pathname === "/src/lib/portal.ts").name);
    const session = { ...account, token: "old-test-token", membertype: "S", name: "Test Student" };
    store.save(session);
    window.dispatchEvent(new CustomEvent("juet:renewed", { detail: session }));
  }, account);
  await expect(page.getByRole("button", { name: "Logout", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { setSessionStatus } = await import(performance.getEntriesByType("resource").find((r) => new URL(r.name).pathname === "/src/lib/portal.ts").name);
    setSessionStatus("expired");
  });
  await expect(page.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();
}

test("manual reconnect uses the encrypted password without putting it in a field", async ({ page }) => {
  await seedLegacy(page);
  const submitted = await mockLogin(page);
  await showExpiredDashboard(page);
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Renew session" });
  await expect(dialog.getByLabel("Captcha", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Captcha", { exact: true }).fill("abcde");
  await dialog.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toEqual([password]);
  expect(await readSaved(page)).toBe(password);
});

test("silent recovery decrypts saved credentials after token refresh fails", async ({ page }) => {
  await seedLegacy(page);
  const submitted = await mockLogin(page);
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 310;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 310, 60);
    ctx.font = "bold 40px Arial, 'Liberation Sans', sans-serif";
    ctx.fillStyle = "black";
    ctx.fillText("ab234", 18, 43);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.route("**/api/token/getcaptcha", (route) => route.fulfill({
    json: { status: { responseStatus: "Success" }, response: { captcha: { hidden: "fixture", image } } },
  }));
  await page.route("**/api/token/refreshTokenRequest", (route) => route.fulfill({
    json: { status: { responseStatus: "Success" }, response: { msg: "Failure" } },
  }));
  await page.route("**/api/credential-test", (route) => route.request().headers().authorization === "Bearer test-token"
    ? route.fulfill({ json: { status: { responseStatus: "Success" }, response: { recovered: true } } })
    : route.fulfill({ status: 401, json: { status: { responseStatus: "Failure", errors: ["Session expired"] } } }));
  const result = await page.evaluate(async (account) => {
    const { client, store } = await import(performance.getEntriesByType("resource").find((r) => new URL(r.name).pathname === "/src/lib/portal.ts").name);
    store.save({ ...account, membertype: "S", token: "old-test-token" });
    return client.postRaw("/credential-test", {});
  }, account);
  expect(result.response.recovered).toBe(true);
  expect(submitted).toEqual([password]);
  expect(await readSaved(page)).toBe(password);
});
