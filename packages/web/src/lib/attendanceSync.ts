import { features } from "@juet/core";
import { client } from "./portal";
import { getCached, setCached, sessionCacheKey, requestFeature, getCacheGeneration, isCacheGenerationCurrent } from "../hooks/useFeature";
import {
  isSubjectDetailComplete,
  parseClassLogs,
  subjectDetailMatchesOverview,
  rowSubId,
  type AttData,
  type AttRow,
} from "./attendanceCalc";
import {
  doesSubjectNeedDeepFetch,
  computeSubjectRowChecksum,
  computeSubjectComponentChecksum,
  hasSubjectCountCoverage,
  isCurrentPortalDay,
  getPortalDayKey,
  FEATURE_TTL,
  type SessionRef,
} from "./portalSchedule";
import type { Semester, Session } from "../types";

type Detail = Record<string, Record<string, unknown>>;

export function getSubjectCacheKey(
  username: string,
  registrationid: string | undefined | null,
  rowOrId: (AttRow & Record<string, unknown>) | string,
  instituteid?: string | null,
): string {
  const subId = typeof rowOrId === "string" ? rowOrId : rowSubId(rowOrId);
  return sessionCacheKey("att.subject", { username, instituteid }, registrationid ?? "default", subId);
}

export interface SubjectDetailCacheEntry {
  data: Detail | null;
  updatedAt: number | null;
  checksum?: string | null;
  componentChecksums?: Record<string, string>;
  provisional?: boolean;
}

export function getCachedSubjectDetailEntry(
  username: string,
  registrationid: string | undefined | null,
  rowOrId: (AttRow & Record<string, unknown>) | string,
  instituteid?: string | null,
): SubjectDetailCacheEntry {
  const key = getSubjectCacheKey(username, registrationid, rowOrId, instituteid);
  const cached = getCached<Detail>(key);
  return {
    data: cached.data,
    updatedAt: cached.updatedAt,
    checksum: typeof cached.checksum === "string" ? cached.checksum : null,
    componentChecksums: cached.componentChecksums as Record<string, string> | undefined,
    provisional: cached.provisional === true,
  };
}

export function setCachedSubjectDetail(
  session: SessionRef,
  registrationid: string | undefined | null,
  row: AttRow & Record<string, unknown>,
  data: Detail,
): number {
  const key = getSubjectCacheKey(
    session.username ? String(session.username) : "",
    registrationid,
    row,
    session.instituteid ? String(session.instituteid) : undefined,
  );
  const checksum = subjectDetailMatchesOverview(row, data) !== false ? computeSubjectRowChecksum(row) : null;
  return setCached(key, data, { checksum });
}

export function subjectDetailRequest(
  session: Session,
  row: AttRow & Record<string, unknown>,
  base: { registrationid?: string | null; registrationcode?: string | null },
) {
  const portalDay = getPortalDayKey();
  const key = sessionCacheKey("att.subject.pending", session, base.registrationid, rowSubId(row));
  const snapshot = JSON.stringify([
    computeSubjectRowChecksum(row),
    base,
    row.individualsubjectcode ?? row.subjectcode,
    ...["L", "T", "P"].map((type) => features.getAttendanceComponentIds(row[`${type}subjectcomponentid`])),
  ]);
  return { key, snapshot, portalDay, version: JSON.stringify([snapshot, portalDay]) };
}

const subjectReads = new Map<string, { active: boolean; unavailable?: unknown; listeners: Set<(error: unknown) => void> }>();

function subjectReadState(request: ReturnType<typeof subjectDetailRequest>) {
  const key = JSON.stringify([getCacheGeneration(), request.key, request.version]);
  let state = subjectReads.get(key);
  if (!state) subjectReads.set(key, state = { active: false, listeners: new Set() });
  const release = () => {
    if (!state!.active && !state!.listeners.size && subjectReads.get(key) === state) subjectReads.delete(key);
  };
  return { state, release };
}

function componentRow(row: AttRow & Record<string, unknown>, type: string) {
  const keys = new RegExp(`^${type}(subjectcomponentid|percentage|totalclass|totalpresent)$`, "i");
  return Object.fromEntries(Object.entries(row).filter(([key]) => keys.test(key)));
}

function componentChecksums(row: AttRow & Record<string, unknown>, base: { registrationcode?: string | null }) {
  return Object.fromEntries(["L", "T", "P"].map((type) => [type, JSON.stringify([
    row.subjectid, row.individualsubjectcode ?? row.subjectcode, base.registrationcode,
    computeSubjectComponentChecksum(row, type),
  ])]));
}

export function detailMetadata(row: AttRow & Record<string, unknown>, base: { registrationcode?: string | null }, provisional: boolean) {
  return {
    checksum: computeSubjectRowChecksum(row),
    provisional,
    ...(!provisional ? { componentChecksums: componentChecksums(row, base) } : {}),
  };
}

export function validSubjectComponent(row: AttRow & Record<string, unknown>, [type, data]: [string, Record<string, unknown>]) {
  return ["L", "T", "P"].includes(type) && features.getAttendanceComponentIds(row[`${type}subjectcomponentid`]).length > 0 &&
    isSubjectDetailComplete({ [`${type}subjectcomponentid`]: row[`${type}subjectcomponentid`] }, { [type]: data });
}

export async function readSubjectDetail(
  session: Session,
  row: AttRow & Record<string, unknown>,
  base: { registrationid?: string | null; registrationcode?: string | null },
  signal?: AbortSignal,
  onProvisional?: () => void,
) {
  const generation = getCacheGeneration();
  const request = subjectDetailRequest(session, row, base);
  const { key, snapshot, portalDay } = request;
  const { state, release } = subjectReadState(request);
  state.active = true;
  const checkpoint = getCached<Detail>(key);
  const saved = getCachedSubjectDetailEntry(session.username ?? "", base.registrationid, row, session.instituteid);
  const checksums = componentChecksums(row, base);
  const validComponent = (entry: [string, Record<string, unknown>]) => validSubjectComponent(row, entry);
  const completed = new Map<string, Record<string, unknown>>();
  const reuse = (data: Detail | null, previous: Record<string, string> | undefined, sameDay: boolean, exact = false) => {
    for (const [type, component] of Object.entries(data ?? {})) {
      if (!validComponent([type, component])) continue;
      const matches = subjectDetailMatchesOverview(componentRow(row, type), { [type]: component });
      if (matches === null && !exact) continue;
      if (matches !== false &&
          (sameDay || hasSubjectCountCoverage(componentRow(row, type))) &&
          (exact || previous?.[type] === checksums[type])) completed.set(type, component);
    }
  };
  if (saved.checksum !== computeSubjectRowChecksum(row)) {
    reuse(saved.data, saved.componentChecksums, isCurrentPortalDay(saved.updatedAt));
  }
  const checkpointMatches = checkpoint.snapshot === snapshot && checkpoint.portalDay === portalDay;
  reuse(checkpoint.data, checkpoint.componentChecksums as Record<string, string> | undefined,
    checkpoint.portalDay === portalDay, checkpointMatches);
  if (isSubjectDetailComplete(row, Object.fromEntries(completed)) &&
      subjectDetailMatchesOverview(row, Object.fromEntries(completed)) === false) completed.clear();
  const reused = [...completed.keys()];
  const current = () => !signal?.aborted && isCacheGenerationCurrent(generation) && getPortalDayKey() === portalDay;
  const saveProgress = () => {
    if (current()) setCached(key, Object.fromEntries([...completed].filter(validComponent)), { snapshot, portalDay, componentChecksums: checksums });
  };
  try {
    const read = () => features.getSubjectAttendanceAll(client, session, row, base, "current", {
      completed, signal, onComponent: saveProgress,
      onUnavailable: (error: unknown) => {
        if (!current()) return;
        state.unavailable = error;
        for (const notify of state.listeners) notify(error);
      },
    });
    let data = await read();
    if (reused.length && current() && isSubjectDetailComplete(row, data) && subjectDetailMatchesOverview(row, data) === false) {
      for (const type of reused) completed.delete(type);
      saveProgress();
      data = await read();
    }
    if (getPortalDayKey() !== portalDay) throw new Error("The portal day changed while loading. Please retry.");
    if (!isSubjectDetailComplete(row, data)) throw new Error("Portal returned incomplete class records");
    if (subjectDetailMatchesOverview(row, data) === false) {
      onProvisional?.();
      return isSubjectDetailComplete(row, saved.data) ? saved.data! : data;
    }
    if (current()) setCached(key, {}, { snapshot, portalDay });
    return data;
  } finally { state.active = false; release(); }
}

export function refreshSubjectDetail(
  session: Session,
  row: AttRow & Record<string, unknown>,
  base: { registrationid?: string | null; registrationcode?: string | null },
  onUnavailable?: (error: unknown) => void,
) {
  const request = subjectDetailRequest(session, row, base);
  const { state, release } = subjectReadState(request);
  let provisional = false;
  if (onUnavailable) {
    state.listeners.add(onUnavailable);
    if (state.unavailable) onUnavailable(state.unavailable);
  }
  return requestFeature(
    getSubjectCacheKey(session.username ?? "", base.registrationid, row, session.instituteid),
    (signal) => readSubjectDetail(session, row, base, signal, () => { provisional = true; }),
    () => detailMetadata(row, base, provisional),
    request.version,
  ).finally(() => {
    if (onUnavailable) state.listeners.delete(onUnavailable);
    release();
  });
}

export interface AttLovData {
  header: { stynumber?: string } | null;
  semesters: Semester[];
}

export function getCachedLov(session: Session): AttLovData | null {
  const cached = getCached<AttLovData>(sessionCacheKey("att.lov", session));
  if (cached.data?.semesters?.length && cached.updatedAt && Date.now() - cached.updatedAt < FEATURE_TTL.lov) {
    return cached.data;
  }
  return null;
}

export function setCachedLov(
  session: Session,
  lov?: { header?: { stynumber?: string } | null; semesters?: Semester[] } | null,
): void {
  if (lov && (lov.header || lov.semesters?.length)) {
    setCached(sessionCacheKey("att.lov", session), {
      header: lov.header ?? null,
      semesters: lov.semesters ?? [],
    });
  }
}

/** Reuse registrations without extending the lifetime of the last real LOV read. */
export async function readAttendanceOverview(session: Session, signal?: AbortSignal) {
  const generation = getCacheGeneration();
  const lov = getCachedLov(session);
  const data = await features.getAttendance(client, session, lov ?? undefined, { signal });
  // Core preserves the supplied semester array when no LOV request was made.
  // A fallback/new lookup supplies a new array and deserves a new timestamp.
  if (!signal?.aborted && isCacheGenerationCurrent(generation) && data.semesters !== lov?.semesters) setCachedLov(session, data);
  return data;
}

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
      session.username ?? "", base.registrationid, row, session.instituteid,
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
        const latest = getCachedSubjectDetailEntry(session.username ?? "", base.registrationid, row, session.instituteid);
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
  const provisional = rows.some((row) => getCachedSubjectDetailEntry(session.username ?? "", base.registrationid, row, session.instituteid).provisional);
  return { changed, errors, complete, provisional };
}

export async function runManualAttendanceRefresh({
  readOverview, baselineRows, ...sync
}: Omit<Parameters<typeof syncAttendanceDetails>[0], "rows" | "base" | "overviewUpdatedAt"> & {
  readOverview: () => Promise<AttData>;
  baselineRows: AttRow[];
}) {
  const portalDay = getPortalDayKey();
  const current = () => !sync.signal?.aborted && (sync.isCurrent?.() ?? true) && getPortalDayKey() === portalDay;
  if (!current()) return null;
  const fresh = await readOverview();
  const overviewUpdatedAt = Date.now();
  if (!current()) return null;
  const semester = fresh?.semesters?.[0];
  if (!fresh?.rows?.length || !semester?.registrationid) throw new Error("Portal returned no attendance records");
  const rowsChanged = attendanceRowsChanged(baselineRows, fresh.rows);
  const result = await syncAttendanceDetails({
    ...sync,
    rows: fresh.rows,
    base: { registrationid: semester.registrationid, registrationcode: semester.registrationcode },
    overviewUpdatedAt,
    forceProvisional: true,
  });
  if (!current()) return null;
  if (!result.complete) throw result.errors[0] ?? new Error("Attendance refresh did not finish. Please try again.");
  return { changed: rowsChanged || result.changed, provisional: result.provisional };
}
