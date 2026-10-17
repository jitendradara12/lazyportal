import { useState, useMemo } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, setCached, getCached, sessionCacheKey, requestFeature } from "../hooks/useFeature";
import {
  isCurrentPortalDay,
  computeSubjectRowChecksum,
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
  combinedAttendance,
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
  const checksum = isSubjectDetailComplete(row, data) ? computeSubjectRowChecksum(row) : null;
  return setCached(key, data, checksum ? { checksum } : undefined);
}

export async function readSubjectDetail(
  session: SectionProps["session"], row: AttRow & Record<string, unknown>,
  base: { registrationid?: string | null; registrationcode?: string | null },
) {
  const data = await features.getSubjectAttendanceAll(client, session, row, base, "current");
  if (!isSubjectDetailComplete(row, data)) throw new Error("Portal returned incomplete class records");
  return data;
}

export function refreshSubjectDetail(
  session: SectionProps["session"], row: AttRow & Record<string, unknown>,
  base: { registrationid?: string | null; registrationcode?: string | null },
) {
  return requestFeature(
    getSubjectCacheKey(session.username, base.registrationid, row, session.instituteid),
    () => readSubjectDetail(session, row, base),
    { checksum: computeSubjectRowChecksum(row) },
  );
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

export function useAttendanceInitial(session: SectionProps["session"]) {
  return useFeature<AttData>({
    run: async () => {
      const lov = getCachedLov(session);
      const data = await features.getAttendance(client, session, lov ?? undefined);
      setCachedLov(session, data);
      return data;
    },
    deps: [session],
    cacheKey: sessionCacheKey("att.initial", session),
    isFresh: isCurrentPortalDay,
    scope: "attendance",
  });
}

export function useAttendanceSummary(session: SectionProps["session"]) {
  const att = useAttendanceInitial(session);
  const rows = att.data?.rows ?? [];
  const semId = att.data?.semesters?.[0]?.registrationid;
  const shortsCount = rows.filter((r) => {
    const entry = getCachedSubjectDetailEntry(session.username, semId != null ? String(semId) : null, r, session.instituteid);
    const isStale = doesSubjectNeedDeepFetch(r, entry.data, entry.updatedAt, entry.checksum);
    const detail = isStale ? null : entry.data;
    return combinedAttendance(r, detail).isShort;
  }).length;
  const badgeText = rows.length > 0
    ? (shortsCount > 0 ? `${shortsCount} short` : "All clear")
    : (att.loading ? "Loading…" : "Subject breakdown");
  return { shortsCount, badgeText, loading: att.loading };
}
