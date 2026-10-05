import { useCallback, useEffect, useState } from "react";
import { getSessionStatus, onSessionStatus, setSessionStatus, store, type SessionStatus } from "../lib/portal";
import type { Session } from "../types";

function restore(): Session | null {
  return store.load();
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(restore);
  const [status, setStatus] = useState<SessionStatus>(() => (restore() ? getSessionStatus() : "expired"));

  const save = useCallback((s: Session) => {
    store.save(s);
    setSession(s);
    setSessionStatus("authenticated");
    setStatus("authenticated");
  }, []);

  const logout = useCallback(() => {
    store.clear();
    try {
      localStorage.removeItem("juet.portal.saved_pw");
      localStorage.removeItem("juet.portal.last_refresh_attempt");
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (
          k &&
          (k.startsWith("juet.cache.") ||
            k.startsWith("juet.portal.sem.") ||
            k.startsWith("juet.portal.card.") ||
            k === "juet.portal.last_sync" ||
            k === "juet.portal.last_refresh_attempt" ||
            k === "juet.portal.expired")
        )
          localStorage.removeItem(k);
      }
    } catch {}
    setSession(null);
    setSessionStatus("expired");
    setStatus("expired");
  }, []);

  useEffect(() => {
    return onSessionStatus((newStatus) => {
      setStatus(newStatus);
    });
  }, []);

  useEffect(() => {
    const onRenewed = (e: Event) => {
      const detail = (e as CustomEvent<Session>).detail;
      if (detail) {
        setSession(detail);
        setSessionStatus("authenticated");
        setStatus("authenticated");
      }
    };
    window.addEventListener("juet:renewed", onRenewed);
    return () => window.removeEventListener("juet:renewed", onRenewed);
  }, []);

  const isExpired = status === "expired";
  const isRecovering = status === "recovering";

  return { session, isExpired, isRecovering, sessionStatus: status, save, logout };
}

