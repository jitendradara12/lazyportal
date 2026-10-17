import { useEffect, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { FEATURE_TTL } from "../lib/portalSchedule";
import {
  CollapsibleCard,
  SectionError,
  useCardState,
  countdown,
  titleCase,
  formatSemester,
} from "../components/DataViews";
import type { SectionProps, Semester } from "../types";
import { examTimes, groupExams, type ExamRow } from "../lib/exams";

interface ExamEvent {
  exameventid?: string;
  exameventdesc?: string;
}

function formatExamDateTime(r: ExamRow): string {
  const date = r.datetime ?? "";
  let timeStr = "";
  if (r.datetimeupto && /to/i.test(r.datetimeupto)) {
    timeStr = r.datetimeupto;
  } else if (r.datetimefrom && r.datetimeupto) {
    timeStr = `${r.datetimefrom} to ${r.datetimeupto}`;
  } else {
    timeStr = r.datetimefrom ?? r.datetimeupto ?? "";
  }
  return [date, timeStr].filter(Boolean).join(" – ");
}

function examEventLabel(e: ExamEvent): string {
  return e.exameventdesc ?? String(e.exameventid ?? "");
}

export function ExamsSection({ session }: SectionProps) {
  const card = useCardState("exams", false);
  const examSems = useFeature<Semester[]>({
    run: () => features.getExamSemesters(client, session),
    deps: [session],
    enabled: card.hasExpanded,
    cacheKey: sessionCacheKey("exams.sems", session),
    staleTimeMs: FEATURE_TTL.exams,
  });
  const [examSemId, setExamSemId, examSem] = useSemester(sessionCacheKey("semester", session, "exams"), examSems.data);
  const examEvents = useFeature<ExamEvent[]>({
    run: () => features.getExamEvents(client, session, { registrationid: examSemId }),
    deps: [session, examSemId],
    enabled: card.hasExpanded && examSem !== null,
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
    enabled: card.hasExpanded && examSem !== null && activeEventId !== null,
    cacheKey: examSem && activeEventId ? sessionCacheKey("exams.rows", session, examSemId, activeEventId) : undefined,
    staleTimeMs: FEATURE_TTL.exams,
  });

  const error = examSems.error ?? examEvents.error ?? examRows.error;
  const loading = examSems.loading || examEvents.loading || examRows.loading || (card.hasExpanded && !error && (
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
    if (!card.hasExpanded) return;
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
  }, [card.hasExpanded]);

  const rows = examRows.data ?? [];
  const { upcoming, past, undated } = groupExams(rows, now);
  const badgeText = upcoming.length > 0 ? `${upcoming.length} scheduled`
    : loading ? "Loading…"
    : error ? "Couldn't load schedules"
    : undated.length > 0 ? "Dates unavailable"
    : rows.length > 0 ? "No upcoming exams"
    : card.hasExpanded ? "No schedules" : "Seating & dates";

  return (
    <CollapsibleCard
      id="exams"
      title="Exam schedules"
      badge={badgeText}
      defaultOpen={false}
      isOpen={card.isOpen}
      onToggle={card.toggle}
      action={
        examSems.data && examSems.data.length > 1 ? (
          <select
            value={examSemId ?? ""}
            onChange={(e) => {
              setExamSemId(e.target.value);
              setExamEventId(null);
            }}
            disabled={loading}
            className="sem-picker"
          >
            {examSems.data.map((s) => (
              <option key={String(s.registrationid)} value={String(s.registrationid)}>
                {formatSemester(s.registrationcode ?? s.registrationdesc)}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      {examEvents.data && examEvents.data.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "4px 0 12px" }}>
          <span className="muted" style={{ fontSize: "14px", fontWeight: 500 }}>Event:</span>
          <select
            value={activeEventId ?? ""}
            onChange={(e) => setExamEventId(e.target.value)}
            disabled={loading}
            className="sem-picker"
            style={{ maxWidth: "200px" }}
          >
            {examEvents.data.map((e) => (
              <option key={String(e.exameventid)} value={String(e.exameventid)}>
                {examEventLabel(e)}
              </option>
            ))}
          </select>
        </div>
      )}
      {loading && <p className="muted">Loading…</p>}
      {upcoming.length > 0 && <ExamTable rows={upcoming} now={now} />}
      {undated.length > 0 && (
        <>
          <p className="muted">Dates unavailable</p>
          <ExamTable rows={undated} now={now} />
        </>
      )}
      {past.length > 0 && (
        <details className="past-exams" key={`${examSemId}:${activeEventId}`}>
          <summary>Past exams ({past.length})</summary>
          <ExamTable rows={past} now={now} />
        </details>
      )}
      {rows.length === 0 && !error && !loading && (
        <p className="muted">No exam schedule published for this semester yet.</p>
      )}
      {error && <SectionError label="Exams" error={error} retry={retry} />}
    </CollapsibleCard>
  );
}

function ExamTable({ rows, now }: { rows: ExamRow[]; now: number }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Date / Time</th>
            <th>Subject</th>
            <th>Room</th>
            <th>Seat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const start = examTimes(r)?.start;
            return (
              <tr key={i}>
                <td>
                  {formatExamDateTime(r)}
                  {start != null && start > now ? ` (${countdown(start - now)})` : ""}
                </td>
                <td>{titleCase(r.subjectdesc ?? "")}</td>
                <td>{r.roomcode ?? "—"}</td>
                <td>{r.seatno ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
