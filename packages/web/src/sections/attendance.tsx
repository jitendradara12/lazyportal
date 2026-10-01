import { Fragment, useEffect, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
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

interface AttRow {
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

interface AttData {
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

function cleanDateTime(dt?: string): string {
  if (!dt) return "—";
  return dt
    .replace(/:([AP]M)/gi, " $1")
    .replace(/[()]/g, " ")
    .replace(/\s*-\s*/g, " – ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseClassLogs(raw: unknown, type?: string): {
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

function CombinedClassLog({
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
      <div className="att-comp-header">
        <span className="att-comp-label">Class History</span>
        <span className="att-comp-val">
          <strong>{attended}</strong> of {total} attended
          {percentage != null && ` (${percentage}%)`}
          {absent > 0 && <span className="absent-count"> · {absent} absent</span>}
        </span>
      </div>

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

          <div className="table-scroll log-table-scroll">
            <table className="att-log-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={i} className={c.isAttended ? "row-present" : "row-absent"}>
                    <td>{c.datetime}</td>
                    <td>{c.type || "—"}</td>
                    <td>
                      <span className={`log-badge ${c.isAttended ? "present" : "absent"}`}>
                        {c.isAttended ? "Present" : "Absent"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SubjectDetail({
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
    cacheKey: `att.subject:${session.username}:${registrationid ?? "cur"}:${row.subjectid ?? row.individualsubjectcode ?? row.subjectcode}`,
  });

  if (detail.loading) return <p className="muted">Loading class breakdown…</p>;
  if (detail.error) return <SectionError label="Subject detail" error={detail.error} retry={detail.retry} />;

  if (!detail.data || Object.keys(detail.data).length === 0) {
    return <p className="muted">No class records available.</p>;
  }

  return (
    <div className="att-detail-grid">
      <CombinedClassLog data={detail.data} />
    </div>
  );
}

function subjectName(code?: string): { name: string; badge: string } {
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

function computeBunkMargin(present: number, total: number): BunkMargin {
  if (total <= 0) return { type: "none", count: 0, text: "" };
  const currentRatio = present / total;
  if (currentRatio < 0.75) {
    // Need: (present + x) / (total + x) >= 0.75 => x >= 3*total - 4*present
    const needed = Math.max(1, Math.ceil(3 * total - 4 * present));
    return {
      type: "attend",
      count: needed,
      text: `Need ${needed} ${needed === 1 ? "class" : "classes"}`,
    };
  }
  // Can bunk: present / (total + y) >= 0.75 => y <= (4*present - 3*total) / 3
  const canBunk = Math.max(0, Math.floor((4 * present - 3 * total) / 3));
  if (canBunk > 0) {
    return {
      type: "bunk",
      count: canBunk,
      text: `Can bunk ${canBunk}`,
    };
  }
  return {
    type: "bunk",
    count: 0,
    text: "Don't bunk",
  };
}

function getColorClass(val: number | null): AttColorClass {
  if (val === null) return "";
  if (val < 70) return "att-red";
  if (val < 80) return "att-yellow";
  if (val < 90) return "att-normal";
  return "att-green";
}

function combinedAttendance(r: AttRow & Record<string, unknown>): {
  pct: string;
  pctNum: number | null;
  isShort: boolean;
  colorClass: AttColorClass;
  margin: BunkMargin;
} {
  const Ltotal = Number(r.Ltotalclass ?? r.LTotalclass ?? r.ltotalclass ?? 0);
  const Lpres = Number(r.Ltotalpresent ?? r.LTotalpresent ?? r.ltotalpresent ?? 0);
  const Ttotal = Number(r.Ttotalclass ?? r.TTotalclass ?? r.ttotalclass ?? 0);
  const Tpres = Number(r.Ttotalpresent ?? r.TTotalpresent ?? r.ttotalpresent ?? 0);
  const Ptotal = Number(r.Ptotalclass ?? r.PTotalclass ?? r.ptotalclass ?? 0);
  const Ppres = Number(r.Ptotalpresent ?? r.PTotalpresent ?? r.ptotalpresent ?? 0);

  const totalClasses = Ltotal + Ttotal + Ptotal;
  const totalPresent = Lpres + Tpres + Ppres;

  if (totalClasses > 0) {
    const val = (totalPresent / totalClasses) * 100;
    return {
      pct: `${val.toFixed(1)}%`,
      pctNum: val,
      isShort: val < 75,
      colorClass: getColorClass(val),
      margin: computeBunkMargin(totalPresent, totalClasses),
    };
  }

  // Check direct overall/total percentage if portal returns it
  const direct = pct(r.totalpercentage ?? r.overallpercentage ?? r.percentage);
  if (direct !== null) {
    return {
      pct: `${direct.toFixed(1)}%`,
      pctNum: direct,
      isShort: direct < 75,
      colorClass: getColorClass(direct),
      margin: { type: "none", count: 0, text: "" },
    };
  }

  // Extract component percentages: L, T, P
  const l = pct(r.Lpercentage);
  const t = pct(r.Tpercentage);
  const p = pct(r.Ppercentage);

  const active: { type: string; val: number }[] = [];

  // Lecture: active if L component ID exists or if neither T nor P exists
  if (l !== null && (r.Lsubjectcomponentid || (!r.Tsubjectcomponentid && !r.Psubjectcomponentid))) {
    active.push({ type: "L", val: l });
  } else if (l !== null && !r.Lsubjectcomponentid && !r.Tsubjectcomponentid && !r.Psubjectcomponentid) {
    active.push({ type: "L", val: l });
  }

  // Tutorial: active if T component ID exists
  if (t !== null && (r.Tsubjectcomponentid || (!r.Lsubjectcomponentid && !r.Psubjectcomponentid))) {
    active.push({ type: "T", val: t });
  }

  // Practical: active if P component ID exists (practicals typically have separate course code)
  if (p !== null && (r.Psubjectcomponentid || (!r.Lsubjectcomponentid && !r.Tsubjectcomponentid))) {
    active.push({ type: "P", val: p });
  }

  // Fallback if no component IDs were present
  if (active.length === 0) {
    if (l !== null) active.push({ type: "L", val: l });
    if (t !== null) active.push({ type: "T", val: t });
    if (p !== null) active.push({ type: "P", val: p });
  }

  if (active.length > 0) {
    const sum = active.reduce((a, b) => a + b.val, 0);
    const avg = sum / active.length;

    return {
      pct: `${avg.toFixed(1)}%`,
      pctNum: avg,
      isShort: avg < 75 || active.some((a) => a.val < 75),
      colorClass: getColorClass(avg),
      margin: { type: "none", count: 0, text: "" },
    };
  }

  return {
    pct: "—",
    pctNum: null,
    isShort: false,
    colorClass: "",
    margin: { type: "none", count: 0, text: "" },
  };
}

export function AttendanceSection({ session, onLogout }: SectionProps) {
  const card = useCardState("attendance", true);
  const att = useFeature<AttData>({
    run: () => features.getAttendance(client, session),
    deps: [session],
    cacheKey: `att.initial:${session.username}`,
  });
  const initial = att.data;
  const [semId, setSemId, sem] = useSemester("attendance", initial?.semesters);
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
    cacheKey: semId ? `att.detail:${session.username}:${semId}` : undefined,
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
