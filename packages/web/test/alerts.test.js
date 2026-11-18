import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const storage = new Map();
const dispatched = [];
const listeners = new Map();

globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  addEventListener: (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  },
  removeEventListener: (type, fn) => {
    listeners.get(type)?.delete(fn);
  },
  dispatchEvent: (event) => {
    dispatched.push(event);
    for (const fn of listeners.get(event.type) ?? []) fn(event);
    return true;
  },
};

let alerts, AlertsPromptBanner;

before(async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });
  try {
    alerts = await server.ssrLoadModule("/src/lib/alerts.ts");
    ({ AlertsPromptBanner } = await server.ssrLoadModule("/src/components/AlertsPromptBanner.tsx"));
  } finally {
    globalThis.__alertsTestServer = server;
  }
});

after(async () => {
  await globalThis.__alertsTestServer?.close();
});

beforeEach(() => {
  storage.clear();
  dispatched.length = 0;
  listeners.clear();
});

test("parseNotificationAction validates tab, mode, and refresh allowlists", () => {
  assert.deepEqual(alerts.parseNotificationAction({ tab: "marks", mode: "cgpa", refresh: "1" }), {
    tab: "marks",
    mode: "cgpa",
    refresh: true,
  });
  assert.deepEqual(alerts.parseNotificationAction({ mode: "marks", refresh: "true" }), {
    tab: "marks",
    mode: "marks",
    refresh: true,
  });
  assert.deepEqual(alerts.parseNotificationAction({ tab: "exams" }), {
    tab: "exams",
  });
  assert.equal(alerts.parseNotificationAction({ tab: "https://evil.example", mode: "admin", refresh: "0" }), null);
  assert.equal(alerts.parseNotificationAction(null), null);
});

test("parseNotificationSearch parses deep-link query params", () => {
  assert.deepEqual(alerts.parseNotificationSearch("?tab=marks&mode=cgpa&refresh=1"), {
    tab: "marks",
    mode: "cgpa",
    refresh: true,
  });
  assert.equal(alerts.parseNotificationSearch(""), null);
  assert.equal(alerts.parseNotificationSearch("?foo=bar"), null);
});

test("requestTabRefresh persists results.mode and queues pending refresh for unmounted tabs", () => {
  alerts.requestTabRefresh("marks", "cgpa");
  assert.equal(storage.get("juet.portal.results.mode"), "cgpa");
  assert.equal(alerts.consumePendingTabRefresh("cgpa"), true);
  assert.equal(alerts.consumePendingTabRefresh("cgpa"), false);
  assert.equal(dispatched.some((e) => e.type === "juet:refresh-tab" && e.detail?.key === "cgpa"), true);
});

test("alerts prompt dismissal persists across reads", () => {
  assert.equal(alerts.isAlertsPromptDismissed(), false);
  alerts.dismissAlertsPrompt();
  assert.equal(alerts.isAlertsPromptDismissed(), true);
});

test("getAlertsStatus returns unsupported cleanly outside Android native shell", async () => {
  const status = await alerts.getAlertsStatus();
  assert.deepEqual(status, { supported: false, muted: false, enabled: false, permission: "prompt" });
});

test("resolveTabRefreshKey respects active results.mode when mode is omitted", () => {
  assert.equal(alerts.resolveTabRefreshKey("marks"), "marks");
  storage.set("juet.portal.results.mode", "cgpa");
  assert.equal(alerts.resolveTabRefreshKey("marks"), "cgpa");
  assert.equal(alerts.resolveTabRefreshKey("marks", "marks"), "marks");

  alerts.requestTabRefresh("marks");
  assert.equal(alerts.consumePendingTabRefresh("cgpa"), true);
});

test("onTabRefresh delivers live refresh events for matching key only", () => {
  let hits = 0;
  const unsub = alerts.onTabRefresh("exams", () => { hits++; });
  alerts.requestTabRefresh("marks", "marks");
  assert.equal(hits, 0);
  alerts.requestTabRefresh("exams");
  assert.equal(hits, 1);
  unsub();
  alerts.requestTabRefresh("exams");
  assert.equal(hits, 1);
});

test("AlertsPromptBanner renders nothing when unsupported or dismissed", () => {
  assert.equal(renderToStaticMarkup(createElement(AlertsPromptBanner)), "");
  alerts.dismissAlertsPrompt();
  assert.equal(renderToStaticMarkup(createElement(AlertsPromptBanner)), "");
});
