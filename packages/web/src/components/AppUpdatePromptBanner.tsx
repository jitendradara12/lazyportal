import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  dismissUpdatePrompt,
  getSharedAppUpdateCheck,
  isNewerVersion,
  isUpdatePromptDismissed,
  type AppUpdateCheck,
} from "../lib/appUpdates";
import { getInstalledAppVersion } from "../lib/nativeInteractions";
import { PromptBanner } from "./PromptBanner";

function UpdateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" />
    </svg>
  );
}

export function AppUpdatePromptBanner({ onOpenMore }: { onOpenMore?: () => void }) {
  const isAndroid = Capacitor.getPlatform() === "android";
  const [result, setResult] = useState<AppUpdateCheck | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isAndroid) return;
    let active = true;
    void getSharedAppUpdateCheck(getInstalledAppVersion).then((res) => {
      if (active) setResult(res);
    });
    return () => { active = false; };
  }, [isAndroid]);

  if (!isAndroid || !result) return null;
  const [installed, latest] = result;
  if (!installed || !latest || isNewerVersion(installed, latest.version) !== true) {
    return null;
  }
  if (dismissedVersion === latest.version || isUpdatePromptDismissed(latest.version)) {
    return null;
  }

  return (
    <PromptBanner
      ariaLabel="App update available"
      icon={<UpdateIcon />}
      title={`Update app to ${latest.version}`}
      subtitle={`Installed ${installed}`}
      actionLabel="Update"
      onAction={() => {
        if (onOpenMore) onOpenMore();
        else window.location.hash = "more";
        setTimeout(() => {
          document.getElementById("app-update-action")?.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 60);
      }}
      dismissLabel="Dismiss update prompt"
      onDismiss={() => {
        dismissUpdatePrompt(latest.version);
        setDismissedVersion(latest.version);
      }}
    />
  );
}
