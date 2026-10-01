import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInstallPrompt, INSTALL_DISMISSAL_KEY, INSTALL_DISMISSAL_MS } from "../src/lib/installPrompt.js";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36";
const NOW = Date.UTC(2026, 9, 1);

class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(name, listener) {
    super.addEventListener(name, listener);
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }
  removeEventListener(name, listener) {
    super.removeEventListener(name, listener);
    this.listeners.get(name)?.delete(listener);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

function fixture(t, { ua = ANDROID, platform = "Linux armv8l", touches = 5, standalone = false, iosStandalone = false, rawDismissal, storageError, legacyMedia = false, start = true } = {}) {
  let time = NOW;
  const values = new Map();
  const timers = new Map();
  let nextTimer = 0;
  if (rawDismissal !== undefined) values.set(INSTALL_DISMISSAL_KEY, rawDismissal);
  const storage = {
    getItem(key) {
      if (storageError === "read") throw new Error("Storage is blocked");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (storageError === "write") throw new Error("Quota exceeded");
      values.set(key, value);
    },
  };
  const win = new TrackedTarget();
  win.navigator = { userAgent: ua, platform, maxTouchPoints: touches, standalone: iosStandalone };
  win.document = new TrackedTarget();
  win.document.visibilityState = "visible";
  Object.defineProperty(win, "localStorage", {
    get() {
      if (storageError === "access") throw new Error("Storage is blocked");
      return storage;
    },
  });
  const media = new TrackedTarget();
  media.matches = standalone;
  if (legacyMedia) {
    media.addListener = (listener) => TrackedTarget.prototype.addEventListener.call(media, "change", listener);
    media.removeListener = (listener) => TrackedTarget.prototype.removeEventListener.call(media, "change", listener);
    media.addEventListener = undefined;
    media.removeEventListener = undefined;
  }
  win.matchMedia = (query) => {
    assert.equal(query, "(display-mode: standalone)");
    return media;
  };
  win.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, at: time + delay });
    return id;
  };
  win.clearTimeout = (id) => timers.delete(id);
  const controller = createInstallPrompt({ now: () => time });
  if (start) controller.start(win);
  t.after(() => controller.stop());
  return {
    controller, win, media, storage, values, timers,
    snapshot: controller.getSnapshot,
    now: () => time,
    advance(ms) {
      time += ms;
      for (const [id, timer] of timers) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    storageEvent(key = INSTALL_DISMISSAL_KEY, storageArea = storage) {
      const event = new Event("storage");
      Object.assign(event, { key, storageArea });
      win.dispatchEvent(event);
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function nativeEvent({ outcome = "accepted", userChoice = Promise.resolve({ outcome }), prompt = () => Promise.resolve() } = {}) {
  let calls = 0;
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, {
    userChoice,
    prompt() {
      calls++;
      return prompt();
    },
  });
  return { event, calls: () => calls };
}

describe("install platform and standalone policy", () => {
  for (const { name, ua, platform, touches, expected } of [
    { name: "Android Chrome", ua: ANDROID, expected: "android" },
    { name: "Android without Chrome", ua: ANDROID.replace(/Chrome\/\S+/, "Firefox/128.0"), expected: "android" },
    { name: "iPhone Safari", ua: IPHONE, expected: "ios-safari" },
    { name: "iPad Safari", ua: IPHONE.replace(/iPhone/g, "iPad"), expected: "ios-safari" },
    { name: "desktop-mode iPadOS", ua: IPAD_DESKTOP, platform: "MacIntel", touches: 5, expected: "ios-safari" },
    { name: "iOS Chrome", ua: IPHONE.replace("Version/18.0", "CriOS/128.0"), expected: "ios-other" },
    { name: "iOS Firefox", ua: IPHONE.replace("Version/18.0", "FxiOS/128.0"), expected: "ios-other" },
    { name: "iOS in-app browser", ua: `${IPHONE} [FBAN/FBIOS;FBAV/1]`, expected: "ios-other" },
    { name: "desktop Chrome", ua: DESKTOP, touches: 0, expected: null },
    { name: "real Mac Safari", ua: IPAD_DESKTOP, platform: "MacIntel", touches: 0, expected: null },
    { name: "unknown browser", ua: "", expected: null },
  ]) {
    it(`selects appropriate guidance for ${name}`, (t) => {
      const f = fixture(t, { ua, platform, touches });
      assert.equal(f.snapshot().mode, expected);
    });
  }

  it("suppresses display-mode: standalone, even when an install event arrives", async (t) => {
    const f = fixture(t, { standalone: true });
    const native = nativeEvent();
    f.win.dispatchEvent(native.event);
    await f.controller.install();
    assert.equal(f.snapshot().mode, null);
    assert.equal(native.calls(), 0);
  });

  it("suppresses navigator.standalone on iOS", (t) => {
    const f = fixture(t, { ua: IPHONE, iosStandalone: true });
    assert.equal(f.snapshot().mode, null);
  });

  for (const legacyMedia of [false, true]) {
    it(`reacts to standalone changes with ${legacyMedia ? "legacy Safari" : "modern"} media listeners`, (t) => {
      const f = fixture(t, { legacyMedia });
      f.media.matches = true;
      f.media.dispatchEvent(new Event("change"));
      assert.equal(f.snapshot().mode, null);
      f.media.matches = false;
      f.media.dispatchEvent(new Event("change"));
      assert.equal(f.snapshot().mode, "android");
    });
  }

  it("leaves desktop browser install UI alone", (t) => {
    const f = fixture(t, { ua: DESKTOP, touches: 0 });
    const native = nativeEvent();
    f.win.dispatchEvent(native.event);
    assert.equal(native.event.defaultPrevented, false);
    assert.equal(f.snapshot().mode, null);
  });
});

describe("native install lifecycle", () => {
  it("defers the native dialog until a user action, then invokes prompt synchronously", async (t) => {
    const f = fixture(t);
    const native = nativeEvent();
    f.win.dispatchEvent(native.event);
    assert.equal(native.event.defaultPrevented, true);
    assert.equal(f.snapshot().mode, "native");
    assert.equal(native.calls(), 0);
    const installation = f.controller.install();
    assert.equal(native.calls(), 1, "prompt must run before the first await");
    assert.equal(f.snapshot().isInstalling, true);
    await installation;
    assert.equal(f.snapshot().mode, null, "accepted installs hide the banner immediately");
    assert.equal(f.values.has(INSTALL_DISMISSAL_KEY), false);
  });

  it("ignores double taps and consumes each event only once", async (t) => {
    const f = fixture(t);
    const choice = deferred();
    const native = nativeEvent({ userChoice: choice.promise });
    f.win.dispatchEvent(native.event);
    const first = f.controller.install();
    await f.controller.install();
    assert.equal(native.calls(), 1);
    choice.resolve({ outcome: "accepted" });
    await first;
    await f.controller.install();
    assert.equal(native.calls(), 1);
  });

  it("honors a native dialog cancellation for 14 days and never reuses its event", async (t) => {
    const f = fixture(t);
    const native = nativeEvent({ outcome: "dismissed" });
    f.win.dispatchEvent(native.event);
    await f.controller.install();
    assert.equal(f.snapshot().mode, null);
    assert.equal(f.values.get(INSTALL_DISMISSAL_KEY), String(NOW));
    f.advance(INSTALL_DISMISSAL_MS);
    assert.equal(f.snapshot().mode, "android");
    await f.controller.install();
    assert.equal(native.calls(), 1);
  });

  for (const [name, prompt] of [
    ["synchronous throw", () => { throw new Error("No user activation"); }],
    ["rejected promise", () => Promise.reject(new Error("Install failed"))],
  ]) {
    it(`recovers from a ${name} with manual guidance, not a dead install button`, async (t) => {
      const f = fixture(t);
      const native = nativeEvent({ prompt });
      f.win.dispatchEvent(native.event);
      await f.controller.install();
      assert.equal(f.snapshot().mode, "android");
      assert.equal(f.snapshot().isInstalling, false);
      assert.match(f.snapshot().error, /Installation couldn't start/);
      await f.controller.install();
      assert.equal(native.calls(), 1);
      f.win.dispatchEvent(nativeEvent().event);
      assert.equal(f.snapshot().mode, "native");
      assert.equal(f.snapshot().error, null);
    });
  }

  it("handles a rejected userChoice promise without an unhandled rejection", async (t) => {
    const f = fixture(t);
    // Reject only once install() is awaiting the browser's choice promise.
    const native = nativeEvent({ userChoice: Promise.resolve().then(() => { throw new Error("Choice unavailable"); }) });
    f.win.dispatchEvent(native.event);
    await f.controller.install();
    assert.equal(f.snapshot().mode, "android");
    assert.ok(f.snapshot().error);
  });

  it("hides after appinstalled, including installation from browser menus", (t) => {
    const f = fixture(t);
    f.win.dispatchEvent(new Event("appinstalled"));
    assert.equal(f.snapshot().mode, null);
    f.win.dispatchEvent(nativeEvent().event);
    f.win.dispatchEvent(new Event("focus"));
    assert.equal(f.snapshot().mode, null);
  });

  it("does not resurrect a banner or persist a cancellation after appinstalled", async (t) => {
    const f = fixture(t);
    const choice = deferred();
    f.win.dispatchEvent(nativeEvent({ userChoice: choice.promise }).event);
    const installation = f.controller.install();
    f.win.dispatchEvent(new Event("appinstalled"));
    choice.resolve({ outcome: "dismissed" });
    await installation;
    assert.equal(f.snapshot().mode, null);
    assert.equal(f.values.has(INSTALL_DISMISSAL_KEY), false);
  });
});

describe("persistent dismissal", () => {
  it("stores only its own key and expires at exactly 14 days", (t) => {
    const f = fixture(t);
    f.values.set("juet.portal.session.v1", "keep me");
    f.controller.dismiss();
    assert.equal(f.values.get(INSTALL_DISMISSAL_KEY), String(NOW));
    assert.equal(f.values.get("juet.portal.session.v1"), "keep me");
    assert.equal(f.snapshot().mode, null);
    f.advance(INSTALL_DISMISSAL_MS - 1);
    assert.equal(f.snapshot().mode, null);
    f.advance(1);
    assert.equal(f.snapshot().mode, "android");
    assert.equal(f.timers.size, 0);
  });

  it("honors dismissal across controller restarts/reloads", (t) => {
    const f = fixture(t);
    f.controller.dismiss();
    f.controller.stop();
    f.advance(INSTALL_DISMISSAL_MS - 1);
    f.controller.start(f.win);
    assert.equal(f.snapshot().mode, null);
    f.advance(1);
    assert.equal(f.snapshot().mode, "android");
  });

  it("captures but suppresses native events during the cooldown", (t) => {
    const f = fixture(t, { rawDismissal: String(NOW - 1) });
    const native = nativeEvent();
    f.win.dispatchEvent(native.event);
    assert.equal(native.event.defaultPrevented, true);
    assert.equal(f.snapshot().mode, null);
    assert.equal(native.calls(), 0);
    f.advance(INSTALL_DISMISSAL_MS - 1);
    assert.equal(f.snapshot().mode, "native");
  });

  for (const rawDismissal of [null, "", "NaN", "Infinity", "garbage", "-1", "1.5", String(NOW + 1), String(NOW - INSTALL_DISMISSAL_MS)]) {
    it(`does not suppress for invalid or expired storage value ${JSON.stringify(rawDismissal)}`, (t) => {
      const f = fixture(t, { rawDismissal });
      assert.equal(f.snapshot().mode, "android");
      assert.equal(f.timers.size, 0);
    });
  }

  for (const storageError of ["access", "read", "write"]) {
    it(`remains usable when storage fails on ${storageError}`, (t) => {
      const f = fixture(t, { storageError });
      assert.equal(f.snapshot().mode, "android");
      f.controller.dismiss();
      f.win.dispatchEvent(new Event("focus"));
      f.win.document.dispatchEvent(new Event("visibilitychange"));
      assert.equal(f.snapshot().mode, null, "in-memory cooldown survives focus/resume");
      f.advance(INSTALL_DISMISSAL_MS);
      assert.equal(f.snapshot().mode, "android");
    });
  }

  it("syncs relevant localStorage changes and storage.clear across tabs", (t) => {
    const f = fixture(t);
    f.values.set(INSTALL_DISMISSAL_KEY, String(NOW));
    f.storageEvent("unrelated");
    assert.equal(f.snapshot().mode, "android");
    f.storageEvent(INSTALL_DISMISSAL_KEY, {});
    assert.equal(f.snapshot().mode, "android", "sessionStorage is unrelated");
    f.storageEvent();
    assert.equal(f.snapshot().mode, null);
    f.values.clear();
    f.storageEvent(null);
    assert.equal(f.snapshot().mode, "android");
  });

  it("rechecks dismissal when a suspended page resumes", (t) => {
    const f = fixture(t);
    f.values.set(INSTALL_DISMISSAL_KEY, String(NOW));
    f.win.document.visibilityState = "hidden";
    f.win.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(f.snapshot().mode, "android");
    f.win.document.visibilityState = "visible";
    f.win.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(f.snapshot().mode, null);
  });
});

describe("controller lifecycle and subscriptions", () => {
  it("has a stable hidden server snapshot and stable browser snapshots until state changes", (t) => {
    const f = fixture(t, { start: false });
    const initial = f.snapshot();
    assert.equal(initial.mode, null);
    assert.equal(f.controller.getServerSnapshot(), initial);
    f.controller.start(f.win);
    const visible = f.snapshot();
    f.win.dispatchEvent(new Event("focus"));
    assert.equal(f.snapshot(), visible, "useSyncExternalStore requires cached snapshots");
    assert.equal(f.controller.getServerSnapshot(), initial);
  });

  it("starts idempotently, notifies only on changes, and unsubscribes", (t) => {
    const f = fixture(t, { start: false });
    let notifications = 0;
    const unsubscribe = f.controller.subscribe(() => notifications++);
    f.controller.start(f.win);
    const listenerCount = f.win.listenerCount;
    f.controller.start(f.win);
    assert.equal(f.win.listenerCount, listenerCount);
    f.win.dispatchEvent(new Event("focus"));
    assert.equal(notifications, 1);
    f.controller.dismiss();
    assert.equal(notifications, 2);
    unsubscribe();
    f.advance(INSTALL_DISMISSAL_MS);
    assert.equal(notifications, 2);
  });

  for (const legacyMedia of [false, true]) {
    it(`cleans up every timer and ${legacyMedia ? "legacy" : "modern"} listener on stop`, (t) => {
      const f = fixture(t, { legacyMedia });
      f.controller.dismiss();
      assert.equal(f.timers.size, 1);
      f.controller.stop();
      f.controller.stop();
      assert.equal(f.win.listenerCount, 0);
      assert.equal(f.win.document.listenerCount, 0);
      assert.equal(f.media.listenerCount, 0);
      assert.equal(f.timers.size, 0);
      assert.equal(f.snapshot().mode, null);
    });
  }

  it("ignores async results from an old lifecycle after stop/restart", async (t) => {
    const f = fixture(t);
    const choice = deferred();
    f.win.dispatchEvent(nativeEvent({ userChoice: choice.promise }).event);
    const installation = f.controller.install();
    f.controller.stop();
    f.controller.start(f.win);
    choice.resolve({ outcome: "accepted" });
    await installation;
    assert.equal(f.snapshot().mode, "android");
    assert.equal(f.snapshot().isInstalling, false);
  });
});
