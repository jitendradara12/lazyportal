import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { examTime, countdown, isShort } from "../components/DataViews";
import { SECTIONS } from "../sections";
import type { Session } from "../types";

interface InstituteOption {
  value?: string;
  label?: string;
}

interface AttRow {
  Lpercentage?: string;
  Tpercentage?: string;
  Ppercentage?: string;
}

interface ExamRow {
  datetime?: string;
  subjectdesc?: string;
}

/** Read-only day-to-day glance. Failures hide silently — no error spam. */
function SummaryCard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const att = useFeature<{ rows: AttRow[] }>({
    run: () => features.getAttendance(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const exam = useFeature<(ExamRow & { time: number }) | null>({
    run: async () => {
      const sems = await features.getExamSemesters(client, session);
      const sem = sems?.[0];
      if (!sem?.registrationid) return null;
      const events = await features.getExamEvents(client, session, { registrationid: sem.registrationid });
      const ev = events?.[0];
      if (!ev?.exameventid) return null;
      const rows: ExamRow[] = await features.getExamSchedule(client, session, {
        registrationid: sem.registrationid,
        exameventid: ev.exameventid,
      });
      const now = Date.now();
      let next: (ExamRow & { time: number }) | null = null;
      for (const r of rows ?? []) {
        const t = examTime(r.datetime);
        if (t === null || t <= now) continue;
        if (!next || t < next.time) next = { ...r, time: t };
      }
      return next;
    },
    deps: [session],
    onUnauthorized: onLogout,
  });

  const rows = att.data?.rows ?? null;
  const shorts = rows ? rows.filter(isShort).length : null;
  const next = exam.data ?? null;

  if (shorts === null && !next) return null;
  const now = Date.now();
  return (
    <section className="card" aria-label="Today">
      <h2>Today</h2>
      {next && (
        <a href="#exams">
          Next exam: {next.subjectdesc ?? "Exam"} — {next.datetime} ({countdown(next.time - now)})
        </a>
      )}
      {rows && rows.length > 0 && shorts !== null && (
        <a href="#attendance">
          {shorts > 0 ? `Attendance: ${shorts} of ${rows.length} short` : "Attendance: all clear"}
        </a>
      )}
    </section>
  );
}

export function DashboardPage({ session, onLogout, onSelectInstitute }: {
  session: Session;
  onLogout: () => void;
  onSelectInstitute: (instituteid: string) => void;
}) {
  const institutes = (session.institutelist as InstituteOption[] | undefined) ?? [];
  const visible = SECTIONS.filter((s) => s.enabled !== false);
  return (
    <main className="dash">
      <header>
        <h1>Hi, {session.name ?? session.enrollmentno ?? "student"}</h1>
        {institutes.length > 1 && (
          <label className="semrow">
            Institute{" "}
            <select
              value={typeof session.instituteid === "string" ? session.instituteid : ""}
              onChange={(e) => onSelectInstitute(e.target.value)}
            >
              {institutes.map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {String(o.label ?? o.value)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button onClick={onLogout}>Logout</button>
      </header>
      <SummaryCard session={session} onLogout={onLogout} />
      <nav className="group anchor-nav" aria-label="Sections">
        {visible.map(({ id, label }) => (
          <a key={id} href={`#${id}`}>{label}</a>
        ))}
      </nav>
      {visible.map(({ id, Component }) => (
        <Component key={`${id}:${typeof session.instituteid === "string" ? session.instituteid : ""}`} session={session} onLogout={onLogout} />
      ))}
    </main>
  );
}
