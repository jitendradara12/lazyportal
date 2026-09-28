import { useEffect, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { SectionError, examTime, countdown } from "../components/DataViews";
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

function examSemLabel(s: Semester): string {
  return s.registrationcode ?? s.registrationdesc ?? String(s.registrationid ?? "");
}

function examEventLabel(e: ExamEvent): string {
  return e.exameventdesc ?? String(e.exameventid ?? "");
}

export function ExamsSection({ session, onLogout }: SectionProps) {
  const examSems = useFeature<Semester[]>({
    run: () => features.getExamSemesters(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const [examSemId, setExamSemId] = useSemester("exams", examSems.data);
  const examEvents = useFeature<ExamEvent[]>({
    run: () => features.getExamEvents(client, session, { registrationid: examSemId }),
    deps: [session, examSemId],
    enabled: examSemId !== null,
    onUnauthorized: onLogout,
  });
  const [examEventId, setExamEventId] = useState<string | null>(null);
  useEffect(() => {
    if (examSemId === null) {
      if (examEventId !== null) setExamEventId(null);
      return;
    }
    const first = examEvents.data?.[0]?.exameventid;
    if (first != null && (examEventId === null || !examEvents.data.some((e) => String(e.exameventid) === examEventId))) setExamEventId(String(first));
    if (examEvents.data && examEvents.data.length === 0 && examEventId !== null) setExamEventId(null);
  }, [examSemId, examEvents.data, examEventId]);
  const examRows = useFeature<ExamRow[]>({
    run: () =>
      features.getExamSchedule(client, session, { registrationid: examSemId, exameventid: examEventId }),
    deps: [session, examSemId, examEventId],
    enabled: examSemId !== null && examEventId !== null,
    onUnauthorized: onLogout,
  });

  const loading = examEvents.loading || examRows.loading;
  const error = examSems.error ?? examEvents.error ?? examRows.error;
  const retry = examSems.error ? examSems.retry : examEvents.error ? examEvents.retry : examRows.retry;
  // HTTP 204 = portal has nothing published for this semester yet, not a failure.
  const notPublished = !!error && /204/.test(error);
  if (!examSems.data && !error) {
    if (!examSems.loading) return null;
    return (
      <section className="card" id="exams" aria-busy="true">
        <h2>Exam schedule</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  return (
    <section className="card" id="exams">
      <h2>Exam schedule</h2>
      {examSems.data && examSems.data.length > 0 && (
        <label className="semrow">
          Semester{" "}
          <select
            value={examSemId ?? ""}
            onChange={(e) => {
              setExamSemId(e.target.value);
              setExamEventId(null);
            }}
            disabled={loading}
          >
            {examSems.data.map((s) => (
              <option key={String(s.registrationid)} value={String(s.registrationid)}>
                {examSemLabel(s)}
              </option>
            ))}
          </select>
        </label>
      )}
      {examEvents.data && examEvents.data.length > 0 && (
        <label className="semrow">
          Event{" "}
          <select value={examEventId ?? ""} onChange={(e) => setExamEventId(e.target.value)} disabled={loading}>
            {examEvents.data.map((e) => (
              <option key={String(e.exameventid)} value={String(e.exameventid)}>
                {examEventLabel(e)}
              </option>
            ))}
          </select>
        </label>
      )}
      {loading && <p className="muted">Loading…</p>}
      {examRows.data && examRows.data.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Date/Time</th><th>Subject</th><th>Room</th><th>Seat</th></tr>
            </thead>
            <tbody>
              {[...examRows.data]
                .sort((a, b) => (examTime(a.datetime) ?? 0) - (examTime(b.datetime) ?? 0))
                .map((r, i) => {
                  const t = examTime(r.datetime);
                  const next = t !== null && t > Date.now();
                  return (
                    <tr key={i}>
                      <td>{[r.datetime, r.datetimeupto].filter(Boolean).join(" – ")}{next ? ` (${countdown(t - Date.now())})` : ""}</td><td>{r.subjectdesc}</td><td>{r.roomcode}</td><td>{r.seatno}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
      {examRows.data && examRows.data.length === 0 && !error && !loading && (
        <p className="muted">No exam rows for this event.</p>
      )}
      {notPublished && <p className="muted">No exam schedule published for this semester yet.</p>}
      {error && !notPublished && <SectionError label="Exam schedule" error={error} retry={retry} />}
    </section>
  );
}
