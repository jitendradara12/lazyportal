import { useMemo } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey, getCached } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { FEATURE_TTL } from "../lib/portalSchedule";
import {
  CollapsibleCard,
  ListSkeleton,
  SectionError,
  useCardState,
  titleCase,
  formatSemester,
} from "../components/DataViews";
import { subjectName } from "./attendance";
import type { SectionProps, Semester } from "../types";

export interface FacultyRow {
  subjectcode?: string;
  subjectdesc?: string;
  subjecttypedesc?: string;
  employeename?: string;
  credits?: string | number;
  subjectcomponentcode?: string;
  [key: string]: unknown;
}

export interface GroupedCourseFaculty {
  key: string;
  code: string;
  courseName: string;
  courseType: string;
  credits: string;
  instructors: { name: string; components: string[] }[];
}

export function groupCoursesAndFaculty(
  rows: FacultyRow[],
  catalog?: ReadonlyMap<string, { name?: string; type?: string }>,
  extraSubjects?: FacultyRow[],
): GroupedCourseFaculty[] {
  const byKey = new Map<string, GroupedCourseFaculty>();
  const ensure = (r: FacultyRow, fallbackKey: string): GroupedCourseFaculty => {
    const parsed = subjectName(r.subjectcode);
    const rawCode = String(r.subjectcode ?? "").trim();
    const code = parsed.badge || rawCode;
    const normCode = code.toUpperCase();
    const key = normCode || fallbackKey;
    const cat = normCode ? catalog?.get(normCode) : undefined;
    const explicitDesc = r.subjectdesc ? titleCase(r.subjectdesc) : "";
    const parsedDesc = parsed.badge ? parsed.name : "";
    const courseName = explicitDesc || parsedDesc || cat?.name || "";
    const courseType = (r.subjecttypedesc ? titleCase(r.subjecttypedesc) : "") || cat?.type || "";
    const credits = r.credits != null && String(r.credits).trim() !== "" ? String(r.credits).trim() : "";

    let existing = byKey.get(key);
    if (!existing) {
      existing = {
        key,
        code,
        courseName,
        courseType,
        credits,
        instructors: [],
      };
      byKey.set(key, existing);
    } else {
      if (!existing.courseName && courseName) existing.courseName = courseName;
      if (!existing.courseType && courseType) existing.courseType = courseType;
      if (!existing.credits && credits) existing.credits = credits;
    }
    return existing;
  };

  rows.forEach((r, i) => {
    const entry = ensure(r, `row-${i}`);
    const emp = r.employeename ? titleCase(r.employeename) : "";
    const comp = r.subjectcomponentcode ? String(r.subjectcomponentcode).trim().toUpperCase() : "";
    if (emp) {
      const existingInst = entry.instructors.find((inst) => inst.name.toLowerCase() === emp.toLowerCase());
      if (existingInst) {
        if (comp && !existingInst.components.includes(comp)) existingInst.components.push(comp);
      } else {
        entry.instructors.push({ name: emp, components: comp ? [comp] : [] });
      }
    }
  });

  if (extraSubjects?.length) {
    extraSubjects.forEach((r, i) => {
      ensure(r, `sub-${i}`);
    });
  }

  return [...byKey.values()];
}

export function FacultySection({ session }: SectionProps) {
  const card = useCardState("faculty", false);
  const lov = useFeature<Semester[]>({
    run: () => features.getFacultyRegistrations(client, session),
    deps: [session],
    enabled: card.hasExpanded,
    cacheKey: sessionCacheKey("faculty.lov", session),
    staleTimeMs: FEATURE_TTL.faculty,
    manualRefreshEnabled: card.isOpen,
  });
  const [semId, setSemId, sem] = useSemester(sessionCacheKey("semester", session, "faculty"), lov.data);
  const detail = useFeature<{ rows: FacultyRow[]; totalcreditpoints?: unknown }>({
    run: () => features.getFaculties(client, session, { registrationid: sem?.registrationid }),
    deps: [session, semId],
    enabled: card.hasExpanded && sem !== null,
    cacheKey: semId ? sessionCacheKey("faculty.detail", session, semId) : undefined,
    staleTimeMs: FEATURE_TTL.faculty,
    manualRefreshEnabled: card.isOpen,
  });

  const rows = detail.data?.rows ?? [];
  const semesters = lov.data ?? [];
  const isDefault = semId != null && semId === String(semesters[0]?.registrationid);

  const courses = useMemo(() => {
    const catalog = new Map<string, { name?: string; type?: string }>();
    const addCatalogRow = (r: { subjectcode?: string; subjectdesc?: string; subjecttypedesc?: string }) => {
      const parsed = subjectName(r.subjectcode);
      const code = (parsed.badge || String(r.subjectcode ?? "").trim()).toUpperCase();
      if (!code) return;
      const name = r.subjectdesc ? titleCase(r.subjectdesc) : (parsed.badge ? parsed.name : "");
      const type = r.subjecttypedesc ? titleCase(r.subjecttypedesc) : "";
      const prev = catalog.get(code);
      catalog.set(code, {
        name: prev?.name || name || undefined,
        type: prev?.type || type || undefined,
      });
    };

    const cachedSubjects = getCached<{ rows?: FacultyRow[] }>(sessionCacheKey("subjects.latest", session)).data?.rows ?? [];
    const cachedAttInitial = getCached<{ rows?: FacultyRow[] }>(sessionCacheKey("att.initial", session)).data?.rows ?? [];
    const cachedAttDetail = semId ? (getCached<{ rows?: FacultyRow[] }>(sessionCacheKey("att.detail", session, semId)).data?.rows ?? []) : [];
    const cachedMarksLatest = getCached<{ rows?: FacultyRow[] }>(sessionCacheKey("marks.latest", session)).data?.rows ?? [];
    const cachedMarksDetail = semId ? (getCached<{ rows?: FacultyRow[] }>(sessionCacheKey("marks.detail", session, semId)).data?.rows ?? []) : [];

    for (const r of [...cachedSubjects, ...cachedAttInitial, ...cachedAttDetail, ...cachedMarksLatest, ...cachedMarksDetail]) {
      addCatalogRow(r);
    }

    return groupCoursesAndFaculty(rows, catalog, isDefault && rows.length > 0 ? cachedSubjects : undefined);
  }, [rows, session, semId, isDefault]);

  const semLabel = formatSemester(sem?.registrationcode ?? sem?.registrationdesc);
  const error = lov.error ?? detail.error;
  const loading = lov.loading || detail.loading || (!error && card.hasExpanded && (
    lov.data === null || (semesters.length > 0 && sem === null) || (sem !== null && detail.data === null)
  ));
  const retry = lov.error ? lov.retry : detail.retry;
  const totalCredits = detail.data?.totalcreditpoints != null ? String(detail.data.totalcreditpoints).trim() : "";
  const badgeText = courses.length > 0
    ? `${courses.length} ${courses.length === 1 ? "course" : "courses"}${totalCredits ? ` · ${totalCredits} cr` : ""}`
    : (semLabel ? semLabel.toLowerCase() : "Courses, teachers & credits");
  const hasAction = Boolean(totalCredits) || semesters.length > 1;

  return (
    <CollapsibleCard
      id="faculty"
      title="Faculty & courses"
      badge={badgeText}
      defaultOpen={false}
      isOpen={card.isOpen}
      onToggle={card.toggle}
      action={
        hasAction ? (
          <div className="more-card-toolbar">
            {totalCredits ? (
              <span className="more-credits-pill">
                Total credits: <strong>{totalCredits}</strong>
              </span>
            ) : <span />}
            {semesters.length > 1 && (
              <select
                value={semId ?? ""}
                onChange={(e) => setSemId(e.target.value)}
                disabled={loading}
                className="sem-picker"
                aria-label="Select semester"
              >
                {semesters.map((s) => (
                  <option key={String(s.registrationid)} value={String(s.registrationid)}>
                    {formatSemester(s.registrationcode ?? s.registrationdesc)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : undefined
      }
    >
      {loading && courses.length === 0 && <ListSkeleton rows={3} label="Loading…" variant="inline" />}
      {courses.length > 0 && (
        <ul className="more-data-list" aria-label="Courses and faculty">
          {courses.map((course) => {
            const headline = course.courseName || course.instructors.map((i) => i.name).join(", ") || course.code || "Course";
            const showInstructorsInMeta = Boolean(course.courseName) && course.instructors.length > 0;
            return (
              <li key={course.key} className="more-data-row">
                <div className="more-data-main">
                  <span className="more-data-title">{headline}</span>
                  <span className="more-data-meta">
                    {course.code && <span className="att-code">{course.code}</span>}
                    {showInstructorsInMeta ? (
                      course.instructors.map((inst, idx) => (
                        <span key={idx} className="more-faculty-chip">
                          {inst.components.length > 0 && (
                            <span className="att-log-type-tag">{inst.components.join("/")}</span>
                          )}
                          <span>{inst.name}</span>
                        </span>
                      ))
                    ) : (
                      course.instructors.flatMap((inst) => inst.components).map((comp, idx) => (
                        <span key={idx} className="att-log-type-tag">{comp}</span>
                      ))
                    )}
                  </span>
                </div>
                {(course.courseType || course.credits) && (
                  <div className="more-data-trailing-group">
                    {course.courseType && <span className="more-data-tag">{course.courseType}</span>}
                    {course.credits && <span className="more-data-trailing">{course.credits} cr</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {lov.data && courses.length === 0 && !error && !loading && (
        <p className="muted">No course or faculty records found for {semLabel || "this semester"}.</p>
      )}
      {error && <SectionError label="Faculty" error={error} retry={retry} />}
    </CollapsibleCard>
  );
}
