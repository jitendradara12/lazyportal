import { usePersistentState } from "./usePersistentState";

export const ATTENDANCE_TARGETS = [70, 80, 90] as const;
export type AttendanceTarget = (typeof ATTENDANCE_TARGETS)[number];

export function useDefaultAttendanceTarget(): [AttendanceTarget, (target: AttendanceTarget) => void] {
  const [stored, setStored] = usePersistentState("attendance.default_target", "70");
  const target = stored === "80" ? 80 : stored === "90" ? 90 : 70;
  return [target, (next) => setStored(String(next))];
}
