import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { AutoTable, SectionError, selectColumns } from "../components/DataViews";
import type { SectionProps, Semester } from "../types";

export function FacultySection({ session, onLogout }: SectionProps) {
  const lov = useFeature<Semester[]>({
    run: () => features.getFacultyRegistrations(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const [semId, setSemId, sem] = useSemester("faculty", lov.data);
  const detail = useFeature<{ rows: Record<string, unknown>[]; totalcreditpoints?: unknown }>({
    run: () => features.getFaculties(client, session, { registrationid: sem?.registrationid }),
    deps: [session, semId],
    enabled: sem !== null,
    onUnauthorized: onLogout,
  });

  const rows = detail.data?.rows ?? [];
  const loading = lov.loading || detail.loading;
  const error = lov.error ?? detail.error;
  const retry = lov.error ? lov.retry : detail.retry;
  const semesters = lov.data ?? [];

  if (!lov.data && !error) {
    return (
      <section className="card" id="faculty" aria-busy="true">
        <h2>Faculty</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  return (
    <section className="card" id="faculty">
      <h2>Faculty{sem?.registrationcode ? ` · ${sem.registrationcode}` : ""}</h2>
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
      {detail.data?.totalcreditpoints != null && (
        <p className="muted">Total credits: {String(detail.data.totalcreditpoints)}</p>
      )}
      {rows.length > 0 && <AutoTable rows={selectColumns(rows, [/subjectcode/i, /employeename/i, /credit/i])} />}
      {lov.data && rows.length === 0 && !error && !loading && (
        <p className="muted">No faculty data.</p>
      )}
      {error && <SectionError label="Faculty" error={error} retry={retry} />}
    </section>
  );
}
