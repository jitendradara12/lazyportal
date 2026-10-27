import { usePageRefresh } from "../hooks/usePageRefresh";
import { Fragment, useId, useMemo, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey, getCached } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { FEATURE_TTL } from "../lib/portalSchedule";
import { readPdfText } from "../lib/readPdfText";
import {
  diffMarkRows,
  formatEventCode,
  getScoreBand,
  groupSubjectMarks,
  markRowKey,
  mergeMarkRows,
  type MarkRow,
  type SubjectMarks,
} from "../lib/marks.ts";
import { SectionError, titleCase, formatSemester } from "../components/DataViews";
import { TopBar, SemesterPicker } from "../components/AppBar";
import { ChevronRight } from "../components/icons";
import type { SectionProps, Semester } from "../types";

export type { MarkRow };

interface MarksDetail {
  rows: MarkRow[];
  updatedKeys?: string[];
  historyRecovered?: boolean;
  historyError?: string;
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
    <span className="score-value" data-band={getScoreBand(row)}>
      <strong>{formatMark(row.obtainedmarks)}</strong>
      <span className="score-total">/{formatMark(row.fullmarks)}</span>
    </span>
  );
}

function CourseHeader({
  course,
  expandable,
  updatedSet,
}: {
  course: SubjectMarks;
  expandable: boolean;
  updatedSet: ReadonlySet<string>;
}) {
  const examItems = course.exams
    .map((exam) => ({
      label: formatEventCode(exam.eventcode),
      isNew: updatedSet.has(markRowKey(exam) ?? ""),
    }))
    .filter((item) => item.label);

  return (
    <>
      <span className="score-info">
        <span className="score-subject">{titleCase(course.subjectdesc || course.subjectcode || "Course")}</span>
        <span className="score-meta">
          {course.subjectcode && <span className="att-code">{course.subjectcode}</span>}
          {course.subjectcode && examItems.length > 0 && (
            <span className="score-meta-sep" aria-hidden="true"> · </span>
          )}
          {examItems.length > 0 && (
            <span className="score-meta-exams">
              {examItems.map((item, idx) => (
                <Fragment key={idx}>
                  {idx > 0 && <span className="score-meta-comma">, </span>}
                  <span className={`score-meta-exam${item.isNew ? " is-new" : ""}`}>{item.label}</span>
                </Fragment>
              ))}
            </span>
          )}
          {expandable && (
            <span className="score-chevron" aria-hidden="true">
              <ChevronRight />
            </span>
          )}
        </span>
      </span>
      <MarkScore row={course} />
    </>
  );
}

function CourseCard({
  course,
  updatedSet,
}: {
  course: SubjectMarks;
  updatedSet: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const breakdownId = useId();
  const expandable = course.exams.length > 1;
  return (
    <li className="score-card">
      <div className={`score-course${expandable && open ? " is-open" : ""}`}>
        {expandable ? (
          <>
            <button
              type="button"
              className="score-header"
              aria-expanded={open}
              aria-controls={breakdownId}
              onClick={() => setOpen((value) => !value)}
            >
              <CourseHeader course={course} expandable updatedSet={updatedSet} />
            </button>
            <div id={breakdownId} className="score-expansion" aria-hidden={!open}>
              <div className="score-expansion-inner">
                <ul className="score-breakdown" aria-label={`${titleCase(course.subjectdesc || course.subjectcode || "Course")} exam marks`}>
                  {course.exams.map((exam, index) => {
                    const isNew = updatedSet.has(markRowKey(exam) ?? "");
                    return (
                      <li key={index} className={`score-exam${isNew ? " is-new" : ""}`}>
                        <span className="score-exam-label">
                          {formatEventCode(exam.eventcode) || "Exam"}
                          {isNew && <span className="score-new-badge">New</span>}
                        </span>
                        <MarkScore row={exam} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </>
        ) : (
          <div className="score-header is-static">
            <CourseHeader course={course} expandable={false} updatedSet={updatedSet} />
          </div>
        )}
      </div>
    </li>
  );
}

export function MarksSection({ session }: SectionProps) {
  const latestKey = sessionCacheKey("marks.latest", session);
  const lov = useFeature<MarksLatest>({
    run: async () => {
      const latest = await features.getMarksLatest(client, session, { readPdfText });
      const previous = getCached<MarksLatest>(latestKey).data;
      const registrationid = latest.semesters[0]?.registrationid;
      const sameSemester = registrationid != null && String(registrationid) === String(previous?.semesters[0]?.registrationid);
      const prevRows = sameSemester ? previous?.rows ?? [] : [];
      const updatedKeys = sameSemester && previous?.historyRecovered !== false ? diffMarkRows(prevRows, latest.rows) : [];
      return { ...latest, rows: mergeMarkRows(prevRows, latest.rows), updatedKeys };
    },
    deps: [session],
    enabled: true,
    cacheKey: latestKey,
    staleTimeMs: FEATURE_TTL.marks,
    isFresh: () => getCached<MarksLatest>(latestKey).data?.historyRecovered === true,
    manualRefreshEnabled: () => semId === null || isDefault,
  });
  const [semId, setSemId, sem] = useSemester(sessionCacheKey("semester", session, "marks"), lov.data?.semesters);
  const isDefault = semId === String(lov.data?.semesters?.[0]?.registrationid);
  const detailKey = semId ? sessionCacheKey("marks.detail", session, semId) : undefined;
  const detail = useFeature<MarksDetail>({
    run: async () => {
      const latest = await features.getMarks(client, session, { registrationid: sem?.registrationid, registrationcode: sem?.registrationcode, readPdfText });
      const previous = getCached<MarksDetail>(detailKey).data;
      const prevRows = previous?.rows ?? [];
      const updatedKeys = previous?.historyRecovered !== false ? diffMarkRows(prevRows, latest.rows) : [];
      return { ...latest, rows: mergeMarkRows(prevRows, latest.rows), updatedKeys };
    },
    deps: [session, semId],
    enabled: sem !== null && !isDefault,
    cacheKey: detailKey,
    staleTimeMs: FEATURE_TTL.marks,
    isFresh: () => getCached<MarksDetail>(detailKey).data?.historyRecovered === true,
  });

  const rawRows = isDefault ? (lov.data?.rows ?? []) : (detail.data?.rows ?? []);
  const updatedKeys = isDefault ? (lov.data?.updatedKeys ?? []) : (detail.data?.updatedKeys ?? []);
  const updatedSet = useMemo(() => new Set(updatedKeys), [updatedKeys]);
  const semesters = lov.data?.semesters ?? [];
  const code = sem?.registrationcode ?? (isDefault ? lov.data?.registrationcode : undefined);
  const semLabel = formatSemester(code);
  const error = lov.error ?? detail.error ?? (isDefault ? lov.data?.historyError : detail.data?.historyError);
  // Include the gaps between chained reads/semester selection, before their
  // effects start the next request. Those are still loading, not empty results.
  const loading = lov.loading || detail.loading || (!error && (
    lov.data === null || (semesters.length > 0 && sem === null) ||
    (sem !== null && !isDefault && detail.data === null)
  ));
  const retry = lov.error || (isDefault && lov.data?.historyError) ? lov.retry : detail.retry;
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
              <CourseCard key={`${semId}:${course.subjectcode || course.subjectdesc || i}`} course={course} updatedSet={updatedSet} />
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
