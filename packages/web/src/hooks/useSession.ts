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

  // Keep-alive heartbeat: ping token refresh every 3 mins while app is open
  useEffect(() => {
    if (!session?.username) return;
    const heartbeat = async () => {
      try {
        const r = await auth.refreshSession(client, session);
        if (r.ok) {
          if (r.token && r.token !== session.token) {
            save({ ...session, token: r.token });
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
