import { useEffect, useMemo, useState } from "react";
import type { Session } from "../types";
import { getOfficialPortalUrl, writeOfficialPortalBridge } from "../lib/officialPortal";

export function OfficialPortalPage({
  session,
  onBack,
  onLogout,
}: {
  session: Session;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [frameNonce, setFrameNonce] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    writeOfficialPortalBridge(session);
    setReady(true);
  }, [session]);

  const iframeSrc = useMemo(() => getOfficialPortalUrl(frameNonce), [frameNonce]);

  return (
    <main className="portal-view portal-view-enter">
      <header className="portal-topbar">
        <div className="portal-topbar-copy">
          <button type="button" className="portal-back-btn" onClick={onBack} aria-label="Back to dashboard">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Back</span>
          </button>
          <div>
            <h1 className="portal-title">Official student portal</h1>
            <p className="portal-subtitle">Same JUET portal UI, opened with your current lazyportal session.</p>
          </div>
        </div>

        <div className="portal-actions" role="group" aria-label="Official portal actions">
          <a
            href={iframeSrc}
            target="_blank"
            rel="noopener noreferrer"
            className="portal-action-btn"
            onClick={() => writeOfficialPortalBridge(session)}
          >
            Open in tab
          </a>
          <button
            type="button"
            className="portal-action-btn"
            onClick={() => {
              writeOfficialPortalBridge(session);
              setFrameNonce((value) => value + 1);
            }}
          >
            Reload
          </button>
          <button type="button" className="portal-action-btn portal-action-danger" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className="portal-frame-shell" aria-label="Official student portal preview">
        {!ready ? (
          <div className="portal-loading-card">
            <strong>Starting official portal…</strong>
            <span>We are reusing your current session, so there is no second login.</span>
          </div>
        ) : (
          <iframe
            key={frameNonce}
            title="Official student portal"
            src={iframeSrc}
            className="portal-frame"
            loading="eager"
            referrerPolicy="no-referrer"
          />
        )}
      </section>
    </main>
  );
}
