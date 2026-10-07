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
  examTime,
  countdown,
  titleCase,
  formatSemester,
} from "../components/DataViews";
import type { SectionProps, Semester } from "../types";

interface ExamEvent {
  exameventid?: string;
  exameventdesc?: string;
}

interface ExamRow {
  datetime?: string;
  datetimeupto?: string;
  subjectdesc?: string;
  roomcode?: string;
  seatno?: string;
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
    enabled: card.hasExpanded && examSemId !== null,
    cacheKey: examSemId ? sessionCacheKey("exams.events", session, examSemId) : undefined,
    staleTimeMs: FEATURE_TTL.exams,
  });
  const [examEventId, setExamEventId] = useState<string | null>(null);

  useEffect(() => {
    if (examSemId === null || !examEvents.data?.length) {
      if (examEventId !== null) setExamEventId(null);
      return;
    }
    const hasCurrent = examEvents.data.some((e) => String(e.exameventid) === examEventId);
    if (!hasCurrent) {
      const first = examEvents.data[0]?.exameventid;
      setExamEventId(first != null ? String(first) : null);
    }
  }, [examSemId, examEvents.data, examEventId]);

  const examRows = useFeature<ExamRow[]>({
    run: () =>
      features.getExamSchedule(client, session, { registrationid: examSemId, exameventid: examEventId }),
    deps: [session, examSemId, examEventId],
    enabled: card.hasExpanded && examSemId !== null && examEventId !== null,
    cacheKey: examSemId && examEventId ? sessionCacheKey("exams.rows", session, examSemId, examEventId) : undefined,
    staleTimeMs: FEATURE_TTL.exams,
  });

  const loading = examSems.loading || examEvents.loading || examRows.loading;
  const error = examSems.error ?? examEvents.error ?? examRows.error;
  const retry = () => {
    examSems.retry();
    examEvents.retry();
    examRows.retry();
  };

  const rows = examRows.data ?? [];
  const badgeText = rows.length > 0 ? `${rows.length} scheduled` : (card.hasExpanded ? "No schedules" : "Seating & dates");

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
            value={examEventId ?? ""}
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
      {rows.length > 0 && (
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
              {[...rows]
                .sort((a, b) => (examTime(a.datetime) ?? 0) - (examTime(b.datetime) ?? 0))
                .map((r, i) => {
                  const t = examTime(r.datetime);
                  const next = t !== null && t > Date.now();
                  return (
                    <tr key={i}>
                      <td>
                        {[r.datetime, r.datetimeupto].filter(Boolean).join(" – ")}
                        {next ? ` (${countdown(t - Date.now())})` : ""}
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
      )}
      {rows.length === 0 && !error && !loading && (
        <p className="muted">No exam schedule published for this semester yet.</p>
      )}
      {error && <SectionError label="Exams" error={error} retry={retry} />}
    </CollapsibleCard>
  );
}
