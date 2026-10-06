import type { Session } from "../types";

interface InstituteOption {
  value?: unknown;
  label?: unknown;
}

/** Keep a user's selected campus when a fresh login returns the first campus. */
export function preserveSelectedInstitute(fresh: Session, current: Session): Session {
  if (current.instituteid == null) return fresh;

  const institutes = Array.isArray(current.institutelist)
    ? (current.institutelist as InstituteOption[])
    : [];
  const selected = institutes.find((option) => String(option.value) === String(current.instituteid));
  const institutename =
    (typeof selected?.label === "string" ? selected.label : undefined) ??
    current.institutename ??
    fresh.institutename;

  return {
    ...fresh,
    instituteid: current.instituteid,
    institutename,
  };
}
