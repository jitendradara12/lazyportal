// Wiring only. No crypto, no endpoint strings, no localStorage.clear().
import { auth, createClient, session } from "@juet/core";
import { resolveApiBase } from "./apiBase";
import type { Session } from "../types";

const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

// ponytail: read the native bridge global directly — avoids bundling @capacitor/core in the web build
const nativePlatform =
  typeof (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform === "function"
    ? (globalThis as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform()
    : false;

// Same-origin proxy in dev (vite.config proxy /api -> portal) and in the browser
// deployment; absolute URL to the hosted proxy inside the Capacitor shell, which
// has no same-origin `/api`. See lib/apiBase.js.
export const BASE_URL = resolveApiBase({
  nativePlatform,
  envBase: env.VITE_API_BASE,
  envNativeBase: env.VITE_NATIVE_API_BASE,
});

export const store = session.createStore(session.browserLocalAdapter());

export type SessionStatus = "authenticated" | "recovering" | "expired";
let currentSessionStatus: SessionStatus = store.load()?.token ? "authenticated" : "expired";
const statusListeners = new Set<(status: SessionStatus) => void>();

export function getSessionStatus(): SessionStatus {
  return currentSessionStatus;
}

export function setSessionStatus(status: SessionStatus) {
  if (currentSessionStatus === status) return;
  currentSessionStatus = status;
  for (const cb of statusListeners) {
    try {
      cb(status);
    } catch {}
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("juet:session-status", { detail: { status } }));
  }
}

export function onSessionStatus(cb: (status: SessionStatus) => void): () => void {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

export const client = createClient({
  baseUrl: BASE_URL,
  getToken: () => store.load()?.token ?? "",
  onSessionStatusChange: (status) => setSessionStatus(status),
  onRefresh: async () => {
    const s = store.load();
    if (!s?.username) return false;

    // 1. Try lightweight token refresh
    try {
      const r = await auth.refreshSession(client, s);
      if (r.ok) {
        if (r.token) store.save({ ...s, token: r.token });
        setSessionStatus("authenticated");
        return true;
      }
    } catch {
      // Upstream token refresh request failed
    }

    // 2. Silent re-login if saved password exists. Portal shows no captcha
    // rate limit, so retry solver low-confidence / bad-captcha up to 5 times
    // before falling through to the manual reconnect modal. Network blips
    // retry too (without clearing the saved password).
    let savedPw = "";
    try {
      savedPw = localStorage.getItem("juet.portal.saved_pw") ?? "";
    } catch {}

    if (savedPw) {
      const maxAttempts = 5;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let cap;
        try {
          cap = await auth.fetchCaptcha(client);
        } catch {
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            return false;
          }
          // Captcha image fetch failed (network/portal blip): retry.
          continue;
        }
        let captchaText = "";
        try {
          captchaText = await auth.solveCaptcha(cap);
        } catch {
          // Solver threw on this image: try a fresh one.
          continue;
        }
        if (!captchaText) continue;
        try {
          const savedUsertype = (localStorage.getItem("juet.portal.last_usertype") as "S" | "P") || (s.membertype === "P" ? "P" : "S");
          const fresh = (await auth.login(client, {
            username: String(s.username ?? s.enrollmentno),
            password: savedPw,
            captchaText,
            captcha: cap,
            usertype: savedUsertype,
          })) as unknown as Session;

          // Preserve the user's selected institute: login returns the first
          // one, but the user may have switched. Overwriting it here used to
          // refetch every section under a different institute right after a
          // silent renew (looked like "homepage asks for captcha again").
          const keepId = s.instituteid ?? fresh.instituteid;
          const keepName =
            (s.instituteid != null
              ? (s.institutelist as { value?: string; label?: string }[] | undefined)?.find(
                  (o) => String(o.value) === String(s.instituteid),
                )?.label ?? s.institutename
              : fresh.institutename) ?? fresh.institutename;
          const newSession = { ...fresh, instituteid: keepId, institutename: keepName };

          store.save(newSession);
          setSessionStatus("authenticated");
          window.dispatchEvent(new CustomEvent("juet:renewed", { detail: newSession }));
          return true;
        } catch (e) {
          const code = (e as { code?: string })?.code;
          const msg = (e as Error)?.message ?? "";
          const isCaptchaErr = code === "CAPTCHA_INVALID" || /captcha/i.test(msg);
          if (isCaptchaErr) continue;
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            return false;
          }
          // Explicit credential rejection: clear saved credentials
          if (/invalid (user|password|credential)|wrong password|user id or password/i.test(msg)) {
            try {
              localStorage.removeItem("juet.portal.saved_pw");
            } catch {}
            return false;
          }
          // Transient: portal down / session race — retry with a fresh captcha.
          if (code === "NETWORK_ERROR" || code === "SESSION_EXPIRED") continue;
          return false;
        }
      }
    }

    return false;
  },
  onUnauthorized: async () => {
    session.markSessionExpired();
    setSessionStatus("expired");
  },
});
