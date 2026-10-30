// Pure calculation and parsing logic for attendance data.
// No React or browser APIs, so it can be tested directly in Node.
import { features } from "@juet/core";

export type AttColorClass = "att-red" | "att-yellow" | "att-normal" | "att-green" | "";

export interface BunkMargin {
  type: "bunk" | "attend" | "none";
  count: number;
  text: string;
}

export interface ClassRecord {
  datetime: string;
  isAttended: boolean;
  type?: string;
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

export function cleanDateTime(dt?: string): string {
  if (!dt) return "—";
  return dt
    .replace(/:([AP]M)/gi, " $1")
    .replace(/[()]/g, " ")
    .replace(/\s*-\s*/g, " – ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pct(v: string | number | undefined | null): number | null {
  if (v == null) return null;
  const s = String(v).replace("%", "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function getColorClass(val: number | null): AttColorClass {
  if (val === null) return "";
  if (val < 70) return "att-red";
  if (val < 80) return "att-yellow";
  if (val < 90) return "att-normal";
  return "att-green";
}

export function computeBunkMargin(present: number, total: number, target = 0.70): BunkMargin {
  if (total <= 0) return { type: "none", count: 0, text: "" };
  // Calculate in percentage units so targets such as 80% do not introduce
  // 1 - 0.8 rounding errors before ceil/floor at exact class boundaries.
  const targetPercent = target * 100;
  // Criteria is strictly debar below 70% (even 69.9% is debarred)
  if (present * 100 < targetPercent * total) {
    const needed = Math.max(1, Math.ceil((targetPercent * total - present * 100) / (100 - targetPercent)));
    return {
      type: "attend",
      count: needed,
      text: `Need ${needed} ${needed === 1 ? "class" : "classes"}`,
    };
  }

  const canBunk = Math.max(0, Math.floor((present * 100 - targetPercent * total) / targetPercent));
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

function isClassRecordList(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item));
}

export function isSubjectDetailComplete(
  row: Record<string, unknown>,
  detail?: Record<string, unknown> | null,
): boolean {
  if (!detail || typeof detail !== "object") return false;
  for (const type of ["L", "T", "P"]) {
    if (!features.getAttendanceComponentIds(row[`${type}subjectcomponentid`]).length) continue;
    const component = detail[type];
    if (!component || typeof component !== "object") return false;
    if (Array.isArray(component)) {
      if (!isClassRecordList(component)) return false;
      continue;
    }
    const record = component as Record<string, unknown>;
    const logs = record.student_attdsummarylist ?? record.attdsummarylist ??
      record.studentAttdsummarylist ?? record.summary ?? record.rows;
    if (Array.isArray(logs)) {
      if (!isClassRecordList(logs)) return false;
      continue;
    }
    // Some portal responses expose totals instead of individual class logs.
    const total = record.totalclass ?? record.totalclasses ?? record.Totalclass;
    const present = record.totalpresent ?? record.present ?? record.Totalpresent;
    if (logs != null || total == null || present == null || total === "" || present === "" ||
      !Number.isFinite(Number(total)) || !Number.isFinite(Number(present)) ||
      Number(total) < 0 || Number(present) < 0 || Number(present) > Number(total)) return false;
  }
  return true;
}

/**
 * `withClasses: false` returns the same counts with an empty `classes` list, skipping the per-class
 * date normalisation that totals-only callers (the subject list) never read.
 */
export function parseClassLogs(raw: unknown, type?: string, withClasses = true): {
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

  // Old caches may predate validation; never let malformed list entries crash
  // the history sheet while a replacement read is pending.
  if (Array.isArray(list) && !isClassRecordList(list)) return null;

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

    if (withClasses) {
      classes.push({
        datetime: cleanDateTime(String(item.datetime ?? item.date ?? "")),
        isAttended,
        type,
      });
    }
  }

  const absent = total - attended;
  const percentage = total > 0 ? ((attended / total) * 100).toFixed(1) : null;
  return { total, attended, absent, pct: percentage, classes };
}

function isLabRow(r: Record<string, unknown>): boolean {
  return Boolean(
    (features.getAttendanceComponentIds(r.Psubjectcomponentid).length || r.Ppercentage) &&
    !features.getAttendanceComponentIds(r.Lsubjectcomponentid).length &&
    !features.getAttendanceComponentIds(r.Tsubjectcomponentid).length
  );
}

function hasExplicitOverviewPercentage(r: Record<string, unknown>): boolean {
  // Mirror the percentage sources used by the overview calculation below.
  return [
    r.Lpercentage,
    r.Tpercentage,
    r.Ppercentage,
    isLabRow(r) ? null : r.LTpercantage ?? r.LTpercentage,
  ].some((value) => pct(value as string | number | null | undefined) !== null);
}

export function combinedAttendance(
  r: Record<string, unknown>,
  detail?: Record<string, Record<string, unknown>> | null,
  target = 0.70,
  preferOverviewPercentage = false,
): CombinedAttResult {
  if (detail && preferOverviewPercentage) {
    const saved = combinedAttendance({}, detail, target);
    const overview = combinedAttendance(r, null, target);
    // A missing percentage may fall back to saved counts. An explicit fresh
    // 0% is rendered as "—" and must not resurrect the saved percentage.
    return overview.pctNum === null && !hasExplicitOverviewPercentage(r) ? saved : {
      ...saved, pct: overview.pct, pctNum: overview.pctNum,
      isShort: overview.isShort, colorClass: overview.colorClass,
    };
  }
  const isLab = isLabRow(r);
  const hasLecture = features.getAttendanceComponentIds(r.Lsubjectcomponentid).length > 0;

  // Fallback row counts to guard against stale cached detail
  const Ltotal = Number(r.Ltotalclass ?? r.LTotalclass ?? r.ltotalclass ?? 0);
  const Lpres = Number(r.Ltotalpresent ?? r.LTotalpresent ?? r.ltotalpresent ?? 0);
  const Ttotal = Number(r.Ttotalclass ?? r.TTotalclass ?? r.ttotalclass ?? 0);
  const Tpres = Number(r.Ttotalpresent ?? r.TTotalpresent ?? r.ttotalpresent ?? 0);
  const Ptotal = Number(r.Ptotalclass ?? r.PTotalclass ?? r.ptotalclass ?? 0);
  const Ppres = Number(r.Ptotalpresent ?? r.PTotalpresent ?? r.ptotalpresent ?? 0);
  const topTotal = Number(r.totalclass ?? r.totalclasses ?? r.Totalclass ?? 0);
  const topPres = Number(r.totalpresent ?? r.totalpresents ?? r.Totalpresent ?? 0);

  // Tradeoff: Math.max ensures we do not undercount if component breakdown lags top-level summary
  // rows on the portal. Consistent portal data cannot produce >100%, but downward corrections
  // on individual components will yield to the higher summary count until fresh details arrive.
  const rowTotalClasses = Math.max(topTotal, isLab ? Ptotal : Ltotal + Ttotal + (hasLecture ? 0 : Ptotal));
  const rowTotalPresent = Math.max(topPres, isLab ? Ppres : Lpres + Tpres + (hasLecture ? 0 : Ppres));

  // When class-by-class detail logs are available (from live fetch or cache)
  // Only trust detail if all expected components are present and non-null
  const isComplete = isSubjectDetailComplete(r, detail);
  if (isComplete && detail && typeof detail === "object" && Object.keys(detail).length > 0) {
    let totalClasses = 0;
    let totalPresent = 0;
    const components: CombinedAttResult["components"] = {};

    const lStats = detail.L ? parseClassLogs(detail.L, "L", false) : null;
    const tStats = detail.T ? parseClassLogs(detail.T, "T", false) : null;
    const pStats = detail.P ? parseClassLogs(detail.P, "P", false) : null;

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
      if (isLab || (!components.L && !components.T && !hasLecture)) {
        totalClasses += pStats.total;
        totalPresent += pStats.attended;
      }
    }

    // If detail is stale (fresh row has more total classes than cached detail),
    // do not prioritize stale cached detail over fresh overview row!
    if (totalClasses > 0 && !(rowTotalClasses > totalClasses)) {
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
  }

  // Fallback when counts are directly embedded in row
  const totalClasses = rowTotalClasses;
  const totalPresent = rowTotalPresent;

  const components: CombinedAttResult["components"] = {};
  if (Ltotal > 0 || r.Lpercentage != null) {
    components.L = { total: Ltotal, present: Lpres, pct: r.Lpercentage as string | number | null };
  }
  if (Ttotal > 0 || r.Tpercentage != null) {
    components.T = { total: Ttotal, present: Tpres, pct: r.Tpercentage as string | number | null };
  }
  if (Ptotal > 0 || r.Ppercentage != null) {
    components.P = { total: Ptotal, present: Ppres, pct: r.Ppercentage as string | number | null };
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

  // Fallback when component percentages or official overall percentage are available without class count breakdown
  const officialPct = isLab
    ? pct(r.Ppercentage as string | number | null)
    : pct((r.LTpercantage ?? r.LTpercentage) as string | number | null);
  const l = pct(r.Lpercentage as string | number | null);
  const t = pct(r.Tpercentage as string | number | null);
  const p = pct(r.Ppercentage as string | number | null);
  const presentPcts = [l, t, p].filter((x): x is number => x !== null);

  if (officialPct !== null || presentPcts.length > 0) {
    const val = officialPct !== null
      ? officialPct
      : presentPcts.reduce((sum, v) => sum + v, 0) / presentPcts.length;
    const isExact = officialPct !== null || presentPcts.every((x) => x === presentPcts[0]);
    // When no classes have been held (e.g. project/internship), 0% should display as '—'
    const isZeroWithoutClasses = val === 0 && rowTotalClasses === 0;
    return {
      pct: isZeroWithoutClasses ? "—" : (isExact ? `${val.toFixed(1)}%` : `~${val.toFixed(1)}%`),
      pctNum: isZeroWithoutClasses ? null : val,
      isShort: !isZeroWithoutClasses && val < 70.0,
      colorClass: !isZeroWithoutClasses && val > 0 ? getColorClass(val) : "",
      margin: { type: "none", count: 0, text: "" },
      totalClasses: 0,
      totalPresent: 0,
      hasHeldClasses: false,
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
