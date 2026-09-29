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
  const [password, setPassword] = useState(() => savedPw);
  const [rememberPw, setRememberPw] = useState(() => Boolean(savedPw) || true);
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
  const loading = useRef(false);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const c = await auth.fetchCaptcha(client);
      setCaptcha(c);
      try {
        const solved = await auth.solveCaptcha(c);
        if (solved) setCaptchaText(solved);
      } catch {}
    } finally {
      loading.current = false;
    }
  };
  useEffect(() => {
    if (session.consumeSessionExpired()) setExpired(true);
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (username) passRef.current?.focus();
    else userRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = captcha !== null && !busy;

  return (
    <main className="auth">
      <form
        className="card"
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
        <h1>JUET Portal — Sign in</h1>
        {expired && <p role="alert" className="error">Session expired, please log in again.</p>}
        <p className="muted">Login once, stay logged in. Captcha is required only on first login.</p>
        <label>
          I am a
          <select value={usertype} onChange={(e) => setUsertype(e.target.value as "S" | "P")}>
            <option value="S">Student</option>
            <option value="P">Parent</option>
          </select>
        </label>
        <label>
          Enrollment no
          <input ref={userRef} required value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <span className="pwrow">
            <input
              ref={passRef}
              required
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} disabled={busy} aria-pressed={showPassword} aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={rememberPw}
            onChange={(e) => setRememberPw(e.target.checked)}
          />
          <span>Remember password on this device</span>
        </label>
        {captcha ? (
          <div className="captcharow">
            <img src={captcha.imageDataUrl} alt="Captcha distorted text to type in" className="captcha" />
            <button
              type="button"
              onClick={() => {
                setError(null);
                load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
              }}
              disabled={busy}
            >
              Refresh captcha
            </button>
          </div>
        ) : (
          <div className="captcharow">
            <p className="muted">Loading captcha…</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
              }}
              disabled={busy}
            >
              Retry
            </button>
          </div>
        )}
        <label>
          Captcha text
          <input required autoComplete="off" inputMode="text" autoCapitalize="off" value={captchaText} onChange={(e) => setCaptchaText(e.target.value)} />
        </label>
        <button type="submit" disabled={!ready}>
          {busy ? "Signing in…" : "Login once, stay logged in"}
        </button>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
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
    </main>
  );
}
