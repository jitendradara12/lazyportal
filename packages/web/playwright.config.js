import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "android-chrome",
      testMatch: ["**/install-banner.spec.js", "**/android-install.spec.js"],
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "ios-safari",
      testMatch: ["**/install-banner.spec.js", "**/ios-guidance.spec.js"],
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 0.0.0.0 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
