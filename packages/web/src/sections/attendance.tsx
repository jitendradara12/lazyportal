import { useState, useMemo, useEffect } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, setCached, getCached, sessionCacheKey, requestFeature, getCacheGeneration, isCacheGenerationCurrent } from "../hooks/useFeature";
import {
  isCurrentPortalDay,
  getPortalDayKey,
  computeSubjectRowChecksum,
  computeSubjectComponentChecksum,
  hasSubjectCountCoverage,
  doesSubjectNeedDeepFetch,
  FEATURE_TTL,
  type SessionRef,
} from "../lib/portalSchedule";
import {
  titleCase,
  parseIndianDateTime,
} from "../components/DataViews";
import {
  type ClassRecord,
  cleanDateTime,
  isSubjectDetailComplete,
  parseClassLogs,
  subjectDetailMatchesOverview,
} from "../lib/attendanceCalc";
import type { SectionProps, Semester } from "../types";

export interface AttRow {
  subjectcode?: string;
  subjectid?: string | number;
  individualsubjectcode?: string;
  Lsubjectcomponentid?: string;
  Tsubjectcomponentid?: string;
  Psubjectcomponentid?: string;
  Lpercentage?: string | number;
  Tpercentage?: string | number;
  Ppercentage?: string | number;
  LTpercantage?: string | number;
  LTpercentage?: string | number;
}

export interface AttData {
  header: { stynumber?: string } | null;
  semesters: Semester[];
  registrationcode?: string | null;
  rows: AttRow[];
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatClassDateTime(dt?: string): string {
  if (!dt) return "—";
  const ms = parseIndianDateTime(dt);
  if (!ms) return cleanDateTime(dt);
  const d = new Date(ms);
  const day = d.getDate();
  const month = MONTH_NAMES[d.getMonth()];
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const minStr = minutes < 10 ? `0${minutes}` : String(minutes);
  return `${day} ${month}, ${hours}:${minStr} ${ampm}`;
}

export function CombinedClassLog({
  data,
}: {
  data: Record<string, unknown>;
}) {
  const [filter, setFilter] = useState<"all" | "absent" | "present">("all");

  const { total, attended, absent, allClasses } = useMemo(() => {
    const parsedEntries = Object.entries(data)
      .map(([type, raw]) => ({ type, stats: parseClassLogs(raw, type) }))
      .filter((item): item is { type: string; stats: NonNullable<ReturnType<typeof parseClassLogs>> } => item.stats !== null);

    let tot = 0;
    let att = 0;
    const classes: { record: ClassRecord; ts: number }[] = [];

    for (const { stats } of parsedEntries) {
      tot += stats.total;
      att += stats.attended;
      for (const c of stats.classes) {
        classes.push({ record: c, ts: parseIndianDateTime(c.datetime) ?? 0 });
      }
    }

    classes.sort((a, b) => b.ts - a.ts);

    return {
      total: tot,
      attended: att,
      absent: tot - att,
      allClasses: classes.map((item) => item.record),
    };
  }, [data]);

  if (total === 0 && allClasses.length === 0) {
    return <p className="muted">No class records available.</p>;
  }

  const filtered = allClasses.filter((c) => {
    if (filter === "absent") return !c.isAttended;
    if (filter === "present") return c.isAttended;
    return true;
  });

  return (
    <div className="att-comp-box" onClick={(e) => e.stopPropagation()}>
      {allClasses.length > 0 && (
        <>
          <div className="filter-chips">
            <button
              type="button"
              className={`chip-btn ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All ({total})
            </button>
            {absent > 0 && (
              <button
                type="button"
                className={`chip-btn chip-absent ${filter === "absent" ? "active" : ""}`}
                onClick={() => setFilter("absent")}
              >
                Absent ({absent})
              </button>
            )}
            <button
              type="button"
              className={`chip-btn ${filter === "present" ? "active" : ""}`}
              onClick={() => setFilter("present")}
            >
              Present ({attended})
            </button>
          </div>

          <div className="att-log-list" role="list">
            {filtered.map((c, i) => (
              <div
                key={i}
                className={`att-log-row ${c.isAttended ? "row-present" : "row-absent"}`}
                role="listitem"
              >
                <div className="att-log-info">
                  <span className="att-log-date">{formatClassDateTime(c.datetime)}</span>
                  {c.type && <span className="att-log-type-tag">{c.type}</span>}
                </div>
                <span className={`log-badge ${c.isAttended ? "present" : "absent"}`}>
                  {c.isAttended ? "Present" : "Absent"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function subjectName(code?: string): { name: string; badge: string } {
  if (!code) return { name: "", badge: "" };
  const m = code.match(/^(.+?)\(([^)]+)\)$/);
  if (m) return { name: titleCase(m[1].trim()), badge: m[2] };
  return { name: titleCase(code), badge: "" };
}

/** Stable per-row subject id for cache keys, sync sets, and React keys. */
export function rowSubId(r?: Record<string, unknown> | null): string {
  if (!r) return "";
  return String(r.subjectid ?? r.individualsubjectcode ?? r.subjectcode ?? "");
}

export const subjectRowId = rowSubId;

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
  data: Record<string, Record<string, unknown>> | null;
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
  const cached = getCached<Record<string, Record<string, unknown>>>(key);
  return {
    data: cached.data,
    updatedAt: cached.updatedAt,
    checksum: typeof cached.checksum === "string" ? cached.checksum : null,
    componentChecksums: cached.componentChecksums as Record<string, string> | undefined,
    provisional: cached.provisional === true,
  };
}

export function getCachedSubjectDetail(
  username: string,
  registrationid: string | undefined | null,
  rowOrId: (AttRow & Record<string, unknown>) | string,
  instituteid?: string | null,
): Record<string, Record<string, unknown>> | null {
  return getCachedSubjectDetailEntry(username, registrationid, rowOrId, instituteid).data;
}

export function setCachedSubjectDetail(
  session: SessionRef,
  registrationid: string | undefined | null,
  row: AttRow & Record<string, unknown>,
  data: Record<string, Record<string, unknown>>,
): number {
  const key = getSubjectCacheKey(
    session.username ? String(session.username) : undefined,
    registrationid,
    row,
    session.instituteid ? String(session.instituteid) : undefined,
  );
  const checksum = subjectDetailMatchesOverview(row, data) !== false ? computeSubjectRowChecksum(row) : null;
  return setCached(key, data, { checksum });
}

function subjectDetailRequest(
  session: SectionProps["session"], row: AttRow & Record<string, unknown>,
  base: { registrationid?: string | null; registrationcode?: string | null },
) {
  const portalDay = getPortalDayKey();
  const key = sessionCacheKey("att.subject.pending", session, base.registrationid, rowSubId(row));
  const snapshot = JSON.stringify([computeSubjectRowChecksum(row), base,
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
  return Object.fromEntries(["L", "T", "P"].map(type => [type, JSON.stringify([
    row.subjectid, row.individualsubjectcode ?? row.subjectcode, base.registrationcode,
    computeSubjectComponentChecksum(row, type),
  ])]));
}

function detailMetadata(row: AttRow & Record<string, unknown>, base: { registrationcode?: string | null }, provisional: boolean) {
  return { checksum: computeSubjectRowChecksum(row), provisional,
    ...(!provisional ? { componentChecksums: componentChecksums(row, base) } : {}),
  };
}

function validSubjectComponent(row: AttRow & Record<string, unknown>, [type, data]: [string, Record<string, unknown>]) {
  return ["L", "T", "P"].includes(type) && features.getAttendanceComponentIds(row[`${type}subjectcomponentid`]).length > 0 &&
    isSubjectDetailComplete({ [`${type}subjectcomponentid`]: row[`${type}subjectcomponentid`] }, { [type]: data });
}

export async function readSubjectDetail(
  session: SectionProps["session"], row: AttRow & Record<string, unknown>,
  base: { registrationid?: string | null; registrationcode?: string | null },
  signal?: AbortSignal,
  onProvisional?: () => void,
) {
  const generation = getCacheGeneration();
  const request = subjectDetailRequest(session, row, base);
  const { key, snapshot, portalDay } = request;
  const { state, release } = subjectReadState(request);
  state.active = true;
  const checkpoint = getCached<Record<string, Record<string, unknown>>>(key);
  const saved = getCachedSubjectDetailEntry(session.username, base.registrationid, row, session.instituteid);
  const checksums = componentChecksums(row, base);
  const validComponent = (entry: [string, Record<string, unknown>]) => validSubjectComponent(row, entry);
  const completed = new Map<string, Record<string, unknown>>();
  const reuse = (data: Record<string, Record<string, unknown>> | null, previous: Record<string, string> | undefined, sameDay: boolean, exact = false) => {
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
  const current = () => !signal?.aborted && isCacheGenerationCurrent(generation) && getPortalDayKey() === portalDay;
  const saveProgress = () => {
    if (current()) setCached(key, Object.fromEntries([...completed].filter(validComponent)), { snapshot, portalDay, componentChecksums: checksums });
  };
  try {
    const data = await features.getSubjectAttendanceAll(client, session, row, base, "current", {
      completed, signal, onComponent: saveProgress,
      onUnavailable: (error: unknown) => {
        if (!current()) return;
        state.unavailable = error;
        for (const notify of state.listeners) notify(error);
      },
    });
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

/** Full saved history stays visible; a first load can show completed components. */
export function useSubjectDetail(
  session: SectionProps["session"], row: AttRow & Record<string, unknown>,
  base: { registrationid?: string | null; registrationcode?: string | null },
) {
  const checksum = computeSubjectRowChecksum(row);
  const { key, snapshot, portalDay, version } = subjectDetailRequest(session, row, base);
  const validation = { provisional: false };
  const [, updateProgress] = useState(0);
  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === key) updateProgress(n => n + 1);
    };
    window.addEventListener("juet:cache-updated", update);
    return () => window.removeEventListener("juet:cache-updated", update);
  }, [key]);
  const detail = useFeature<Record<string, Record<string, unknown>>>({
    run: signal => readSubjectDetail(session, row, base, signal, () => { validation.provisional = true; }),
    deps: [session, base.registrationid, base.registrationcode, rowSubId(row), checksum],
    cacheKey: getSubjectCacheKey(session.username, base.registrationid, row, session.instituteid),
    requestVersion: version,
    isFresh: () => {
      const entry = getCachedSubjectDetailEntry(session.username, base.registrationid, row, session.instituteid);
      return !doesSubjectNeedDeepFetch(row, entry.data, entry.updatedAt, entry.checksum, Date.now(), entry.provisional);
    },
    writeExtra: () => detailMetadata(row, base, validation.provisional),
  });
  const progress = getCached<Record<string, Record<string, unknown>>>(key);
  const partial = useMemo(() => progress.snapshot === snapshot && progress.portalDay === portalDay
    ? Object.fromEntries(Object.entries(progress.data ?? {}).filter(entry => validSubjectComponent(row, entry))) : {},
  [progress.data, progress.snapshot, progress.portalDay, snapshot, portalDay, row]);
  return { ...detail, data: detail.data ?? (Object.keys(partial).length ? partial : null) };
}

export function refreshSubjectDetail(
  session: SectionProps["session"], row: AttRow & Record<string, unknown>,
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
    getSubjectCacheKey(session.username, base.registrationid, row, session.instituteid),
    signal => readSubjectDetail(session, row, base, signal, () => { provisional = true; }),
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

export function getCachedLov(session: SectionProps["session"]): AttLovData | null {
  const cached = getCached<AttLovData>(sessionCacheKey("att.lov", session));
  if (cached.data?.semesters?.length && cached.updatedAt && Date.now() - cached.updatedAt < FEATURE_TTL.lov) {
    return cached.data;
  }
  return null;
}

export function setCachedLov(
  session: SectionProps["session"],
  lov?: { header?: { stynumber?: string } | null; semesters?: Semester[] } | null
): void {
  if (lov && (lov.header || lov.semesters?.length)) {
    setCached(sessionCacheKey("att.lov", session), {
      header: lov.header ?? null,
      semesters: lov.semesters ?? [],
    });
  }
}

/** Reuse registrations without extending the lifetime of the last real LOV read. */
export async function readAttendanceOverview(session: SectionProps["session"], signal?: AbortSignal) {
  const generation = getCacheGeneration();
  const lov = getCachedLov(session);
  const data = await features.getAttendance(client, session, lov ?? undefined, { signal });
  // Core preserves the supplied semester array when no LOV request was made.
  // A fallback/new lookup supplies a new array and deserves a new timestamp.
  if (!signal?.aborted && isCacheGenerationCurrent(generation) && data.semesters !== lov?.semesters) setCachedLov(session, data);
  return data;
}

export function useAttendanceInitial(session: SectionProps["session"]) {
  return useFeature<AttData>({
    run: signal => readAttendanceOverview(session, signal),
    deps: [session],
    cacheKey: sessionCacheKey("att.initial", session),
    isFresh: isCurrentPortalDay,
    scope: "attendance",
  });
}
