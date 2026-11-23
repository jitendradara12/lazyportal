import { useEffect } from "react";
import { features } from "@juet/core";
import { usePersistentState } from "./usePersistentState";

export const isFutureSemester = features.isFutureSemester;

/**
 * Shared semester pick: persisted, defaults to preferredId (or first non-future
 * semester, falling back to first row), finds match. Resets a stale pick to default.
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
    const defaultSem = semesters.find((s) => !isFutureSemester(s)) ?? semesters[0];
    const preferred = preferredId != null && semesters.some((s) => String(getId(s)) === String(preferredId))
      ? preferredId
      : getId(defaultSem);
    if (preferred == null) return;
    if (semId === null || !semesters.some((s) => String(getId(s)) === semId)) {
      setSemId(String(preferred));
    }
  }, [semesters, semId, getId, setSemId, preferredId]);

  const sem = semesters?.find((s) => String(getId(s)) === semId) ?? null;
  return [semId, setSemId, sem] as const;
}
