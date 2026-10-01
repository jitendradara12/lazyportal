import { useCallback, useEffect, useState } from "react";
import { auth } from "@juet/core";
import { client, onClientUnauthorized, store } from "../lib/portal";
import type { Session } from "../types";

function restore(): Session | null {
  // Ponytail: never proactively discard token based on local clock.
  // The server decides validity via 401, which triggers transparent refresh before logout.
  return store.load();
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(restore);
  const [isExpired, setIsExpired] = useState(false);

  const save = useCallback((s: Session) => {
    store.save(s);
    setSession(s);
    setIsExpired(false);
  }, []);

  const logout = useCallback(() => {
    store.clear();
    try {
      localStorage.removeItem("juet.portal.saved_pw");
    } catch {}
    setSession(null);
    setIsExpired(false);
  }, []);

  const handleUnauthorized = useCallback(() => {
    // Session expired upstream: do not kick user out of the dashboard!
    // Set isExpired to show reconnect prompt while keeping cached data visible.
    setIsExpired(true);
  }, []);

  useEffect(() => {
    onClientUnauthorized(handleUnauthorized);
    return () => onClientUnauthorized(() => {});
  }, [handleUnauthorized]);

  useEffect(() => {
    const onRenewed = (e: Event) => {
      const detail = (e as CustomEvent<Session>).detail;
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
            // ponytail: re-read, drop stale heartbeat win if silent re-login rotated meanwhile
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
