import { useEffect } from "react";
import { usePersistentState } from "./usePersistentState";

/** Shared semester pick: persisted, defaults to first row, finds match. Resets a stale pick (e.g. institute switch) to first. */
export function useSemester<T>(key: string, semesters: T[] | undefined, getId: (s: T) => unknown = (s) => (s as { registrationid?: unknown }).registrationid) {
  const [semId, setSemId] = usePersistentState(`sem.${key}`, null);
  useEffect(() => {
    if (!semesters?.length) return;
    const first = getId(semesters[0]);
    if (first == null) return;
    if (semId === null || !semesters.some((s) => String(getId(s)) === semId)) setSemId(String(first));
  }, [semesters, semId, getId, setSemId]);
  const sem = semesters?.find((s) => String(getId(s)) === semId) ?? null;
  return [semId, setSemId, sem] as const;
}
