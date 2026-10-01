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
  const [autoSolveFailed, setAutoSolveFailed] = useState(false);
  const captchaInputRef = useRef<HTMLInputElement>(null);

  const loadCaptcha = async () => {
    setAutoSolveFailed(false);
    try {
      const c = await auth.fetchCaptcha(client);
      setCaptcha(c);
      try {
        const solved = await auth.solveCaptcha(c);
        if (solved) {
          setCaptchaText(solved);
          setAutoSolveFailed(false);
        } else {
          setAutoSolveFailed(true);
        }
      } catch {
        setAutoSolveFailed(true);
      }
      setTimeout(() => captchaInputRef.current?.focus(), 50);
    } catch {
      setError("JUET's portal is down (not us).");
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
      const savedUsertype = (localStorage.getItem("juet.portal.last_usertype") as "S" | "P") || (session.membertype === "P" ? "P" : "S");
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Renew Session</h3>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted" style={{ marginBottom: "12px" }}>
          Portal logged you out. Solve captcha to reconnect.
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
            {autoSolveFailed ? "Solve your captcha, it's too tough for me" : "Captcha Code"}
            <input
              ref={captchaInputRef}
              required
              autoComplete="off"
              value={captchaText}
              onChange={(e) => setCaptchaText(e.target.value)}
              placeholder={autoSolveFailed ? "solve it, too tough for me" : "Enter text from image"}
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

function formatLastSync(ts: number | null): string {
  if (!ts) return "";
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  const d = new Date(ts);
  const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diffHours < 24) return timeStr;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${timeStr}`;
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

  useEffect(() => {
    if (isExpired) {
      setShowRenewModal(true);
    }
  }, [isExpired]);
  const [lastSync, setLastSync] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem("juet.portal.last_sync");
      return raw ? Number(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const update = () => {
      try {
        const raw = localStorage.getItem("juet.portal.last_sync");
        if (raw) setLastSync(Number(raw));
      } catch {}
    };
    window.addEventListener("storage", update);
    window.addEventListener("juet:sync", update);
    const interval = setInterval(update, 30000);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("juet:sync", update);
      clearInterval(interval);
    };
  }, []);

  const institutes = (session.institutelist as InstituteOption[] | undefined) ?? [];
  const visible = SECTIONS.filter((s) => s.enabled !== false);
  const displayName = titleCase(session.name ?? session.enrollmentno ?? "Student");

  return (
    <main className="dash">
      {/* Session Expired Sticky Notice */}
      {isExpired && (
        <aside className="expiry-banner" role="alert">
          <span>⚠️ <strong>Portal logged you out</strong> — showing cached attendance.</span>
          <button onClick={() => setShowRenewModal(true)} className="renew-btn">
            Reconnect
          </button>
        </aside>
      )}

      <header className="dash-header">
        <div className="header-meta">
          <h1 className="user-greeting">Hi, {displayName}</h1>
          {lastSync && (
            <span className="last-sync-text">
              Updated {formatLastSync(lastSync)}
            </span>
          )}
          {institutes.length > 1 && (
            <label className="semrow" style={{ marginTop: "4px" }}>
              Institute{" "}
              <select
                value={String(session.instituteid ?? "")}
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
            key={`${id}:${String(session.instituteid ?? "")}`}
            session={session}
            onLogout={onLogout}
          />
        ))}
      </div>

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
