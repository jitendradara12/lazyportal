import { useEffect } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { usePersistentState } from "../hooks/usePersistentState";
import { AutoTable, SectionError } from "../components/DataViews";
import type { SectionProps, Semester } from "../types";

export function SubjectsSection({ session, onLogout }: SectionProps) {
  const lov = useFeature<Semester[]>({
    run: () => features.getChoiceSemesters(client),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const [semId, setSemId] = usePersistentState("sem.subjects", null);
  useEffect(() => {
    const first = lov.data?.[0]?.registrationid;
    if (first != null && semId === null) setSemId(String(first));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lov.data]);
  const sem = lov.data?.find((s) => String(s.registrationid) === semId) ?? null;
  const detail = useFeature<{ rows: Record<string, unknown>[] }>({
    run: () => features.getChoiceSubjects(client, session, { registrationid: sem?.registrationid }),
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
      <section className="card" id="subjects" aria-busy="true">
        <h2>Subjects</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  return (
    <section className="card" id="subjects">
      <h2>Subjects{sem?.registrationcode ? ` · ${sem.registrationcode}` : ""}</h2>
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
      {rows.length > 0 && <AutoTable rows={rows} />}
      {lov.data && rows.length === 0 && !error && !loading && (
        <p className="muted">No subjects for this semester.</p>
      )}
      {error && <SectionError label="Subjects" error={error} retry={retry} />}
    </section>
  );
}
