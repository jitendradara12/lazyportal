import { useCallback, useEffect, useRef, useState } from "react";
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

  return { session, isExpired, save, logout };
}
