import { useState, useEffect, useRef } from "react";
import { auth } from "@juet/core";
import { client } from "../lib/portal";
import { titleCase } from "../components/DataViews";
import { SECTIONS } from "../sections";
import type { Session, Captcha } from "../types";

interface InstituteOption {
  value?: string;
  label?: string;
}

function ReconnectModal({
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
  const [savedPw, setSavedPw] = useState(() => {
    try {
      return localStorage.getItem("juet.portal.saved_pw") ?? "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState(() => savedPw);
  const [rememberPw, setRememberPw] = useState(Boolean(savedPw));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captchaInputRef = useRef<HTMLInputElement>(null);

  const loadCaptcha = async () => {
    try {
      const c = await auth.fetchCaptcha(client);
      setCaptcha(c);
      setTimeout(() => captchaInputRef.current?.focus(), 50);
    } catch {
      setError("Unable to load captcha. Check network.");
    }
  };

  useEffect(() => {
    loadCaptcha();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captcha || !password) return;
    setBusy(true);
    setError(null);
    try {
      const s = (await auth.login(client, {
        username: String(session.username ?? session.enrollmentno),
        password,
        captchaText: captchaText.trim(),
        captcha,
        usertype: session.membertype === "P" ? "P" : "S",
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Renew Session</h3>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted" style={{ marginBottom: "12px" }}>
          Upstream token timed out. Solve captcha to reconnect without losing your place.
        </p>
        <form onSubmit={handleSubmit}>
          <label className="field-label">
            Enrollment No
            <input disabled value={String(session.username ?? session.enrollmentno ?? "")} />
          </label>
          <label className="field-label">
            Password
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Portal password"
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={rememberPw}
              onChange={(e) => setRememberPw(e.target.checked)}
            />
            <span>Remember password on this device (reconnect with 1 tap)</span>
          </label>
          {captcha ? (
            <div className="captcharow" style={{ margin: "10px 0" }}>
              <img src={captcha.imageDataUrl} alt="Captcha" className="captcha" />
              <button type="button" onClick={loadCaptcha} disabled={busy} className="secondary-btn">
                ↻ Refresh
              </button>
            </div>
          ) : (
            <p className="muted">Loading captcha…</p>
          )}
          <label className="field-label">
            Captcha Code
            <input
              ref={captchaInputRef}
              required
              autoComplete="off"
              value={captchaText}
              onChange={(e) => setCaptchaText(e.target.value)}
              placeholder="Enter text from image"
            />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="secondary-btn">
              Stay Offline
            </button>
            <button type="submit" disabled={busy || !captcha} className="primary-btn">
              {busy ? "Reconnecting…" : "Reconnect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DashboardPage({
  session,
  isExpired,
  onLogout,
  onSessionRenewed,
  onSelectInstitute,
}: {
  session: Session;
  isExpired?: boolean;
  onLogout: () => void;
  onSessionRenewed?: (s: Session) => void;
  onSelectInstitute: (instituteid: string) => void;
}) {
  const [showRenewModal, setShowRenewModal] = useState(false);
  const institutes = (session.institutelist as InstituteOption[] | undefined) ?? [];
  const visible = SECTIONS.filter((s) => s.enabled !== false);
  const displayName = titleCase(session.name ?? session.enrollmentno ?? "Student");

  return (
    <main className="dash">
      {/* Session Expired Sticky Notice */}
      {isExpired && (
        <aside className="expiry-banner" role="alert">
          <span>⚠️ <strong>Session timed out</strong> — you are viewing cached data.</span>
          <button onClick={() => setShowRenewModal(true)} className="renew-btn">
            Reconnect now
          </button>
        </aside>
      )}

      <header>
        <div>
          <h1>Hi, {displayName}</h1>
          {institutes.length > 1 && (
            <label className="semrow" style={{ marginTop: "6px" }}>
              Institute{" "}
              <select
                value={typeof session.instituteid === "string" ? session.instituteid : ""}
                onChange={(e) => onSelectInstitute(e.target.value)}
                className="sem-picker"
              >
                {institutes.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>
                    {String(o.label ?? o.value)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="header-actions">
          {isExpired && (
            <button onClick={() => setShowRenewModal(true)} className="renew-header-btn">
              ⚡ Reconnect
            </button>
          )}
          <button onClick={onLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </header>

      {/* Material 3 Expressive Expandable Stacked Sections */}
      <div className="m3-stacked-sections" role="list">
        {visible.map(({ id, Component }) => (
          <Component
            key={`${id}:${typeof session.instituteid === "string" ? session.instituteid : ""}`}
            session={session}
            onLogout={onLogout}
          />
        ))}
      </div>

      {showRenewModal && onSessionRenewed && (
        <ReconnectModal
          session={session}
          onRenewed={onSessionRenewed}
          onClose={() => setShowRenewModal(false)}
        />
      )}
    </main>
  );
}
