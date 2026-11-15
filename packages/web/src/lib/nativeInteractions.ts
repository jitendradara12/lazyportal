import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { createBackHandlers } from "./backHandlers.js";

const nativeInteractions = registerPlugin<{
  addListener(event: "back", callback: () => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
  setBackEnabled(options: { enabled: boolean }): Promise<void>;
  defaultBack(): Promise<void>;
  haptic(): Promise<void>;
  hideKeyboard(): Promise<void>;
  getAppVersion(): Promise<{ version: string }>;
  installUpdate(options: { tag: string; sha256?: string | null }): Promise<{ started?: boolean }>;
}>("NativeInteractions");

const available = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("NativeInteractions");

export type AppUpdateInstallResult = "started" | "unsupported" | "permission_denied" | "failed";

export async function getInstalledAppVersion(): Promise<string | null> {
  if (!available()) return null;
  // Older APKs have this plugin but not this method.
  return nativeInteractions.getAppVersion().then(({ version }) => version).catch(() => null);
}

export async function installAppUpdate(
  options: { tag: string; sha256?: string | null },
): Promise<AppUpdateInstallResult> {
  if (!available()) return "unsupported";
  try {
    await nativeInteractions.installUpdate({
      tag: options.tag,
      sha256: options.sha256 ?? null,
    });
    return "started";
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
    const message = err instanceof Error ? err.message
      : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : String(err ?? "");
    if (code === "UNIMPLEMENTED" || /not implemented|unimplemented/i.test(message)) {
      return "unsupported";
    }
    if (code === "PERMISSION_DENIED" || (!code && /permission/i.test(message))) {
      return "permission_denied";
    }
    return "failed";
  }
}

let listening = false;
let initialization: Promise<void> | undefined;
let webPopstateBound = false;
let webPushed = false;

export const appBack = createBackHandlers((enabled: boolean) => {
  if (listening) {
    void nativeInteractions.setBackEnabled({ enabled }).catch(() => {});
    return;
  }
  if (typeof window === "undefined" || available()) return;
  if (!webPopstateBound) {
    webPopstateBound = true;
    // Tabs restore their own scroll; closing overlay history must not rewind it.
    window.history.scrollRestoration = "manual";
    window.addEventListener("popstate", () => {
      webPushed = false;
      appBack.dispatch();
    });
  }
  if (enabled && !webPushed) {
    webPushed = true;
    window.history.pushState({ juetOverlay: true }, "");
  } else if (!enabled && webPushed) {
    webPushed = false;
    if (window.history.state?.juetOverlay) window.history.back();
  }
});

export function initializeNativeInteractions() {
  if (!available()) return;
  initialization ??= (async () => {
    // A WebView reload keeps the native plugin alive, but replaces its JS listeners.
    await nativeInteractions.removeAllListeners();
    await nativeInteractions.addListener("back", () => {
      if (!appBack.dispatch()) void nativeInteractions.defaultBack().catch(() => {});
    });
    listening = true;
    await nativeInteractions.setBackEnabled({ enabled: appBack.enabled });
  })().catch(() => { listening = false; initialization = undefined; });
  return initialization;
}

let lastHaptic = -Infinity;
/** Native touch feedback only; older APKs and browsers quietly skip it. */
export function selectionHaptic() {
  if (!available()) return;
  const now = performance.now();
  if (now - lastHaptic < 80) return;
  lastHaptic = now;
  void nativeInteractions.haptic().catch(() => {});
}

export function hideKeyboard() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (available()) void nativeInteractions.hideKeyboard().catch(() => {});
}
