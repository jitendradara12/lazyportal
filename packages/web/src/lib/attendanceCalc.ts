// Pure calculation and parsing logic for attendance data.
// Kept zero-dependency and isolated from React/JSX so it can be tested directly in Node.

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

export function isSubjectDetailComplete(
  row: Record<string, unknown>,
  detail?: Record<string, unknown> | null,
): boolean {
  if (!detail || typeof detail !== "object") return false;
  if (row.Lsubjectcomponentid && (!detail.L || typeof detail.L !== "object")) return false;
  if (row.Tsubjectcomponentid && (!detail.T || typeof detail.T !== "object")) return false;
  if (row.Psubjectcomponentid && (!detail.P || typeof detail.P !== "object")) return false;
  return true;
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

export function combinedAttendance(
  r: Record<string, unknown>,
  detail?: Record<string, Record<string, unknown>> | null,
  target = 0.70
): CombinedAttResult {
  const isLab = Boolean(
    (r.Psubjectcomponentid || r.Ppercentage) &&
    !r.Lsubjectcomponentid &&
    !r.Tsubjectcomponentid
  );

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
  const rowTotalClasses = Math.max(topTotal, isLab ? Ptotal : Ltotal + Ttotal + (r.Lsubjectcomponentid ? 0 : Ptotal));
  const rowTotalPresent = Math.max(topPres, isLab ? Ppres : Lpres + Tpres + (r.Lsubjectcomponentid ? 0 : Ppres));

  // When class-by-class detail logs are available (from live fetch or cache)
  // Only trust detail if all expected components are present and non-null
  const isComplete = isSubjectDetailComplete(r, detail);
  if (isComplete && detail && typeof detail === "object" && Object.keys(detail).length > 0) {
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

  // Fallback when component percentages are available without class count breakdown
  const l = pct(r.Lpercentage as string | number | null);
  const t = pct(r.Tpercentage as string | number | null);
  const p = pct(r.Ppercentage as string | number | null);
  const presentPcts = [l, t, p].filter((x): x is number => x !== null);

  if (presentPcts.length > 0) {
    const avg = presentPcts.reduce((sum, val) => sum + val, 0) / presentPcts.length;
    const allSame = presentPcts.every((x) => x === presentPcts[0]);
    // When no classes have been held (e.g. project/internship), 0% should display as '—'
    const isZeroWithoutClasses = avg === 0 && rowTotalClasses === 0;
    return {
      pct: isZeroWithoutClasses ? "—" : (allSame ? `${presentPcts[0].toFixed(1)}%` : `~${avg.toFixed(1)}%`),
      pctNum: isZeroWithoutClasses ? null : avg,
      isShort: false,
      colorClass: !isZeroWithoutClasses && avg > 0 ? getColorClass(avg) : "",
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
