import { isSubjectDetailComplete } from "./attendanceCalc.ts";
export { isSubjectDetailComplete };

/**
 * Portal scheduling and daily refresh quota management.
 *
 * JUET's portal mass-commits daily attendance around midnight.
 * By 2:00 AM IST (UTC+05:30), the new day's records are finalized.
 *
 * A "portal day" runs from 02:00 AM IST to 01:59:59 AM IST the following calendar day.
 */

/**
 * Daily manual refresh quota per student per portal day.
 * Auto-sync on the first app open of the day is free (does not consume this quota).
 */
export const DAILY_MANUAL_REFRESH_LIMIT = 1;
export const DAILY_UNCHANGED_REFRESH_LIMIT = 3;
export const UNCHANGED_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6-hour cooldown between unchanged checks

export const REFRESH_THROTTLE_MS = 20 * 1000; // 20s cooldown

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
  // Marks remain cached until the user explicitly refreshes the dashboard.
  marks: Number.POSITIVE_INFINITY,
  exams: 24 * 60 * 60 * 1000, // 24 hours (published days before exams)
  faculty: 7 * 24 * 60 * 60 * 1000, // 7 days (static semester registration)
  subjects: 7 * 24 * 60 * 60 * 1000, // 7 days (static course catalog)
  pastDetail: 30 * 24 * 60 * 60 * 1000, // 30 days (immutable past-semester history)
  lov: 7 * 24 * 60 * 60 * 1000, // 7 days (static semester registration LOV)
} as const;

/** Helper to convert Date | number | undefined to epoch milliseconds */
export function toMs(date?: Date | number): number {
  if (typeof date === "number" && Number.isFinite(date)) return date;
  if (date instanceof Date && Number.isFinite(date.getTime())) return date.getTime();
  return Date.now();
}

/** Helper to clamp integer values safely, defaulting invalid and non-finite values to min */
function clamp(val: unknown, min: number, max: number): number {
  const n = Number(val);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : min;
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

export type QuotaBlockedReason = "cooldown" | "unchanged_exhausted" | "manual_exhausted" | null;

export interface RefreshQuotaState {
  used: number;
  unchanged: number;
  total: number;
  remaining: number;
  canRefresh: boolean;
  blockedReason: QuotaBlockedReason;
  resetsInMs: number;
  portalDay: string;
}

export function getQuotaStorageKey(session?: SessionRef | null): string {
  const user = session?.username ? encodeURIComponent(String(session.username).trim().toUpperCase()) : "anonymous";
  const inst = session?.instituteid != null ? encodeURIComponent(String(session.instituteid)) : "default";
  return `juet.portal.refresh_quota.${user}:${inst}`;
}

interface QuotaRecord {
  day: string;
  count: number;
  unchanged: number;
  lastUnchangedAt: number;
}

function readQuotaRecord(session?: SessionRef | null, portalDay?: string, nowMs = Date.now()): QuotaRecord {
  const day = portalDay ?? getPortalDayKey(nowMs);
  const fallback: QuotaRecord = { day, count: 0, unchanged: 0, lastUnchangedAt: 0 };
  const key = getQuotaStorageKey(session);
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;

    let lastUnchangedAt = clamp(parsed.lastUnchangedAt, 0, Number.MAX_SAFE_INTEGER);
    // Sanitize future skew: if stored timestamp is in the future relative to current time, clamp to nowMs
    if (lastUnchangedAt > nowMs) {
      lastUnchangedAt = nowMs;
    }

    if (parsed.day !== day) {
      // New portal day: counts and cooldown cleanly reset at 02:00 AM IST
      return { day, count: 0, unchanged: 0, lastUnchangedAt: 0 };
    }

    return {
      day,
      count: clamp(parsed.count, 0, DAILY_MANUAL_REFRESH_LIMIT),
      unchanged: clamp(parsed.unchanged, 0, DAILY_UNCHANGED_REFRESH_LIMIT),
      lastUnchangedAt,
    };
  } catch {
    return fallback;
  }
}

/**
 * Query the remaining manual refresh quota for the current portal day.
 * Client-side abuse guard only: prevents rapid polling from the client UI.
 */
export function getManualRefreshQuota(session?: SessionRef | null, now?: Date | number): RefreshQuotaState {
  const nowMs = toMs(now);
  const portalDay = getPortalDayKey(nowMs);
  const { count: used, unchanged, lastUnchangedAt } = readQuotaRecord(session, portalDay, nowMs);

  const isCooledDown = lastUnchangedAt === 0 || nowMs - lastUnchangedAt >= UNCHANGED_COOLDOWN_MS;
  const isManualExhausted = used >= DAILY_MANUAL_REFRESH_LIMIT;
  const isUnchangedExhausted = unchanged >= DAILY_UNCHANGED_REFRESH_LIMIT;

  let blockedReason: QuotaBlockedReason = null;
  if (isManualExhausted) {
    blockedReason = "manual_exhausted";
  } else if (isUnchangedExhausted) {
    blockedReason = "unchanged_exhausted";
  } else if (!isCooledDown) {
    blockedReason = "cooldown";
  }

  const canRefresh = blockedReason === null;
  // remaining represents manual refresh capacity (1 - used); does not report 0 when only temporarily in cooldown,
  // but reports 0 if unchanged checks are exhausted for the day.
  const remaining = isUnchangedExhausted ? 0 : Math.max(0, DAILY_MANUAL_REFRESH_LIMIT - used);
  const resetsInMs = blockedReason === "cooldown"
    ? Math.max(0, UNCHANGED_COOLDOWN_MS - (nowMs - lastUnchangedAt))
    : getMsUntilNextPortalDay(nowMs);

  return {
    used,
    unchanged,
    total: DAILY_MANUAL_REFRESH_LIMIT,
    remaining,
    canRefresh,
    blockedReason,
    resetsInMs,
    portalDay,
  };
}

/**
 * Record that a manual refresh completed with real portal data.
 * Must ONLY be called upon successful 200 response with non-empty rows.
 * Deducts full manual quota if attendance changed, or counts toward unchanged limit and starts 6h cooldown.
 * Client-side abuse guard only.
 */
export function recordSuccessfulManualRefresh(
  session?: SessionRef | null,
  options?: { changed?: boolean; now?: Date | number } | number | Date
): RefreshQuotaState {
  let nowMs = Date.now();
  let changed = true;

  if (typeof options === "number" || options instanceof Date) {
    nowMs = toMs(options);
  } else if (typeof options === "object" && options !== null) {
    if (options.now !== undefined) nowMs = toMs(options.now);
    if (typeof options.changed === "boolean") changed = options.changed;
  }

  const current = getManualRefreshQuota(session, nowMs);
  const portalDay = getPortalDayKey(nowMs);
  const rec = readQuotaRecord(session, portalDay, nowMs);

  if (changed) {
    if (current.used >= DAILY_MANUAL_REFRESH_LIMIT || current.unchanged >= DAILY_UNCHANGED_REFRESH_LIMIT) {
      return current;
    }
    rec.count = Math.min(DAILY_MANUAL_REFRESH_LIMIT, rec.count + 1);
  } else {
    // Window-slide prevention: if ALREADY cooling down or exhausted, do NOT push lastUnchangedAt forward!
    if (!current.canRefresh) {
      return current;
    }
    rec.unchanged = Math.min(DAILY_UNCHANGED_REFRESH_LIMIT, rec.unchanged + 1);
    rec.lastUnchangedAt = nowMs;
  }

  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(getQuotaStorageKey(session), JSON.stringify(rec));
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("juet:quota-changed"));
    }
  } catch {}

  return getManualRefreshQuota(session, nowMs);
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
  return `${tot}:${pres}:${pct}`;
}

/**
 * Fast composite row checksum to determine if attendance breakdown has changed.
 * Captures all component counts, totals, and percentages.
 */
export function computeSubjectRowChecksum(row: Record<string, unknown>): string {
  const subId = pick(row, "subjectid", "individualsubjectcode", "subjectcode");
  const overall = pick(row, "LTpercantage", "LTpercentage", "overallattendance", "percentage", "attendance");
  const tot = pick(row, "totalclass", "totalclasses", "Totalclass");
  const pres = pick(row, "totalpresent", "Totalpresent");
  const L = pickComponent(row, "L");
  const T = pickComponent(row, "T");
  const P = pickComponent(row, "P");
  return `${subId}|${tot}|${pres}|${overall}|${L}|${T}|${P}`;
}

function getComponentTotal(comp: unknown): number {
  if (!comp || typeof comp !== "object") return 0;
  if (Array.isArray(comp)) return comp.length;
  const rec = comp as Record<string, unknown>;
  const list = rec.student_attdsummarylist ?? rec.attdsummarylist ?? rec.rows;
  if (Array.isArray(list)) return list.length;
  return Number(rec.totalclass ?? rec.totalclasses ?? rec.Totalclass ?? 0);
}


export function doesSubjectNeedDeepFetch(
  row: Record<string, unknown>,
  cached: Record<string, Record<string, unknown>> | null,
  cachedUpdatedAt: number | null,
  cachedChecksum?: string | null,
  now = Date.now(),
  options?: { allowFetchIfNotUpdatedToday?: boolean } | boolean
): boolean {
  if (!cached || Object.keys(cached).length === 0) return true;

  // Incomplete / corrupted cache detection:
  // If a component is expected by the row, but is missing or null in cached,
  // we must deep fetch to repair the incomplete cache (e.g. only tutorials fetched).
  if (!isSubjectDetailComplete(row, cached)) return true;

  const currentChecksum = computeSubjectRowChecksum(row);
  const allowIfNotUpdatedToday =
    typeof options === "boolean" ? options : Boolean(options?.allowFetchIfNotUpdatedToday);

  if (cachedChecksum) {
    if (cachedChecksum !== currentChecksum) return true;
    // Missing or corrupted timestamp
    if (!cachedUpdatedAt) return true;
    // When user explicitly views subject sheet, allow fetching if not yet updated in the current portal day
    if (allowIfNotUpdatedToday && !isCurrentPortalDay(cachedUpdatedAt, now)) {
      return true;
    }
    // A valid checksum is the freshness signal; age alone must not trigger a refetch.
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
  if (allowIfNotUpdatedToday && !isCurrentPortalDay(cachedUpdatedAt, now)) {
    return true;
  }
  // Legacy detail entries have no checksum. Keep their age limit so they are
  // eventually refreshed and rewritten with checksum metadata.
  if (!cachedUpdatedAt || now - cachedUpdatedAt > FEATURE_TTL.subjects) {
    return true;
  }
  return false;
}

/**
 * Automatically roll over quota and trigger revalidation when a tab is kept open overnight across 02:00 AM IST.
 */
export function subscribePortalDayRollover(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastDay = getPortalDayKey();
  const schedule = () => {
    if (timer) clearTimeout(timer);
    const ms = getMsUntilNextPortalDay() + 500;
    timer = setTimeout(() => {
      lastDay = getPortalDayKey();
      callback();
      window.dispatchEvent(new CustomEvent("juet:quota-changed"));
      window.dispatchEvent(new CustomEvent("juet:refresh-attendance"));
      schedule();
    }, ms);
  };
  schedule();
  const handleVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      const currentDay = getPortalDayKey();
      if (currentDay !== lastDay) {
        lastDay = currentDay;
        callback();
        window.dispatchEvent(new CustomEvent("juet:quota-changed"));
        window.dispatchEvent(new CustomEvent("juet:refresh-attendance"));
      }
      if (timer) clearTimeout(timer);
      schedule();
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility);
  }
  return () => {
    if (timer) clearTimeout(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibility);
    }
  };
}
