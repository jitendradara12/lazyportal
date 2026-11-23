import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  dismissLegacyUpdatePrompt,
  dismissUpdatePrompt,
  getSharedAppUpdateCheck,
  isLegacyAndroidWebView,
  isLegacyUpdateDismissed,
  isNewerVersion,
  isUpdatePromptDismissed,
  type AppUpdateCheck,
} from "../lib/appUpdates";
import { APK_DOWNLOAD_URL } from "../lib/installPrompt";
import { getInstalledAppVersion, selectionHaptic } from "../lib/nativeInteractions";
import { PromptBanner } from "./PromptBanner";

function UpdateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" />
    </svg>
  );
}

export function AppUpdatePromptBanner({ onOpenMore }: { onOpenMore?: () => void }) {
  const isCapacitorAndroid = Capacitor.getPlatform() === "android";
  const isLegacyWebView = !isCapacitorAndroid && isLegacyAndroidWebView();
  const [result, setResult] = useState<AppUpdateCheck | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [legacyDismissed, setLegacyDismissed] = useState<boolean>(() => isLegacyUpdateDismissed());

  useEffect(() => {
    if (!isCapacitorAndroid) return;
    let active = true;
    void getSharedAppUpdateCheck(getInstalledAppVersion).then((res) => {
      if (active) setResult(res);
    });
    return () => { active = false; };
  }, [isCapacitorAndroid]);

  // Old v1 / beta APKs lack NativeInteractions.getAppVersion (installed === null)
  // or Capacitor entirely (Android WebView UA). Prompt them directly without
  // depending on api.github.com (which is rate-limited on campus NAT).
  const isLegacyCapacitorApk = isCapacitorAndroid && result !== null && result[0] === null;
  if (isLegacyWebView || isLegacyCapacitorApk) {
    if (legacyDismissed || isLegacyUpdateDismissed()) return null;
    const latest = result?.[1] ?? null;
    return (
      <PromptBanner
        ariaLabel="App update available"
        icon={<UpdateIcon />}
        title={latest ? `Update app to ${latest.version}` : "Update Lazyportal app"}
        subtitle="Faster direct login, exam alerts & fixes"
        actionLabel="Download"
        onAction={() => {
          selectionHaptic();
          window.open(latest?.url ?? APK_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
        }}
        dismissLabel="Dismiss update prompt"
        onDismiss={() => {
          dismissLegacyUpdatePrompt();
          setLegacyDismissed(true);
        }}
      />
    );
  }

  if (!isCapacitorAndroid || !result) return null;
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
