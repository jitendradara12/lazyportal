import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import {
  CollapsibleCard,
  SectionError,
  titleCase,
  formatSemester,
} from "../components/DataViews";
import type { SectionProps, Semester } from "../types";

interface FacultyRow {
  subjectcode?: string;
  employeename?: string;
  credits?: string | number;
  [key: string]: unknown;
}

export function FacultySection({ session }: SectionProps) {
  const lov = useFeature<Semester[]>({
    run: () => features.getFacultyRegistrations(client, session),
    deps: [session],
    cacheKey: `faculty.lov:${session.username}`,
  });
  const [semId, setSemId, sem] = useSemester("faculty", lov.data);
  const detail = useFeature<{ rows: FacultyRow[]; totalcreditpoints?: unknown }>({
    run: () => features.getFaculties(client, session, { registrationid: sem?.registrationid }),
    deps: [session, semId],
    enabled: sem !== null,
    cacheKey: semId ? `faculty.detail:${session.username}:${semId}` : undefined,
  });

  const rows = detail.data?.rows ?? [];
  const semesters = lov.data ?? [];
  const semLabel = formatSemester(sem?.registrationcode ?? sem?.registrationdesc);
  const loading = lov.loading || detail.loading;
  const error = lov.error ?? detail.error;
  const retry = lov.error ? lov.retry : detail.retry;
  const badgeText = rows.length > 0 ? `${rows.length} faculty` : (semLabel ? semLabel.toLowerCase() : undefined);

  return (
    <CollapsibleCard
      id="faculty"
      title="faculty"
      badge={badgeText}
      defaultOpen={false}
      action={
        semesters.length > 1 ? (
          <select
            value={semId ?? ""}
            onChange={(e) => setSemId(e.target.value)}
            disabled={loading}
            className="sem-picker"
          >
            {semesters.map((s) => (
              <option key={String(s.registrationid)} value={String(s.registrationid)}>
                {formatSemester(s.registrationcode ?? s.registrationdesc)}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      {loading && <p className="muted">Loading…</p>}
      {detail.data?.totalcreditpoints != null && (
        <p className="muted" style={{ margin: "4px 0 10px" }}>
          Total registered credits: <strong>{String(detail.data.totalcreditpoints)}</strong>
        </p>
      )}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Faculty</th>
                <th className="num-col">Credits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.subjectcode && <span className="badge">{r.subjectcode}</span>}
                  </td>
                  <td>{titleCase(r.employeename ?? "")}</td>
                  <td className="num-col">{String(r.credits ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lov.data && rows.length === 0 && !error && !loading && (
        <p className="muted">No faculty records found for {semLabel || "this semester"}.</p>
      )}
      {error && <SectionError label="Faculty" error={error} retry={retry} />}
    </CollapsibleCard>
  );
}
