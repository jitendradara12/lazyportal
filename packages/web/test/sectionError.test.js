import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const storage = new Map();
globalThis.localStorage ??= {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.document ??= {
  addEventListener() {},
  removeEventListener() {},
  documentElement: { setAttribute() {}, getAttribute: () => null },
  querySelector: () => null,
};
globalThis.window ??= {
  navigator: globalThis.navigator,
  document: globalThis.document,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

let server, SectionError, classifySectionError, subscribeSectionAutoRetry;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });
  ({ SectionError, classifySectionError, subscribeSectionAutoRetry } =
    await server.ssrLoadModule("/src/components/DataViews.tsx"));
});

after(async () => {
  await server?.close();
});

function createEmitter() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

test("classifySectionError marks only transient offline/down/timeout errors as retryable", () => {
  assert.deepEqual(classifySectionError("You are offline.", true), {
    isOffline: true,
    isDown: false,
    isTimeout: false,
    isTransient: true,
  });
  assert.deepEqual(classifySectionError("Anything", false), {
    isOffline: true,
    isDown: false,
    isTimeout: false,
    isTransient: true,
  });
  assert.deepEqual(classifySectionError("JUET's portal is down (not us).", true), {
    isOffline: false,
    isDown: true,
    isTimeout: false,
    isTransient: true,
  });
  assert.deepEqual(classifySectionError("JUET's portal took too long to respond. Please retry.", true), {
    isOffline: false,
    isDown: false,
    isTimeout: true,
    isTransient: true,
  });

  for (const nonTransient of [
    "Portal logged you out.",
    "Session expired! Please login again.",
    "Invalid captcha submitted.",
    "Wrong password",
    "Request failed (HTTP 400)",
    "Request failed (HTTP 404)",
    "Some class details could not be updated. Retry to load the remaining subjects.",
  ]) {
    assert.equal(classifySectionError(nonTransient, true).isTransient, false, nonTransient);
  }
  assert.equal(classifySectionError("Portal logged you out.", false).isTransient, false);
});

test("subscribeSectionAutoRetry retries once on visibilitychange -> visible for transient errors without loops", () => {
  for (const error of [
    "You are offline.",
    "JUET's portal is down (not us).",
    "JUET's portal took too long to respond. Please retry.",
  ]) {
    const { isTransient } = classifySectionError(error, true);
    const win = createEmitter();
    const doc = Object.assign(createEmitter(), { visibilityState: "hidden" });
    const nav = { onLine: true };
    let retries = 0;

    const cleanup = subscribeSectionAutoRetry({
      isTransient,
      retry: () => { retries++; },
      win,
      doc,
      nav,
    });

    // Duplicate visible events without hiding again must not trigger extra retries.
    doc.visibilityState = "visible";
    doc.emit("visibilitychange");
    doc.emit("visibilitychange");
    assert.equal(retries, 1, `${error} should retry once on return to visible`);

    // A full hidden -> visible cycle allows one more retry.
    doc.visibilityState = "hidden";
    doc.emit("visibilitychange");
    doc.visibilityState = "visible";
    doc.emit("visibilitychange");
    assert.equal(retries, 2);

    cleanup();
    assert.equal(win.count("online"), 0);
    assert.equal(doc.count("visibilitychange"), 0);
  }
});

test("subscribeSectionAutoRetry skips background online events, offline visible returns, and expired/auth errors", () => {
  const win = createEmitter();
  const doc = Object.assign(createEmitter(), { visibilityState: "hidden" });
  const nav = { onLine: false };
  let retries = 0;

  const cleanup = subscribeSectionAutoRetry({
    isTransient: true,
    retry: () => { retries++; },
    win,
    doc,
    nav,
  });

  // Coming online while hidden waits for visibilitychange -> visible.
  nav.onLine = true;
  win.emit("online");
  assert.equal(retries, 0);

  // Returning visible while still offline does not fire; subsequent online does.
  nav.onLine = false;
  doc.visibilityState = "visible";
  doc.emit("visibilitychange");
  assert.equal(retries, 0);
  nav.onLine = true;
  win.emit("online");
  assert.equal(retries, 1);

  // Subsequent visible event without hiding does not double-fire after online retry.
  doc.emit("visibilitychange");
  assert.equal(retries, 1);
  cleanup();

  // Never retries auth/validation errors or when session is expired.
  const win2 = createEmitter();
  const doc2 = Object.assign(createEmitter(), { visibilityState: "visible" });
  let blockedRetries = 0;
  const cleanupAuth = subscribeSectionAutoRetry({
    isTransient: classifySectionError("Portal logged you out.", true).isTransient,
    retry: () => { blockedRetries++; },
    win: win2,
    doc: doc2,
    nav: { onLine: true },
  });
  const cleanupExpired = subscribeSectionAutoRetry({
    isTransient: true,
    isExpired: true,
    retry: () => { blockedRetries++; },
    win: win2,
    doc: doc2,
    nav: { onLine: true },
  });
  win2.emit("online");
  doc2.emit("visibilitychange");
  assert.equal(blockedRetries, 0);
  cleanupAuth();
  cleanupExpired();
});

test("SectionError renders expected copy for offline, down, timeout, and portal errors", () => {
  assert.match(
    renderToStaticMarkup(createElement(SectionError, { label: "Marks", error: "You are offline.", retry() {} })),
    /You are offline\./,
  );
  assert.match(
    renderToStaticMarkup(createElement(SectionError, { label: "Marks", error: "JUET's portal is down (not us).", retry() {} })),
    /JUET&#x27;s portal is down \(not us\)\./,
  );
  assert.match(
    renderToStaticMarkup(createElement(SectionError, { label: "Marks", error: "JUET's portal took too long to respond. Please retry.", retry() {} })),
    /Marks failed: JUET&#x27;s portal took too long to respond\. Please retry\./,
  );
});
