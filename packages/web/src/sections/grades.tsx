import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { SectionError } from "../components/DataViews";
import type { SectionProps, Semester } from "../types";

interface GradeRow {
  subjectcode?: string;
  subjectdesc?: string;
  grade?: string;
  earnedcredit?: string | number;
  gradepoint?: string | number;
  minorsubject?: string;
}

interface GradeInfo {
  branchid?: string;
  programid?: string;
}

export function GradesSection({ session, onLogout }: SectionProps) {
  const lov = useFeature<{ info: GradeInfo | null; semesters: Semester[]; registrationcode?: string | null; rows: GradeRow[] }>({
    run: () => features.getGradesLatest(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const [semId, setSemId, sem] = useSemester("grades", lov.data?.semesters);
  const isDefault = semId === String(lov.data?.semesters?.[0]?.registrationid);
  const detail = useFeature<GradeRow[]>({
    run: () =>
      features.getGradeCard(client, session, {
        registrationid: sem?.registrationid,
        branchid: lov.data?.info?.branchid,
        programid: lov.data?.info?.programid,
      }),
    deps: [session, semId],
    enabled: sem !== null && !isDefault,
    onUnauthorized: onLogout,
  });

  const rows = detail.data ?? lov.data?.rows ?? [];
  const code = detail.data ? sem?.registrationcode : lov.data?.registrationcode;
  const loading = lov.loading || detail.loading;
  const error = lov.error ?? detail.error;
  const retry = lov.error ? lov.retry : detail.retry;
  const semesters = lov.data?.semesters ?? [];

  if (!lov.data && !error) {
    return (
      <section className="card" id="grades" aria-busy="true">
        <h2>Grades</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  return (
    <section className="card" id="grades">
      <h2>Grades{code ? ` · ${code}` : ""}</h2>
      {semesters.length > 0 && (
        <label className="semrow">
          Semester{" "}
          <select value={semId ?? ""} onChange={(e) => setSemId(e.target.value)} disabled={loading}>
            {semesters.map((s) => (
              <option key={String(s.registrationid)} value={String(s.registrationid)}>
                {s.registrationcode ?? s.registrationdesc}
              </option>
            ))}
          </select>
          {detail.loading && <span className="muted">Loading…</span>}
        </label>
      )}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Subject</th><th>Description</th><th>Grade</th><th>Credits</th><th>Points</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.subjectcode}{r.minorsubject === "Y" ? " (minor)" : ""}</td><td>{r.subjectdesc}</td><td>{r.grade}</td><td>{String(r.earnedcredit ?? "")}</td><td>{String(r.gradepoint ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lov.data && rows.length === 0 && !error && !loading && (
        <p className="muted">No grades for this semester.</p>
      )}
      {error && <SectionError label="Grades" error={error} retry={retry} />}
    </section>
  );
}
