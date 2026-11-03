import { useState, useEffect, useRef } from "react";
import { auth } from "@juet/core";
import { client, savedCredentials } from "../lib/portal";
import { preserveSelectedInstitute } from "../lib/sessionSelection";
import { MAX_AUTOSOLVE_ATTEMPTS } from "../lib/captchaSolve";
import type { Session } from "../types";
import { useAppBack } from "../hooks/useAppBack";
import { hideKeyboard } from "../lib/nativeInteractions";
import { CaptchaFields } from "./CaptchaFields";
import { useCaptcha } from "../hooks/useCaptcha";

export function ReconnectModal({
  session,
  onRenewed,
  onClose,
}: {
  session: Session;
  onRenewed: (s: Session) => void;
  onClose: () => void;
}) {
  const [savedUsertype] = useState(() => {
    try {
      return localStorage.getItem("juet.portal.last_usertype") || (session.membertype === "P" ? "P" : "S");
    } catch { return session.membertype === "P" ? "P" : "S"; }
  });
  const account = { username: String(session.username ?? session.enrollmentno), usertype: savedUsertype };
  const [hasSavedPassword, setHasSavedPassword] = useState(() => savedCredentials.has(account));
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberPw, setRememberPw] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginAttempt, setLoginAttempt] = useState(1);
  const captchaInputRef = useRef<HTMLInputElement>(null);
  const submitAbortController = useRef<AbortController | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      submitAbortController.current?.abort();
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    };
  }, []);

  const {
    captcha, setCaptcha, captchaText, setCaptchaText,
    isSolving, isAutoSolved, setIsAutoSolved, isCaptchaLoading,
    loadCaptcha: load, stopSolving,
  } = useCaptcha(captchaInputRef, true);

  const loadCaptcha = (manual = false) => load(manual).catch((error) => {
    setError(error instanceof Error ? error.message : String(error));
  });

  useEffect(() => {
    loadCaptcha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captcha || busy || isCaptchaLoading || isClosing) return;
    stopSolving();
    setBusy(true);
    setLoginAttempt(1);
    setError(null);
    const submitController = new AbortController();
    submitAbortController.current = submitController;
    try {
      const loginPassword = password || await savedCredentials.load(account);
      if (submitController.signal.aborted) return;
      if (!loginPassword) {
        setHasSavedPassword(false);
        throw new Error("Please enter your password again.");
      }
      const s = (await auth.loginWithCaptchaRetry(client, {
        username: String(session.username ?? session.enrollmentno),
        password: loginPassword,
        captchaText: captchaText.trim(),
        captcha,
        usertype: savedUsertype,
      }, {
        signal: submitController.signal,
        maxAttempts: isAutoSolved ? MAX_AUTOSOLVE_ATTEMPTS : 1,
        onCaptcha: ({ captcha: image, text, attempt }) => {
          if (submitController.signal.aborted) return;
          setCaptcha(image);
          setCaptchaText(text);
          setIsAutoSolved(Boolean(text));
          setLoginAttempt(attempt);
        },
      })) as unknown as Session;
      if (submitController.signal.aborted) return;

      if (rememberPw) await savedCredentials.save(loginPassword, account);
      else savedCredentials.clear();
      if (submitController.signal.aborted) return;

      onRenewed(preserveSelectedInstitute(s, session));
      hideKeyboard();
      window.dispatchEvent(new CustomEvent("juet:refresh-attendance", { detail: { force: true } }));
      onClose();
    } catch (err: unknown) {
      if (!submitController.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
        if ((err as { code?: string })?.code === "CAPTCHA_INVALID") {
          setError("Couldn't verify the captcha. Enter the characters from the new image.");
          loadCaptcha(true);
        }
      }
    } finally {
      submitAbortController.current = null;
      if (!submitController.signal.aborted) setBusy(false);
    }
  };

  const handleClose = () => {
    if (closeTimer.current !== null || busy) return;
    stopSolving();
    hideKeyboard();
    setIsClosing(true);
    closeTimer.current = setTimeout(onClose, 200);
  };

  useAppBack(true, handleClose, 200);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  const ready = captcha !== null && !busy && !isCaptchaLoading && !isClosing && Boolean(password || hasSavedPassword) && Boolean(captchaText.trim());

  return (
    <div className={`modal-backdrop ${isClosing ? "closing" : ""}`} onClick={handleClose} role="presentation">
      <div
        className={`auth-card renew-modal-card ${isClosing ? "closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="renew-title"
      >
        {/* Header */}
        <div className="auth-header">
          <div className="auth-header-text">
            <h2 className="auth-title" id="renew-title" style={{ fontSize: "20px" }}>
              Renew session
            </h2>
            <p className="auth-subtitle">
              {hasSavedPassword
                ? "Portal logged you out. Solve captcha to reconnect."
                : "Portal logged you out. Enter password & solve captcha."}
            </p>
          </div>
          <button
            type="button"
            className="auth-close-btn"
            onClick={handleClose}
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>

        {error && (
          <div role="alert" className="auth-banner auth-banner-error">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="renew-form">
          {/* Only show Password input if NOT saved */}
          {!hasSavedPassword && (
            <div className="auth-field-group">
              <div className="auth-field-card is-single">
                <label htmlFor="renew-password" className="auth-field-label">
                  Password
                </label>
                <div className="auth-input-action-wrapper">
                  <input
                    id="renew-password"
                    autoComplete="current-password"
                    enterKeyHint="next"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); captchaInputRef.current?.focus(); }
                    }}
                    required
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="password"
                    className="auth-input has-action"
                  />
                  <button
                    type="button"
                    className="auth-input-inline-btn"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={busy}
                    aria-pressed={showPassword}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <label className="auth-checkbox-row" style={{ marginTop: "4px" }}>
                <input
                  type="checkbox"
                  checked={rememberPw}
                  onChange={(e) => setRememberPw(e.target.checked)}
                  className="auth-checkbox-input"
                />
                <span className="auth-checkbox-box" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                </span>
                <span className="auth-checkbox-text">Remember password on this device</span>
              </label>
            </div>
          )}

          <CaptchaFields
            id="renew-captcha-input"
            captcha={captcha}
            text={captchaText}
            loading={isCaptchaLoading}
            solving={isSolving}
            autoSolved={isAutoSolved}
            busy={busy}
            attempt={loginAttempt}
            inputRef={captchaInputRef}
            onChange={(value) => {
              stopSolving();
              setCaptchaText(value);
              setIsAutoSolved(false);
            }}
            onManual={() => { stopSolving(); captchaInputRef.current?.focus(); }}
            onRefresh={() => { setError(null); loadCaptcha(); }}
          />

          {/* Modal Actions */}
          <div className="renew-modal-actions">
            <button type="button" onClick={handleClose} className="renew-cancel-btn" disabled={busy}>
              Stay Offline
            </button>
            <button type="submit" disabled={!ready} className="renew-submit-btn">
              {busy ? (
                <span className="auth-btn-content">
                  <span className="auth-btn-spinner" aria-hidden="true" />
                  <span>Reconnecting…</span>
                </span>
              ) : (
                <span>Reconnect</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
