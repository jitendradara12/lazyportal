// Pure helpers for the CGPA view. JUET's SGPA/grade-card payloads vary in key
// names between endpoints, so every read goes through a small alias list.

type Row = Record<string, unknown>;

function pick(row: Row | null | undefined, keys: string[]): unknown {
  if (!row) return undefined;
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== "") return value;
  }
  return undefined;
}

export function toNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface Term {
  sty: number;
  sgpa: number | null;
  cgpa: number | null;
  credits: number | null;
  points?: number | null;
  forecasted?: boolean;
  raw: Row;
}

export interface CourseGrade {
  code: string;
  name: string;
  grade: string;
  credits: number | null;
  /** Grade point on the 10-point scale (O = 10, A+ = 9, …). */
  gradePoint: number | null;
  /** Points secured = grade point × credits (JUET's "SGPA points"). */
  points: number | null;
  /** Points available = 10 × credits. */
  maxPoints: number | null;
  minor: boolean;
  fail: boolean;
}

const STY_KEYS = ["stynumber", "semester", "stynumberdesc"];
const SGPA_KEYS = ["sgpa", "sgpapoints"];
const CGPA_KEYS = ["cgpa", "cgpapoints"];
const TERM_CREDIT_KEYS = ["earnedcredit", "totalearnedcredit", "totalcoursecredit", "registeredcredit"];
const TERM_POINT_KEYS = ["sgpapoints", "pointssecured", "points"];

function computeTermPoints(sgpa: number | null, credits: number | null): number | null {
  if (sgpa == null || credits == null) return null;
  return Math.round(sgpa * credits * 2) / 2;
}

/** Normalise semester rows into ordered terms, keeping only rows with a semester number. */
export function toTerms(rows: Row[] | null | undefined): Term[] {
  return (rows ?? [])
    .map((raw) => {
      const sgpa = toNumber(pick(raw, SGPA_KEYS));
      const cgpa = toNumber(pick(raw, CGPA_KEYS));
      const credits = toNumber(pick(raw, TERM_CREDIT_KEYS));
      const hasExplicitSgpa = toNumber(raw?.sgpa) != null;
      const rawPoints = toNumber(
        pick(raw, hasExplicitSgpa ? TERM_POINT_KEYS : ["pointssecured", "points"]),
      );
      const fallbackSgpaPoints =
        !hasExplicitSgpa && rawPoints == null ? toNumber(raw?.sgpapoints) : null;
      const pickedPoints =
        rawPoints ?? (fallbackSgpaPoints != null && fallbackSgpaPoints > 10 ? fallbackSgpaPoints : null);
      const points = pickedPoints ?? computeTermPoints(sgpa, credits);
      return {
        sty: toNumber(pick(raw, STY_KEYS)) ?? NaN,
        sgpa,
        cgpa,
        credits,
        points,
        raw,
      };
    })
    .filter((t) => Number.isFinite(t.sty) && t.sty > 0)
    .sort((a, b) => a.sty - b.sty);
}

const CODE_KEYS = ["subjectcode", "subjectno"];
const NAME_KEYS = ["subjectdesc", "subjectname", "subject"];
const GRADE_KEYS = ["grade", "gradeawarded", "gradecode"];
const CREDIT_KEYS = ["coursecreditpoint", "coursecredit", "coursecreditpoints", "credits", "credit", "earnedcredit"];
const GP_KEYS = ["gradepoint", "gradepoints"];
const POINT_KEYS = ["sgpapoints", "sgpapoint", "pointssecured", "points"];

/** Normalise grade-card / semester-detail subject rows. */
export function toCourses(rows: Row[] | null | undefined): CourseGrade[] {
  return (rows ?? [])
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const grade = String(pick(r, GRADE_KEYS) ?? "—").trim();
      const credits = toNumber(pick(r, CREDIT_KEYS));
      const gradePoint = toNumber(pick(r, GP_KEYS));
      const points = toNumber(pick(r, POINT_KEYS)) ?? (gradePoint != null && credits != null ? gradePoint * credits : null);
      const failFlag = String(pick(r, ["fail", "failflag", "isfail"]) ?? "").toUpperCase();
      return {
        code: String(pick(r, CODE_KEYS) ?? ""),
        name: String(pick(r, NAME_KEYS) ?? ""),
        grade,
        credits,
        gradePoint,
        points,
        maxPoints: credits != null ? credits * 10 : null,
        minor: String(r.minorsubject ?? "").toUpperCase() === "Y",
        fail: failFlag === "Y" || isFail(grade),
      };
    })
    .filter((c) => c.code || c.name);
}

/** Subject rows from a getSgpaDetail response, whichever list key it uses. */
export function detailRows(response: unknown): Row[] {
  if (!response || typeof response !== "object") return [];
  const r = response as Row;
  for (const key of ["semesterList", "subjectlist", "subjectList", "gradecard", "detail"]) {
    if (Array.isArray(r[key])) return r[key] as Row[];
  }
  return [];
}

export const isFail = (grade: string) => /^(F|E|I|AB|X)$/i.test(grade.trim());

/** Tight Y-range for the chart so small GPA movements stay legible. */
export function gpaRange(terms: Term[]): { min: number; max: number } {
  const values = terms.flatMap((t) => [t.sgpa, t.cgpa]).filter((v): v is number => v != null);
  if (values.length === 0) return { min: 0, max: 10 };
  const min = Math.max(0, Math.floor(Math.min(...values)) - 1);
  return { min, max: 10 };
}

export function formatGpa(value: number | null) {
  return value == null ? "—" : value.toFixed(2);
}

export function formatCredits(value: number | null) {
  return value == null ? "—" : Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

/** Courses that count toward SGPA (audit/pass-only subjects carry no credit). */
export function totals(courses: CourseGrade[]) {
  const graded = courses.filter((c) => (c.credits ?? 0) > 0 && c.points != null);
  const points = graded.reduce((sum, c) => sum + (c.points ?? 0), 0);
  const max = graded.reduce((sum, c) => sum + (c.maxPoints ?? 0), 0);
  const credits = graded.reduce((sum, c) => sum + (c.credits ?? 0), 0);
  return { points, max, credits, sgpa: credits > 0 ? points / credits : null, count: graded.length };
}

const UPPER_TOKENS = new Set([
  "2D", "3D", "4D",
  "DBMS", "RDBMS", "UI", "UX", "AI", "ML", "DL", "NLP", "OS", "COA", "CN",
  "OOP", "OOPS", "DSA", "DAA", "VLSI", "CMOS", "FPGA", "DSP", "PCB",
  "CAD", "CAM", "CNC", "SQL", "PHP", "HTML", "CSS", "XML", "API",
  "TCP", "IP", "HTTP", "AWS", "IT", "ICT", "CS", "CSE", "ECE", "ME", "CE",
  "IPR", "HRM", "ERP",
  "I", "II", "III", "IV", "V", "VI",
]);

const MIXED_TOKENS = new Map<string, string>([
  ["iot", "IoT"],
  ["nosql", "NoSQL"],
]);

const MINOR_WORDS = new Set(["of", "and", "for", "in", "to", "on", "with", "by"]);

function formatSubToken(token: string, forceCap: boolean): string {
  const match = token.match(/^([(\[{"']*)(.*?)([)\]}.,;:?!"']*)$/);
  if (!match) return token;
  const [, lead, core, trail] = match;
  if (!core) return token;

  const upper = core.toUpperCase();
  if (UPPER_TOKENS.has(upper)) return `${lead}${upper}${trail}`;

  const lower = core.toLowerCase();
  const mixed = MIXED_TOKENS.get(lower);
  if (mixed) return `${lead}${mixed}${trail}`;

  if (!forceCap && MINOR_WORDS.has(lower)) return `${lead}${lower}${trail}`;

  return `${lead}${lower.replace(/^[a-z]/, (c) => c.toUpperCase())}${trail}`;
}

/** Smart academic title-caser preserving acronyms, technical tokens, Roman numerals, and minor words. */
export function formatSubjectName(raw: string): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(\S)\s+-(?=\S)/g, "$1-")
    .replace(/(\S)-\s+(?=\S)/g, "$1-");
  if (!cleaned) return "";

  const words = cleaned.split(" ");
  let capitalizeNext = true;

  return words
    .map((word) => {
      const parts = word.split(/([/:-])/);
      let cap = capitalizeNext;
      const formatted = parts
        .map((part) => {
          if (!part) return "";
          if (part === "-" || part === ":" || part === "–" || part === "—") {
            cap = true;
            return part;
          }
          if (part === "/") return part;
          const out = formatSubToken(part, cap);
          cap = false;
          return out;
        })
        .join("");
      capitalizeNext = cap;
      return formatted;
    })
    .join(" ");
}

export const GRADE_SCALE = [
  { grade: "O", gp: 10 },
  { grade: "A+", gp: 9 },
  { grade: "A", gp: 8 },
  { grade: "B+", gp: 7 },
  { grade: "B", gp: 6 },
  { grade: "C", gp: 5 },
  { grade: "P", gp: 4 },
  { grade: "F", gp: 0 },
] as const;

export type LetterGrade = (typeof GRADE_SCALE)[number]["grade"];

const GRADE_POINT_MAP = new Map<string, number>(GRADE_SCALE.map((entry) => [entry.grade, entry.gp]));

/** Map a letter grade (e.g. "O", "A+", "F") to its 10-point grade point, or null if unknown. */
export function gradeToPoint(grade: string): number | null {
  const normalized = String(grade ?? "").trim().toUpperCase();
  const gp = GRADE_POINT_MAP.get(normalized);
  return gp !== undefined ? gp : null;
}

export interface ForecastCourse {
  id: string;
  name: string;
  credits: number;
  grade: LetterGrade;
}

export interface ForecastInput {
  sgpa: number;
  credits?: number;
  courses?: ForecastCourse[];
  useCourses?: boolean;
}

export interface CumulativeStats {
  completedTerms: number;
  credits: number;
  points: number;
  maxPoints: number;
  cgpa: number | null;
  defaultTermCredits: number;
}

function resolveTermPoints(term: Term): number | null {
  if (term.points !== undefined) return term.points;
  return computeTermPoints(term.sgpa, term.credits);
}

/** Aggregate cumulative credits, grade points, max points, and CGPA across terms (optionally up to `upToSty`). */
export function cumulativeStats(terms: Term[], upToSty?: number): CumulativeStats {
  const slice = (upToSty == null ? terms : terms.filter((t) => t.sty <= upToSty))
    .slice()
    .sort((a, b) => a.sty - b.sty);

  let credits = 0;
  let points = 0;
  let creditSumForAvg = 0;
  let creditTermCount = 0;

  for (const term of slice) {
    const termCredits = term.credits ?? 0;
    if (termCredits > 0) {
      creditSumForAvg += termCredits;
      creditTermCount += 1;
      const pts = resolveTermPoints(term);
      if (pts != null) {
        credits += termCredits;
        points += pts;
      }
    }
  }

  let fallbackCgpa: number | null = null;
  for (let i = slice.length - 1; i >= 0; i--) {
    if (slice[i].cgpa != null) {
      fallbackCgpa = slice[i].cgpa;
      break;
    }
  }

  const maxPoints = credits * 10;
  const cgpa = credits > 0 ? points / credits : fallbackCgpa;
  const defaultTermCredits =
    creditTermCount > 0 ? Math.round((creditSumForAvg / creditTermCount) * 2) / 2 : 21;

  return {
    completedTerms: slice.filter((t) => !t.forecasted).length,
    credits,
    points,
    maxPoints,
    cgpa,
    defaultTermCredits,
  };
}

/** Convert forecasted subject rows into CourseGrade entries for `totals()` and table rendering. */
export function forecastCoursesToGrades(courses: ForecastCourse[]): CourseGrade[] {
  return (courses ?? []).map((c) => {
    const credits = Number.isFinite(c.credits) && c.credits >= 0 ? c.credits : 0;
    const gradePoint = gradeToPoint(c.grade);
    return {
      code: "",
      name: c.name,
      grade: c.grade,
      credits,
      gradePoint,
      points: gradePoint != null ? gradePoint * credits : null,
      maxPoints: credits * 10,
      minor: false,
      fail: isFail(c.grade),
    };
  });
}

/** Drop forecasted terms at or below the latest published semester so upstream updates supersede old forecasts. */
export function pruneForecasts(
  actualTerms: Term[],
  forecasts: Record<number, ForecastInput>,
): Record<number, ForecastInput> {
  const maxActualSty = actualTerms.reduce((m, t) => Math.max(m, t.sty), 0);
  const actualStys = new Set(actualTerms.map((t) => t.sty));
  const next: Record<number, ForecastInput> = {};

  for (const [key, input] of Object.entries(forecasts ?? {})) {
    const sty = Number(key);
    if (!Number.isInteger(sty) || sty <= maxActualSty || actualStys.has(sty) || !input) continue;
    next[sty] = input;
  }

  return next;
}

/** Merge actual completed terms with forecasted future terms and compute running CGPA. */
export function projectTerms(actualTerms: Term[], forecasts: Record<number, ForecastInput>): Term[] {
  const baseStats = cumulativeStats(actualTerms);
  const pruned = pruneForecasts(actualTerms, forecasts);
  const combined: Term[] = actualTerms.map((t) => ({ ...t }));

  for (const [key, input] of Object.entries(pruned)) {
    const sty = Number(key);

    let credits: number | null;
    let points: number | null;
    let sgpa: number | null;

    if (input.useCourses && input.courses && input.courses.length > 0) {
      const sum = totals(forecastCoursesToGrades(input.courses));
      credits = sum.credits;
      points = sum.points;
      sgpa = sum.sgpa;
    } else {
      credits =
        input.credits != null && Number.isFinite(input.credits)
          ? Math.max(0, input.credits)
          : baseStats.defaultTermCredits;
      sgpa = Math.min(10, Math.max(0, Number.isFinite(input.sgpa) ? input.sgpa : 0));
      points = sgpa * credits;
    }

    combined.push({
      sty,
      sgpa,
      cgpa: null,
      credits,
      points,
      forecasted: true,
      raw: {},
    });
  }

  combined.sort((a, b) => a.sty - b.sty);

  let runningPoints = 0;
  let runningCredits = 0;
  let sawForecast = false;

  return combined.map((t) => {
    if (t.forecasted) sawForecast = true;
    const pts = resolveTermPoints(t);
    if ((t.credits ?? 0) > 0 && pts != null) {
      runningPoints += pts;
      runningCredits += t.credits!;
    }
    const computedCgpa = runningCredits > 0 ? runningPoints / runningCredits : t.cgpa;
    const cgpa = t.forecasted || sawForecast || t.cgpa == null ? computedCgpa : t.cgpa;
    return {
      ...t,
      points: pts,
      cgpa,
    };
  });
}

export interface TargetRequirement {
  targetCgpa: number;
  label: string;
  requiredSgpa: number;
  achievable: boolean;
  alreadyMet: boolean;
}

const DEFAULT_TARGETS = [7.5, 8.0, 8.5, 9.0];

/** Calculate SGPA required in the next semester (`futureCredits`) to reach target CGPAs. */
export function requiredSgpaForTargets(
  actualTerms: Term[],
  futureCredits?: number,
  targets?: number[],
): TargetRequirement[] {
  const stats = cumulativeStats(actualTerms);
  const cr = futureCredits ?? stats.defaultTermCredits;
  if (!Number.isFinite(cr) || cr <= 0) return [];

  const currentCgpa = stats.cgpa;
  const entries: Array<{ targetCgpa: number; label: string }> = (targets ?? DEFAULT_TARGETS).map(
    (targetCgpa) => ({
      targetCgpa,
      label: formatGpa(targetCgpa),
    }),
  );

  if (targets == null && currentCgpa != null) {
    const maintain = Math.round(currentCgpa * 100) / 100;
    if (!entries.some((e) => Math.abs(e.targetCgpa - maintain) < 0.005)) {
      entries.push({ targetCgpa: maintain, label: "Maintain" });
    }
  }

  return entries
    .map(({ targetCgpa, label }) => {
      const rawRequired = (targetCgpa * (stats.credits + cr) - stats.points) / cr;
      const requiredSgpa = rawRequired === 0 ? 0 : rawRequired;
      return {
        targetCgpa,
        label,
        requiredSgpa,
        achievable: requiredSgpa <= 10 && requiredSgpa >= 0,
        alreadyMet: currentCgpa != null && currentCgpa >= targetCgpa,
      };
    })
    .sort((a, b) => a.targetCgpa - b.targetCgpa);
}

export const CGPA_SLOTS = 8;
const CREDIT_CYCLE = [4, 3, 2, 1.5, 1] as const;

const DEFAULT_COURSE_TEMPLATE: ReadonlyArray<{ name: string; credits: number }> = [
  { name: "Theory Course 1", credits: 4 },
  { name: "Theory Course 2", credits: 4 },
  { name: "Theory Course 3", credits: 4 },
  { name: "Theory Course 4", credits: 3 },
  { name: "Theory Course 5", credits: 3 },
  { name: "Lab 1", credits: 1 },
  { name: "Lab 2", credits: 1 },
  { name: "Lab 3", credits: 1 },
];

export function nextCredit(current: number): number {
  const idx = CREDIT_CYCLE.findIndex((c) => Math.abs(c - current) < 0.01);
  return CREDIT_CYCLE[(idx + 1) % CREDIT_CYCLE.length];
}

export function nearestLetterGrade(sgpa: number): LetterGrade {
  let best: LetterGrade = "A";
  let bestDiff = Infinity;
  for (const entry of GRADE_SCALE) {
    if (entry.gp === 0) continue;
    const diff = Math.abs(entry.gp - sgpa);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry.grade;
    }
  }
  return best;
}

export function parseForecasts(raw: string | null): Record<number, ForecastInput> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const validGrades = new Set<string>(GRADE_SCALE.map((g) => g.grade));
    const out: Record<number, ForecastInput> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const sty = Number(k);
      if (!Number.isInteger(sty) || sty <= 0 || !v || typeof v !== "object") continue;
      const item = v as Record<string, unknown>;
      const sgpa = typeof item.sgpa === "number" && Number.isFinite(item.sgpa) ? item.sgpa : 8.0;
      const credits =
        typeof item.credits === "number" && Number.isFinite(item.credits) && item.credits > 0
          ? item.credits
          : undefined;
      const useCourses = typeof item.useCourses === "boolean" ? item.useCourses : undefined;
      const courses = Array.isArray(item.courses)
        ? item.courses
            .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
            .map((c, idx) => ({
              id: typeof c.id === "string" && c.id ? c.id : `c-${sty}-${idx}`,
              name: typeof c.name === "string" && c.name.trim() ? c.name : `Course ${idx + 1}`,
              credits: typeof c.credits === "number" && Number.isFinite(c.credits) && c.credits >= 0 ? c.credits : 3,
              grade: (typeof c.grade === "string" && validGrades.has(c.grade) ? c.grade : "A") as LetterGrade,
            }))
        : undefined;
      out[sty] = { sgpa, credits, useCourses, courses };
    }
    return out;
  } catch {
    return {};
  }
}

export function seedCoursesFromRows(cachedRows: Row[], sty: number, defaultSgpa: number): ForecastCourse[] {
  const grade = nearestLetterGrade(defaultSgpa);
  if (cachedRows.length > 0) {
    const seen = new Map<string, { name: string; credits: number | null; lab: boolean }>();
    for (const row of cachedRows) {
      const rawSubjectCode = String(row.subjectcode ?? "").trim();
      const parenMatch = rawSubjectCode.match(/^(.+?)\(([^)]+)\)$/);
      const rawCode = (parenMatch ? parenMatch[2] : rawSubjectCode).trim().toUpperCase();
      const rawName = String(row.subjectdesc ?? row.subjectname ?? row.subject ?? (parenMatch ? parenMatch[1] : rawSubjectCode)).trim();
      if (!rawCode && !rawName) continue;
      const formatted = formatSubjectName(rawName || rawCode);
      const key = rawCode || formatted.toUpperCase();
      const cr = toNumber(row.credits ?? row.coursecredit ?? row.coursecreditpoint ?? row.credit);
      const hasPracticalOnly = Boolean(row.Psubjectcomponentid) && !row.Lsubjectcomponentid && !row.Tsubjectcomponentid;
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, { name: formatted, credits: cr != null && cr > 0 ? cr : null, lab: hasPracticalOnly });
      } else {
        if (!prev.name && formatted) prev.name = formatted;
        if (prev.credits == null && cr != null && cr > 0) prev.credits = cr;
        if (hasPracticalOnly) prev.lab = true;
      }
    }
    if (seen.size > 0) {
      let idx = 0;
      return [...seen.values()].map((entry) => {
        const isLab = entry.lab || /\blab\b/i.test(entry.name);
        const credits = entry.credits ?? (isLab ? 1 : idx < 3 ? 4 : 3);
        const item: ForecastCourse = {
          id: `c-${sty}-${idx}`,
          name: entry.name,
          credits,
          grade,
        };
        idx += 1;
        return item;
      });
    }
  }

  return DEFAULT_COURSE_TEMPLATE.map((t, idx) => ({
    id: `c-${sty}-${idx}`,
    name: t.name,
    credits: t.credits,
    grade,
  }));
}

/** Smooth curve through points (Catmull-Rom as cubic Beziers) in a 0-100 box. */
export function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1] ?? points[i];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const [x3, y3] = points[i + 2] ?? points[i + 1];
    const t = 6;
    d += ` C${x1 + (x2 - x0) / t},${y1 + (y2 - y0) / t} ${x2 - (x3 - x1) / t},${y2 - (y3 - y1) / t} ${x2},${y2}`;
  }
  return d;
}
