import { useEffect, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { FEATURE_TTL } from "../lib/portalSchedule";
import { SectionError, countdown, titleCase, formatSemester } from "../components/DataViews";
import { TopBar, SemesterPicker } from "../components/AppBar";
import type { SectionProps, Semester } from "../types";
import { examTimes, groupExams, formatExamRoom, cleanExamSubject, type ExamRow } from "../lib/exams";

interface ExamEvent {
  exameventid?: string;
  exameventdesc?: string;
}

function examEventLabel(e: ExamEvent): string {
  return e.exameventdesc ?? String(e.exameventid ?? "");
}

export function ExamsSection({ session }: SectionProps) {
  const examSems = useFeature<Semester[]>({
    run: () => features.getExamSemesters(client, session),
    deps: [session],
    enabled: true,
    cacheKey: sessionCacheKey("exams.sems", session),
    staleTimeMs: FEATURE_TTL.exams,
  });
  const [examSemId, setExamSemId, examSem] = useSemester(sessionCacheKey("semester", session, "exams"), examSems.data);
  const examEvents = useFeature<ExamEvent[]>({
    run: () => features.getExamEvents(client, session, { registrationid: examSemId }),
    deps: [session, examSemId],
    enabled: examSem !== null,
    cacheKey: examSem ? sessionCacheKey("exams.events", session, examSemId) : undefined,
    staleTimeMs: FEATURE_TTL.exams,
  });
  const [examEventId, setExamEventId] = useState<string | null>(null);

  // Resolve the event during render so semester changes never read the old
  // event or briefly claim that the next step in the chain has no schedules.
  const selectedEvent = examEvents.data?.find((e) => String(e.exameventid) === examEventId)
    ?? examEvents.data?.[0];
  const activeEventId = selectedEvent?.exameventid != null ? String(selectedEvent.exameventid) : null;

  const examRows = useFeature<ExamRow[]>({
    run: () =>
      features.getExamSchedule(client, session, { registrationid: examSemId, exameventid: activeEventId }),
    deps: [session, examSemId, activeEventId],
    enabled: examSem !== null && activeEventId !== null,
    cacheKey: examSem && activeEventId ? sessionCacheKey("exams.rows", session, examSemId, activeEventId) : undefined,
    staleTimeMs: FEATURE_TTL.exams,
  });

  const error = examSems.error ?? examEvents.error ?? examRows.error;
  const loading = examSems.loading || examEvents.loading || examRows.loading || (!error && (
    examSems.data === null || (examSems.data.length > 0 && examSem === null) ||
    (examSem !== null && examEvents.data === null) ||
    (activeEventId !== null && examRows.data === null)
  ));
  const retry = () => {
    examSems.retry();
    examEvents.retry();
    examRows.retry();
  };

  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const rows = examRows.data ?? [];
  const { upcoming, past, undated } = groupExams(rows, now);
  const [next, ...later] = upcoming;
  const semLabel = formatSemester(examSem?.registrationcode ?? examSem?.registrationdesc);

  return (
    <div className="page">
      <TopBar title="Exams" subtitle={semLabel || undefined} busy={loading} refreshLabel="Refresh exams" />
      <div className="page-body">
        {((examEvents.data?.length ?? 0) > 1 || (examSems.data?.length ?? 0) > 1) && (
          <div className="page-toolbar">
            {examEvents.data && examEvents.data.length > 1 && (
              <div className="chip-row" role="tablist" aria-label="Exam event">
                {examEvents.data.map((e) => (
                  <button key={String(e.exameventid)} type="button" role="tab" aria-selected={String(e.exameventid) === activeEventId}
                    className={`chip-btn ${String(e.exameventid) === activeEventId ? "active" : ""}`}
                    onClick={() => setExamEventId(String(e.exameventid))} disabled={loading}>
                    {examEventLabel(e)}
                  </button>
                ))}
              </div>
            )}
            <SemesterPicker semesters={examSems.data ?? []} value={examSemId} disabled={loading} format={formatSemester}
              onChange={(id) => { setExamSemId(id); setExamEventId(null); }} />
          </div>
        )}
        {loading && rows.length === 0 && <p className="muted page-note">Loading…</p>}
        {next && <ExamCard row={next} now={now} featured />}
        {later.length > 0 && <div className="exam-list">{later.map((r, i) => <ExamCard key={i} row={r} now={now} />)}</div>}
        {rows.length > 0 && upcoming.length === 0 && !loading && (
          <p className="muted page-note">No upcoming exams. Past schedules are below.</p>
        )}
        {undated.length > 0 && (
          <>
            <h2 className="page-subhead">Date not announced</h2>
            <div className="exam-list">{undated.map((r, i) => <ExamCard key={i} row={r} now={now} />)}</div>
          </>
        )}
        {past.length > 0 && (
          <details className="past-exams" key={`${examSemId}:${activeEventId}`}>
            <summary>Past exams ({past.length})</summary>
            <div className="exam-list">{past.map((r, i) => <ExamCard key={i} row={r} now={now} />)}</div>
          </details>
        )}
        {rows.length === 0 && !error && !loading && (
          <p className="muted page-note">No exam schedule published for this semester yet.</p>
        )}
        {error && <SectionError label="Exams" error={error} retry={retry} />}
      </div>
    </div>
  );
}

const IST = "Asia/Kolkata";

function examTimeRange(r: ExamRow): string {
  if (r.datetimeupto && /to/i.test(r.datetimeupto)) return r.datetimeupto;
  if (r.datetimefrom && r.datetimeupto) return `${r.datetimefrom} to ${r.datetimeupto}`;
  return r.datetimefrom ?? r.datetimeupto ?? "";
}

function ExamCard({ row, now, featured = false }: { row: ExamRow; now: number; featured?: boolean }) {
  const times = examTimes(row);
  const d = times ? new Date(times.start) : null;
  const when = !times ? null : now >= times.start && now < times.end ? "Now" : times.start > now ? countdown(times.start - now) : null;
  const room = formatExamRoom(row.roomcode);
  return (
    <article className={`exam-card ${featured ? "is-next" : ""}`}>
      <div className="exam-date" aria-hidden={d ? "true" : undefined}>
        {d ? (
          <>
            <span className="exam-day">{d.toLocaleDateString("en-IN", { day: "numeric", timeZone: IST })}</span>
            <span className="exam-month">{d.toLocaleDateString("en-IN", { month: "short", timeZone: IST })}</span>
            <span className="exam-weekday">{d.toLocaleDateString("en-IN", { weekday: "short", timeZone: IST })}</span>
          </>
        ) : (
          <span className="exam-month">TBA</span>
        )}
      </div>
      <div className="exam-body">
        <div className="exam-head">
          <h3 className="exam-subject">{titleCase(cleanExamSubject(row.subjectdesc))}</h3>
          {when && <span className="exam-when">{when}</span>}
        </div>
        <span className="exam-time">{d ? examTimeRange(row) : row.datetime ?? "Date not announced"}</span>
        <div className="exam-seat">
          <span className="exam-tag"><span className="exam-tag-label">Room</span> {room}</span>
          <span className="exam-tag"><span className="exam-tag-label">Seat</span> {row.seatno ?? "—"}</span>
        </div>
      </div>
    </article>
  );
}
