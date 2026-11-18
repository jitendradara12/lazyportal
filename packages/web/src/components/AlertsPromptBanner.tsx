import { useState } from "react";
import { useAlerts } from "../hooks/useAlerts";
import { dismissAlertsPrompt, isAlertsPromptDismissed } from "../lib/alerts";
import { PromptBanner } from "./PromptBanner";
import { BellIcon } from "./icons";

export function AlertsPromptBanner() {
  const alerts = useAlerts();
  const [dismissed, setDismissed] = useState(isAlertsPromptDismissed);

  if (!alerts.status.supported || alerts.status.muted || alerts.status.permission === "granted" || dismissed) {
    return null;
  }

  const blocked = alerts.status.permission === "denied";

  return (
    <PromptBanner
      ariaLabel="Result notifications"
      icon={<BellIcon size={18} />}
      title="Get notified when marks or SGPA drop"
      subtitle={alerts.error ?? (blocked ? "Blocked in Android settings." : null)}
      actionLabel={alerts.busy ? "Enabling…" : blocked ? "Settings" : "Enable"}
      actionBusy={alerts.busy}
      onAction={() => {
        if (blocked) void alerts.openSettings();
        else void alerts.setMuted(false);
      }}
      dismissLabel="Dismiss notification prompt"
      onDismiss={() => {
        dismissAlertsPrompt();
        setDismissed(true);
      }}
    />
  );
}
