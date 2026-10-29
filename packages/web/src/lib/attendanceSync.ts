import { parseClassLogs } from "./attendanceCalc";
import { doesSubjectNeedDeepFetch, computeSubjectRowChecksum, getPortalDayKey, recordSuccessfulManualRefresh } from "./portalSchedule";
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

async function waitForOpenSheets(signal?: AbortSignal) {
  while (openSheets > 0 && !signal?.aborted) await new Promise<void>((resolve) => {
    const resume = () => {
      resumeListeners.delete(resume);
      signal?.removeEventListener("abort", resume);
      resolve();
    };
    resumeListeners.add(resume);
    signal?.addEventListener("abort", resume, { once: true });
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
  session, rows, base, isCurrent = () => true, onDetail, onProgress, overviewUpdatedAt, signal,
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
}) {
  const queue = rows.map((row) => ({
    row,
    entry: getCachedSubjectDetailEntry(
      session.username, base.registrationid, row, session.instituteid,
    ),
  })).filter(({ row, entry }) => doesSubjectNeedDeepFetch(
    row, entry.data, entry.updatedAt, entry.checksum,
  ));
  const total = queue.length;
  const pending = new Set(queue.map(({ row }) => rowSubId(row)));
  let done = 0;
  let changed = false;
  let phase: AttendanceSyncState["phase"] = "running";
  let syncedAt = overviewUpdatedAt ?? 0;
  const errors: unknown[] = [];
  const current = () => !signal?.aborted && isCurrent();
  const progress = () => { if (isCurrent()) onProgress?.({ phase, pending: new Set(pending), done, total }); };
  progress();
  while (queue.length && phase === "running") {
    if (!current()) { phase = "cancelled"; break; }
    if (openSheets > 0) { phase = "paused"; progress(); }
    await waitForOpenSheets(signal);
    if (!current()) { phase = "cancelled"; break; }
    if (phase === "paused") { phase = "running"; progress(); }
    const { row, entry } = queue.shift()!;
    const id = rowSubId(row);
    try {
      // A sheet may have loaded this queued subject while the worker was
      // busy. Recheck at dequeue time, not just when the batch was created.
      const latest = getCachedSubjectDetailEntry(session.username, base.registrationid, row, session.instituteid);
      const needsRead = doesSubjectNeedDeepFetch(row, latest.data, latest.updatedAt, latest.checksum);
      const result = needsRead ? await waitForHistory(refreshSubjectDetail(session, row, base), signal)
        : { data: latest.data!, updatedAt: latest.updatedAt };
      if (!current()) { phase = "cancelled"; break; }
      syncedAt = Math.max(syncedAt, result.updatedAt ?? 0);
      changed ||= detailSignature(entry.data) !== detailSignature(result.data);
      onDetail?.(id, result.data);
    } catch (error) {
      if (!current()) { phase = "cancelled"; break; }
      errors.push(error);
      if (features.isAttendanceUnavailable(error)) phase = "failed";
    } finally {
      pending.delete(id);
      done++;
      if (phase === "running" && queue.length) progress();
    }
  }
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
  return { changed, errors, complete };
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
  const current = () => !sync.signal?.aborted && (sync.isCurrent?.() ?? true);
  if (!current()) return null;
  const portalDay = getPortalDayKey();
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
  });
  checkpoint.changed ||= result.changed;
  if (!current()) return null;
  if (!result.complete) throw result.errors[0] ?? new Error("Attendance refresh did not finish. Please try again.");
  const changed = Boolean(checkpoint.changed);
  const quota = recordSuccessfulManualRefresh(sync.session, { changed }, policy);
  checkpoint.changed = false;
  return { changed, quota };
}
