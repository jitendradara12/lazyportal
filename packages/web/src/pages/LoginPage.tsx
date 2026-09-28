import { useEffect, useRef, useState } from "react";
import { auth, session } from "@juet/core";
import { client } from "../lib/portal";
import type { Captcha, Session } from "../types";

export function LoginPage({ onDone }: { onDone: (s: Session) => void }) {
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captchaText, setCaptchaText] = useState("");
  const [usertype, setUsertype] = useState<"S" | "P">("S");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const loading = useRef(false);

  const load = async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      setCaptcha(await auth.fetchCaptcha(client));
    } finally {
      loading.current = false;
    }
  };
  useEffect(() => {
    if (session.consumeSessionExpired()) setExpired(true);
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
          <input required value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <span className="pwrow">
            <input
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
    </main>
  );
}
