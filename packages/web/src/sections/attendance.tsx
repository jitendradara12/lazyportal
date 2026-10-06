import { Fragment, useEffect, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, STALE_MS, sessionCacheKey } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import {
  CollapsibleCard,
  SectionError,
  useCardState,
  titleCase,
  formatSemester,
  pct,
  parseIndianDateTime,
} from "../components/DataViews";
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

interface ClassRecord {
  datetime: string;
  isAttended: boolean;
  type?: string;
}

export function cleanDateTime(dt?: string): string {
  if (!dt) return "—";
  return dt
    .replace(/:([AP]M)/gi, " $1")
    .replace(/[()]/g, " ")
    .replace(/\s*-\s*/g, " – ")
    .replace(/\s+/g, " ")
    .trim();
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


export function parseClassLogs(raw: unknown, type?: string): {
  total: number;
  attended: number;
  absent: number;
  pct: string | null;
  classes: ClassRecord[];
} | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const list = (
    Array.isArray(raw)
      ? raw
      : (obj.student_attdsummarylist ??
        obj.attdsummarylist ??
        obj.studentAttdsummarylist ??
        obj.summary ??
        obj.rows ??
        [])
  ) as Record<string, unknown>[];

  if (!Array.isArray(list) || list.length === 0) {
    const total = Number(obj.totalclass ?? obj.totalclasses ?? obj.Totalclass);
    const present = Number(obj.totalpresent ?? obj.present ?? obj.Totalpresent);
    if (!Number.isNaN(total) && total > 0) {
      const p = Number.isNaN(present) ? 0 : present;
      const a = Math.max(0, total - p);
      return { total, attended: p, absent: a, pct: ((p / total) * 100).toFixed(1), classes: [] };
    }
    return null;
  }

  const total = list.length;
  const classes: ClassRecord[] = [];
  let attended = 0;

  for (const item of list) {
    const status = String(
      item.present ?? item.attendance ?? item.attendancestatus ?? item.status ?? ""
    )
      .trim()
      .toUpperCase();
    const isAttended =
      status === "Y" || status === "YES" || status === "PRESENT" || status === "P" || status === "1";
    if (isAttended) attended++;

    classes.push({
      datetime: cleanDateTime(String(item.datetime ?? item.date ?? "")),
      isAttended,
      type,
    });
  }

  const absent = total - attended;
  const percentage = total > 0 ? ((attended / total) * 100).toFixed(1) : null;
  return { total, attended, absent, pct: percentage, classes };
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
  onLogout,
}: {
  row: AttRow & Record<string, unknown>;
  registrationid?: string;
  registrationcode?: string;
  session: SectionProps["session"];
  onLogout: () => void;
}) {
  const base = { registrationid, registrationcode };
  const detail = useFeature<Record<string, Record<string, unknown>>>({
    run: () => features.getSubjectAttendanceAll(client, session, row, base, "current"),
    deps: [session, registrationid, String(row.subjectid)],
    cacheKey: getSubjectCacheKey(session.username, registrationid, row, session.instituteid),
    staleTimeMs: STALE_MS,
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

export type AttColorClass = "att-red" | "att-yellow" | "att-normal" | "att-green" | "";

export interface BunkMargin {
  type: "bunk" | "attend" | "none";
  count: number;
  text: string;
}

export function computeBunkMargin(present: number, total: number, target = 0.70): BunkMargin {
  if (total <= 0) return { type: "none", count: 0, text: "" };
  const currentRatio = present / total;
  // Criteria is strictly debar below 70% (even 69.9% is debarred)
  if (currentRatio < target) {
    const needed = Math.max(1, Math.ceil((target * total - present) / (1 - target)));
    return {
      type: "attend",
      count: needed,
      text: `Need ${needed} ${needed === 1 ? "class" : "classes"}`,
    };
  }

  const canBunk = Math.max(0, Math.floor(present / target - total));
  if (canBunk > 0) {
    return {
      type: "bunk",
      count: canBunk,
      text: `Can bunk ${canBunk} ${canBunk === 1 ? "class" : "classes"}`,
    };
  }

  return {
    type: "bunk",
    count: 0,
    text: "Cannot bunk more",
  };
}

export function getColorClass(val: number | null): AttColorClass {
  if (val === null) return "";
  if (val < 70) return "att-red";
  if (val < 80) return "att-yellow";
  if (val < 90) return "att-normal";
  return "att-green";
}

export interface CombinedAttResult {
  pct: string;
  pctNum: number | null;
  isShort: boolean;
  colorClass: AttColorClass;
  margin: BunkMargin;
  totalClasses: number;
  totalPresent: number;
  hasHeldClasses: boolean;
  components: {
    L?: { total: number; present: number; pct?: string | number | null };
    T?: { total: number; present: number; pct?: string | number | null };
    P?: { total: number; present: number; pct?: string | number | null };
  };
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

export function getCachedSubjectDetailEntry(
  username: string,
  registrationid: string | undefined | null,
  row: AttRow & Record<string, unknown>,
  instituteid?: string | null,
): { data: Record<string, Record<string, unknown>> | null; updatedAt: number | null } {
  const key = getSubjectCacheKey(username, registrationid, row, instituteid);
  try {
    const raw = localStorage.getItem(`juet.cache.${key}`);
    if (!raw) return { data: null, updatedAt: null };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "data" in parsed) {
      return {
        data: parsed.data as Record<string, Record<string, unknown>>,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : null,
      };
    }
    return { data: parsed as Record<string, Record<string, unknown>>, updatedAt: null };
  } catch {
    return { data: null, updatedAt: null };
  }
}

export function getCachedSubjectDetail(
  username: string,
  registrationid: string | undefined | null,
  row: AttRow & Record<string, unknown>,
  instituteid?: string | null,
): Record<string, Record<string, unknown>> | null {
  return getCachedSubjectDetailEntry(username, registrationid, row, instituteid).data;
}

export function combinedAttendance(
  r: AttRow & Record<string, unknown>,
  detail?: Record<string, Record<string, unknown>> | null,
  target = 0.70
): CombinedAttResult {
  const isLab = Boolean(
    (r.Psubjectcomponentid || r.Ppercentage) &&
    !r.Lsubjectcomponentid &&
    !r.Tsubjectcomponentid
  );

  // When class-by-class detail logs are available (from live fetch or cache)
  if (detail && typeof detail === "object" && Object.keys(detail).length > 0) {
    let totalClasses = 0;
    let totalPresent = 0;
    const components: CombinedAttResult["components"] = {};

    const lStats = detail.L ? parseClassLogs(detail.L, "L") : null;
    const tStats = detail.T ? parseClassLogs(detail.T, "T") : null;
    const pStats = detail.P ? parseClassLogs(detail.P, "P") : null;

    if (lStats && (lStats.total > 0 || r.Lsubjectcomponentid)) {
      components.L = { total: lStats.total, present: lStats.attended, pct: lStats.pct };
      totalClasses += lStats.total;
      totalPresent += lStats.attended;
    }
    if (tStats && (tStats.total > 0 || r.Tsubjectcomponentid)) {
      components.T = { total: tStats.total, present: tStats.attended, pct: tStats.pct };
      totalClasses += tStats.total;
      totalPresent += tStats.attended;
    }
    if (pStats && (pStats.total > 0 || r.Psubjectcomponentid)) {
      components.P = { total: pStats.total, present: pStats.attended, pct: pStats.pct };
      if (isLab || (!components.L && !components.T && !r.Lsubjectcomponentid)) {
        totalClasses += pStats.total;
        totalPresent += pStats.attended;
      }
    }

    if (totalClasses > 0) {
      const val = (totalPresent / totalClasses) * 100;
      return {
        pct: `${val.toFixed(1)}%`,
        pctNum: val,
        isShort: val < 70.0,
        colorClass: getColorClass(val),
        margin: computeBunkMargin(totalPresent, totalClasses, target),
        totalClasses,
        totalPresent,
        hasHeldClasses: true,
        components,
      };
    }

    return {
      pct: "—",
      pctNum: null,
      isShort: false,
      colorClass: "",
      margin: { type: "none", count: 0, text: "" },
      totalClasses: 0,
      totalPresent: 0,
      hasHeldClasses: false,
      components,
    };
  }

  // Fallback when counts are directly embedded in row
  const Ltotal = Number(r.Ltotalclass ?? r.LTotalclass ?? r.ltotalclass ?? 0);
  const Lpres = Number(r.Ltotalpresent ?? r.LTotalpresent ?? r.ltotalpresent ?? 0);
  const Ttotal = Number(r.Ttotalclass ?? r.TTotalclass ?? r.ttotalclass ?? 0);
  const Tpres = Number(r.Ttotalpresent ?? r.TTotalpresent ?? r.ttotalpresent ?? 0);
  const Ptotal = Number(r.Ptotalclass ?? r.PTotalclass ?? r.ptotalclass ?? 0);
  const Ppres = Number(r.Ptotalpresent ?? r.PTotalpresent ?? r.ptotalpresent ?? 0);

  const totalClasses = isLab ? Ptotal : Ltotal + Ttotal + (r.Lsubjectcomponentid ? 0 : Ptotal);
  const totalPresent = isLab ? Ppres : Lpres + Tpres + (r.Lsubjectcomponentid ? 0 : Ppres);

  const components: CombinedAttResult["components"] = {};
  if (Ltotal > 0 || r.Lpercentage != null) {
    components.L = { total: Ltotal, present: Lpres, pct: r.Lpercentage };
  }
  if (Ttotal > 0 || r.Tpercentage != null) {
    components.T = { total: Ttotal, present: Tpres, pct: r.Tpercentage };
  }
  if (Ptotal > 0 || r.Ppercentage != null) {
    components.P = { total: Ptotal, present: Ppres, pct: r.Ppercentage };
  }

  if (totalClasses > 0) {
    const val = (totalPresent / totalClasses) * 100;
    return {
      pct: `${val.toFixed(1)}%`,
      pctNum: val,
      isShort: val < 70.0,
      colorClass: getColorClass(val),
      margin: computeBunkMargin(totalPresent, totalClasses, target),
      totalClasses,
      totalPresent,
      hasHeldClasses: true,
      components,
    };
  }

  // Fallback when component percentages are available without class count breakdown
  const l = pct(r.Lpercentage);
  const t = pct(r.Tpercentage);
  const p = pct(r.Ppercentage);
  const presentPcts = [l, t, p].filter((x): x is number => x !== null);

  if (presentPcts.length > 0) {
    const avg = presentPcts.reduce((sum, val) => sum + val, 0) / presentPcts.length;
    const allSame = presentPcts.every((x) => x === presentPcts[0]);
    return {
      pct: allSame ? `${presentPcts[0].toFixed(1)}%` : `~${avg.toFixed(1)}%`,
      pctNum: avg,
      isShort: avg < 70.0,
      colorClass: getColorClass(avg),
      margin: { type: "none", count: 0, text: "" },
      totalClasses: 0,
      totalPresent: 0,
      hasHeldClasses: true,
      components,
    };
  }

  // No detail, no embedded class counts, and no component percentages -> truly no classes yet
  return {
    pct: "—",
    pctNum: null,
    isShort: false,
    colorClass: "",
    margin: { type: "none", count: 0, text: "" },
    totalClasses: 0,
    totalPresent: 0,
    hasHeldClasses: false,
    components,
  };
}

export function useAttendanceInitial(session: SectionProps["session"]) {
  return useFeature<AttData>({
    run: () => features.getAttendance(client, session),
    deps: [session],
    cacheKey: sessionCacheKey("att.initial", session),
    scope: "all",
  });
}

export function useAttendanceSummary(session: SectionProps["session"]) {
  const att = useAttendanceInitial(session);
  const rows = att.data?.rows ?? [];
  const semId = att.data?.semesters?.[0]?.registrationid;
  const shortsCount = rows.filter((r) => {
    const cached = getCachedSubjectDetail(session.username, semId != null ? String(semId) : null, r, session.instituteid);
    return combinedAttendance(r, cached).isShort;
  }).length;
  const badgeText = rows.length > 0
    ? (shortsCount > 0 ? `${shortsCount} short` : "All clear")
    : (att.loading ? "Loading…" : "Subject breakdown");
  return { shortsCount, badgeText, loading: att.loading };
}

export function AttendanceSection({ session }: SectionProps) {
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
                            onLogout={onLogout}
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
