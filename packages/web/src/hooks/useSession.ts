import { useCallback, useEffect, useState } from "react";
import { store } from "../lib/portal";
import type { Session } from "../types";

export function useSession() {
  const [session, setSession] = useState<Session | null>(() => store.loadValid());
  useEffect(() => {
    setSession(store.loadValid());
  }, []);
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
