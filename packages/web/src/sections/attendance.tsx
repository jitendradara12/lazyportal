import { Fragment, useEffect, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, setCached, getCached, sessionCacheKey } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import {
  isCurrentPortalDay,
  computeSubjectRowChecksum,
  doesSubjectNeedDeepFetch,
  FEATURE_TTL,
  type SessionRef,
} from "../lib/portalSchedule";
import {
  CollapsibleCard,
  SectionError,
  useCardState,
  titleCase,
  formatSemester,
  parseIndianDateTime,
} from "../components/DataViews";
import {
  type AttColorClass,
  type BunkMargin,
  type ClassRecord,
  type CombinedAttResult,
  cleanDateTime,
  pct,
  getColorClass,
  computeBunkMargin,
  isSubjectDetailComplete,
  parseClassLogs,
  combinedAttendance,
} from "../lib/attendanceCalc";

export {
  type AttColorClass,
  type BunkMargin,
  type ClassRecord,
  type CombinedAttResult,
  cleanDateTime,
  pct,
  getColorClass,
  computeBunkMargin,
  isSubjectDetailComplete,
  parseClassLogs,
  combinedAttendance,
};
import type { SectionProps, Semester } from "../types";

export interface AttRow {
  subjectcode?: string;
  subjectid?: string | number;
  individualsubjectcode?: string;
  Lsubjectcomponentid?: string;
  Tsubjectcomponentid?: string;
  Psubjectcomponentid?: string;
  Lpercentage?: string;
  Tpercentage?: string;
  Ppercentage?: string;
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

  const parsedEntries = Object.entries(data)
    .map(([type, raw]) => ({ type, stats: parseClassLogs(raw, type) }))
    .filter((item): item is { type: string; stats: NonNullable<ReturnType<typeof parseClassLogs>> } => item.stats !== null);

  if (parsedEntries.length === 0) {
    return <p className="muted">No class records available.</p>;
  }

  let total = 0;
  let attended = 0;
  const allClasses: ClassRecord[] = [];

  for (const { stats } of parsedEntries) {
    total += stats.total;
    attended += stats.attended;
    for (const c of stats.classes) {
      allClasses.push(c);
    }
  }

  allClasses.sort((a, b) => (parseIndianDateTime(b.datetime) ?? 0) - (parseIndianDateTime(a.datetime) ?? 0));

  const absent = total - attended;
  const percentage = total > 0 ? ((attended / total) * 100).toFixed(1) : null;

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

export function SubjectDetail({
  row,
  registrationid,
  registrationcode,
  session,
}: {
  row: AttRow & Record<string, unknown>;
  registrationid?: string;
  registrationcode?: string;
  session: SectionProps["session"];
}) {
  const base = { registrationid, registrationcode };
  const detail = useFeature<Record<string, Record<string, unknown>>>({
    run: () => features.getSubjectAttendanceAll(client, session, row, base, "current"),
    deps: [session, registrationid, String(row.subjectid)],
    cacheKey: getSubjectCacheKey(session.username, registrationid, row, session.instituteid),
    staleTimeMs: FEATURE_TTL.subjects,
    isFresh: (updatedAt) => {
      const fresh = getCachedSubjectDetailEntry(session.username, registrationid, row, session.instituteid);
      return !doesSubjectNeedDeepFetch(row, fresh.data, updatedAt, fresh.checksum, undefined, true);
    },
    writeExtra: (d) => (isSubjectDetailComplete(row, d) ? { checksum: computeSubjectRowChecksum(row) } : {}),
  });

  if (detail.loading && !detail.data) return <p className="muted">Loading class breakdown…</p>;
  if (detail.error && !detail.data) return <SectionError label="Subject detail" error={detail.error} retry={detail.retry} />;

  if (!detail.data || Object.keys(detail.data).length === 0) {
    return <p className="muted">No class records available.</p>;
  }

  return (
    <div className="att-detail-grid">
      <CombinedClassLog data={detail.data} />
    </div>
  );
}

export function subjectName(code?: string): { name: string; badge: string } {
  if (!code) return { name: "", badge: "" };
  const m = code.match(/^(.+?)\(([^)]+)\)$/);
  if (m) return { name: titleCase(m[1].trim()), badge: m[2] };
  return { name: titleCase(code), badge: "" };
}

export function getSubjectCacheKey(
  username: string,
  registrationid: string | undefined | null,
  row: AttRow & Record<string, unknown>,
  instituteid?: string | null,
): string {
  const subId = row.subjectid ?? row.individualsubjectcode ?? row.subjectcode;
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
  row: AttRow & Record<string, unknown>,
  instituteid?: string | null,
): SubjectDetailCacheEntry {
  const key = getSubjectCacheKey(username, registrationid, row, instituteid);
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
  row: AttRow & Record<string, unknown>,
  instituteid?: string | null,
): Record<string, Record<string, unknown>> | null {
  return getCachedSubjectDetailEntry(username, registrationid, row, instituteid).data;
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

export function AttendanceSection({ session, onLogout }: SectionProps) {
  const card = useCardState("attendance", true);
  const att = useAttendanceInitial(session);
  const initial = att.data;
  const [semId, setSemId, sem] = useSemester(sessionCacheKey("semester", session, "attendance"), initial?.semesters);
  const isDefault = semId === String(initial?.semesters?.[0]?.registrationid);
  const detail = useFeature<{ rows: AttRow[] }>({
    run: () =>
      features.getAttendanceDetail(client, session, {
        stynumber: initial?.header?.stynumber,
        registrationid: sem?.registrationid,
        registrationcode: sem?.registrationcode,
      }),
    deps: [session, semId],
    enabled: sem !== null && !isDefault,
    cacheKey: semId ? sessionCacheKey("att.detail", session, semId) : undefined,
    staleTimeMs: FEATURE_TTL.pastDetail,
  });

  const rows = isDefault ? (initial?.rows ?? []) : (detail.data?.rows ?? []);
  const semesters = initial?.semesters ?? [];
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    setOpen(null);
  }, [semId]);

  const loading = att.loading || detail.loading;
  const error = att.error ?? detail.error;
  const retry = att.error ? att.retry : detail.retry;

  const shortsCount = rows.filter((r) => combinedAttendance(r).isShort).length;
  const badgeText = rows.length > 0 ? (shortsCount > 0 ? `${shortsCount} short` : "All clear") : undefined;

  return (
    <CollapsibleCard
      id="attendance"
      title="Attendance"
      badge={badgeText}
      badgeShort={shortsCount > 0}
      defaultOpen={true}
      isOpen={card.isOpen}
      onToggle={card.toggle}
      action={
        semesters.length > 1 ? (
          <select
            value={semId ?? ""}
            onChange={(e) => setSemId(e.target.value)}
            disabled={loading}
            className="sem-picker"
          >
            {semesters.map((s) => (
              <option key={String(s.registrationid)} value={String(s.registrationid)}>
                {formatSemester(s.registrationcode ?? s.registrationdesc)}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      {loading && <p className="muted">Loading…</p>}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th className="num-col">Attendance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const { name, badge } = subjectName(r.subjectcode);
                const attInfo = combinedAttendance(r);
                const isOpen = open === i;
                return (
                  <Fragment key={i}>
                    <tr
                      className={`clickable-row ${isOpen ? "active-row" : ""}`}
                      onClick={() => setOpen(isOpen ? null : i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpen(isOpen ? null : i);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-expanded={isOpen}
                      title="Tap to see class-by-class attendance"
                    >
                      <td>
                        <div className="sub-row">
                          <span className="row-chevron" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                          <div className="sub-content">
                            <div className="sub-header-line">
                              {badge && <span className="badge">{badge}</span>}
                              <span className="sub-name">{name}</span>
                            </div>
                            {attInfo.margin.text && (
                              <span className={`bunk-note ${attInfo.margin.type}`}>
                                {attInfo.margin.text}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={`num-col ${attInfo.colorClass}`}>
                        {attInfo.pct}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="detail-expanded-row">
                        <td colSpan={2}>
                          <SubjectDetail
                            row={r as AttRow & Record<string, unknown>}
                            registrationid={sem?.registrationid}
                            registrationcode={sem?.registrationcode}
                            session={session}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {initial && rows.length === 0 && !error && !loading && (
        <p className="muted">No attendance rows found.</p>
      )}
      {error && <SectionError label="Attendance" error={error} retry={retry} />}
    </CollapsibleCard>
  );
}
