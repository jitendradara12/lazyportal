import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "off",
    screenshot: "off",
    launchOptions: { executablePath: "/run/current-system/sw/bin/google-chrome" },
  },
  projects: [
    { name: "android-chrome", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
  webServer: {
    command: "npm run dev -- --host 0.0.0.0 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
