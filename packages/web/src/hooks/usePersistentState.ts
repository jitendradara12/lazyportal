import { useCallback, useEffect, useState } from "react";

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

  const set = useCallback((next: string | null) => {
    setStored({ key, value: next });
    try {
      if (next === null) globalThis.localStorage?.removeItem(`juet.portal.${key}`);
      else globalThis.localStorage?.setItem(`juet.portal.${key}`, next);
    } catch {
      /* storage blocked */
    }
  }, [key]);

  return [value, set];
}
