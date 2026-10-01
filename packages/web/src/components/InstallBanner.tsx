import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { APK_RELEASES_URL } from "../lib/installPrompt.js";

function ShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V3m-4 4 4-4 4 4M7 10H5v11h14V10h-2" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 7v10M7 12h10" />
    </svg>
  );
}

type InstallState = ReturnType<typeof useInstallPrompt>;

export function InstallBanner() {
  const state = useInstallPrompt();
  if (!state.mode) return null;
  return <InstallCard {...state} />;
}

function InstallCard({ mode, isInstalling, error, install, dismiss }: InstallState) {
  const id = useId();
  const cardRef = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);
  const [showSteps, setShowSteps] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const isIOS = mode === "ios-safari" || mode === "ios-other";

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    // Reserve scroll space for the floating card, including expanded steps
    // and enlarged text, so the page's last controls remain reachable.
    const measure = () => setHeight(card.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [showSteps, keyboardOpen, mode, isInstalling, error]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const focused = document.activeElement;
      const isEditing = focused instanceof HTMLElement
        && (focused.matches("input, textarea") || focused.isContentEditable);
      // Modern mobile browsers shrink the visual (not layout) viewport for
      // the keyboard. Don't cover the captcha/password fields while typing.
      setKeyboardOpen(Boolean(isEditing && viewport.scale === 1 && window.innerHeight - viewport.height > 150));
    };
    update();
    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  return (
    <>
      <div
        className="install-banner-space"
        style={{ "--install-banner-height": `${height}px` } as CSSProperties}
        hidden={keyboardOpen}
        aria-hidden="true"
      />
      <aside
        ref={cardRef}
        className="install-banner"
        aria-labelledby={`${id}-title`}
        hidden={keyboardOpen}
      >
        <div className="install-banner-header">
          <img src="/icon-192.png" alt="" className="install-banner-icon" width="44" height="44" />
          <div className="install-banner-copy">
            <h2 id={`${id}-title`}>Install Lazyportal</h2>
            <p>
              {mode === "ios-safari" ? (
                <>Tap <strong>Share</strong> <ShareIcon /> then <strong>Add to Home Screen</strong> <AddIcon />.</>
              ) : mode === "ios-other" ? (
                <>Open this page in <strong>Safari</strong> to add it to your Home Screen.</>
              ) : (
                <>Your portal, one tap away on your Home Screen.</>
              )}
            </p>
          </div>
          <button type="button" className="install-banner-dismiss" onClick={dismiss} aria-label="Dismiss install banner for 14 days">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>

        {error && <p className="install-banner-error" role="alert">{error}</p>}

        <div className="install-banner-actions">
          {mode === "native" ? (
            <button type="button" className="install-banner-primary" onClick={() => void install()} disabled={isInstalling} aria-busy={isInstalling}>
              {isInstalling ? "Opening installer…" : "Install app"}
            </button>
          ) : (
            <button type="button" className="install-banner-primary" onClick={() => setShowSteps((value) => !value)} aria-expanded={showSteps} aria-controls={`${id}-steps`}>
              {showSteps ? "Hide steps" : "How to install"}
            </button>
          )}
          <a href={APK_RELEASES_URL} target="_blank" rel="noopener noreferrer" className="install-banner-apk">
            Or download APK{isIOS && <span className="install-banner-android-only"> (Android only)</span>}
          </a>
        </div>

        {mode !== "native" && (
          <div id={`${id}-steps`} className="install-banner-guide" hidden={!showSteps}>
            {isIOS ? (
              <>
                {mode === "ios-other" && <p>First, open this page in Safari.</p>}
                <ol>
                  <li>
                    <span className="install-banner-step-icon"><ShareIcon /></span>
                    <span>Tap <strong>Share</strong> in Safari’s toolbar.</span>
                  </li>
                  <li>
                    <span className="install-banner-step-icon"><AddIcon /></span>
                    <span>Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</span>
                  </li>
                </ol>
                <p>You may need to scroll through the Share menu.</p>
              </>
            ) : (
              <p>Open your browser’s menu <span aria-hidden="true">⋮</span> and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</p>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
