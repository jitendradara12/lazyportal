import { type MouseEvent, useEffect, useRef, useState } from "react";
import { fetchLatestRelease, isNewerVersion } from "../lib/appUpdates.js";
import { APK_DOWNLOAD_URL } from "../lib/installPrompt.js";
import { getInstalledAppVersion, installAppUpdate, selectionHaptic, type AppUpdateInstallResult } from "../lib/nativeInteractions";

type UpdateCheck = [string | null, Awaited<ReturnType<typeof fetchLatestRelease>> | null];
type InstallState = "idle" | "downloading" | AppUpdateInstallResult;

// Both versions stay fixed until reload; share the check across visits to More.
let updateCheck: Promise<UpdateCheck> | undefined;

export function AppUpdateAction() {
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [installState, setInstallState] = useState<InstallState>("idle");
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    updateCheck ??= Promise.all([getInstalledAppVersion(), fetchLatestRelease().catch(() => null)]);
    void updateCheck.then((res) => {
      if (active) setResult(res);
    });
    return () => {
      active = false;
      mountedRef.current = false;
    };
  }, []);

  const [installed, latest] = result ?? [null, null];
  const newer = installed && latest ? isNewerVersion(installed, latest.version) : null;
  const canAttemptInApp = newer === true && latest !== null;
  const fallbackToBrowser = installState === "failed" || installState === "unsupported";
  const isDownloading = canAttemptInApp && installState === "downloading";

  const label = canAttemptInApp && latest ? `Update ${installed} → ${latest.version}`
    : newer === false ? "App up to date" : "Download latest APK";
  const description = !result ? "Checking for updates…"
    : newer === false ? `Version ${installed}`
    : canAttemptInApp ? (
      installState === "downloading" ? "Downloading update…"
      : installState === "started" ? "Approve the prompt to finish updating."
      : installState === "permission_denied" ? "Allow installs from this app in Settings, then tap again."
      : installState === "failed" ? "Couldn't download in-app. Tap to download in browser."
      : installState === "unsupported" ? "Open the downloaded APK to install the update."
      : "Tap to download and install the update."
    )
    : installed ? `Version ${installed}. Couldn't check for updates. Download manually.`
    : "Open the downloaded APK to update the app.";

  const handleClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (!canAttemptInApp || !latest) return;
    if (fallbackToBrowser) {
      selectionHaptic();
      return;
    }
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    selectionHaptic();
    setInstallState("downloading");
    let outcome: AppUpdateInstallResult = "failed";
    try {
      outcome = await installAppUpdate({ tag: latest.tag, sha256: latest.sha256 });
    } finally {
      busyRef.current = false;
    }
    if (!mountedRef.current) return;
    setInstallState(outcome);
    if (outcome === "unsupported") {
      window.open(latest.url, "_blank", "noopener,noreferrer");
    }
  };

  const content = <>
    <span className="more-action-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" />
      </svg>
    </span>
    <span className="more-action-label">
      <span>{label}</span>
      <span id="app-update-help" className="more-action-description" aria-live={canAttemptInApp ? "polite" : undefined}>
        {description}
      </span>
    </span>
  </>;

  const rowClass = [
    "more-action",
    canAttemptInApp && "is-update",
    canAttemptInApp && installState === "failed" && "is-update-error",
  ].filter(Boolean).join(" ");

  return newer === false ? (
    <div className="more-action" role="status">{content}</div>
  ) : (
    <a
      href={canAttemptInApp && latest ? latest.url : APK_DOWNLOAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={rowClass}
      aria-label={label}
      aria-describedby="app-update-help"
      aria-busy={isDownloading || undefined}
      onClick={handleClick}
    >
      {content}
      <span className="more-action-trailing" aria-hidden="true">
        {isDownloading ? <span className="more-action-spinner" /> : canAttemptInApp && !fallbackToBrowser ? "›" : "↗"}
      </span>
    </a>
  );
}
