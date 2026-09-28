import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { AutoTable, SectionError } from "../components/DataViews";
import type { SectionProps } from "../types";

export function FacultySection({ session, onLogout }: SectionProps) {
  const faculty = useFeature<{ registrationcode?: string | null; rows: Record<string, unknown>[]; totalcreditpoints?: unknown }>({
    run: () => features.getFacultiesLatest(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  if (!faculty.data && !faculty.error) return null;
  return (
    <section className="card" id="faculty">
      <h2>Faculty{faculty.data?.registrationcode ? ` · ${faculty.data.registrationcode}` : ""}</h2>
      {faculty.data?.totalcreditpoints != null && (
        <p className="muted">Total credits: {String(faculty.data.totalcreditpoints)}</p>
      )}
      {faculty.data && faculty.data.rows.length > 0 && <AutoTable rows={faculty.data.rows} />}
      {faculty.data && faculty.data.rows.length === 0 && !faculty.error && (
        <p className="muted">No faculty data.</p>
      )}
      {faculty.error && <SectionError label="Faculty" error={faculty.error} retry={faculty.retry} />}
    </section>
  );
}
