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
  let used = 0;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.day === portalDay) {
        const countNum = Number(parsed.count);
        used = Number.isFinite(countNum)
          ? Math.min(Math.max(0, Math.floor(countNum)), DAILY_MANUAL_REFRESH_LIMIT)
          : 0;
      }
    }
  } catch {}
  const remaining = Math.max(0, DAILY_MANUAL_REFRESH_LIMIT - used);
  return { used, total: DAILY_MANUAL_REFRESH_LIMIT, remaining, canRefresh: remaining > 0, resetsInMs, portalDay };
}

/**
 * Record that a manual refresh successfully completed with real portal data.
 * Must ONLY be called upon successful 200 response with non-empty rows.
 * Failed, aborted, or offline attempts MUST NOT call this.
 * Only deducts quota when attendance actually changed (or when new subject details were fetched / changed).
 * If 0 subjects or rows changed (changed === false), does not burn the user's manual refresh quota.
 */
export function recordSuccessfulManualRefresh(
  session?: SessionRef | null,
  options?: { changed?: boolean; now?: number } | number
): RefreshQuotaState {
  let now = Date.now();
  let changed = true;

  if (typeof options === "number") {
    now = options;
  } else if (typeof options === "object" && options !== null) {
    if (typeof options.now === "number") now = options.now;
    if (typeof options.changed === "boolean") changed = options.changed;
  }

  const current = getManualRefreshQuota(session, now);
  if (!changed) {
    return current;
  }

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
  now = Date.now(),
  options?: { allowFetchIfNotUpdatedToday?: boolean } | boolean
): boolean {
  if (!cached || Object.keys(cached).length === 0) return true;
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
