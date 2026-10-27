import { usePageRefresh } from "../hooks/usePageRefresh";
import { useId, useMemo, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey, getCached } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { FEATURE_TTL } from "../lib/portalSchedule";
import { formatEventCode, groupSubjectMarks, mergeMarkRows, type MarkRow, type SubjectMarks } from "../lib/marks.ts";
import { SectionError, titleCase, formatSemester } from "../components/DataViews";
import { TopBar, SemesterPicker } from "../components/AppBar";
import { ChevronRight } from "../components/icons";
import type { SectionProps, Semester } from "../types";

export type { MarkRow };

interface MarksDetail {
  rows: MarkRow[];
}

interface MarksLatest extends MarksDetail {
  semesters: Semester[];
  registrationcode?: string | null;
}

function formatMark(value: unknown) {
  if (value == null || String(value).trim() === "") return "—";
  return Number.isFinite(Number(value)) ? Number(value) : String(value);
}

function MarkScore({ row }: { row: MarkRow }) {
  return (
    <span className="score-value">
      <strong>{formatMark(row.obtainedmarks)}</strong>
      <span className="score-total">/{formatMark(row.fullmarks)}</span>
    </span>
  );
}

function CourseHeader({ course }: { course: SubjectMarks }) {
  return (
    <>
      <span className="score-info">
        <span className="score-subject">{titleCase(course.subjectdesc || course.subjectcode || "Course")}</span>
        <span className="score-meta">
          {course.subjectcode && <span className="att-code">{course.subjectcode}</span>}
        </span>
      </span>
      <MarkScore row={course} />
      <span className="score-chevron" aria-hidden="true"><ChevronRight /></span>
    </>
  );
}

function CourseCard({ course }: { course: SubjectMarks }) {
  const [open, setOpen] = useState(false);
  const breakdownId = useId();
  const earned = Number(course.obtainedmarks);
  const maximum = Number(course.fullmarks);
  const percentage = maximum > 0 && Number.isFinite(earned) && String(course.obtainedmarks ?? "").trim() !== ""
    ? Math.min(100, Math.max(0, earned / maximum * 100))
    : null;
  const band = percentage === null ? "neutral" : percentage >= 80 ? "good" : percentage >= 60 ? "neutral" : percentage >= 40 ? "warning" : "low";
  return (
    <li className="score-card">
      <div className={`score-course${open ? " is-open" : ""}`}>
        <button type="button" className="score-header" aria-expanded={open} aria-controls={breakdownId} onClick={() => setOpen((value) => !value)}>
          <CourseHeader course={course} />
        </button>
        {percentage !== null && (
          <div className="score-progress" data-band={band} aria-hidden="true">
            <span style={{ width: `${percentage}%` }} />
          </div>
        )}
        <div id={breakdownId} className="score-expansion" aria-hidden={!open}>
          <div className="score-expansion-inner">
            <ul className="score-breakdown" aria-label={`${titleCase(course.subjectdesc || course.subjectcode || "Course")} exam marks`}>
              {course.exams.map((exam, index) => (
                <li key={index} className="score-exam">
                  <span className="score-exam-label">{formatEventCode(exam.eventcode) || "Exam"}</span>
                  <MarkScore row={exam} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </li>
  );
}

export function MarksSection({ session }: SectionProps) {
  const latestKey = sessionCacheKey("marks.latest", session);
  const lov = useFeature<MarksLatest>({
    run: async () => {
      const latest = await features.getMarksLatest(client, session);
      const previous = getCached<MarksLatest>(latestKey).data;
      const registrationid = latest.semesters[0]?.registrationid;
      const sameSemester = registrationid != null && String(registrationid) === String(previous?.semesters[0]?.registrationid);
      return { ...latest, rows: mergeMarkRows(sameSemester ? previous?.rows ?? [] : [], latest.rows) };
    },
    deps: [session],
    enabled: true,
    cacheKey: latestKey,
    staleTimeMs: FEATURE_TTL.marks,
    manualRefreshEnabled: () => semId === null || isDefault,
  });
  const [semId, setSemId, sem] = useSemester(sessionCacheKey("semester", session, "marks"), lov.data?.semesters);
  const isDefault = semId === String(lov.data?.semesters?.[0]?.registrationid);
  const detailKey = semId ? sessionCacheKey("marks.detail", session, semId) : undefined;
  const detail = useFeature<MarksDetail>({
    run: async () => {
      const latest = await features.getMarks(client, session, { registrationid: sem?.registrationid });
      return { ...latest, rows: mergeMarkRows(getCached<MarksDetail>(detailKey).data?.rows ?? [], latest.rows) };
    },
    deps: [session, semId],
    enabled: sem !== null && !isDefault,
    cacheKey: detailKey,
    staleTimeMs: FEATURE_TTL.marks,
  });

  const rawRows = isDefault ? (lov.data?.rows ?? []) : (detail.data?.rows ?? []);
  const semesters = lov.data?.semesters ?? [];
  const code = sem?.registrationcode ?? (isDefault ? lov.data?.registrationcode : undefined);
  const semLabel = formatSemester(code);
  const error = lov.error ?? detail.error;
  // Include the gaps between chained reads/semester selection, before their
  // effects start the next request. Those are still loading, not empty results.
  const loading = lov.loading || detail.loading || (!error && (
    lov.data === null || (semesters.length > 0 && sem === null) ||
    (sem !== null && !isDefault && detail.data === null)
  ));
  const retry = lov.error ? lov.retry : detail.retry;
  const courses = useMemo(() => groupSubjectMarks(rawRows), [rawRows]);

  const pageRefresh = usePageRefresh("marks", session, loading);

  return (
    <div className="page">
      <TopBar title="Marks" subtitle={semLabel || undefined} {...pageRefresh} refreshLabel="Refresh marks" />
      <div className="page-body">
        {semesters.length > 1 && (
          <div className="page-toolbar">
            <SemesterPicker semesters={semesters} value={semId} onChange={setSemId} disabled={loading} format={formatSemester} />
          </div>
        )}
        {loading && rawRows.length === 0 && <p className="muted page-note">Loading…</p>}
        {courses.length > 0 && (
          <ul className="score-list" aria-label="Marks by course">
            {courses.map((course, i) => (
              <CourseCard key={`${semId}:${course.subjectcode || course.subjectdesc || i}`} course={course} />
            ))}
          </ul>
        )}
        {lov.data && rawRows.length === 0 && !error && !loading && (
          <p className="muted page-note">No marks records found for {semLabel || "this semester"}. They show up here once faculty upload them.</p>
        )}
        {error && <SectionError label="Marks" error={error} retry={retry} />}
      </div>
    </div>
  );
}
