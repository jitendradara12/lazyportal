// Browser-only install policy. No portal API calls or React dependencies.
export const INSTALL_DISMISSAL_KEY = "juet.portal.install.dismissedAt.v1";
export const INSTALL_DISMISSAL_MS = 14 * 24 * 60 * 60 * 1000;
export const APK_RELEASES_URL = "https://github.com/jitendradara12/lazyportal/releases";

/** @typedef {"android" | "ios-safari" | "ios-other"} InstallPlatform */
/** @typedef {{ mode: InstallPlatform | "native" | null, isInstalling: boolean, error: string | null }} InstallSnapshot */
/** @typedef {Event & { prompt: () => Promise<unknown>, userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }} InstallEvent */

/** @type {InstallSnapshot} */
const HIDDEN = Object.freeze({ mode: null, isInstalling: false, error: null });

/** @returns {InstallPlatform | null} */
function detectPlatform(navigator) {
  const ua = navigator.userAgent ?? "";
  // iPadOS requests desktop sites by default and identifies itself as a Mac.
  const isIOS = /iPad|iPhone|iPod/i.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    const isSafari = /Version\/.*Safari\//i.test(ua)
      && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA|FBAN|FBAV|Instagram|Line\/|MicroMessenger/i.test(ua);
    return isSafari ? "ios-safari" : "ios-other";
  }
  return /Android/i.test(ua) ? "android" : null;
}

function dismissalExpiry(raw, now) {
  const dismissedAt = Number(raw);
  // Corrupt/future timestamps must not hide the banner indefinitely.
  if (!Number.isSafeInteger(dismissedAt) || dismissedAt <= 0 || dismissedAt > now) return 0;
  return dismissedAt + INSTALL_DISMISSAL_MS;
}

/**
 * One controller lives above the login/dashboard lifecycle. The browser and
 * clock are injected in tests; creating a controller is inert until start().
 */
export function createInstallPrompt({ now = Date.now } = {}) {
  /** @type {Window | null} */
  let win = null;
  let displayMode = null;
  /** @type {InstallPlatform | null} */
  let platform = null;
  /** @type {InstallEvent | null} */
  let pendingPrompt = null;
  let installed = false;
  let dismissedUntil = 0;
  let localOnlyDismissal = false;
  let isInstalling = false;
  let error = null;
  let expiryTimer;
  let generation = 0;
  /** @type {InstallSnapshot} */
  let snapshot = HIDDEN;
  const listeners = new Set();
  const cleanups = [];

  function isStandalone() {
    return Boolean(displayMode?.matches || win?.navigator.standalone);
  }

  function publish() {
    const hidden = !win || !platform || installed || isStandalone() || dismissedUntil > now();
    /** @type {InstallSnapshot} */
    const next = hidden ? HIDDEN : {
      mode: pendingPrompt || isInstalling ? "native" : platform,
      isInstalling,
      error,
    };
    if (snapshot.mode === next.mode && snapshot.isInstalling === next.isInstalling && snapshot.error === next.error) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function scheduleExpiry() {
    if (!win) return;
    win.clearTimeout(expiryTimer);
    const remaining = dismissedUntil - now();
    if (remaining > 0 && !installed) {
      expiryTimer = win.setTimeout(refresh, remaining);
    }
  }

  function refresh() {
    if (!win) return;
    // A failed storage write still buys a cooldown for this page's lifetime.
    if (!localOnlyDismissal) {
      try {
        dismissedUntil = dismissalExpiry(win.localStorage.getItem(INSTALL_DISMISSAL_KEY), now());
      } catch {
        // Disabled storage/private browsing must not break the app.
      }
    }
    publish();
    scheduleExpiry();
  }

  function dismiss() {
    if (!win) return;
    const dismissedAt = now();
    dismissedUntil = dismissedAt + INSTALL_DISMISSAL_MS;
    error = null;
    localOnlyDismissal = false;
    try {
      win.localStorage.setItem(INSTALL_DISMISSAL_KEY, String(dismissedAt));
    } catch {
      localOnlyDismissal = true;
    }
    publish();
    scheduleExpiry();
  }

  async function install() {
    if (!win || !pendingPrompt || isInstalling || installed || isStandalone() || dismissedUntil > now()) return;
    const event = pendingPrompt;
    const attemptGeneration = generation;
    // The event is single-use, even if prompt() throws or the user cancels.
    pendingPrompt = null;
    isInstalling = true;
    error = null;
    publish();
    try {
      // Keep this call synchronous with the tap: awaiting first loses the
      // browser's user activation and can make the native dialog fail.
      const userChoice = event.userChoice.catch(() => null);
      await event.prompt();
      const choice = await userChoice;
      if (!win || generation !== attemptGeneration || installed) return;
      if (!choice) throw new Error("Install choice unavailable");
      if (choice.outcome === "accepted") {
        installed = true;
      } else {
        dismiss();
      }
    } catch {
      if (!win || generation !== attemptGeneration) return;
      if (!installed) error = "Installation couldn't start. Tap How to install or download the Android APK.";
    } finally {
      if (win && generation === attemptGeneration) {
        isInstalling = false;
        publish();
      }
    }
  }

  function onBeforeInstallPrompt(event) {
    if (!platform || installed || isStandalone() || typeof event.prompt !== "function") return;
    // Also intercept during a remembered dismissal, so Chrome doesn't show
    // its own automatic install UI after the user has told us "not now".
    event.preventDefault();
    if (isInstalling) return;
    pendingPrompt = event;
    error = null;
    refresh();
  }

  function onInstalled() {
    installed = true;
    pendingPrompt = null;
    error = null;
    refresh();
  }

  function onStorage(event) {
    if (event.key !== null && event.key !== INSTALL_DISMISSAL_KEY) return;
    try {
      if (event.storageArea && event.storageArea !== win.localStorage) return;
    } catch {
      return;
    }
    localOnlyDismissal = false;
    refresh();
  }

  function onVisibilityChange() {
    if (win.document.visibilityState === "visible") refresh();
  }

  function listen(target, name, listener) {
    target.addEventListener(name, listener);
    cleanups.push(() => target.removeEventListener(name, listener));
  }

  function start(browserWindow) {
    if (win) return;
    win = browserWindow;
    generation++;
    platform = detectPlatform(win.navigator);
    displayMode = win.matchMedia?.("(display-mode: standalone)") ?? null;
    listen(win, "beforeinstallprompt", onBeforeInstallPrompt);
    listen(win, "appinstalled", onInstalled);
    listen(win, "storage", onStorage);
    listen(win, "focus", refresh);
    listen(win.document, "visibilitychange", onVisibilityChange);
    if (displayMode?.addEventListener) {
      listen(displayMode, "change", refresh);
    } else if (displayMode?.addListener) {
      // Older iOS Safari supports only the legacy MediaQueryList API.
      displayMode.addListener(refresh);
      cleanups.push(() => displayMode.removeListener(refresh));
    }
    refresh();
  }

  function stop() {
    if (!win) return;
    win.clearTimeout(expiryTimer);
    for (const cleanup of cleanups.splice(0)) cleanup();
    win = null;
    displayMode = null;
    pendingPrompt = null;
    installed = false;
    dismissedUntil = 0;
    localOnlyDismissal = false;
    isInstalling = false;
    error = null;
    generation++;
    publish();
  }

  return {
    start,
    stop,
    dismiss,
    install,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => HIDDEN,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const installPrompt = createInstallPrompt();
// Register before React mounts so early browser events and page transitions
// cannot drop the deferred prompt. Guarded for Node tests/server rendering.
if (typeof window !== "undefined") installPrompt.start(window);
if (import.meta.hot) import.meta.hot.dispose(() => installPrompt.stop());
