import { useState, useEffect, useRef } from "react";
import { auth } from "@juet/core";
import { client } from "../lib/portal";
import { fetchAutosolvedCaptcha, MAX_AUTOSOLVE_ATTEMPTS } from "../lib/captchaSolve";
import type { Session, Captcha } from "../types";

export function ReconnectModal({
  session,
  onRenewed,
  onClose,
}: {
  session: Session;
  onRenewed: (s: Session) => void;
  onClose: () => void;
}) {
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaText, setCaptchaText] = useState("");
  const [savedPw] = useState(() => {
    try {
      return localStorage.getItem("juet.portal.saved_pw") ?? "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState(() => savedPw);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberPw, setRememberPw] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoSolveFailed, setAutoSolveFailed] = useState(false);
  const [isAutoSolved, setIsAutoSolved] = useState(false);
  const [isCaptchaLoading, setIsCaptchaLoading] = useState(false);
  const captchaInputRef = useRef<HTMLInputElement>(null);
  const loading = useRef(false);
  const abortController = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortController.current?.abort();
    };
  }, []);

  const loadCaptcha = async () => {
    if (loading.current) return;
    abortController.current?.abort();
    const ac = new AbortController();
    abortController.current = ac;
    loading.current = true;
    setIsCaptchaLoading(true);
    setAutoSolveFailed(false);
    setIsAutoSolved(false);
    try {
      const { captcha: c, text, autoSolved } = await fetchAutosolvedCaptcha(MAX_AUTOSOLVE_ATTEMPTS, { signal: ac.signal });
      if (ac.signal.aborted) return;
      setCaptcha(c);
      if (text) {
        setCaptchaText(text);
        setAutoSolveFailed(!autoSolved);
        setIsAutoSolved(autoSolved);
      } else {
        setCaptchaText("");
        setAutoSolveFailed(true);
        setIsAutoSolved(false);
      }
      setTimeout(() => captchaInputRef.current?.focus(), 60);
    } catch {
      if (!ac.signal.aborted) setError("JUET's portal is down (not us).");
    } finally {
      loading.current = false;
      if (!ac.signal.aborted) setIsCaptchaLoading(false);
    }
  };

  useEffect(() => {
    loadCaptcha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captcha || !password) return;
    setBusy(true);
    setError(null);
    try {
      const savedUsertype =
        (localStorage.getItem("juet.portal.last_usertype") as "S" | "P") ||
        (session.membertype === "P" ? "P" : "S");
      const s = (await auth.login(client, {
        username: String(session.username ?? session.enrollmentno),
        password,
        captchaText: captchaText.trim(),
        captcha,
        usertype: savedUsertype,
      })) as unknown as Session;

      if (rememberPw) {
        try {
          localStorage.setItem("juet.portal.saved_pw", password);
        } catch {}
      } else {
        try {
          localStorage.removeItem("juet.portal.saved_pw");
        } catch {}
      }

      onRenewed(s);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      loadCaptcha();
    } finally {
      setBusy(false);
    }
  };

  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  const hasSavedPassword = Boolean(savedPw);
  const ready = captcha !== null && !busy && Boolean(password) && Boolean(captchaText.trim());

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
              <label htmlFor="renew-password" className="auth-field-label">
                Password
              </label>
              <div className="auth-input-action-wrapper">
                <input
                  id="renew-password"
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

          {/* Captcha Section — identical to locked LoginPage */}
          <div className="auth-field-group">
            <label htmlFor="renew-captcha-input" className="auth-field-label">
              Captcha
            </label>

            {/* Captcha Image + Refresh Button */}
            <div className="auth-captcha-media-row">
              {captcha ? (
                <img src={captcha.imageDataUrl} alt="Captcha image" className="auth-captcha-img" />
              ) : (
                <div className="auth-captcha-placeholder">
                  <span className="auth-captcha-spinner" />
                </div>
              )}
              <button
                type="button"
                className={`auth-captcha-refresh ${isCaptchaLoading || busy ? "is-loading" : ""}`}
                onClick={() => {
                  setError(null);
                  loadCaptcha();
                }}
                disabled={busy || isCaptchaLoading}
                aria-label="Refresh captcha"
                title="Refresh captcha"
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                  <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                  <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                </svg>
              </button>
            </div>

            {/* Captcha Input with Minimal Inline Status */}
            <div className="auth-input-action-wrapper">
              <input
                id="renew-captcha-input"
                ref={captchaInputRef}
                required
                autoComplete="off"
                value={captchaText}
                onChange={(e) => {
                  setCaptchaText(e.target.value);
                  setIsAutoSolved(false);
                }}
                placeholder={autoSolveFailed ? "solve it, too tough for me" : "Enter captcha text"}
                className={`auth-input ${isAutoSolved ? "has-status" : ""}`}
              />
              {isAutoSolved && (
                <span className="auth-input-inline-status" aria-label="Auto-solved guess">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="19" y1="12" x2="5" y2="12"/>
                    <polyline points="11 18 5 12 11 6"/>
                  </svg>
                  <span>tried my best</span>
                </span>
              )}
            </div>
          </div>

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
