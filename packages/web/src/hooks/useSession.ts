import { useCallback, useEffect, useState } from "react";
import { session as coreSession } from "@juet/core";
import { cancelSessionRecovery, getSessionStatus, onSessionStatus, savedCredentials, setSessionStatus, store, type SessionStatus } from "../lib/portal";
import { invalidateCacheGeneration } from "./useFeature";
import type { Session } from "../types";
import { clearOfficialPortal } from "../lib/officialPortal";

function restore(): Session | null {
  return store.load();
}

/** Preserve session object identity across silent token renewals when only auth credentials rotated. */
export function resolveRenewedSession(prev: Session | null, next: Session): Session {
  if (!prev) return next;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (key === "token" || key === "tokendate") continue;
    const a = prev[key];
    const b = next[key];
    if (a === b) continue;
    if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
    }
    return next;
  }
  return prev;
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(restore);
  const [status, setStatus] = useState<SessionStatus>(() => (restore() ? getSessionStatus() : "expired"));

  const save = useCallback((s: Session) => {
    clearOfficialPortal();
    cancelSessionRecovery();
    coreSession.clearSessionExpired();
    store.save(s);
    setSession(s);
    setSessionStatus("authenticated");
    setStatus("authenticated");
  }, []);

  const logout = useCallback(() => {
    clearOfficialPortal();
    cancelSessionRecovery();
    invalidateCacheGeneration();
    coreSession.clearSessionExpired();
    store.clear();
    savedCredentials.clear();
    try {
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
        setSession((prev) => resolveRenewedSession(prev, detail));
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

