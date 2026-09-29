// Wiring only. No crypto, no endpoint strings, no localStorage.clear().
import { auth, createClient, session } from "@juet/core";
import type { Session } from "../types";

// Same-origin proxy in dev (vite.config proxy /api -> portal). Direct cross-origin
// calls are blocked by the portal's CORS allowlist, so never point this at the
// portal host from browser code. Override with VITE_API_BASE for prod proxy.
export const BASE_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? "/api";

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

    // 2. Silent re-login if saved password exists (retry once on bad captcha)
    let savedPw = "";
    try {
      savedPw = localStorage.getItem("juet.portal.saved_pw") ?? "";
    } catch {}

    if (savedPw) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const cap = await auth.fetchCaptcha(client);
          const captchaText = await auth.solveCaptcha(cap);
          const newSession = (await auth.login(client, {
            username: String(s.username ?? s.enrollmentno),
            password: savedPw,
            captchaText,
            captcha: cap,
            usertype: s.membertype === "P" ? "P" : "S",
          })) as unknown as Session;

          store.save(newSession);
          window.dispatchEvent(new CustomEvent("juet:renewed", { detail: newSession }));
          return true;
        } catch {
          // Retry once on failure/bad captcha, then fall through
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
