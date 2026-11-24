import { usePageRefresh } from "../hooks/usePageRefresh";
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import { selectionHaptic } from "../lib/nativeInteractions";
import { CgpaPanel } from "./cgpa";
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
  partitionSubjectMarks,
  type MarkRow,
  type SubjectMarks,
} from "../lib/marks.ts";
import { SectionError, ListSkeleton, titleCase, formatSemester } from "../components/DataViews";
import { TopBar, SemesterPicker } from "../components/AppBar";
import { AlertsPromptBanner } from "../components/AlertsPromptBanner";
import { ChevronRight } from "../components/icons";
import { useTabRefresh } from "../hooks/useAlerts";
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
  registrationid?: string | null;
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

function ScoreGroup({
  title,
  headingId,
  items,
  semId,
  updatedSet,
}: {
  title?: string;
  headingId?: string;
  items: SubjectMarks[];
  semId: string | null;
  updatedSet: ReadonlySet<string>;
}) {
  const list = (
    <ul
      className="score-list"
      role="list"
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : "Marks by course"}
    >
      {items.map((course, i) => (
        <CourseCard key={`${semId}:${course.subjectcode || course.subjectdesc || i}`} course={course} updatedSet={updatedSet} />
      ))}
    </ul>
  );
  if (!title) return list;
  return (
    <div className="score-group">
      <h2 className="score-group-title" id={headingId}>{title}</h2>
      {list}
    </div>
  );
}

const MODES = [
  { value: "marks", label: "Marks" },
  { value: "cgpa", label: "CGPA" },
] as const;

/** Results tab: in-semester marks or SGPA/CGPA + grades, behind one toggle. */
export function MarksSection(props: SectionProps) {
  const [stored, setMode] = usePersistentState("results.mode", "marks");
  const mode = stored === "cgpa" ? "cgpa" : "marks";
  const toggle = (
    <div className="segmented-pill-toggle results-toggle" role="radiogroup" aria-label="Results view">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={mode === m.value}
          className={`segmented-pill ${mode === m.value ? "active" : ""}`}
          onClick={() => {
            if (mode === m.value) return;
            selectionHaptic();
            setMode(m.value);
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
  return mode === "cgpa" ? <CgpaPanel {...props} modeToggle={toggle} /> : <MarksPanel {...props} modeToggle={toggle} />;
}

function MarksPanel({ session, modeToggle }: SectionProps & { modeToggle: ReactNode }) {
  const headingBaseId = useId();
  const latestKey = sessionCacheKey("marks.latest", session);
  const [discovered, setDiscovered] = useState<{ key: string; semesters: Semester[] } | null>(null);
  const lov = useFeature<MarksLatest>({
    run: async () => {
      const latest = await features.getMarksLatest(client, session, {
        readPdfText,
        onSemesters: (sems) => setDiscovered({ key: latestKey, semesters: sems }),
      });
      const previous = getCached<MarksLatest>(latestKey).data;
      const registrationid = latest.registrationid ?? latest.semesters[0]?.registrationid;
      const prevRegistrationid = previous?.registrationid ?? previous?.semesters[0]?.registrationid;
      const sameSemester = registrationid != null && String(registrationid) === String(prevRegistrationid);
      const prevRows = sameSemester ? previous?.rows ?? [] : [];
      const updatedKeys = sameSemester && previous?.historyRecovered !== false ? diffMarkRows(prevRows, latest.rows) : [];
      return { ...latest, rows: mergeMarkRows(prevRows, latest.rows), updatedKeys };
    },
    deps: [session],
    enabled: true,
    cacheKey: latestKey,
    staleTimeMs: FEATURE_TTL.marks,
    isFresh: (updatedAt) => {
      const cached = getCached<MarksLatest>(latestKey).data;
      if (cached?.historyRecovered !== true) return false;
      // A 1-semester cache has no semester selector yet; recheck weekly (matching LOV TTL)
      // instead of daily so 1st-semester students do not re-download the marks PDF every day.
      if ((cached.semesters?.length ?? 0) <= 1 && (!updatedAt || Date.now() - updatedAt > FEATURE_TTL.lov)) return false;
      return true;
    },
  });
  const semesters = (discovered?.key === latestKey ? discovered.semesters : null) ?? lov.data?.semesters ?? [];
  const defaultSemId = lov.data?.registrationid ?? semesters[0]?.registrationid;
  const selectableSemesters = lov.data || lov.error ? semesters : undefined;
  const [semId, setSemId, sem] = useSemester(
    sessionCacheKey("semester", session, "marks"),
    selectableSemesters?.length ? selectableSemesters : undefined,
    undefined,
    lov.data?.registrationid,
  );
  const isDefault = semesters.length > 0 && semId === String(defaultSemId);
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

  const showDefault = semesters.length === 0 || isDefault;
  const rawRows = showDefault ? (lov.data?.rows ?? []) : (detail.data?.rows ?? []);
  const updatedKeys = showDefault ? (lov.data?.updatedKeys ?? []) : (detail.data?.updatedKeys ?? []);
  const updatedSet = useMemo(() => new Set(updatedKeys), [updatedKeys]);
  const code = sem?.registrationcode ?? (showDefault ? lov.data?.registrationcode : undefined);
  const semLabel = formatSemester(code);
  const error = showDefault
    ? (lov.error ?? lov.data?.historyError)
    : (detail.error ?? detail.data?.historyError);
  // Include the gaps between chained reads/semester selection, before their
  // effects start the next request. Those are still loading, not empty results.
  const loading = showDefault
    ? (lov.loading || (!error && (lov.data === null || (semesters.length > 0 && sem === null))))
    : (detail.loading || (!error && (sem === null || detail.data === null)));
  const retry = showDefault ? lov.retry : detail.retry;
  const { courses, labs } = useMemo(
    () => partitionSubjectMarks(groupSubjectMarks(rawRows)),
    [rawRows],
  );
  const hasBothGroups = courses.length > 0 && labs.length > 0;

  const pageRefresh = usePageRefresh(
    "marks",
    session,
    loading || lov.refreshing || detail.refreshing,
    () => (showDefault ? lov.refresh() : detail.refresh()),
  );

  useTabRefresh("marks", () => {
    void Promise.allSettled([
      lov.refresh(),
      ...(!isDefault && semId !== null ? [detail.refresh()] : []),
    ]);
  });

  return (
    <div className="page">
      <TopBar title="Results" subtitle={semLabel || undefined} {...pageRefresh} refreshLabel="Refresh marks" />
      <div className="page-body">
        <div className="page-toolbar">
          {modeToggle}
          {semesters.length > 1 && (
            <SemesterPicker semesters={semesters} value={semId} onChange={setSemId} disabled={loading} format={formatSemester} />
          )}
        </div>
        <AlertsPromptBanner />
        {loading && rawRows.length === 0 && <ListSkeleton rows={4} label="Loading…" />}
        {courses.length > 0 && (
          <ScoreGroup
            title={hasBothGroups ? "Courses" : undefined}
            headingId={`${headingBaseId}-courses`}
            items={courses}
            semId={semId}
            updatedSet={updatedSet}
          />
        )}
        {labs.length > 0 && (
          <ScoreGroup
            title="Labs"
            headingId={`${headingBaseId}-labs`}
            items={labs}
            semId={semId}
            updatedSet={updatedSet}
          />
        )}
        {(showDefault ? lov.data : detail.data) && rawRows.length === 0 && !error && !loading && (
          <p className="muted page-note">No marks records found for {semLabel || "this semester"}. They show up here once faculty upload them.</p>
        )}
        {error && <SectionError label="Marks" error={error} retry={retry} />}
      </div>
    </div>
  );
}
