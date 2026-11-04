import { parseClassLogs } from "./attendanceCalc";
import { doesSubjectNeedDeepFetch, computeSubjectRowChecksum, getPortalDayKey, getManualRefreshQuota, recordSuccessfulManualRefresh } from "./portalSchedule";
import { getCachedSubjectDetailEntry, refreshSubjectDetail, rowSubId, type AttRow } from "../sections/attendance";
import type { Session } from "../types";
import type { AttData } from "../sections/attendance";
import type { RefreshPolicy } from "./refreshPolicy";
import { features } from "@juet/core";

type Detail = Record<string, Record<string, unknown>>;

export interface AttendanceSyncState {
  phase: "idle" | "running" | "paused" | "complete" | "failed" | "cancelled";
  pending: Set<string>;
  done: number;
  total: number;
}

export function idleAttendanceSync(): AttendanceSyncState {
  return { phase: "idle", pending: new Set(), done: 0, total: 0 };
}

let openSheets = 0;
const resumeListeners = new Set<() => void>();

/** Let the open subject use the network before starting another queued subject. */
export function pauseAttendanceSync() {
  openSheets++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openSheets--;
    if (openSheets === 0) {
      for (const resume of resumeListeners) resume();
      resumeListeners.clear();
    }
  };
}

async function waitForOpenSheets(signal?: AbortSignal, stopped?: AbortSignal) {
  while (openSheets > 0 && !signal?.aborted && !stopped?.aborted) await new Promise<void>((resolve) => {
    const resume = () => {
      resumeListeners.delete(resume);
      signal?.removeEventListener("abort", resume);
      stopped?.removeEventListener("abort", resume);
      resolve();
    };
    resumeListeners.add(resume);
    signal?.addEventListener("abort", resume, { once: true });
    stopped?.addEventListener("abort", resume, { once: true });
  });
}

async function waitForHistory<T>(read: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return read;
  let abort: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([read, cancelled]); }
  finally { signal.removeEventListener("abort", abort!); }
}

/** Preserve change detection across retries within the same portal day. */
export interface ManualAttendanceRefreshCheckpoint {
  portalDay?: string;
  changed?: boolean;
}

/** Compare attendance records, not response metadata or array/property order. */
export function detailSignature(detail: Detail | null) {
  if (!detail) return null;
  return JSON.stringify(["L", "T", "P"].map((type) => {
    const parsed = parseClassLogs(detail[type], type);
    return parsed ? [type, parsed.total, parsed.attended,
      parsed.classes.map((r) => `${r.datetime}|${r.isAttended}`).sort()] : [type, 0, 0];
  }));
}

export function attendanceRowsChanged(before: AttRow[], after: AttRow[]) {
  const checksums = new Map(before.map((r) => [rowSubId(r), computeSubjectRowChecksum(r)]));
  return before.length !== after.length || after.some((r) => checksums.get(rowSubId(r)) !== computeSubjectRowChecksum(r));
}

/** All syncs use overview checksums to avoid refetching unchanged history. */
export async function syncAttendanceDetails({
  session, rows, base, isCurrent = () => true, onDetail, onProgress, overviewUpdatedAt, signal, forceProvisional = false,
}: {
  session: Session;
  rows: AttRow[];
  base: { registrationid?: string | null; registrationcode?: string | null };
  isCurrent?: () => boolean;
  onDetail?: (id: string, data: Detail) => void;
  onProgress?: (state: AttendanceSyncState) => void;
  signal?: AbortSignal;
  /** Time of the real overview read, so cache-only visits cannot claim a new sync. */
  overviewUpdatedAt?: number | null;
  forceProvisional?: boolean;
}) {
  const queue = rows.map((row) => ({
    row,
    entry: getCachedSubjectDetailEntry(
      session.username, base.registrationid, row, session.instituteid,
    ),
  })).filter(({ row, entry }) => (forceProvisional && entry.provisional) || doesSubjectNeedDeepFetch(
    row, entry.data, entry.updatedAt, entry.checksum, Date.now(), entry.provisional,
  )).sort((a, b) => Number(features.hasSubjectAttendanceRequests(a.row)) - Number(features.hasSubjectAttendanceRequests(b.row)));
  const total = queue.length;
  const pending = new Set(queue.map(({ row }) => rowSubId(row)));
  let done = 0;
  let changed = false;
  let phase: AttendanceSyncState["phase"] = "running";
  let syncedAt = overviewUpdatedAt ?? 0;
  const errors: unknown[] = [];
  const portalDay = getPortalDayKey();
  const current = () => !signal?.aborted && isCurrent() && getPortalDayKey() === portalDay;
  const canStart = () => phase === "running" || phase === "paused";
  const stopped = new AbortController();
  const stop = (next: "failed" | "cancelled") => { phase = next; stopped.abort(); };
  const progress = () => { if (isCurrent()) onProgress?.({ phase, pending: new Set(pending), done, total }); };
  progress();
  const worker = async () => {
    while (queue.length && canStart()) {
      if (!current()) { stop("cancelled"); break; }
      if (features.hasSubjectAttendanceRequests(queue[0].row)) {
        if (openSheets > 0 && phase !== "paused") { phase = "paused"; progress(); }
        await waitForOpenSheets(signal, stopped.signal);
      }
      if (!current()) { stop("cancelled"); break; }
      if (!canStart()) break;
      if (phase === "paused" && openSheets === 0) { phase = "running"; progress(); }
      const next = queue.shift();
      if (!next) break;
      const { row, entry } = next;
      const id = rowSubId(row);
      try {
        // A sheet may have loaded this queued subject while the worker was
        // busy. Recheck at dequeue time, not just when the batch was created.
        const latest = getCachedSubjectDetailEntry(session.username, base.registrationid, row, session.instituteid);
        const needsRead = (forceProvisional && latest.provisional) || doesSubjectNeedDeepFetch(row, latest.data, latest.updatedAt, latest.checksum, Date.now(), latest.provisional);
        const result = needsRead ? await waitForHistory(refreshSubjectDetail(session, row, base, () => {
          if (current() && canStart()) stop("failed");
        }), signal)
          : { data: latest.data!, updatedAt: latest.updatedAt };
        if (!current()) { stop("cancelled"); break; }
        syncedAt = Math.max(syncedAt, result.updatedAt ?? 0);
        changed ||= detailSignature(entry.data) !== detailSignature(result.data);
        onDetail?.(id, result.data);
      } catch (error) {
        if (!current()) { stop("cancelled"); break; }
        errors.push(error);
        if (features.isAttendanceUnavailable(error)) stop("failed");
      } finally {
        pending.delete(id);
        done++;
        if (canStart() && done < total) progress();
      }
    }
  };
  // Overlap slow subjects without launching the entire semester at once.
  await Promise.all(Array.from({ length: Math.min(5, total) }, worker));
  const complete = current() && errors.length === 0 && done === total;
  phase = !current() ? "cancelled" : complete ? "complete" : "failed";
  progress();
  if (complete && syncedAt > 0) {
    try {
      const previous = Number(localStorage.getItem("juet.portal.last_sync"));
      if (!Number.isFinite(previous) || syncedAt > previous) {
        localStorage.setItem("juet.portal.last_sync", String(syncedAt));
        window.dispatchEvent(new CustomEvent("juet:sync"));
      }
    } catch {}
  }
  const provisional = rows.some(row => getCachedSubjectDetailEntry(session.username, base.registrationid, row, session.instituteid).provisional);
  return { changed, errors, complete, provisional };
}

/** A failed/cancelled batch keeps successful cache writes, but spends no quota. */
export async function runManualAttendanceRefresh({
  readOverview, baselineRows, checkpoint = {}, policy, ...sync
}: Omit<Parameters<typeof syncAttendanceDetails>[0], "rows" | "base" | "overviewUpdatedAt"> & {
  readOverview: () => Promise<AttData>;
  baselineRows: AttRow[];
  checkpoint?: ManualAttendanceRefreshCheckpoint;
  policy?: RefreshPolicy;
}) {
  const portalDay = getPortalDayKey();
  const current = () => !sync.signal?.aborted && (sync.isCurrent?.() ?? true) && getPortalDayKey() === portalDay;
  if (!current()) return null;
  if (checkpoint.portalDay !== portalDay) {
    checkpoint.changed = false;
    checkpoint.portalDay = portalDay;
  }
  const fresh = await readOverview();
  const overviewUpdatedAt = Date.now();
  if (!current()) return null;
  const semester = fresh?.semesters?.[0];
  if (!fresh?.rows?.length || !semester?.registrationid) throw new Error("Portal returned no attendance records");
  checkpoint.changed ||= attendanceRowsChanged(baselineRows, fresh.rows);
  const result = await syncAttendanceDetails({
    ...sync, rows: fresh.rows,
    base: { registrationid: semester.registrationid, registrationcode: semester.registrationcode },
    overviewUpdatedAt,
    forceProvisional: true,
  });
  checkpoint.changed ||= result.changed;
  if (!current()) return null;
  if (!result.complete) throw result.errors[0] ?? new Error("Attendance refresh did not finish. Please try again.");
  const changed = Boolean(checkpoint.changed);
  const quota = result.provisional ? getManualRefreshQuota(sync.session, undefined, policy)
    : recordSuccessfulManualRefresh(sync.session, { changed }, policy);
  if (!result.provisional) checkpoint.changed = false;
  return { changed, quota, provisional: result.provisional };
}
