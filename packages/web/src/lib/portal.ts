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

let unauthListener: (() => void) | null = null;
export function onClientUnauthorized(cb: () => void) {
  unauthListener = cb;
}

export const client = createClient({
  baseUrl: BASE_URL,
  getToken: () => store.load()?.token ?? "",
  onRefresh: async () => {
    const s = store.load();
    if (!s?.username) return false;

    // 1. Try lightweight token refresh
    try {
      const r = await auth.refreshSession(client, s);
      if (r.ok) {
        if (r.token) store.save({ ...s, token: r.token });
        return true;
      }
    } catch {
      // Upstream token refresh request failed
    }

    // 2. Silent re-login if saved password exists (retry once on bad captcha).
    // Only CaptchaError gets a second attempt: wrong password / network
    // must fall through to the reconnect modal immediately, not hammer.
    let savedPw = "";
    try {
      savedPw = localStorage.getItem("juet.portal.saved_pw") ?? "";
    } catch {}

    if (savedPw) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const cap = await auth.fetchCaptcha(client);
          const captchaText = await auth.solveCaptcha(cap);
          if (!captchaText) continue;
          const savedUsertype = (localStorage.getItem("juet.portal.last_usertype") as "S" | "P") || (s.membertype === "P" ? "P" : "S");
          const newSession = (await auth.login(client, {
            username: String(s.username ?? s.enrollmentno),
            password: savedPw,
            captchaText,
            captcha: cap,
            usertype: savedUsertype,
          })) as unknown as Session;

          store.save(newSession);
          window.dispatchEvent(new CustomEvent("juet:renewed", { detail: newSession }));
          return true;
        } catch (e) {
          if ((e as { code?: string })?.code === "CAPTCHA_INVALID") continue;
          if ((e as { code?: string })?.code !== "NETWORK_ERROR" && (e as { code?: string })?.code !== "SESSION_EXPIRED") {
            try {
              localStorage.removeItem("juet.portal.saved_pw");
            } catch {}
          }
          return false;
        }
      }
    }

    return false;
  },
  onUnauthorized: async () => {
    session.markSessionExpired();
    unauthListener?.();
  },
});
