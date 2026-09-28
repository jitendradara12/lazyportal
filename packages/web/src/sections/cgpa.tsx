import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { AutoTable, SectionError } from "../components/DataViews";
import type { SectionProps } from "../types";

interface SgpaRow {
  stynumber?: string | number;
  sgpa?: string | number;
  cgpa?: string | number;
  [key: string]: unknown;
}

interface SgpaStudent {
  studentid?: string;
  stynumber?: string | number;
}

export function CgpaSection({ session, onLogout }: SectionProps) {
  const lov = useFeature<{ student: SgpaStudent | null; currentsem?: string | null; semesters: SgpaRow[] }>({
    run: () => features.getSgpaLatest(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const [sty, setSty, sem] = useSemester("cgpa", lov.data?.semesters, (s) => s.stynumber);
  const detail = useFeature<{ semesterList?: SgpaRow[] }>({
    run: () =>
      features.getSgpaDetail(client, session, {
        studentid: lov.data?.student?.studentid,
        stynumber: sem?.stynumber,
      }),
    deps: [session, sty],
    enabled: sem !== null,
    onUnauthorized: onLogout,
  });

  const semesters = lov.data?.semesters ?? [];
  const detailRows = detail.data?.semesterList ?? [];
  const loading = lov.loading || detail.loading;
  const error = lov.error ?? detail.error;
  const retry = lov.error ? lov.retry : detail.retry;

  if (!lov.data && !error) {
    return (
      <section className="card" id="cgpa" aria-busy="true">
        <h2>SGPA / CGPA</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  return (
    <section className="card" id="cgpa">
      <h2>SGPA / CGPA</h2>
      {semesters.length > 0 && (
        <label className="semrow">
          Semester{" "}
          <select value={sty ?? ""} onChange={(e) => setSty(e.target.value)} disabled={loading}>
            {semesters.map((s, i) => (
              <option key={String(s.stynumber ?? i)} value={String(s.stynumber ?? "")}>
                Sem {String(s.stynumber ?? "")} · SGPA {String(s.sgpa ?? "")} · CGPA {String(s.cgpa ?? "")}
              </option>
            ))}
          </select>
          {detail.loading && <span className="muted">Loading…</span>}
        </label>
      )}
      {!detail.data && semesters.length > 0 && !detail.loading && <AutoTable rows={semesters as Record<string, unknown>[]} />}
      {detail.data && detailRows.length > 0 && <AutoTable rows={detailRows as Record<string, unknown>[]} />}
      {detail.data && detailRows.length === 0 && !error && !loading && (
        <p className="muted">No subject rows for this semester.</p>
      )}
      {lov.data && semesters.length === 0 && !error && !loading && (
        <p className="muted">No semester GPA data.</p>
      )}
      {error && <SectionError label="GPA" error={error} retry={retry} />}
    </section>
  );
}
