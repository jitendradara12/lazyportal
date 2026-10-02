import { expect } from "@playwright/test";

export const DISMISSAL_KEY = "juet.portal.install.dismissedAt.v1";
export const DISMISSAL_MS = 14 * 24 * 60 * 60 * 1000;
export const RELEASES_URL = "https://github.com/jitendradara12/lazyportal/releases";
export const SESSION = { token: "test-token", username: "test-student", name: "Test Student", instituteid: "test-institute" };

export function banner(page) {
  return page.getByRole("complementary", { name: "Install Lazyportal" });
}

export async function mockPortal(page) {
  // No credentials, live portal requests, or install binaries in browser tests.
  await page.route("**/api/**", (route) => route.fulfill({
    json: {
      status: { responseStatus: "Success" },
      response: {
        // A blank PNG lets the login view settle into manual captcha entry.
        captcha: { hidden: "test-captcha", image: "iVBORw0KGgoAAAANSUhEUgAAATYAAAA8CAIAAABjMgEsAAAAyElEQVR4nO3TMQEAMAyAsPo33TrYO45EAQ+zQNj8DgBeLAppFoU0i0KaRSHNopBmUUizKKRZFNIsCmkWhTSLQppFIc2ikGZRSLMopFkU0iwKaRaFNItCmkUhzaKQZlFIsyikWRTSLAppFoU0i0KaRSHNopBmUUizKKRZFNIsCmkWhTSLQppFIc2ikGZRSLMopFkU0iwKaRaFNItCmkUhzaKQZlFIsyikWRTSLAppFoU0i0KaRSHNopBmUUizKKRZFNIsCmkWhbQDlfEqwDC7A+kAAAAASUVORK5CYII=" },
        headerlist: [],
        semlist: [],
      },
    },
  }));
  await page.route("**/_vercel/**", (route) => route.fulfill({ status: 204 }));
  await page.route("https://va.vercel-scripts.com/**", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
}

export async function openApp(page, { dashboard = false } = {}) {
  await mockPortal(page);
  if (dashboard) {
    await page.addInitScript((session) => localStorage.setItem("juet.portal.session.v1", JSON.stringify(session)), SESSION);
  }
  await page.goto("/");
  if (!dashboard) await waitForLogin(page);
}

export async function waitForLogin(page) {
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  // Login intentionally focuses captcha after its async solver completes.
  // Wait for that existing behavior rather than racing its delayed focus.
  await expect(page.getByLabel("Captcha", { exact: true })).toBeFocused();
}

export async function renewSession(page) {
  await page.evaluate((session) => {
    localStorage.setItem("juet.portal.session.v1", JSON.stringify(session));
    window.dispatchEvent(new CustomEvent("juet:renewed", { detail: session }));
  }, SESSION);
  // The dashboard's attendance hero. Its accessible name carries live data
  // ("Attendance, Loading…" → "Attendance, 78% attendance"), so match the
  // stable prefix instead of the full label.
  await expect(page.getByRole("button", { name: /^Attendance,/ })).toBeVisible();
}

export async function emitNativePrompt(page, { outcome = "accepted", fail = false, pending = false } = {}) {
  return page.evaluate(({ outcome, fail, pending }) => {
    const state = { calls: 0, hadUserActivation: false, resolve: null };
    window.__installTest = state;
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = () => {
      state.calls++;
      state.hadUserActivation = navigator.userActivation.isActive;
      if (fail) throw new Error("Native installation unavailable");
      return Promise.resolve();
    };
    event.userChoice = pending
      ? new Promise((resolve) => { state.resolve = resolve; })
      : Promise.resolve({ outcome });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, { outcome, fail, pending });
}
