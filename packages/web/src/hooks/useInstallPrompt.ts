import { useSyncExternalStore } from "react";
import { installPrompt } from "../lib/installPrompt.js";

export function useInstallPrompt() {
  const snapshot = useSyncExternalStore(
    installPrompt.subscribe,
    installPrompt.getSnapshot,
    installPrompt.getServerSnapshot,
  );
  return { ...snapshot, install: installPrompt.install, dismiss: installPrompt.dismiss };
}
