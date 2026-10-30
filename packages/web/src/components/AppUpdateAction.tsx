import { useEffect, useState } from "react";
import { fetchLatestRelease, isNewerVersion } from "../lib/appUpdates.js";
import { APK_DOWNLOAD_URL } from "../lib/installPrompt.js";
import { getInstalledAppVersion } from "../lib/nativeInteractions";

type UpdateCheck = [string | null, Awaited<ReturnType<typeof fetchLatestRelease>> | null];

// Both versions stay fixed until reload; share the check across visits to More.
let updateCheck: Promise<UpdateCheck> | undefined;

export function AppUpdateAction() {
  const [result, setResult] = useState<UpdateCheck | null>(null);

  useEffect(() => {
    let active = true;
    updateCheck ??= Promise.all([getInstalledAppVersion(), fetchLatestRelease().catch(() => null)]);
    void updateCheck.then((result) => {
      if (active) setResult(result);
    });
    return () => { active = false; };
  }, []);

  const [installed, latest] = result ?? [null, null];
  const newer = installed && latest ? isNewerVersion(installed, latest.version) : null;
  const label = newer === true && latest ? `Update ${installed} → ${latest.version}`
    : newer === false ? "App up to date" : "Download latest APK";
  const description = !result ? "Checking for updates…"
    : newer === false ? `Version ${installed}`
    : newer === true ? "Open the downloaded APK to install the update."
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
      <span id="app-update-help" className="more-action-description">{description}</span>
    </span>
  </>;

  return newer === false ? (
    <div className="more-action" role="status">{content}</div>
  ) : (
    <a href={newer && latest ? latest.url : APK_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="more-action" aria-label={label} aria-describedby="app-update-help">
      {content}
      <span className="more-action-trailing" aria-hidden="true">↗</span>
    </a>
  );
}
