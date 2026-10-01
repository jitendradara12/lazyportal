import { useEffect, useRef, useState } from "react";
import { auth, session } from "@juet/core";
import { client } from "../lib/portal";
import type { Captcha, Session } from "../types";

export function LoginPage({ onDone }: { onDone: (s: Session) => void }) {
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem("juet.portal.last_user") ?? "";
    } catch {
      return "";
    }
  });
  const [savedPw] = useState(() => {
    try {
      return localStorage.getItem("juet.portal.saved_pw") ?? "";
    } catch {
      return "";
    }
  });
  const [hasSavedProfile, setHasSavedProfile] = useState(() => Boolean(savedPw));
  const [password, setPassword] = useState(() => savedPw);
  const [rememberPw, setRememberPw] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [captchaText, setCaptchaText] = useState("");
  const [usertype, setUsertype] = useState<"S" | "P">(() => {
    try {
      return (localStorage.getItem("juet.portal.last_usertype") as "S" | "P") ?? "S";
    } catch {
      return "S";
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [autoSolveFailed, setAutoSolveFailed] = useState(false);
  const [isAutoSolved, setIsAutoSolved] = useState(false);
  const [isCaptchaLoading, setIsCaptchaLoading] = useState(false);

  const loading = useRef(false);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const captchaInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (loading.current) return;
    loading.current = true;
    setIsCaptchaLoading(true);
    setAutoSolveFailed(false);
    setIsAutoSolved(false);
    try {
      const c = await auth.fetchCaptcha(client);
      setCaptcha(c);
      try {
        const solved = await auth.solveCaptcha(c);
        if (solved) {
          setCaptchaText(solved);
          setAutoSolveFailed(false);
          setIsAutoSolved(true);
        } else {
          setAutoSolveFailed(true);
          setIsAutoSolved(false);
          setTimeout(() => captchaInputRef.current?.focus(), 60);
        }
      } catch {
        setAutoSolveFailed(true);
        setIsAutoSolved(false);
        setTimeout(() => captchaInputRef.current?.focus(), 60);
      }
    } finally {
      loading.current = false;
      setIsCaptchaLoading(false);
    }
  };

  useEffect(() => {
    if (session.consumeSessionExpired()) setExpired(true);
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (username) {
      if (!savedPw) passRef.current?.focus();
    } else {
      userRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearSaved = () => {
    setUsername("");
    setPassword("");
    setRememberPw(false);
    setHasSavedProfile(false);
    try {
      localStorage.removeItem("juet.portal.last_user");
      localStorage.removeItem("juet.portal.saved_pw");
    } catch {}
    userRef.current?.focus();
  };

  const ready = captcha !== null && !busy && Boolean(username.trim()) && Boolean(password) && Boolean(captchaText.trim());

  return (
    <main className="auth-canvas">
      <div className="auth-card-container">
        <form
          className="auth-card"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!captcha) return;
            setBusy(true);
            setError(null);
            try {
              const s = (await auth.login(client, {
                username: username.trim(),
                password,
                captchaText: captchaText.trim(),
                captcha,
                usertype,
              })) as unknown as Session;
              try {
                localStorage.setItem("juet.portal.last_user", username.trim());
                localStorage.setItem("juet.portal.last_usertype", usertype);
                if (rememberPw) {
                  localStorage.setItem("juet.portal.saved_pw", password);
                } else {
                  localStorage.removeItem("juet.portal.saved_pw");
                }
              } catch {}
              onDone(s);
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : String(err));
              load().catch(() => {});
            } finally {
              setBusy(false);
            }
          }}
        >
          {/* Card Header */}
          <div className="auth-header">
            <div className="auth-header-text">
              <h1 className="auth-title">Sign in</h1>
              <p className="auth-subtitle">Login once, stay logged in.</p>
            </div>
            <div className="auth-icon-badge" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                <path d="M6 12v5c3 3 9 3 12 0v-5"/>
              </svg>
            </div>
          </div>

          {/* Session Expiry Banner */}
          {expired && (
            <div role="alert" className="auth-banner auth-banner-warning">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>Portal logged you out. Please sign in again.</span>
            </div>
          )}

          {/* Error Banner */}
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

          {/* Role Selector: Segmented Pill Toggle */}
          <div className="auth-field-group">
            <span className="auth-field-label">I am a</span>
            <div className="segmented-pill-toggle" role="radiogroup" aria-label="User role">
              <button
                type="button"
                role="radio"
                aria-checked={usertype === "S"}
                className={`segmented-pill ${usertype === "S" ? "active" : ""}`}
                onClick={() => setUsertype("S")}
              >
                Student
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={usertype === "P"}
                className={`segmented-pill ${usertype === "P" ? "active" : ""}`}
                onClick={() => setUsertype("P")}
              >
                Parent
              </button>
            </div>
          </div>

          {/* Enrollment No Field */}
          <div className="auth-field-group">
            <div className="auth-label-row">
              <label htmlFor="auth-username" className="auth-field-label">
                Enrollment no
              </label>
              {hasSavedProfile && username && (
                <div className="saved-profile-chip" title="Saved credentials on this device">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  <span>Saved</span>
                  <button
                    type="button"
                    className="saved-profile-clear"
                    onClick={handleClearSaved}
                    aria-label="Clear saved credentials"
                    title="Switch / clear saved credentials"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
            <input
              id="auth-username"
              ref={userRef}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="e.g. 21BCSE104"
              className="auth-input"
            />
          </div>

          {/* Password Field */}
          <div className="auth-field-group">
            <label htmlFor="auth-password" className="auth-field-label">
              Password
            </label>
            <div className="auth-input-action-wrapper">
              <input
                id="auth-password"
                ref={passRef}
                required
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••••••"
                className="auth-input has-action"
              />
              <button
                type="button"
                className="auth-input-inline-btn"
                onClick={() => setShowPassword((v) => !v)}
                disabled={busy}
                aria-pressed={showPassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
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

          {/* Remember Password Checkbox */}
          <label className="auth-checkbox-row">
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

          {/* Captcha Section */}
          <div className="auth-field-group">
            <label htmlFor="auth-captcha-input" className="auth-field-label">
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
                  load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
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
                id="auth-captcha-input"
                ref={captchaInputRef}
                required
                autoComplete="off"
                value={captchaText}
                onChange={(e) => {
                  setCaptchaText(e.target.value);
                  setIsAutoSolved(false);
                }}
                placeholder="Enter captcha text"
                className={`auth-input ${isAutoSolved ? "has-status" : ""}`}
              />
              {isAutoSolved && (
                <span className="auth-input-inline-status" aria-label="Auto-solved">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  <span>Auto-solved</span>
                </span>
              )}
            </div>
          </div>

          {/* Submit CTA */}
          <button type="submit" disabled={!ready} className="auth-submit-btn">
            {busy ? (
              <span className="auth-btn-content">
                <span className="auth-btn-spinner" aria-hidden="true" />
                <span>Signing in…</span>
              </span>
            ) : (
              <span>Enter portal</span>
            )}
          </button>
        </form>

        {/* Footer */}
        <footer className="app-footer">
          <span className="footer-label">free and open source, always</span>
          <a
            href="https://github.com/jitendradara12/lazyportal/"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-gh"
            aria-label="View source on GitHub"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            <span>GitHub</span>
            <span className="footer-arrow">↗</span>
          </a>
        </footer>
      </div>
    </main>
  );
}
