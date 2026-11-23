import { useEffect, useState } from "react";
import { getSharedAppUpdateCheck, isNewerVersion, type AppUpdateCheck } from "../lib/appUpdates";
import { APK_DOWNLOAD_URL } from "../lib/installPrompt";
import { getInstalledAppVersion, selectionHaptic } from "../lib/nativeInteractions";

export function AppUpdateAction() {
  const [result, setResult] = useState<AppUpdateCheck | null>(null);

  useEffect(() => {
    let active = true;
    void getSharedAppUpdateCheck(getInstalledAppVersion).then((res) => {
      if (active) setResult(res);
    });
    return () => {
      active = false;
    };
  }, []);

  const [installed, latest] = result ?? [null, null];
  const newer = installed && latest ? isNewerVersion(installed, latest.version) : null;
  const hasUpdate = newer === true && latest !== null;

  const label = hasUpdate && latest ? `Update ${installed} → ${latest.version}`
    : newer === false ? "App up to date" : "Download latest APK";
  const description = !result ? "Checking for updates…"
    : newer === false ? `Version ${installed}`
    : hasUpdate ? "Download in browser and open the APK to update."
    : installed ? `Version ${installed}. Couldn't check for updates. Download manually.`
    : "Open the downloaded APK to update the app.";

  const content = <>
    <span className="more-action-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" />
      </svg>
    </span>
    <span className="more-action-label">
      <span>{label}</span>
      <span id="app-update-help" className="more-action-description">
        {description}
      </span>
    </span>
  </>;

  const rowClass = [
    "more-action",
    hasUpdate && "is-update",
  ].filter(Boolean).join(" ");

  return newer === false ? (
    <div id="app-update-action" className="more-action" role="status">{content}</div>
  ) : (
    <a
      id="app-update-action"
      href={hasUpdate && latest ? latest.url : APK_DOWNLOAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={rowClass}
      aria-label={label}
      aria-describedby="app-update-help"
      onClick={() => selectionHaptic()}
    >
      {content}
      <span className="more-action-trailing" aria-hidden="true">↗</span>
    </a>
  );
}
