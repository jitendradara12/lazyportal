import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "@juet/core";
import { clearOfficialPortalBridge } from "../lib/officialPortal";
import { client, onClientUnauthorized, store } from "../lib/portal";
import type { Session } from "../types";

function restore(): Session | null {
  return store.load();
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(restore);
  const [isExpired, setIsExpired] = useState(false);
  const pendingExpiredTimer = useRef<number | null>(null);

  const save = useCallback((s: Session) => {
    if (pendingExpiredTimer.current) {
      window.clearTimeout(pendingExpiredTimer.current);
      pendingExpiredTimer.current = null;
    }
    store.save(s);
    setSession(s);
    setIsExpired(false);
  }, []);
  const logout = useCallback(() => {
    if (pendingExpiredTimer.current) {
      window.clearTimeout(pendingExpiredTimer.current);
      pendingExpiredTimer.current = null;
    }
    store.clear();
    clearOfficialPortalBridge();
    try {
      localStorage.removeItem("juet.portal.saved_pw");
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("juet.cache.") || k.startsWith("juet.portal.sem.") || k.startsWith("juet.portal.card.") || k === "juet.portal.last_sync" || k === "juet.portal.expired")) localStorage.removeItem(k);
      }
    } catch {}
    setSession(null);
    setIsExpired(false);
  }, []);

  const handleUnauthorized = useCallback(() => {
    // Session expired upstream: do not kick user out of the dashboard!
    // Debounce the flag: client.js times out the shared silent refresh at
    // 60s, but the background attempt can still succeed just after and fire
    // juet:renewed. Showing the pill immediately caused a flash
    // (banner appears -> silent retry fixes it -> banner disappears).
    // Wait a beat; a renew arriving first cancels the prompt entirely.
    if (pendingExpiredTimer.current) window.clearTimeout(pendingExpiredTimer.current);
    const t = window.setTimeout(() => {
      pendingExpiredTimer.current = null;
      setIsExpired(true);
    }, 800);
    pendingExpiredTimer.current = t;
  }, []);

  useEffect(() => {
    onClientUnauthorized(handleUnauthorized);
    return () => {
      onClientUnauthorized(() => {});
      if (pendingExpiredTimer.current) window.clearTimeout(pendingExpiredTimer.current);
    };
  }, [handleUnauthorized]);

  useEffect(() => {
    const onRenewed = (e: Event) => {
      const detail = (e as CustomEvent<Session>).detail;
      if (pendingExpiredTimer.current) {
        window.clearTimeout(pendingExpiredTimer.current);
        pendingExpiredTimer.current = null;
      }
      if (detail) {
        setSession(detail);
        setIsExpired(false);
      }
    };
    window.addEventListener("juet:renewed", onRenewed);
    return () => window.removeEventListener("juet:renewed", onRenewed);
  }, []);

  // Keep-alive heartbeat: ping token refresh every 3 mins while app is open
  useEffect(() => {
    if (!session?.username) return;
    const heartbeat = async () => {
      // Read live store (not stale closure): silent re-login may have
      // rotated the token since this interval was created.
      let cur: Session | null = null;
      try {
        cur = store.load() as Session | null;
      } catch {}
      const active = cur ?? session;
      if (!active?.username) return;
      try {
        const r = await auth.refreshSession(client, active);
        if (r.ok) {
          if (r.token && r.token !== active.token) {
            let latest: Session | null = active;
            try {
              latest = (store.load() as Session | null) ?? active;
            } catch {}
            if (latest?.token === active.token) save({ ...latest, token: r.token });
          }
          setIsExpired(false);
        }
      } catch {
        // Keep-alive failures are non-fatal; active requests handle 401 transparently
      }
    };

    const interval = setInterval(heartbeat, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [session, save]);

  return { session, isExpired, save, logout };
}
