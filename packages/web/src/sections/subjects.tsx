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

interface SubjectRow {
  subjectcode?: string;
  subjectdesc?: string;
  subjecttypedesc?: string;
  [key: string]: unknown;
}

export function SubjectsSection({ session }: SectionProps) {
  const lov = useFeature<Semester[]>({
    run: () => features.getChoiceSemesters(client),
    deps: [session],
    cacheKey: `subjects.lov:${session.username}`,
  });
  const [semId, setSemId, sem] = useSemester("subjects", lov.data);
  const detail = useFeature<SubjectRow[]>({
    run: () => features.getChoiceSubjects(client, session, { registrationid: sem?.registrationid }),
    deps: [session, semId],
    enabled: sem !== null,
    cacheKey: semId ? `subjects.detail:${session.username}:${semId}` : undefined,
  });

  const rows = detail.data ?? [];
  const semesters = lov.data ?? [];
  const semLabel = formatSemester(sem?.registrationcode ?? sem?.registrationdesc);
  const loading = lov.loading || detail.loading;
  const error = lov.error ?? detail.error;
  const retry = lov.error ? lov.retry : detail.retry;
  const badgeText = rows.length > 0 ? `${rows.length} subjects` : (semLabel ? semLabel.toLowerCase() : undefined);

  return (
    <CollapsibleCard
      id="subjects"
      title="Registered subject"
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
      {rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Subject</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <span className="badge">{r.subjectcode}</span>
                  </td>
                  <td>{titleCase(r.subjectdesc ?? "")}</td>
                  <td>{r.subjecttypedesc ?? "Regular"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lov.data && rows.length === 0 && !error && !loading && (
        <p className="muted">No registered subjects found for {semLabel || "this semester"}.</p>
      )}
      {error && <SectionError label="Subjects" error={error} retry={retry} />}
    </CollapsibleCard>
  );
}
