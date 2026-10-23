import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const offline = await readFile(new URL("../../public/offline.html", import.meta.url), "utf8");
const LIVE = "https://lazyportal-tan.vercel.app/";

test("local Android error page waits through HTTP outages and recovers using a readable HEAD", async ({ page }) => {
  let healthy = false, checks = 0;
  await page.clock.install();
  await page.route("https://localhost/**", (route) => route.fulfill({
    contentType: "text/html", body: offline.replace('src="offline.jpg"', 'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"'),
  }));
  await page.route(LIVE, (route) => {
    if (route.request().method() === "HEAD") {
      checks++;
      return route.fulfill({ status: healthy ? 200 : 503, contentType: "text/html",
        headers: { "Access-Control-Allow-Origin": "https://localhost" }, body: "" });
    }
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Live app</title>Recovered" });
  });
  await page.goto("https://localhost/offline.html");
  await page.clock.runFor(5000);
  await expect.poll(() => checks).toBe(1);
  await expect(page).toHaveURL("https://localhost/offline.html");
  await expect(page.getByRole("button", { name: "Try Again" })).toBeEnabled();
  healthy = true;
  await page.clock.runFor(10000);
  await expect.poll(() => checks).toBe(2);
  await expect(page).toHaveURL(LIVE);
});

test("mismatched recovery CORS permission fails safely without navigating", async ({ page }) => {
  await page.clock.install();
  await page.route("https://localhost/**", (route) => route.fulfill({ contentType: "text/html", body: offline }));
  let checks = 0;
  await page.route(LIVE, (route) => {
    checks++;
    // Playwright automatically adds an allowing CORS header when it is absent;
    // an explicit mismatch exercises the browser's real rejection path.
    return route.fulfill({ status: 200, contentType: "text/html",
      headers: { "Access-Control-Allow-Origin": "https://unrelated.invalid" }, body: "" });
  });
  await page.goto("https://localhost/offline.html");
  await page.clock.runFor(5000);
  await expect.poll(() => checks).toBe(1);
  await expect(page).toHaveURL("https://localhost/offline.html");
  await expect(page.getByRole("button", { name: "Try Again" })).toBeEnabled();
});
