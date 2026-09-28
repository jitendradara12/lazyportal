import { useEffect, useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { AutoTable, SectionError } from "../components/DataViews";
import type { SectionProps, Semester } from "../types";

export function MarksSection({ session, onLogout }: SectionProps) {
  const lov = useFeature<{ semesters: Semester[]; registrationcode?: string | null; rows: Record<string, unknown>[] }>({
    run: () => features.getMarksLatest(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const [semId, setSemId] = useState<string | null>(null);
  useEffect(() => {
    const first = lov.data?.semesters?.[0]?.registrationid;
    if (first != null && semId === null) setSemId(String(first));
  }, [lov.data, semId]);
  const sem = lov.data?.semesters?.find((s) => String(s.registrationid) === semId) ?? null;
  const detail = useFeature<{ rows: Record<string, unknown>[] }>({
    run: () => features.getMarks(client, session, { registrationid: sem?.registrationid }),
    deps: [session, semId],
    enabled: sem !== null && semId !== String(lov.data?.semesters?.[0]?.registrationid),
    onUnauthorized: onLogout,
  });

  const rows = detail.data?.rows ?? lov.data?.rows ?? [];
  const code = detail.data ? sem?.registrationcode : lov.data?.registrationcode;
  const loading = lov.loading || detail.loading;
  const error = lov.error ?? detail.error;
  const retry = lov.error ? lov.retry : detail.retry;
  const semesters = lov.data?.semesters ?? [];

  if (!lov.data && !error) {
    return (
      <section className="card" id="marks" aria-busy="true">
        <h2>Marks</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  return (
    <section className="card" id="marks">
      <h2>Marks{code ? ` · ${code}` : ""}</h2>
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
        <p className="muted">No marks for this semester.</p>
      )}
      {error && <SectionError label="Marks" error={error} retry={retry} />}
    </section>
  );
}
