import { useCallback, useEffect, useState } from "react";
import { writePersistentValue } from "../lib/persistentState.ts";

export { writePersistentValue };

function readValue(key: string, initial: string | null): string | null {
  try {
    return globalThis.localStorage?.getItem(`juet.portal.${key}`) ?? initial;
  } catch {
    return initial;
  }
}

/** Return the state for the requested key instead of leaking another key's value. */
export function resolvePersistentValue(
  stored: { key: string; value: string | null },
  key: string,
  initial: string | null,
): string | null {
  return stored.key === key ? stored.value : readValue(key, initial);
}

/** Resolve an incoming storage or custom state event for `key` without overwriting with stale storage. */
export function resolvePersistentEventValue(
  event: Event,
  key: string,
  initial: string | null,
): { match: boolean; value: string | null } {
  const se = event as StorageEvent;
  const ce = event as CustomEvent<{ key?: string; value?: string | null }>;
  const changedKey = ce.detail?.key ?? (se.key ? se.key.replace(/^juet\.portal\./, "") : null);
  if (changedKey !== key && changedKey !== null) return { match: false, value: initial };
  const value = ce.detail && "value" in ce.detail ? (ce.detail.value ?? initial) : readValue(key, initial);
  return { match: true, value };
}

/** useState persisted to localStorage, so semester picks survive reloads. */
export function usePersistentState(key: string, initial: string | null): [string | null, (v: string | null) => void] {
  const [stored, setStored] = useState<{ key: string; value: string | null }>(() => ({
    key,
    value: readValue(key, initial),
  }));

  // Some callers scope their preference key to a session or institute. Keep the
  // hook's in-memory value aligned when that key changes without remounting.
  const value = resolvePersistentValue(stored, key, initial);
  useEffect(() => {
    if (stored.key !== key) setStored({ key, value: readValue(key, initial) });
  }, [key, initial, stored.key]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = (e: Event) => {
      const next = resolvePersistentEventValue(e, key, initial);
      if (next.match) setStored({ key, value: next.value });
    };
    window.addEventListener?.("storage", update);
    window.addEventListener?.("juet:persistent-state", update);
    return () => {
      window.removeEventListener?.("storage", update);
      window.removeEventListener?.("juet:persistent-state", update);
    };
  }, [key, initial]);

  const set = useCallback((next: string | null) => {
    setStored({ key, value: next ?? initial });
    writePersistentValue(key, next);
  }, [key, initial]);

  return [value, set];
}
