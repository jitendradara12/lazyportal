import { useEffect, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import type { Session } from "../types";

interface AttRow {
  subjectcode?: string;
  Lpercentage?: string;
  Tpercentage?: string;
  Ppercentage?: string;
}

interface AttSem {
  registrationid?: string;
  registrationcode?: string;
}

interface AttState {
  rows: AttRow[];
  registrationcode?: string;
  semesters?: AttSem[];
  header?: { stynumber?: string } | null;
}

interface MenuItem {
  title?: string;
  url?: string;
  type?: string;
  icon?: string;
  children?: MenuItem[];
}

function groups(nav: unknown): MenuItem[] {
  return Array.isArray(nav) ? (nav as MenuItem[]) : [];
}

/** Fallback table for responses whose columns we haven't mapped yet. */
function AutoTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;
  const cols = Object.keys(rows[0]);
  return (
    <table>
      <thead>
        <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{cols.map((c) => <td key={c}>{String(r[c] ?? "")}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function DashboardPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [nav, setNav] = useState<MenuItem[] | null>(null);
  const [due, setDue] = useState<number | null>(null);
  const [att, setAtt] = useState<AttState | null>(null);
  const [semId, setSemId] = useState<string | null>(null);
  const [semLoading, setSemLoading] = useState(false);
  const [attError, setAttError] = useState<string | null>(null);
  const [marks, setMarks] = useState<{ rows: Record<string, unknown>[]; registrationcode?: string | null } | null>(null);
  const [marksError, setMarksError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    features
      .getNavigation(client, session)
      .then((n) => live && setNav(groups(n)))
      .catch((e) => {
        if (!live) return;
        if (e?.code === "SESSION_EXPIRED") onLogout();
        else setError(e instanceof Error ? e.message : String(e));
      });
    features
      .getFeeSummary(client, session)
      .then((rows) => live && setDue(rows.reduce((a, r) => a + Number(r.dueamount ?? 0), 0)))
      .catch((e) => console.error("fee summary failed", e));
    features
      .getAttendance(client, session)
      .then((a) => {
        if (!live) return;
        setAtt(a);
        const first = a.semesters?.[0]?.registrationid;
        setSemId(first != null ? String(first) : null);
      })
      .catch((e) => {
        if (!live) return;
        console.error("attendance failed", e);
        setAttError(e instanceof Error ? e.message : String(e));
      });
    features
      .getMarksLatest(client, session)
      .then((m) => live && setMarks(m))
      .catch((e) => {
        if (!live) return;
        console.error("marks failed", e);
        setMarksError(e instanceof Error ? e.message : String(e));
      });
    return () => void (live = false);
  }, [session, onLogout]);

  async function selectSemester(registrationid: string) {
    if (!att) return;
    setSemId(registrationid);
    const sem = att.semesters?.find((s) => String(s.registrationid) === registrationid);
    if (!sem) return;
    setSemLoading(true);
    setAttError(null);
    try {
      const detail = await features.getAttendanceDetail(client, session, {
        stynumber: att.header?.stynumber,
        registrationid: sem.registrationid,
        registrationcode: sem.registrationcode,
      });
      setAtt((prev) => (prev ? { ...prev, rows: detail.rows, registrationcode: sem.registrationcode } : prev));
    } catch (e) {
      console.error("attendance detail failed", e);
      setAttError(e instanceof Error ? e.message : String(e));
    } finally {
      setSemLoading(false);
    }
  }

  return (
    <main className="dash">
      <header>
        <h1>Hi, {session.name ?? session.enrollmentno ?? "student"}</h1>
        <button onClick={onLogout}>Logout</button>
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {due !== null && due > 0 && <p className="due">Fee due: ₹{due}</p>}
      {att && (att.semesters?.length ?? 0) > 0 && (
        <label className="semrow">
          Semester{" "}
          <select
            value={semId ?? ""}
            onChange={(e) => void selectSemester(e.target.value)}
            disabled={semLoading}
          >
            {att.semesters!.map((s) => (
              <option key={String(s.registrationid)} value={String(s.registrationid)}>
                {s.registrationcode}
              </option>
            ))}
          </select>
          {semLoading && <span className="muted">Loading…</span>}
        </label>
      )}
      {att && att.rows.length > 0 && (
        <section className="card">
          <h2>Attendance{att.registrationcode ? ` · ${att.registrationcode}` : ""}</h2>
          <p className="muted">Previous day's entry. Today's attendance reflects tomorrow.</p>
          <table>
            <thead>
              <tr><th>Subject</th><th>L%</th><th>T%</th><th>P%</th></tr>
            </thead>
            <tbody>
              {att.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.subjectcode}</td><td>{r.Lpercentage}</td><td>{r.Tpercentage}</td><td>{r.Ppercentage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {att && att.rows.length === 0 && !attError && (
        <p className="muted">No attendance rows for {att.registrationcode ?? "this registration"}.</p>
      )}
      {attError && <p role="alert" className="error">Attendance failed: {attError}</p>}
      {marks && marks.rows.length > 0 && (
        <section className="card">
          <h2>Marks{marks.registrationcode ? ` · ${marks.registrationcode}` : ""}</h2>
          <p className="muted">Latest semester.</p>
          <AutoTable rows={marks.rows} />
        </section>
      )}
      {marks && marks.rows.length === 0 && !marksError && (
        <p className="muted">No marks for the latest semester.</p>
      )}
      {marksError && <p role="alert" className="error">Marks failed: {marksError}</p>}
      {!nav && !error && <p className="muted">Loading menu…</p>}
      {nav && (
        <div className="menu">
          {nav.map((g, i) => (
            <details key={i} open={i === 0} className="group">
              <summary>{g.title ?? `Section ${i + 1}`}</summary>
              <ul>
                {(g.children ?? []).map((c, j) => (
                  <li key={j}>
                    {c.title?.trim() || c.url}
                    {c.url && <span className="muted"> · {c.url}</span>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </main>
  );
}
