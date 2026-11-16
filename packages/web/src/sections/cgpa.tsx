import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey, getCached } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { usePersistentState } from "../hooks/usePersistentState";
import { usePageRefresh } from "../hooks/usePageRefresh";
import { FEATURE_TTL } from "../lib/portalSchedule";
import { selectionHaptic } from "../lib/nativeInteractions";
import {
  GRADE_SCALE,
  cumulativeStats,
  detailRows,
  forecastCoursesToGrades,
  formatCredits,
  formatGpa,
  formatSubjectName,
  gpaRange,
  projectTerms,
  pruneForecasts,
  requiredSgpaForTargets,
  toCourses,
  toNumber,
  toTerms,
  totals,
  type CourseGrade,
  type ForecastCourse,
  type ForecastInput,
  type LetterGrade,
  type TargetRequirement,
  type Term,
} from "../lib/cgpa";
import { SectionError, ListSkeleton, formatSemester } from "../components/DataViews";
import { TopBar, SemesterPicker } from "../components/AppBar";
import type { SectionProps, Semester } from "../types";

type Row = Record<string, unknown>;

interface SgpaLatest {
  student: { studentid?: string; stynumber?: string | number } | null;
  currentsem?: string | number | null;
  semesters: Row[];
}

interface GradesLatest {
  info: { branchid?: string; programid?: string } | null;
  semesters: Semester[];
  registrationcode?: string | null;
  rows: Row[];
}

const SLOTS = 8;
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

function nextCredit(current: number): number {
  const idx = CREDIT_CYCLE.findIndex((c) => Math.abs(c - current) < 0.01);
  return CREDIT_CYCLE[(idx + 1) % CREDIT_CYCLE.length];
}

function nearestLetterGrade(sgpa: number): LetterGrade {
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

function parseForecasts(raw: string | null): Record<number, ForecastInput> {
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

function seedCoursesFromCache(
  session: SectionProps["session"],
  sty: number,
  defaultSgpa: number,
): ForecastCourse[] {
  const grade = nearestLetterGrade(defaultSgpa);
  const subjectsData = getCached<{ rows?: Row[] }>(sessionCacheKey("subjects.latest", session)).data;
  const facultyLatest = getCached<{ rows?: Row[] }>(sessionCacheKey("faculty.latest", session)).data;
  let facultyRows = facultyLatest?.rows ?? [];
  if (facultyRows.length === 0) {
    const lov = getCached<Semester[]>(sessionCacheKey("faculty.lov", session)).data;
    const firstSemId = lov?.[0]?.registrationid;
    if (firstSemId != null) {
      facultyRows = getCached<{ rows?: Row[] }>(sessionCacheKey("faculty.detail", session, String(firstSemId))).data?.rows ?? [];
    }
  }
  const cachedRows = [...(subjectsData?.rows ?? []), ...facultyRows];

  if (cachedRows.length > 0) {
    const seen = new Map<string, { name: string; credits: number | null }>();
    for (const row of cachedRows) {
      const rawCode = String(row.subjectcode ?? "").trim().toUpperCase();
      const rawName = String(row.subjectdesc ?? row.subjectname ?? row.subject ?? row.subjectcode ?? "").trim();
      if (!rawCode && !rawName) continue;
      const formatted = formatSubjectName(rawName || rawCode);
      const key = rawCode || formatted.toUpperCase();
      const cr = toNumber(row.credits ?? row.coursecredit ?? row.coursecreditpoint ?? row.credit);
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, { name: formatted, credits: cr != null && cr > 0 ? cr : null });
      } else {
        if (!prev.name && formatted) prev.name = formatted;
        if (prev.credits == null && cr != null && cr > 0) prev.credits = cr;
      }
    }
    if (seen.size > 0) {
      let idx = 0;
      return [...seen.values()].map((entry) => {
        const isLab = /\blab\b/i.test(entry.name);
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

/** Smooth curve through points (Catmull-Rom as cubic Béziers) in a 0–100 box. */
function smoothPath(points: [number, number][]) {
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

function GpaChart({
  terms,
  selected,
  onSelect,
}: {
  terms: Term[];
  selected?: number | null;
  onSelect?: (sty: number) => void;
}) {
  const slots = Math.max(SLOTS, terms.at(-1)?.sty ?? 0);
  const { min, max } = gpaRange(terms);
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const bySty = new Map(terms.map((t) => [t.sty, t]));

  const cgpaTerms = terms.filter((t) => t.cgpa != null);
  const toPoint = (t: Term): [number, number] => [((t.sty - 0.5) / slots) * 100, 100 - pct(t.cgpa!)];

  const actualDots = cgpaTerms.filter((t) => !t.forecasted).map((t) => ({ term: t, pt: toPoint(t) }));
  const forecastDots = cgpaTerms.filter((t) => t.forecasted).map((t) => ({ term: t, pt: toPoint(t) }));
  const actualLinePts = actualDots.map((d) => d.pt);
  const forecastLinePts =
    forecastDots.length > 0
      ? [...(actualLinePts.length > 0 ? [actualLinePts[actualLinePts.length - 1]] : []), ...forecastDots.map((d) => d.pt)]
      : [];
  const allDots = [...actualDots, ...forecastDots];
  const hasForecasts = forecastDots.length > 0 || terms.some((t) => t.forecasted);

  const ticks = [];
  for (let v = Math.ceil(min); v <= max; v += max - min > 4 ? 2 : 1) ticks.push(v);

  return (
    <figure className="gpa-chart" style={{ "--slots": slots } as CSSProperties}>
      <div className="gpa-plot">
        <div className="gpa-grid" aria-hidden="true">
          {ticks.map((v) => (
            <span key={v} className="gpa-tick" style={{ bottom: `${pct(v)}%` }}>
              <span>{v}</span>
            </span>
          ))}
        </div>
        <div className="gpa-cols" role={onSelect ? "radiogroup" : undefined} aria-label={onSelect ? "Semester" : undefined}>
          {Array.from({ length: slots }, (_, i) => {
            const sty = i + 1;
            const term = bySty.get(sty);
            const active = sty === selected;

            if (!onSelect) {
              return (
                <div key={sty} className="gpa-col is-future" aria-hidden="true">
                  <span className="gpa-track"><span className="gpa-bar" /></span>
                  <span className="gpa-label">S{sty}</span>
                </div>
              );
            }

            if (!term) {
              return (
                <button
                  key={sty}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`Forecast Semester ${sty}`}
                  className={`gpa-col is-future${active ? " is-active" : ""}`}
                  onClick={() => {
                    selectionHaptic();
                    onSelect(sty);
                  }}
                >
                  <span className="gpa-track">
                    <span className="gpa-bar">
                      <span className="gpa-future-plus" aria-hidden="true">+</span>
                    </span>
                  </span>
                  <span className="gpa-label">S{sty}</span>
                </button>
              );
            }

            const barPct = term.sgpa == null ? 0 : pct(term.sgpa);
            const dotPct = term.cgpa == null ? null : pct(term.cgpa);
            const hitsDot = dotPct != null && dotPct >= barPct - 4 && dotPct <= barPct + 14;
            const valueStyle: CSSProperties = {
              bottom: hitsDot && dotPct != null ? `calc(${Math.max(barPct, dotPct)}% + 10px)` : `calc(${barPct}% + 4px)`,
            };

            return (
              <button
                key={sty}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={
                  term.forecasted
                    ? `Forecast Semester ${sty}: SGPA ${formatGpa(term.sgpa)}, Projected CGPA ${formatGpa(term.cgpa)}`
                    : `Semester ${sty}: SGPA ${formatGpa(term.sgpa)}, CGPA ${formatGpa(term.cgpa)}`
                }
                className={`gpa-col${term.forecasted ? " is-forecast" : ""}${active ? " is-active" : ""}`}
                onClick={() => {
                  if (active) return;
                  selectionHaptic();
                  onSelect(sty);
                }}
              >
                <span className="gpa-track">
                  <span className="gpa-bar" style={{ height: `${barPct}%` }} />
                  <span className="gpa-bar-value" style={valueStyle}>
                    {formatGpa(term.sgpa)}
                  </span>
                </span>
                <span className="gpa-label">S{sty}</span>
              </button>
            );
          })}
        </div>
        {allDots.length > 0 && (
          <div className="gpa-line" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              {actualLinePts.length >= 2 && (
                <path d={smoothPath(actualLinePts)} vectorEffect="non-scaling-stroke" />
              )}
              {forecastLinePts.length >= 2 && (
                <path
                  className="is-forecast"
                  d={smoothPath(forecastLinePts)}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            {allDots.map(({ term, pt: [x, y] }) => (
              <span
                key={term.sty}
                className={`gpa-dot${term.forecasted ? " is-forecast" : ""}${term.sty === selected ? " is-active" : ""}`}
                style={{ left: `${x}%`, top: `${y}%` }}
              />
            ))}
          </div>
        )}
      </div>
      {onSelect && (
        <figcaption className="gpa-legend">
          <span className="gpa-key is-bar">SGPA</span>
          <span className="gpa-key is-line">CGPA</span>
          {hasForecasts && <span className="gpa-key is-forecast">Forecast</span>}
        </figcaption>
      )}
    </figure>
  );
}

function PointsCell({ course }: { course: CourseGrade }) {
  if (!course.credits) return <td className="num paper-points is-nil">—</td>;
  return (
    <td className="num paper-points">
      <strong>{formatCredits(course.points)}</strong>
      <span className="paper-of">/{formatCredits(course.maxPoints)}</span>
    </td>
  );
}

function PaperTable({ caption, courses }: { caption: string; courses: CourseGrade[] }) {
  const sum = totals(courses);
  return (
    <table className="paper-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Subject</th>
          <th scope="col" className="grade-col">Grade</th>
          <th scope="col" className="num">Points</th>
        </tr>
      </thead>
      <tbody>
        {courses.map((c, i) => {
          const nonCredit = !c.credits;
          const note = [c.minor && "Minor", nonCredit && "Non-credit", c.fail && "Fail"].filter(Boolean).join(" · ");
          return (
            <tr key={`${c.code}:${i}`} className={`${c.fail ? "is-fail" : ""}${nonCredit ? " is-nil" : ""}`}>
              <th scope="row">
                <span className="paper-subject">{formatSubjectName(c.name || c.code)}</span>
                {note && <span className="paper-note">{note}</span>}
              </th>
              <td className="paper-grade">{c.grade}</td>
              <PointsCell course={c} />
            </tr>
          );
        })}
      </tbody>
      {sum.count > 0 && (
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="grade-col" />
            <td className="num paper-points">
              <strong>{formatCredits(sum.points)}</strong>
              <span className="paper-of">/{formatCredits(sum.max)}</span>
            </td>
          </tr>
          {sum.sgpa != null && (
            <tr className="paper-sum">
              <td colSpan={3}>
                {formatCredits(sum.points)} points ÷ {formatCredits(sum.credits)} credits = <strong>{formatGpa(sum.sgpa)}</strong> SGPA
              </td>
            </tr>
          )}
        </tfoot>
      )}
    </table>
  );
}

function ForecastWorkbench({
  sty,
  term,
  forecast,
  defaultCredits,
  targets,
  session,
  onUpdate,
  onResetTerm,
}: {
  sty: number;
  term: Term | null;
  forecast: ForecastInput;
  defaultCredits: number;
  targets: TargetRequirement[];
  session: SectionProps["session"];
  onUpdate: (next: ForecastInput) => void;
  onResetTerm: () => void;
}) {
  const useCourses = Boolean(forecast.useCourses);
  const courses = forecast.courses ?? [];
  const courseGrades = useMemo(() => forecastCoursesToGrades(courses), [courses]);
  const courseTotals = useMemo(() => totals(courseGrades), [courseGrades]);

  const activeCredits = useCourses && courses.length > 0
    ? courseTotals.credits
    : (forecast.credits ?? defaultCredits);
  const effectiveSgpa = term?.sgpa ?? forecast.sgpa;

  const setSgpa = (nextSgpa: number) => {
    const clamped = Math.min(10, Math.max(4, Math.round(nextSgpa * 100) / 100));
    onUpdate({ ...forecast, sgpa: clamped, useCourses: false });
  };

  const stepSgpa = (delta: number) => {
    selectionHaptic();
    const base = Math.min(10, Math.max(4, effectiveSgpa));
    setSgpa(Math.round((base + delta) * 100) / 100);
  };

  const stepCredits = (delta: number) => {
    if (useCourses) return;
    selectionHaptic();
    const next = Math.min(40, Math.max(1, Math.round((activeCredits + delta) * 2) / 2));
    onUpdate({ ...forecast, credits: next });
  };

  const setPlannerMode = (bySubject: boolean) => {
    if (bySubject === useCourses) return;
    selectionHaptic();
    if (bySubject) {
      const seeded = courses.length > 0 ? courses : seedCoursesFromCache(session, sty, effectiveSgpa);
      onUpdate({ ...forecast, useCourses: true, courses: seeded });
    } else {
      const carriedSgpa =
        courseTotals.sgpa != null
          ? Math.min(10, Math.max(4, Math.round(courseTotals.sgpa * 100) / 100))
          : forecast.sgpa;
      onUpdate({ ...forecast, useCourses: false, sgpa: carriedSgpa });
    }
  };

  const selectTarget = (req: TargetRequirement) => {
    if (!req.achievable) return;
    selectionHaptic();
    const nextSgpa = Math.min(10, Math.max(0, Math.round(req.requiredSgpa * 1000) / 1000));
    onUpdate({
      ...forecast,
      sgpa: nextSgpa,
      credits: activeCredits,
      useCourses: false,
    });
  };

  const updateCourse = (id: string, patch: Partial<ForecastCourse>) => {
    const nextCourses = courses.map((c) => (c.id === id ? { ...c, ...patch } : c));
    onUpdate({ ...forecast, useCourses: true, courses: nextCourses });
  };

  const removeCourse = (id: string) => {
    if (courses.length <= 1) return;
    selectionHaptic();
    const nextCourses = courses.filter((c) => c.id !== id);
    onUpdate({ ...forecast, useCourses: true, courses: nextCourses });
  };

  const addCourse = () => {
    selectionHaptic();
    const n = courses.length + 1;
    const nextCourses: ForecastCourse[] = [
      ...courses,
      {
        id: `c-${sty}-${Date.now()}-${n}`,
        name: `Course ${n}`,
        credits: 3,
        grade: nearestLetterGrade(effectiveSgpa),
      },
    ];
    onUpdate({ ...forecast, useCourses: true, courses: nextCourses });
  };

  return (
    <section className="cgpa-term cgpa-forecast-bench" aria-labelledby="cgpa-term-title">
      <div className="cgpa-term-head">
        <div className="cgpa-term-title-group">
          <h2 id="cgpa-term-title">Semester {sty}</h2>
          <span className="cgpa-forecast-badge">Forecast</span>
          <button type="button" className="cgpa-bench-reset" onClick={onResetTerm}>
            Reset
          </button>
        </div>
        <dl className="cgpa-term-stats">
          <div><dt>SGPA</dt><dd>{formatGpa(term?.sgpa ?? effectiveSgpa)}</dd></div>
          <div><dt>CGPA</dt><dd>{formatGpa(term?.cgpa ?? null)}</dd></div>
        </dl>
      </div>

      <div className="cgpa-bench-bar">
        <div className="segmented-pill-toggle cgpa-bench-mode" role="radiogroup" aria-label="Forecast input mode">
          <button
            type="button"
            role="radio"
            aria-checked={!useCourses}
            className={`segmented-pill ${!useCourses ? "active" : ""}`}
            onClick={() => setPlannerMode(false)}
          >
            Quick slider
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={useCourses}
            className={`segmented-pill ${useCourses ? "active" : ""}`}
            onClick={() => setPlannerMode(true)}
          >
            By subject
          </button>
        </div>

        <div className={`cgpa-credits-stepper${useCourses ? " is-disabled" : ""}`} aria-label="Semester credits">
          <button
            type="button"
            className="cgpa-step-btn"
            onClick={() => stepCredits(-0.5)}
            disabled={useCourses || activeCredits <= 1}
            aria-label="Decrease credits"
          >
            −
          </button>
          <span className="cgpa-credits-val">{formatCredits(activeCredits)} cr</span>
          <button
            type="button"
            className="cgpa-step-btn"
            onClick={() => stepCredits(0.5)}
            disabled={useCourses || activeCredits >= 40}
            aria-label="Increase credits"
          >
            +
          </button>
        </div>
      </div>

      {!useCourses && (
        <div className="cgpa-scrubber">
          <div className="cgpa-scrubber-head">
            <label htmlFor={`sgpa-slider-${sty}`}>Expected SGPA</label>
            <span className="cgpa-scrubber-val">{formatGpa(effectiveSgpa)}</span>
          </div>
          <div className="cgpa-scrubber-row">
            <button
              type="button"
              className="cgpa-step-btn"
              onClick={() => stepSgpa(-0.1)}
              disabled={effectiveSgpa <= 4}
              aria-label="Decrease SGPA by 0.10"
            >
              −
            </button>
            <input
              id={`sgpa-slider-${sty}`}
              type="range"
              className="cgpa-slider"
              min={4}
              max={10}
              step={0.05}
              value={Math.min(10, Math.max(4, effectiveSgpa))}
              onChange={(e) => setSgpa(Number(e.target.value))}
              aria-label={`Semester ${sty} expected SGPA`}
            />
            <button
              type="button"
              className="cgpa-step-btn"
              onClick={() => stepSgpa(0.1)}
              disabled={effectiveSgpa >= 10}
              aria-label="Increase SGPA by 0.10"
            >
              +
            </button>
          </div>
        </div>
      )}

      {targets.length > 0 && (
        <div className="cgpa-targets" role="group" aria-label="Target CGPA presets">
          {targets.map((req) => {
            const isKeep = req.label === "Maintain";
            const isActive =
              !useCourses &&
              req.achievable &&
              Math.abs(effectiveSgpa - req.requiredSgpa) < 0.025;
            const chipText = !req.achievable
              ? req.alreadyMet && req.requiredSgpa < 0
                ? `${formatGpa(req.targetCgpa)} CGPA (already met)`
                : `${formatGpa(req.targetCgpa)} CGPA (needs >10 in 1 sem)`
              : isKeep
              ? `Keep ${formatGpa(req.targetCgpa)} → ${formatGpa(req.requiredSgpa)} SGPA`
              : `${formatGpa(req.targetCgpa)} CGPA → ${formatGpa(req.requiredSgpa)} SGPA`;

            return (
              <button
                key={`${req.label}:${req.targetCgpa}`}
                type="button"
                disabled={!req.achievable}
                className={`cgpa-target-chip${isActive ? " is-active" : ""}${!req.achievable ? " is-unreachable" : ""}`}
                onClick={() => selectTarget(req)}
              >
                {chipText}
              </button>
            );
          })}
        </div>
      )}

      {useCourses && (
        <table className="paper-table planner-table">
          <caption className="sr-only">Semester {sty} subject grade planner</caption>
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col" className="grade-col">Grade</th>
              <th scope="col" className="num">Points</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c, idx) => {
              const cg = courseGrades[idx];
              const nonCredit = !cg.credits;
              return (
                <tr key={c.id} className={`${cg.fail ? "is-fail" : ""}${nonCredit ? " is-nil" : ""}`}>
                  <th scope="row">
                    <span className="paper-subject">{c.name}</span>
                    <span className="planner-row-controls">
                      <button
                        type="button"
                        className="planner-credit-btn"
                        onClick={() => {
                          selectionHaptic();
                          updateCourse(c.id, { credits: nextCredit(c.credits) });
                        }}
                        aria-label={`Change credits for ${c.name}, currently ${formatCredits(c.credits)}`}
                      >
                        {formatCredits(c.credits)} cr
                      </button>
                      <button
                        type="button"
                        className="planner-remove-btn"
                        onClick={() => removeCourse(c.id)}
                        disabled={courses.length <= 1}
                        aria-label={`Remove ${c.name}`}
                      >
                        ×
                      </button>
                    </span>
                  </th>
                  <td className="paper-grade">
                    <div className="planner-grade-wrap">
                      <select
                        className="planner-grade-select"
                        value={c.grade}
                        onChange={(e) => {
                          selectionHaptic();
                          updateCourse(c.id, { grade: e.target.value as LetterGrade });
                        }}
                        aria-label={`Grade for ${c.name}`}
                      >
                        {GRADE_SCALE.map((entry) => (
                          <option key={entry.grade} value={entry.grade}>
                            {entry.grade}
                          </option>
                        ))}
                      </select>
                      <svg className="planner-grade-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </td>
                  <PointsCell course={cg} />
                </tr>
              );
            })}
            <tr className="planner-add-row">
              <td colSpan={3}>
                <button type="button" className="planner-add-btn" onClick={addCourse}>
                  + Add subject
                </button>
              </td>
            </tr>
          </tbody>
          {courseTotals.count > 0 && (
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="grade-col" />
                <td className="num paper-points">
                  <strong>{formatCredits(courseTotals.points)}</strong>
                  <span className="paper-of">/{formatCredits(courseTotals.max)}</span>
                </td>
              </tr>
              {courseTotals.sgpa != null && (
                <tr className="paper-sum">
                  <td colSpan={3}>
                    {formatCredits(courseTotals.points)} points ÷ {formatCredits(courseTotals.credits)} credits = <strong>{formatGpa(courseTotals.sgpa)}</strong> SGPA
                  </td>
                </tr>
              )}
            </tfoot>
          )}
        </table>
      )}
    </section>
  );
}

function UnavailableMessage({
  semester,
  compact = false,
}: {
  semester?: string | number | null;
  compact?: boolean;
}) {
  return (
    <div className={`cgpa-empty${compact ? " is-compact" : ""}`}>
      <h2>Results aren't on JUET's portal yet</h2>
      <p>
        Your SGPA, CGPA and grade card show up here once JUET publishes them
        {semester ? ` — you're in semester ${semester} now.` : "."}
      </p>
    </div>
  );
}

export function CgpaPanel({ session, modeToggle }: SectionProps & { modeToggle: ReactNode }) {
  const stale = FEATURE_TTL.marks;
  const lov = useFeature<SgpaLatest>({
    run: () => features.getSgpaLatest(client, session),
    deps: [session],
    enabled: true,
    cacheKey: sessionCacheKey("marks.cgpa.latest", session),
    staleTimeMs: stale,
  });
  const actualTerms = useMemo(() => toTerms(lov.data?.semesters), [lov.data]);
  const hasTerms = actualTerms.length > 0;

  const forecastKey = sessionCacheKey("marks.cgpa.forecast", session);
  const [rawForecasts, setRawForecasts] = usePersistentState(forecastKey, null);
  const rawParsedForecasts = useMemo(() => parseForecasts(rawForecasts), [rawForecasts]);
  const forecasts = useMemo(
    () => (hasTerms ? pruneForecasts(actualTerms, rawParsedForecasts) : rawParsedForecasts),
    [hasTerms, actualTerms, rawParsedForecasts],
  );

  useEffect(() => {
    if (!hasTerms) return;
    if (Object.keys(forecasts).length < Object.keys(rawParsedForecasts).length) {
      setRawForecasts(Object.keys(forecasts).length === 0 ? null : JSON.stringify(forecasts));
    }
  }, [hasTerms, forecasts, rawParsedForecasts, setRawForecasts]);

  const saveForecasts = (next: Record<number, ForecastInput>) => {
    setRawForecasts(Object.keys(next).length === 0 ? null : JSON.stringify(next));
  };

  const projectedTerms = useMemo(() => projectTerms(actualTerms, forecasts), [actualTerms, forecasts]);
  const hasForecasts = projectedTerms.some((t) => Boolean(t.forecasted));
  const actualStats = useMemo(() => cumulativeStats(actualTerms), [actualTerms]);
  const latestActual = actualTerms.at(-1) ?? null;
  const latestActualSty = latestActual?.sty ?? null;

  const [picked, setPicked] = useState<number | null>(null);
  const [prevLatestSty, setPrevLatestSty] = useState<number | null>(latestActualSty);
  if (latestActualSty !== prevLatestSty) {
    setPrevLatestSty(latestActualSty);
    if (latestActualSty != null && (prevLatestSty == null || latestActualSty > prevLatestSty)) {
      if (picked != null && picked <= latestActualSty) setPicked(latestActualSty);
    }
  }

  const slots = Math.max(SLOTS, projectedTerms.at(-1)?.sty ?? 0);
  const fallbackSty = projectedTerms.at(-1)?.sty ?? latestActual?.sty ?? null;
  const selected =
    picked != null && (projectedTerms.some((t) => t.sty === picked) || (picked >= 1 && picked <= slots))
      ? picked
      : fallbackSty;

  const activeTerm = projectedTerms.find((t) => t.sty === selected) ?? latestActual;
  const isActualSelected = selected != null && actualTerms.some((t) => t.sty === selected);
  const isForecastSelected = Boolean(activeTerm?.forecasted);
  const studentid = lov.data?.student?.studentid;
  const detailSty = isActualSelected ? selected : latestActual?.sty ?? null;

  const detail = useFeature<unknown>({
    run: () => features.getSgpaDetail(client, session, { studentid, stynumber: detailSty }),
    deps: [session, detailSty, studentid],
    enabled: hasTerms && detailSty != null && !!studentid,
    cacheKey:
      hasTerms && detailSty != null
        ? sessionCacheKey("marks.cgpa.detail", session, detailSty)
        : undefined,
    staleTimeMs: stale,
  });

  // Fallback: the grade card endpoint, only when SGPA has nothing.
  const useCard = lov.data != null && !hasTerms && !lov.error;
  const card = useFeature<GradesLatest>({
    run: () => features.getGradesLatest(client, session),
    deps: [session],
    enabled: useCard,
    cacheKey: sessionCacheKey("marks.grades.latest", session),
    staleTimeMs: stale,
  });
  const [regId, setRegId, reg] = useSemester(sessionCacheKey("semester", session, "grades"), card.data?.semesters);
  const isDefaultReg = regId === String(card.data?.semesters?.[0]?.registrationid);
  const cardDetail = useFeature<Row[]>({
    run: () =>
      features.getGradeCard(client, session, {
        registrationid: reg?.registrationid,
        branchid: card.data?.info?.branchid,
        programid: card.data?.info?.programid,
      }),
    deps: [session, regId, card.data?.info?.branchid, card.data?.info?.programid],
    enabled: useCard && reg !== null && !isDefaultReg && Boolean(card.data?.info),
    cacheKey: regId ? sessionCacheKey("marks.grades.detail", session, regId) : undefined,
    staleTimeMs: stale,
  });

  const courses = useMemo(() => toCourses(detailRows(detail.data)), [detail.data]);
  const cardCourses = useMemo(
    () => toCourses(isDefaultReg ? card.data?.rows : cardDetail.data),
    [isDefaultReg, card.data, cardDetail.data],
  );
  const cardSemesters = card.data?.semesters ?? [];

  const loadingLov = lov.data == null && !lov.error;
  const loadingCard = useCard && card.data == null && !card.error;
  const busy = lov.loading || detail.loading || card.loading || cardDetail.loading || lov.refreshing || detail.refreshing || card.refreshing || cardDetail.refreshing;
  const pageRefresh = usePageRefresh("marks", session, busy);

  const activeIdx = projectedTerms.findIndex((t) => t.sty === selected);
  const prevTerm = activeIdx > 0 ? projectedTerms[activeIdx - 1] : null;
  const delta =
    activeTerm?.cgpa != null && prevTerm?.cgpa != null ? activeTerm.cgpa - prevTerm.cgpa : null;
  const cumStats = useMemo(
    () => (selected != null ? cumulativeStats(projectedTerms, selected) : null),
    [projectedTerms, selected],
  );

  const handleSelectSlot = (sty: number) => {
    const isActual = actualTerms.some((t) => t.sty === sty);
    if (!isActual && !forecasts[sty]) {
      const baseCgpa = latestActual?.cgpa ?? actualStats.cgpa;
      const defaultSgpa = baseCgpa != null ? Math.min(10, Math.max(4, Math.round(baseCgpa * 10) / 10)) : 8.0;
      saveForecasts({
        ...forecasts,
        [sty]: { sgpa: defaultSgpa, credits: actualStats.defaultTermCredits },
      });
    }
    setPicked(sty);
  };

  const resetAllForecasts = () => {
    selectionHaptic();
    saveForecasts({});
    setPicked(latestActual?.sty ?? null);
  };

  const resetTermForecast = (sty: number) => {
    selectionHaptic();
    const next = { ...forecasts };
    delete next[sty];
    saveForecasts(next);
    const remaining = projectedTerms.filter((t) => t.sty !== sty);
    const remainingPrior = remaining.filter((t) => t.sty < sty);
    setPicked(remainingPrior.at(-1)?.sty ?? remaining.at(0)?.sty ?? latestActual?.sty ?? null);
  };

  const activeForecast = selected != null && !isActualSelected ? forecasts[selected] : undefined;
  const activeForecastCredits = useMemo(() => {
    if (!activeForecast) return actualStats.defaultTermCredits;
    if (activeForecast.useCourses && activeForecast.courses && activeForecast.courses.length > 0) {
      return totals(forecastCoursesToGrades(activeForecast.courses)).credits || actualStats.defaultTermCredits;
    }
    return activeForecast.credits ?? actualStats.defaultTermCredits;
  }, [activeForecast, actualStats.defaultTermCredits]);

  const targetRequirements = useMemo(() => {
    if (selected == null || isActualSelected) return [];
    const priorTerms = projectedTerms.filter((t) => t.sty < selected);
    return requiredSgpaForTargets(priorTerms, activeForecastCredits);
  }, [selected, isActualSelected, projectedTerms, activeForecastCredits]);

  const isPortalEmpty =
    useCard && card.data != null && !card.error && !cardDetail.loading && cardCourses.length === 0;
  const showTermsOrForecast = hasTerms || (isPortalEmpty && projectedTerms.length > 0);
  const portalSemester = lov.data?.currentsem ?? lov.data?.student?.stynumber;

  const subtitle = showTermsOrForecast && selected != null
    ? `Semester ${selected}${isForecastSelected ? " · Forecast" : ""}`
    : useCard && cardCourses.length > 0 && reg
    ? formatSemester(reg.registrationcode)
    : undefined;

  return (
    <div className="page">
      <TopBar title="Results" subtitle={subtitle} {...pageRefresh} refreshLabel="Refresh results" />
      <div className="page-body cgpa-page">
        <div className="page-toolbar">
          {modeToggle}
          {useCard && cardSemesters.length > 1 && cardCourses.length > 0 && (
            <SemesterPicker semesters={cardSemesters} value={regId} onChange={setRegId} disabled={cardDetail.loading} format={formatSemester} />
          )}
        </div>

        {lov.error && <SectionError label="CGPA" error={lov.error} retry={lov.retry} />}
        {(loadingLov || loadingCard) && <ListSkeleton rows={3} label="Loading…" />}

        {showTermsOrForecast && (
          <>
            <header className="cgpa-hero">
              <div className="cgpa-hero-top">
                <p className="cgpa-hero-label">
                  {isForecastSelected ? "Projected CGPA" : "Cumulative GPA"}
                </p>
                {(isForecastSelected || hasForecasts) && (
                  <div className="cgpa-hero-badges">
                    <span className="cgpa-forecast-badge">
                      {isForecastSelected ? "Forecast" : "Forecast saved"}
                    </span>
                    <button type="button" className="cgpa-reset-link" onClick={resetAllForecasts}>
                      Reset forecast
                    </button>
                  </div>
                )}
              </div>
              <p className="cgpa-hero-figure">
                <span className="cgpa-hero-value">{formatGpa(activeTerm?.cgpa ?? latestActual?.cgpa ?? null)}</span>
                <span className="cgpa-hero-scale">/ 10</span>
              </p>
              <p className="cgpa-hero-meta">
                <span>After semester {activeTerm?.sty ?? selected}</span>
                {delta != null && Math.abs(delta) >= 0.005 && prevTerm && (
                  <span className={`cgpa-delta ${delta > 0 ? "is-up" : "is-down"}`}>
                    {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)} from S{prevTerm.sty}
                  </span>
                )}
                {cumStats && cumStats.credits > 0 && (
                  <span className="cgpa-hero-pts">
                    · {formatCredits(cumStats.points)}/{formatCredits(cumStats.maxPoints)} pts ({formatCredits(cumStats.credits)} cr)
                  </span>
                )}
              </p>
            </header>

            <GpaChart terms={projectedTerms} selected={selected} onSelect={handleSelectSlot} />

            {isActualSelected && (
              <section className="cgpa-term" aria-labelledby="cgpa-term-title">
                <div className="cgpa-term-head">
                  <h2 id="cgpa-term-title">Semester {selected}</h2>
                  <dl className="cgpa-term-stats">
                    <div><dt>SGPA</dt><dd>{formatGpa(activeTerm?.sgpa ?? null)}</dd></div>
                    <div><dt>CGPA</dt><dd>{formatGpa(activeTerm?.cgpa ?? null)}</dd></div>
                  </dl>
                </div>
                {detail.loading && courses.length === 0 && <ListSkeleton rows={3} variant="inline" label="Loading subjects…" />}
                {courses.length > 0 && <PaperTable caption={`Semester ${selected} grades`} courses={courses} />}
                {detail.error && courses.length === 0 && (
                  <SectionError label={`Semester ${selected} subjects`} error={detail.error} retry={detail.retry} />
                )}
                {detail.data != null && !detail.loading && !detail.error && courses.length === 0 && (
                  <p className="muted page-note">JUET hasn't published subject grades for semester {selected}.</p>
                )}
              </section>
            )}

            {!isActualSelected && selected != null && activeForecast && (
              <ForecastWorkbench
                sty={selected}
                term={activeTerm}
                forecast={activeForecast}
                defaultCredits={actualStats.defaultTermCredits}
                targets={targetRequirements}
                session={session}
                onUpdate={(next) => saveForecasts({ ...forecasts, [selected]: next })}
                onResetTerm={() => resetTermForecast(selected)}
              />
            )}

            {isPortalEmpty && <UnavailableMessage semester={portalSemester} compact />}
          </>
        )}

        {useCard && card.error && <SectionError label="Grade card" error={card.error} retry={card.retry} />}
        {useCard && cardDetail.error && <SectionError label="Grade card" error={cardDetail.error} retry={cardDetail.retry} />}
        {useCard && cardCourses.length > 0 && (
          <section className="cgpa-term">
            <div className="cgpa-term-head">
              <h2>{formatSemester(reg?.registrationcode) || "Grade card"}</h2>
            </div>
            <PaperTable caption="Grade card" courses={cardCourses} />
          </section>
        )}
        {isPortalEmpty && projectedTerms.length === 0 && (
          <>
            <GpaChart terms={projectedTerms} selected={selected} onSelect={handleSelectSlot} />
            <UnavailableMessage semester={portalSemester} />
          </>
        )}
      </div>
    </div>
  );
}
