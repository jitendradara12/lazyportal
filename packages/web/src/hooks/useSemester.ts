import { useEffect } from "react";
import { usePersistentState } from "./usePersistentState";

/** True when a JUET semester code (e.g. 2027EVESEM in Nov 2026) has not started yet. */
export function isFutureSemester(semester: unknown, now: Date = new Date()): boolean {
  if (!semester || typeof semester !== "object") return false;
  const s = semester as { registrationcode?: unknown; registrationdesc?: unknown };
  const raw = String(s.registrationcode ?? s.registrationdesc ?? "").trim();
  const match = raw.match(/^(\d{4})(ODD|EVE|EVEN)(?:SEM)?$/i);
  if (!match) return false;
  const semYear = Number(match[1]);
  const isOdd = match[2].toUpperCase() === "ODD";
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0 = Jan, 6 = Jul
  return isOdd
    ? currentYear < semYear || (currentYear === semYear && currentMonth < 6)
    : currentYear < semYear;
}

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
