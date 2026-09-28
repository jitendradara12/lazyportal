import { useEffect, useState } from "react";
import { auth } from "@juet/core";
import { client } from "../lib/portal";
import type { Captcha, Session } from "../types";

export function LoginPage({ onDone }: { onDone: (s: Session) => void }) {
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaText, setCaptchaText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setCaptcha(await auth.fetchCaptcha(client));
  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
              username,
              password,
              captchaText,
              captcha,
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
        <p className="muted">Login once, stay logged in. Captcha is required only on first login.</p>
        <label>
          Enrollment no
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {captcha ? (
          <img src={captcha.imageDataUrl} alt="captcha" className="captcha" />
        ) : (
          <p className="muted">Loading captcha…</p>
        )}
        <label>
          Captcha text
          <input value={captchaText} onChange={(e) => setCaptchaText(e.target.value)} />
        </label>
        <button type="submit" disabled={!ready}>
          {busy ? "Signing in…" : "Login once, stay logged in"}
        </button>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
    </main>
  );
}
