import { useEffect, useRef, useState } from "react";
import { clearOfficialPortal, hasOfficialPortal, openOfficialPortal } from "../lib/officialPortal";
import type { Session } from "../types";

export function OfficialPortalEntry({ session }: { session: Session }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => () => clearOfficialPortal(), []);
  if (!hasOfficialPortal()) return null;

  const open = async () => {
    if (pending.current) return;
    pending.current = true; setOpening(true); setError("");
    try { await openOfficialPortal(session); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open the portal. Please retry."); }
    finally { pending.current = false; setOpening(false); }
  };

  return (
    <section className="official-portal-entry" aria-labelledby="official-portal-title">
      <button type="button" className="official-portal-open" onClick={open} disabled={opening} aria-busy={opening}>
        <span className="official-portal-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 9 9-5 9 5-9 5-9-5Z" /><path d="M6 11v6c4 3 8 3 12 0v-6M21 9v7" />
          </svg>
        </span>
        <span className="official-portal-copy">
          <span className="official-portal-heading"><span id="official-portal-title">Official student portal</span><span className="official-portal-badge">Read-only</span></span>
          <span className="official-portal-description">{opening ? "Opening portal…" : "Browse the original portal with your current account."}</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
      <p className="official-portal-hint">Use the actual portal for submissions, changes or payments.</p>
      {error && <p className="official-portal-error" role="alert">{error}</p>}
    </section>
  );
}
