import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import {
  CollapsibleCard,
  SectionError,
  useCardState,
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

interface SubjectsLatest {
  semesters: Semester[];
  registrationcode?: string | null;
  rows: SubjectRow[];
}

export function SubjectsSection({ session }: SectionProps) {
  const card = useCardState("subjects", false);
  const latest = useFeature<SubjectsLatest>({
    run: () => features.getChoiceSubjectsLatest(client, session),
    deps: [session],
    enabled: card.hasExpanded,
    cacheKey: `subjects.latest:${session.username}`,
  });

  const rows = latest.data?.rows ?? [];
  const semLabel = formatSemester(latest.data?.registrationcode);
  const badgeText = rows.length > 0 ? `${rows.length} subjects` : (semLabel ? semLabel.toLowerCase() : "Course registrations");

  return (
    <CollapsibleCard
      id="subjects"
      title="Registered subjects"
      badge={badgeText}
      defaultOpen={false}
      isOpen={card.isOpen}
      onToggle={card.toggle}
    >
      {latest.loading && <p className="muted">Loading…</p>}
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
      {latest.data && rows.length === 0 && !latest.error && !latest.loading && (
        <p className="muted">No registered subjects found for {semLabel || "this semester"}.</p>
      )}
      {latest.error && <SectionError label="Subjects" error={latest.error} retry={latest.retry} />}
    </CollapsibleCard>
  );
}
