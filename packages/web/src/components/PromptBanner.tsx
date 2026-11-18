import type { ReactNode } from "react";
import { selectionHaptic } from "../lib/nativeInteractions";
import { CloseIcon } from "./icons";

export function PromptBanner({
  ariaLabel,
  icon,
  title,
  subtitle,
  actionLabel,
  actionBusy,
  onAction,
  dismissLabel,
  onDismiss,
}: {
  ariaLabel: string;
  icon: ReactNode;
  title: string;
  subtitle?: string | null;
  actionLabel: string;
  actionBusy?: boolean;
  onAction: () => void;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <section className="alerts-prompt" aria-label={ariaLabel}>
      <span className="m3-leading-icon-circle alerts-prompt-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="alerts-prompt-copy">
        <p className="alerts-prompt-title">{title}</p>
        {subtitle && <p className="alerts-prompt-sub">{subtitle}</p>}
      </div>
      <div className="alerts-prompt-actions">
        <button
          type="button"
          className="alerts-prompt-btn"
          disabled={actionBusy}
          aria-busy={actionBusy || undefined}
          onClick={() => {
            selectionHaptic();
            onAction();
          }}
        >
          {actionLabel}
        </button>
        <button
          type="button"
          className="alerts-prompt-close"
          aria-label={dismissLabel}
          onClick={() => {
            selectionHaptic();
            onDismiss();
          }}
        >
          <CloseIcon />
        </button>
      </div>
    </section>
  );
}
