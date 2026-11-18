import { useState } from "react";
import { useAlerts } from "../hooks/useAlerts";
import { dismissAlertsPrompt, isAlertsPromptDismissed } from "../lib/alerts";
import { selectionHaptic } from "../lib/nativeInteractions";
import { BellIcon, CloseIcon } from "./icons";

export function AlertsPromptBanner() {
  const alerts = useAlerts();
  const [dismissed, setDismissed] = useState(isAlertsPromptDismissed);

  if (!alerts.status.supported || alerts.status.enabled || dismissed) {
    return null;
  }

  const blocked = alerts.status.permission === "denied";

  return (
    <section className="alerts-prompt" aria-label="Result notifications">
      <span className="m3-leading-icon-circle alerts-prompt-icon" aria-hidden="true">
        <BellIcon size={18} />
      </span>
      <div className="alerts-prompt-copy">
        <p className="alerts-prompt-title">Get notified when marks or SGPA drop</p>
        {(alerts.error || blocked) && (
          <p className="alerts-prompt-sub">
            {alerts.error ?? "Notifications are blocked in Android settings."}
          </p>
        )}
      </div>
      <div className="alerts-prompt-actions">
        <button
          type="button"
          className="alerts-prompt-btn"
          disabled={alerts.busy}
          aria-busy={alerts.busy || undefined}
          onClick={() => {
            selectionHaptic();
            if (blocked) void alerts.openSettings();
            else void alerts.setEnabled(true);
          }}
        >
          {alerts.busy ? "Enabling…" : blocked ? "Open settings" : "Enable"}
        </button>
        <button
          type="button"
          className="alerts-prompt-close"
          aria-label="Dismiss notification prompt"
          onClick={() => {
            selectionHaptic();
            dismissAlertsPrompt();
            setDismissed(true);
          }}
        >
          <CloseIcon />
        </button>
      </div>
    </section>
  );
}
