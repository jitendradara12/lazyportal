import { features } from "@juet/core";
import { isSubjectDetailComplete, subjectDetailMatchesOverview } from "./attendanceCalc.ts";
export { isSubjectDetailComplete };

/**
 * Portal scheduling and tap-cooldown helpers.
 *
 * JUET's portal mass-commits daily attendance around midnight.
 * By 2:00 AM IST (UTC+05:30), the new day's records are finalized.
 *
 * A "portal day" runs from 02:00 AM IST to 01:59:59 AM IST the following calendar day.
 */

export const REFRESH_THROTTLE_MS = 20_000;
export const NATIVE_REFRESH_THROTTLE_MS = 2_000;
export const ATTENDANCE_UNCHANGED_COOLDOWN_MS = 60 * 60 * 1000; // 1-hour proxy cooldown after unchanged attendance check

export function getThrottleKey(key = "attendance"): string {
  if (key.startsWith("juet.portal.")) return key;
  return `juet.portal.last_refresh_${key}`;
}

/** Check whether an explicit refresh should be throttled based on the last manual refresh attempt. */
export function shouldThrottleRefresh(
  key: string = "attendance",
  throttleMs: number = REFRESH_THROTTLE_MS
): boolean {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(getThrottleKey(key)) : null;
    return Boolean(raw && Date.now() - Number(raw) < throttleMs);
  } catch {
    return false;
  }
}

export function recordRefreshAttempt(key = "attendance"): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(getThrottleKey(key), String(Date.now()));
    }
  } catch {}
}

export function getAttendanceUnchangedKey(session?: SessionRef | null): string {
  const user = session?.username ? encodeURIComponent(String(session.username).trim().toUpperCase()) : "anonymous";
  const inst = session?.instituteid != null ? encodeURIComponent(String(session.instituteid)) : "default";
  return `juet.portal.att_unchanged.${user}:${inst}`;
}

/**
 * Proxy-side cooldown after a manual attendance refresh confirms no portal changes.
 * Automatically resets at the 02:00 AM IST portal day rollover.
 */
export function isAttendanceUnchangedCoolingDown(
  session?: SessionRef | null,
  now?: Date | number,
  cooldownMs: number = ATTENDANCE_UNCHANGED_COOLDOWN_MS,
): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem(getAttendanceUnchangedKey(session));
    if (!raw) return false;
    const lastUnchangedAt = Number(raw);
    if (!Number.isFinite(lastUnchangedAt) || lastUnchangedAt <= 0) return false;
    const nowMs = toMs(now);
    const clamped = lastUnchangedAt > nowMs ? nowMs : lastUnchangedAt;
    if (!isCurrentPortalDay(clamped, nowMs)) return false;
    return nowMs - clamped < cooldownMs;
  } catch {
    return false;
  }
}

export function recordAttendanceUnchanged(
  session?: SessionRef | null,
  now?: Date | number,
): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(getAttendanceUnchangedKey(session), String(toMs(now)));
    }
  } catch {}
}

/**
 * Cutoff time in Indian Standard Time (IST, UTC+05:30).
 * Set to 02:00 AM IST to align with when JUET's single midnight batch actually commits.
 */
export const PORTAL_DAY_CUTOFF_HOUR_IST = 2;
export const PORTAL_DAY_CUTOFF_MINUTE_IST = 0;

// IST offset is UTC+05:30 (330 minutes).
// Shifting by (330 - cutoff_minutes) converts the IST cutoff point to UTC midnight.
const IST_OFFSET_MINUTES = 5 * 60 + 30; // 330 min
const CUTOFF_MINUTES_IST = PORTAL_DAY_CUTOFF_HOUR_IST * 60 + PORTAL_DAY_CUTOFF_MINUTE_IST; // 120 min
const IST_EFFECTIVE_OFFSET_MS = (IST_OFFSET_MINUTES - CUTOFF_MINUTES_IST) * 60 * 1000; // 12,600,000 ms

/** Shared session reference structure for quota and cache keys */
export interface SessionRef {
  username?: unknown;
  instituteid?: unknown;
}

/** Centralized TTL policies across features to avoid shotgun updates */
export const FEATURE_TTL = {
  // Non-attendance pages fetch missing entries, then update only on manual refresh.
  marks: Number.POSITIVE_INFINITY,
  exams: Number.POSITIVE_INFINITY,
  faculty: Number.POSITIVE_INFINITY,
  legacySubjectDetail: 7 * 24 * 60 * 60 * 1000, // migrate old attendance entries without checksums
  pastDetail: 30 * 24 * 60 * 60 * 1000, // 30 days (immutable past-semester history)
  lov: 7 * 24 * 60 * 60 * 1000, // 7 days (static semester registration LOV)
} as const;

/** Helper to convert Date | number | undefined to epoch milliseconds */
export function toMs(date?: Date | number): number {
  if (typeof date === "number" && Number.isFinite(date)) return date;
  if (date instanceof Date && Number.isFinite(date.getTime())) return date.getTime();
  return Date.now();
}

/**
 * Get the portal day key (e.g. "2026-10-07") for a timestamp or Date in IST.
 * 01:59 AM IST on Oct 7 belongs to portal day 2026-10-06.
 * 02:00 AM IST on Oct 7 starts portal day 2026-10-07.
 */
export function getPortalDayKey(date?: Date | number): string {
  const ts = toMs(date);
  const effective = ts + IST_EFFECTIVE_OFFSET_MS;
  const d = new Date(effective);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Check whether a timestamp belongs to the current active portal day.
 */
export function isCurrentPortalDay(timestamp?: number | null, now?: Date | number): boolean {
  if (!timestamp || typeof timestamp !== "number" || Number.isNaN(timestamp) || timestamp <= 0) {
    return false;
  }
  return getPortalDayKey(timestamp) === getPortalDayKey(now);
}

/**
 * Calculate the exact timestamp when the next portal day begins (upcoming 02:00 AM IST).
 */
export function getNextPortalResetTimestamp(now?: Date | number): number {
  const nowMs = toMs(now);
  const effective = nowMs + IST_EFFECTIVE_OFFSET_MS;
  const d = new Date(effective);
  const nextUtcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  return nextUtcMidnight - IST_EFFECTIVE_OFFSET_MS;
}

/**
 * Milliseconds remaining until the next 02:00 AM IST portal reset.
 */
export function getMsUntilNextPortalDay(now?: Date | number): number {
  const nowMs = toMs(now);
  const nextReset = getNextPortalResetTimestamp(nowMs);
  return Math.max(0, nextReset - nowMs);
}

/** Helper to extract the first non-empty string among potential key names */
function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
}

function pickComponent(row: Record<string, unknown>, prefix: string): string {
  const tot = pick(row, `${prefix}totalclass`, `${prefix}Totalclass`, `${prefix.toLowerCase()}totalclass`);
  const pres = pick(row, `${prefix}totalpresent`, `${prefix}Totalpresent`, `${prefix.toLowerCase()}totalpresent`);
  const pct = pick(row, `${prefix}percentage`);
  const components = features.getAttendanceComponentIds(row[`${prefix}subjectcomponentid`]).join(",");
  return `${tot}:${pres}:${pct}:${components}`;
}

function pickLegacyComponent(row: Record<string, unknown>, prefix: string): string {
  const tot = pick(row, `${prefix}totalclass`, `${prefix}Totalclass`, `${prefix.toLowerCase()}totalclass`);
  const pres = pick(row, `${prefix}totalpresent`, `${prefix}Totalpresent`, `${prefix.toLowerCase()}totalpresent`);
  const pct = pick(row, `${prefix}percentage`);
  return `${tot}:${pres}:${pct}`;
}

function isValidComponentId(id: unknown): boolean {
  if (!id) return false;
  const s = String(id).trim();
  return s !== "" && s !== "0" && s !== "null" && s !== "undefined";
}

export function computeSubjectComponentChecksum(row: Record<string, unknown>, type: string): string {
  return pickComponent(row, type);
}

/** Percentages can stay unchanged as new classes are recorded; exact counts cannot. */
export function hasSubjectCountCoverage(row: Record<string, unknown>): boolean {
  const count = (...keys: string[]) => {
    for (const key of keys) {
      const value = row[key];
      if (value == null || typeof value === "boolean" || String(value).trim() === "") continue;
      const n = Number(value);
      if (Number.isInteger(n) && n >= 0) return n;
    }
    return null;
  };
  const pair = (total: number | null, present: number | null) => total !== null && present !== null && present <= total;
  const covered = (type: string) => pair(
    count(`${type}totalclass`, `${type}Totalclass`, `${type.toLowerCase()}totalclass`),
    count(`${type}totalpresent`, `${type}Totalpresent`, `${type.toLowerCase()}totalpresent`),
  );
  const types = ["L", "T", "P"].filter(type => features.getAttendanceComponentIds(row[`${type}subjectcomponentid`]).length);
  if (pair(count("totalclass", "totalclasses", "Totalclass"), count("totalpresent", "totalpresents", "Totalpresent"))) {
    // The aggregate excludes P when the subject also has lecture/tutorial attendance.
    return !types.includes("P") || !types.some(type => type === "L" || type === "T") || covered("P");
  }
  return types.every(covered);
}

function subjectRowChecksum(
  row: Record<string, unknown>,
  component: (row: Record<string, unknown>, prefix: string) => string,
  componentMode: "canonical" | "legacy" | "raw" = "canonical",
): string {
  const subId = pick(row, "subjectid", "individualsubjectcode", "subjectcode");
  const has = (type: string) => componentMode === "canonical"
    ? features.getAttendanceComponentIds(row[`${type}subjectcomponentid`]).length > 0
    : componentMode === "legacy" ? isValidComponentId(row[`${type}subjectcomponentid`]) : Boolean(row[`${type}subjectcomponentid`]);
  const isLab = Boolean((has("P") || row.Ppercentage) && !has("L") && !has("T"));
  const overall = isLab
    ? pick(row, "Ppercentage", "LTpercantage", "LTpercentage", "overallattendance", "percentage", "attendance")
    : pick(row, "LTpercantage", "LTpercentage", "overallattendance", "percentage", "attendance");
  const tot = pick(row, "totalclass", "totalclasses", "Totalclass");
  const pres = componentMode === "canonical"
    ? pick(row, "totalpresent", "totalpresents", "Totalpresent") : pick(row, "totalpresent", "Totalpresent");
  return `${subId}|${tot}|${pres}|${overall}|${component(row, "L")}|${component(row, "T")}|${component(row, "P")}`;
}

/**
 * Legacy row checksum prior to component ID inclusion (e.g. before commit bf74c24).
 * Retained for backward compatibility so existing user caches do not trigger full background refetches.
 */
export function computeLegacySubjectRowChecksum(row: Record<string, unknown>): string {
  return subjectRowChecksum(row, pickLegacyComponent, "legacy");
}

/**
 * Fast composite row checksum to determine if attendance breakdown has changed.
 * Captures all component counts, totals, and percentages.
 */
export function computeSubjectRowChecksum(row: Record<string, unknown>): string {
  return subjectRowChecksum(row, pickComponent);
}

function getComponentTotal(comp: unknown): number {
  if (!comp || typeof comp !== "object") return 0;
  if (Array.isArray(comp)) return comp.length;
  const rec = comp as Record<string, unknown>;
  const list = rec.student_attdsummarylist ?? rec.attdsummarylist ?? rec.rows;
  if (Array.isArray(list)) return list.length;
  return Number(rec.totalclass ?? rec.totalclasses ?? rec.Totalclass ?? 0);
}


function computeRawLegacySubjectRowChecksum(row: Record<string, unknown>): string {
  return subjectRowChecksum(row, pickLegacyComponent, "raw");
}

function computePreviousSubjectRowChecksum(row: Record<string, unknown>): string {
  return subjectRowChecksum(row, (r, type) => `${pickLegacyComponent(r, type)}:${pick(r, `${type}subjectcomponentid`).split(",").filter(Boolean).sort().join(",")}`, "legacy");
}

export function doesSubjectNeedDeepFetch(
  row: Record<string, unknown>,
  cached: Record<string, Record<string, unknown>> | null,
  cachedUpdatedAt: number | null,
  cachedChecksum?: string | null,
  now = Date.now(),
  provisional = false,
): boolean {
  if (!cached) return true;

  // Incomplete / corrupted cache detection:
  // If a component is expected by the row, but is missing or null in cached,
  // we must deep fetch to repair the incomplete cache (e.g. only tutorials fetched).
  if (!isSubjectDetailComplete(row, cached)) return true;
  if (!cachedUpdatedAt || !Number.isFinite(cachedUpdatedAt) || cachedUpdatedAt <= 0) return true;
  const currentChecksum = computeSubjectRowChecksum(row);
  // A confirmed portal disagreement is useful for this exact snapshot today.
  if (provisional) return cachedChecksum !== currentChecksum || !isCurrentPortalDay(cachedUpdatedAt, now);
  if (subjectDetailMatchesOverview(row, cached) === false) return true;
  if (!hasSubjectCountCoverage(row) && !isCurrentPortalDay(cachedUpdatedAt, now)) return true;

  if (cachedChecksum) {
    if (
      cachedChecksum !== currentChecksum &&
      cachedChecksum !== computePreviousSubjectRowChecksum(row) &&
      cachedChecksum !== computeLegacySubjectRowChecksum(row) &&
      cachedChecksum !== computeRawLegacySubjectRowChecksum(row)
    ) {
      return true;
    }
    // Count-bearing rows can retain unchanged history beyond the current portal day.
    return false;
  }
  // Backward compatibility when checksum was not yet stored in cache
  const rowTotal = Number(pick(row, "totalclass", "totalclasses", "Totalclass") || 0);
  if (rowTotal > 0) {
    let cachedTotal = 0;
    for (const comp of Object.values(cached)) {
      cachedTotal += getComponentTotal(comp);
    }
    if (cachedTotal > 0 && rowTotal !== cachedTotal) return true;
  }
  // Legacy detail entries have no checksum. Keep their age limit so they are
  // eventually refreshed and rewritten with checksum metadata.
  if (!cachedUpdatedAt || now - cachedUpdatedAt > FEATURE_TTL.legacySubjectDetail) {
    return true;
  }
  return false;
}

const rolloverSubscribers = new Set<() => void>();
let rolloverTimer: ReturnType<typeof setTimeout> | null = null;
let rolloverLastDay: string | null = null;
let rolloverVisibilityBound = false;

function notifyRollover() {
  for (const cb of rolloverSubscribers) {
    try {
      cb();
    } catch {}
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("juet:refresh-attendance"));
  }
}

function scheduleRolloverTimer() {
  if (rolloverTimer) clearTimeout(rolloverTimer);
  if (rolloverSubscribers.size === 0 || typeof window === "undefined") {
    rolloverTimer = null;
    return;
  }
  const ms = getMsUntilNextPortalDay() + 500;
  rolloverTimer = setTimeout(() => {
    rolloverLastDay = getPortalDayKey();
    notifyRollover();
    scheduleRolloverTimer();
  }, ms);
}

function handleRolloverVisibility() {
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    const currentDay = getPortalDayKey();
    if (rolloverLastDay !== null && currentDay !== rolloverLastDay) {
      rolloverLastDay = currentDay;
      notifyRollover();
    }
    scheduleRolloverTimer();
  }
}

/**
 * Automatically roll over quota and trigger revalidation when a tab is kept open overnight across 02:00 AM IST.
 * Multiplexed across a single shared timer and visibility listener so concurrent subscribers never duplicate events.
 */
export function subscribePortalDayRollover(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const wasEmpty = rolloverSubscribers.size === 0;
  rolloverSubscribers.add(callback);

  if (wasEmpty) {
    rolloverLastDay = getPortalDayKey();
    scheduleRolloverTimer();
    if (typeof document !== "undefined" && !rolloverVisibilityBound) {
      document.addEventListener("visibilitychange", handleRolloverVisibility);
      rolloverVisibilityBound = true;
    }
  }

  return () => {
    rolloverSubscribers.delete(callback);
    if (rolloverSubscribers.size === 0) {
      if (rolloverTimer) {
        clearTimeout(rolloverTimer);
        rolloverTimer = null;
      }
      if (typeof document !== "undefined" && rolloverVisibilityBound) {
        document.removeEventListener("visibilitychange", handleRolloverVisibility);
        rolloverVisibilityBound = false;
      }
      rolloverLastDay = null;
    }
  };
}
