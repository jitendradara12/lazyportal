// Wiring only. No crypto, no endpoint strings, no localStorage.clear().
import { createClient, session } from "@juet/core";

// Same-origin proxy in dev (vite.config proxy /api -> portal). Direct cross-origin
// calls are blocked by the portal's CORS allowlist, so never point this at the
// portal host from browser code. Override with VITE_API_BASE for prod proxy.
export const BASE_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? "/api";

export const store = session.createStore(session.browserLocalAdapter());

export const client = createClient({
  baseUrl: BASE_URL,
  getToken: () => store.load()?.token ?? "",
  onUnauthorized: async () => {
    session.markSessionExpired();
    store.clear();
  },
});
