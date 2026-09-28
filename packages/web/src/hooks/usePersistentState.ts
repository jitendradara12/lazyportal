import { useState } from "react";

/** useState persisted to localStorage, so semester picks survive reloads. */
export function usePersistentState(key: string, initial: string | null): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => {
    try {
      return globalThis.localStorage?.getItem(`juet.portal.${key}`) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = (v: string | null) => {
    setValue(v);
    try {
      if (v === null) globalThis.localStorage?.removeItem(`juet.portal.${key}`);
      else globalThis.localStorage?.setItem(`juet.portal.${key}`, v);
    } catch {
      /* storage blocked */
    }
  };
  return [value, set];
}
