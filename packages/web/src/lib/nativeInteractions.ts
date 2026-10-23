import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { createBackHandlers } from "./backHandlers.js";

const nativeInteractions = registerPlugin<{
  addListener(event: "back", callback: () => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
  setBackEnabled(options: { enabled: boolean }): Promise<void>;
  defaultBack(): Promise<void>;
  haptic(): Promise<void>;
  hideKeyboard(): Promise<void>;
}>("NativeInteractions");

const available = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("NativeInteractions");
let listening = false;
let initialization: Promise<void> | undefined;
export const appBack = createBackHandlers((enabled: boolean) => {
  if (listening) void nativeInteractions.setBackEnabled({ enabled }).catch(() => {});
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
