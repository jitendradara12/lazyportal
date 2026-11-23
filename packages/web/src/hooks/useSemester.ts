import { useEffect } from "react";
import { usePersistentState } from "./usePersistentState";

/**
 * Shared semester pick: persisted, defaults to preferredId (or first row), finds match.
 * Resets a stale pick (e.g. institute switch) to the default.
 */
export function useSemester<T>(
  key: string,
  semesters: T[] | undefined,
  getId: (s: T) => unknown = (s) => (s as { registrationid?: unknown }).registrationid,
  preferredId?: unknown,
) {
  const [semId, setSemId] = usePersistentState(`sem.${key}`, null);

  useEffect(() => {
    if (!semesters?.length) return;
    const preferred = preferredId != null && semesters.some((s) => String(getId(s)) === String(preferredId))
      ? preferredId
      : getId(semesters[0]);
    if (preferred == null) return;
    if (semId === null || !semesters.some((s) => String(getId(s)) === semId)) {
      setSemId(String(preferred));
    }
  }, [semesters, semId, getId, setSemId, preferredId]);

  const sem = semesters?.find((s) => String(getId(s)) === semId) ?? null;
  return [semId, setSemId, sem] as const;
}
