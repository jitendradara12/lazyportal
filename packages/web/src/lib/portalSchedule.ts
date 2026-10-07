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
 * Set to 1 by default (1 auto + 1 manual refresh). Easily adjustable via this constant or env.
 */
const envLimit =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_DAILY_MANUAL_REFRESH_LIMIT
    ? Number(import.meta.env.VITE_DAILY_MANUAL_REFRESH_LIMIT)
    : typeof process !== "undefined" && process.env?.DAILY_MANUAL_REFRESH_LIMIT
    ? Number(process.env.DAILY_MANUAL_REFRESH_LIMIT)
    : NaN;

export const DAILY_MANUAL_REFRESH_LIMIT =
  Number.isFinite(envLimit) && envLimit >= 0 ? Math.floor(envLimit) : 1;

/**
 * Cutoff hour in Indian Standard Time (IST, UTC+05:30).
 * Set to 2 (02:00 AM IST).
 */
export const PORTAL_DAY_CUTOFF_HOUR_IST = 2;

// IST offset is +05:30. Shifting by (5.5 - 2) = +3.5 hours converts IST cutoff to UTC midnight.
const IST_EFFECTIVE_OFFSET_MS = (5.5 - PORTAL_DAY_CUTOFF_HOUR_IST) * 3600 * 1000; // 12,600,000 ms

/** Shared session reference structure for quota and cache keys */
export interface SessionRef {
  username?: unknown;
  instituteid?: unknown;
}

/** Centralized TTL policies across features to avoid shotgun updates */
export const FEATURE_TTL = {
  attendance: "portal-day",
  marks: 12 * 60 * 60 * 1000, // 12 hours (entered in bursts post-exam)
  exams: 24 * 60 * 60 * 1000, // 24 hours (published days before exams)
  faculty: 7 * 24 * 60 * 60 * 1000, // 7 days (static semester registration)
  subjects: 7 * 24 * 60 * 60 * 1000, // 7 days (static course catalog)
  default: 2 * 60 * 60 * 1000, // 2 hours default
} as const;

/**
 * Get the portal day key (e.g. "2026-10-07") for a timestamp or Date in IST.
 * 01:59 AM IST on Oct 7 belongs to portal day 2026-10-06.
 * 02:00 AM IST on Oct 7 starts portal day 2026-10-07.
 */
export function getPortalDayKey(date?: Date | number): string {
  const ts = typeof date === "number" ? date : (date instanceof Date ? date.getTime() : Date.now());
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

/** Reusable freshness predicate for useFeature hooks */
export const isPortalDayFresh = (updatedAt: number | null): boolean => isCurrentPortalDay(updatedAt);

/**
 * Calculate the exact timestamp when the next portal day begins (upcoming 02:00 AM IST).
 */
export function getNextPortalResetTimestamp(now?: Date | number): number {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : Date.now());
  const effective = nowMs + IST_EFFECTIVE_OFFSET_MS;
  const d = new Date(effective);
  const nextUtcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  return nextUtcMidnight - IST_EFFECTIVE_OFFSET_MS;
}

/**
 * Milliseconds remaining until the next 02:00 AM IST portal reset.
 */
export function getMsUntilNextPortalDay(now?: Date | number): number {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : Date.now());
  const nextReset = getNextPortalResetTimestamp(nowMs);
  return Math.max(0, nextReset - nowMs);
}

/**
 * Format milliseconds remaining into human-readable text (e.g. "3h 15m" or "45m").
 */
export function formatTimeUntilReset(ms: number): string {
  if (ms <= 0) return "shortly";
  const hours = Math.floor(ms / (3600 * 1000));
  const minutes = Math.floor((ms % (3600 * 1000)) / (60 * 1000));
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export interface RefreshQuotaState {
  used: number;
  total: number;
  remaining: number;
  canRefresh: boolean;
  resetsInMs: number;
  portalDay: string;
}

export function getQuotaStorageKey(session?: SessionRef | null): string {
  const user = session?.username ? encodeURIComponent(String(session.username).trim().toUpperCase()) : "anonymous";
  const inst = session?.instituteid != null ? encodeURIComponent(String(session.instituteid)) : "default";
  return `juet.portal.refresh_quota.${user}:${inst}`;
}

/**
 * Query the remaining manual refresh quota for the current portal day.
 */
export function getManualRefreshQuota(session?: SessionRef | null, now = Date.now()): RefreshQuotaState {
  const portalDay = getPortalDayKey(now);
  const resetsInMs = getMsUntilNextPortalDay(now);
  const key = getQuotaStorageKey(session);

  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.day === portalDay) {
        const countNum = Number(parsed.count);
        const used = Number.isFinite(countNum)
          ? Math.min(Math.max(0, Math.floor(countNum)), DAILY_MANUAL_REFRESH_LIMIT)
          : 0;
        const remaining = Math.max(0, DAILY_MANUAL_REFRESH_LIMIT - used);
        return {
          used,
          total: DAILY_MANUAL_REFRESH_LIMIT,
          remaining,
          canRefresh: remaining > 0,
          resetsInMs,
          portalDay,
        };
      }
    }
  } catch {}

  return {
    used: 0,
    total: DAILY_MANUAL_REFRESH_LIMIT,
    remaining: DAILY_MANUAL_REFRESH_LIMIT,
    canRefresh: DAILY_MANUAL_REFRESH_LIMIT > 0,
    resetsInMs,
    portalDay,
  };
}

/**
 * Record that a manual refresh successfully completed with real portal data.
 * Must ONLY be called upon successful 200 response with non-empty rows.
 * Failed, aborted, or offline attempts MUST NOT call this.
 */
export function recordSuccessfulManualRefresh(session?: SessionRef | null, now = Date.now()): RefreshQuotaState {
  const current = getManualRefreshQuota(session, now);
  const nextUsed = Math.min(DAILY_MANUAL_REFRESH_LIMIT, current.used + 1);
  const key = getQuotaStorageKey(session);
  const nextState: RefreshQuotaState = {
    used: nextUsed,
    total: DAILY_MANUAL_REFRESH_LIMIT,
    remaining: Math.max(0, DAILY_MANUAL_REFRESH_LIMIT - nextUsed),
    canRefresh: nextUsed < DAILY_MANUAL_REFRESH_LIMIT,
    resetsInMs: current.resetsInMs,
    portalDay: current.portalDay,
  };

  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, JSON.stringify({ day: current.portalDay, count: nextUsed }));
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("juet:quota-changed"));
    }
  } catch {}

  return nextState;
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
  const overall = pick(row, "overallattendance", "percentage", "attendance");
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
  now = Date.now()
): boolean {
  if (!cached || Object.keys(cached).length === 0) return true;
  const currentChecksum = computeSubjectRowChecksum(row);
  if (cachedChecksum) {
    if (cachedChecksum !== currentChecksum) return true;
    // Bounded max TTL: even if checksum matches, entries older than 7 days (or missing timestamp) allow a periodic refresh
    if (!cachedUpdatedAt || now - cachedUpdatedAt > FEATURE_TTL.subjects) return true;
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
  if (!cachedUpdatedAt || now - cachedUpdatedAt > FEATURE_TTL.subjects) {
    return true;
  }
  return false;
}

/**
 * Format the user-facing quota tooltip or banner.
 */
export function formatQuotaStatus(quota: RefreshQuotaState): string {
  if (quota.canRefresh) {
    if (quota.total === 1) {
      return "1 refresh available today";
    }
    return `${quota.remaining}/${quota.total} refreshes remaining today`;
  }
  return `Daily refresh limit used (resets in ${formatTimeUntilReset(quota.resetsInMs)} at 2:00 AM IST)`;
}

/**
 * Automatically roll over quota and trigger revalidation when a tab is kept open overnight across 02:00 AM IST.
 */
export function subscribePortalDayRollover(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    const ms = getMsUntilNextPortalDay() + 500;
    timer = setTimeout(() => {
      callback();
      window.dispatchEvent(new CustomEvent("juet:quota-changed"));
      schedule();
    }, ms);
  };
  schedule();
  const handleVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      callback();
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
