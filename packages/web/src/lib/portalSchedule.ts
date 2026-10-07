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
 * Set to 1 by default (1 auto + 1 manual refresh). Easily adjustable via this flag.
 */
export const DAILY_MANUAL_REFRESH_LIMIT = 1;

/**
 * Cutoff hour in Indian Standard Time (IST, UTC+05:30).
 * Set to 2 (02:00 AM IST).
 */
export const PORTAL_DAY_CUTOFF_HOUR_IST = 2;

// IST offset is +05:30. Shifting by (5.5 - 2) = +3.5 hours converts IST cutoff to UTC midnight.
const IST_EFFECTIVE_OFFSET_MS = (5.5 - PORTAL_DAY_CUTOFF_HOUR_IST) * 3600 * 1000; // 12,600,000 ms

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

/**
 * Format milliseconds remaining into human-readable text (e.g. "3h 15m" or "45m").
 */
export function formatTimeUntilReset(ms: number): string {
  if (ms <= 0) return "shortly";
  const hours = Math.floor(ms / (3600 * 1000));
  const minutes = Math.floor((ms % (3600 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
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

export function getQuotaStorageKey(session: { username?: unknown; instituteid?: unknown }): string {
  const user = session.username ? encodeURIComponent(String(session.username)) : "anonymous";
  const inst = session.instituteid ? encodeURIComponent(String(session.instituteid)) : "default";
  return `juet.portal.refresh_quota.${user}:${inst}`;
}

/**
 * Query the remaining manual refresh quota for the current portal day.
 */
export function getManualRefreshQuota(
  session: { username?: unknown; instituteid?: unknown },
  now = Date.now(),
  limit = DAILY_MANUAL_REFRESH_LIMIT
): RefreshQuotaState {
  const portalDay = getPortalDayKey(now);
  const resetsInMs = getMsUntilNextPortalDay(now);
  const key = getQuotaStorageKey(session);

  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.day === portalDay) {
        const used = Math.max(0, Number(parsed.count) || 0);
        const remaining = Math.max(0, limit - used);
        return {
          used,
          total: limit,
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
    total: limit,
    remaining: limit,
    canRefresh: true,
    resetsInMs,
    portalDay,
  };
}

/**
 * Record that a manual refresh successfully completed with real portal data.
 * Must ONLY be called upon successful 200 response with non-empty rows.
 * Failed, aborted, or offline attempts MUST NOT call this.
 */
export function recordSuccessfulManualRefresh(
  session: { username?: unknown; instituteid?: unknown },
  now = Date.now(),
  limit = DAILY_MANUAL_REFRESH_LIMIT
): RefreshQuotaState {
  const current = getManualRefreshQuota(session, now, limit);
  const nextUsed = current.used + 1;
  const key = getQuotaStorageKey(session);
  const nextState: RefreshQuotaState = {
    used: nextUsed,
    total: limit,
    remaining: Math.max(0, limit - nextUsed),
    canRefresh: nextUsed < limit,
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

export const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Fast composite row checksum to determine if attendance breakdown has changed.
 * Captures all component counts, totals, and percentages.
 */
export function computeSubjectRowChecksum(r: Record<string, unknown>): string {
  const subId = String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode ?? "");
  const Ltot = String(r.Ltotalclass ?? r.LTotalclass ?? r.ltotalclass ?? "");
  const Lpres = String(r.Ltotalpresent ?? r.LTotalpresent ?? r.ltotalpresent ?? "");
  const Lpct = String(r.Lpercentage ?? "");
  const Ttot = String(r.Ttotalclass ?? r.TTotalclass ?? r.ttotalclass ?? "");
  const Tpres = String(r.Ttotalpresent ?? r.TTotalpresent ?? r.ttotalpresent ?? "");
  const Tpct = String(r.Tpercentage ?? "");
  const Ptot = String(r.Ptotalclass ?? r.PTotalclass ?? r.ptotalclass ?? "");
  const Ppres = String(r.Ptotalpresent ?? r.PTotalpresent ?? r.ptotalpresent ?? "");
  const Ppct = String(r.Ppercentage ?? "");
  const tot = String(r.totalclass ?? r.totalclasses ?? r.Totalclass ?? "");
  const pres = String(r.totalpresent ?? r.Totalpresent ?? "");
  return `${subId}|${tot}|${pres}|${Ltot}:${Lpres}:${Lpct}|${Ttot}:${Tpres}:${Tpct}|${Ptot}:${Ppres}:${Ppct}`;
}

export function doesSubjectNeedDeepFetch(
  r: Record<string, unknown>,
  cached: Record<string, Record<string, unknown>> | null,
  cachedUpdatedAt: number | null,
  cachedChecksum?: string | null
): boolean {
  if (!cached || Object.keys(cached).length === 0) return true;
  const currentChecksum = computeSubjectRowChecksum(r);
  if (cachedChecksum) {
    return cachedChecksum !== currentChecksum;
  }
  // Backward compatibility when checksum was not yet stored in cache
  const rowTotal = Number(r.totalclass ?? r.totalclasses ?? r.Totalclass ?? 0);
  if (rowTotal > 0) {
    let cachedTotal = 0;
    for (const comp of Object.values(cached)) {
      if (comp && typeof comp === "object") {
        if (Array.isArray(comp)) {
          cachedTotal += comp.length;
        } else {
          const list = (comp as Record<string, unknown>).student_attdsummarylist ??
            (comp as Record<string, unknown>).attdsummarylist ??
            (comp as Record<string, unknown>).rows;
          if (Array.isArray(list)) {
            cachedTotal += list.length;
          } else {
            cachedTotal += Number(
              (comp as Record<string, unknown>).totalclass ??
              (comp as Record<string, unknown>).totalclasses ??
              (comp as Record<string, unknown>).Totalclass ?? 0
            );
          }
        }
      }
    }
    if (cachedTotal > 0 && rowTotal !== cachedTotal) return true;
  }
  if (!cachedUpdatedAt || Date.now() - cachedUpdatedAt > STALE_MS) {
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
