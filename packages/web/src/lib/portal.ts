// Wiring only. No crypto, no endpoint strings, no localStorage.clear().
import { Capacitor, registerPlugin } from "@capacitor/core";
import { auth, createClient, createPortalTransport, credentials, features, session } from "@juet/core";
import { resolveApiBase } from "./apiBase";
import { preserveSelectedInstitute } from "./sessionSelection";
import { selectRefreshPolicy } from "./refreshPolicy";
import type { Session } from "../types";

const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

const nativePlatform = Capacitor.isNativePlatform();
const nativeHttp = registerPlugin("PortalHttp");

// Same-origin proxy in dev (vite.config proxy /api -> portal) and in the browser
// deployment. Android uses this proxy only on older APKs, for reads missing from
// its installed policy, or with an explicit development override.
export const BASE_URL = resolveApiBase({
  nativePlatform,
  envBase: env.VITE_API_BASE,
  envNativeBase: env.VITE_NATIVE_API_BASE,
});

const transport = createPortalTransport({
  baseUrl: BASE_URL,
  mode: env.VITE_API_TRANSPORT,
  native: Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("PortalHttp") && !env.VITE_NATIVE_API_BASE
    ? nativeHttp : undefined,
});

export type RefreshPage = keyof typeof features.featurePostEndpoints;

export async function getRefreshPolicy(page: RefreshPage) {
  // Unknown/unavailable native capabilities keep the conservative proxy policy.
  const paths = Object.values(features.featurePostEndpoints[page]);
  const usesProxy = await transport.usesProxyFor("POST", paths).catch(() => true) ||
    (page === "marks" && await transport.usesProxyFor("GET", Object.values(features.marksReportEndpoints)).catch(() => true));
  return selectRefreshPolicy(usesProxy, env.VITE_ATTENDANCE_QUOTA);
}

export const MAX_AUTOSOLVE_ATTEMPTS = 8;

export const savedCredentials = credentials.createStore();
// Migrate on every app boot, even when the current session is still valid.
void savedCredentials.migrate();

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
  fetchImpl: transport.fetch,
  getToken: () => store.load()?.token ?? "",
  onSessionStatusChange: (status) => setSessionStatus(status),
  onRefresh: async (signal) => {
    if (signal.aborted) return false;
    const s = store.load();
    if (!s?.username) return false;

    // 1. Try lightweight token refresh
    try {
      const r = await auth.refreshSession(client, s, { signal });
      if (signal.aborted) return false;
      if (r.ok) {
        if (r.token) store.save({ ...s, token: r.token });
        return true;
      }
    } catch {
      if (signal.aborted) return false;
      // Upstream token refresh request failed
    }

    // 2. Silent re-login if saved password exists. Portal shows no captcha
    // rate limit, so retry solver low-confidence / bad-captcha up to 8 times
    // before falling through to the manual reconnect modal. Network blips
    // retry too (without clearing the saved password).
    let usertype = s.membertype === "P" ? "P" : "S";
    try { usertype = localStorage.getItem("juet.portal.last_usertype") || usertype; } catch {}
    const account = { username: String(s.username ?? s.enrollmentno), usertype };
    const savedPw = await savedCredentials.load(account);
    if (signal.aborted) return false;

    if (savedPw) {
      const maxAttempts = MAX_AUTOSOLVE_ATTEMPTS;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (signal.aborted) return false;
        let cap;
        try {
          cap = await auth.fetchCaptcha(client, { signal });
        } catch {
          if (signal.aborted) return false;
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            return false;
          }
          // Captcha image fetch failed (network/portal blip): retry.
          continue;
        }
        if (signal.aborted) return false;
        let captchaText = "";
        try {
          captchaText = await auth.solveCaptcha(cap, { signal });
        } catch {
          if (signal.aborted) return false;
          // Solver threw on this image: try a fresh one.
          continue;
        }
        if (signal.aborted) return false;
        if (!captchaText) continue;
        try {
          const fresh = (await auth.login(client, {
            username: String(s.username ?? s.enrollmentno),
            password: savedPw,
            captchaText,
            captcha: cap,
            usertype: account.usertype,
          }, { signal })) as unknown as Session;
          if (signal.aborted) return false;

          // Login returns the first institute, but the user may have selected
          // another one before the silent renewal.
          const newSession = preserveSelectedInstitute(fresh, s);

          if (signal.aborted) return false;
          store.save(newSession);
          window.dispatchEvent(new CustomEvent("juet:renewed", { detail: newSession }));
          return true;
        } catch (e) {
          if (signal.aborted) return false;
          const code = (e as { code?: string })?.code;
          const msg = (e as Error)?.message ?? "";
          const isCaptchaErr = code === "CAPTCHA_INVALID" || /captcha/i.test(msg);
          if (isCaptchaErr) continue;
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            return false;
          }
          // Explicit credential rejection: clear saved credentials
          if (/invalid (user|password|credential)|wrong password|user id or password/i.test(msg)) {
            savedCredentials.clear();
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

/** Stop silent recovery when the user explicitly changes or clears the session. */
export function cancelSessionRecovery() {
  client.cancelRefresh();
}
