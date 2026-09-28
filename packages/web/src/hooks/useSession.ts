import { useCallback, useState } from "react";
import { session as sessionMod } from "@juet/core";
import { store } from "../lib/portal";
import type { Session } from "../types";

function restore(): Session | null {
  const valid = store.loadValid();
  if (valid) return valid;
  // Token present but past expiry: say so on the login screen instead of silence.
  if (store.load()?.token) sessionMod.markSessionExpired();
  return null;
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(restore);
  const save = useCallback((s: Session) => {
    store.save(s);
    setSession(s);
  }, []);
  const logout = useCallback(() => {
    store.clear();
    setSession(null);
  }, []);
  return { session, save, logout };
}
