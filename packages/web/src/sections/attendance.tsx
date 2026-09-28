import { useEffect, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { SectionError } from "../components/DataViews";
import type { SectionProps, Semester } from "../types";

interface AttRow {
  subjectcode?: string;
  Lpercentage?: string;
  Tpercentage?: string;
  Ppercentage?: string;
}

interface AttData {
  header: { stynumber?: string } | null;
  semesters: Semester[];
  registrationcode?: string | null;
  rows: AttRow[];
}

function pct(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

/** Below 75% in any component counts as short. */
function short(r: AttRow): boolean {
  return [pct(r.Lpercentage), pct(r.Tpercentage), pct(r.Ppercentage)].some((n) => n !== null && n < 75);
}

export function AttendanceSection({ session, onLogout }: SectionProps) {
  const att = useFeature<AttData>({
    run: () => features.getAttendance(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const [semId, setSemId] = useState<string | null>(null);
  useEffect(() => {
    const first = att.data?.semesters?.[0]?.registrationid;
    if (first != null && semId === null) setSemId(String(first));
  }, [att.data, semId]);
  const sem = att.data?.semesters?.find((s) => String(s.registrationid) === semId) ?? null;
  const isDefault = semId === String(att.data?.semesters?.[0]?.registrationid);
  const detail = useFeature<{ rows: AttRow[] }>({
    run: () =>
      features.getAttendanceDetail(client, session, {
        stynumber: att.data?.header?.stynumber,
        registrationid: sem?.registrationid,
        registrationcode: sem?.registrationcode,
      }),
    deps: [session, semId],
    enabled: sem !== null && !isDefault,
    onUnauthorized: onLogout,
  });

  const initial = att.data;
  const rows = detail.data?.rows ?? initial?.rows ?? [];
  const semesters = initial?.semesters ?? [];
  const code = detail.data ? sem?.registrationcode : initial?.registrationcode;
  const loading = att.loading || detail.loading;
  const error = att.error ?? detail.error;
  const retry = att.error ? att.retry : detail.retry;

  if (!initial && !error) {
    return (
      <section className="card" id="attendance" aria-busy="true">
        <h2>Attendance</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  return (
    <section className="card" id="attendance">
      <h2>Attendance{code ? ` · ${code}` : ""}</h2>
      {semesters.length > 0 && (
        <label className="semrow">
          Semester{" "}
          <select value={semId ?? ""} onChange={(e) => setSemId(e.target.value)} disabled={loading}>
            {semesters.map((s) => (
              <option key={String(s.registrationid)} value={String(s.registrationid)}>
                {s.registrationcode}
              </option>
            ))}
          </select>
          {detail.loading && <span className="muted">Loading…</span>}
        </label>
      )}
      <p className="muted">Previous day's entry. Today's attendance reflects tomorrow. Below 75% counts as short — confirm your course rules.</p>
      {rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Subject</th><th>L%</th><th>T%</th><th>P%</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={short(r) ? "short" : undefined}>
                  <td>{r.subjectcode}</td><td>{r.Lpercentage}</td><td>{r.Tpercentage}</td><td>{r.Ppercentage}</td>
                  <td>{short(r) ? "Short" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {initial && rows.length === 0 && !error && !loading && (
        <p className="muted">No attendance rows for {code ?? "this registration"}.</p>
      )}
      {error && <SectionError label="Attendance" error={error} retry={retry} />}
    </section>
  );
}
