import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { CollapsibleCard, SectionError, useCardState, titleCase, formatSemester } from "../components/DataViews";
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

export function GradesSection({ session }: SectionProps) {
  const card = useCardState("grades", false);
  const lov = useFeature<{ info: GradeInfo | null; semesters: Semester[]; registrationcode?: string | null; rows: GradeRow[] }>({
    run: () => features.getGradesLatest(client, session),
    deps: [session],
    enabled: card.hasExpanded,
    cacheKey: `grades.lov:${session.username}`,
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
    enabled: card.hasExpanded && sem !== null && !isDefault,
    cacheKey: semId ? `grades.detail:${session.username}:${semId}` : undefined,
  });

  const rows = isDefault ? (lov.data?.rows ?? []) : (detail.data ?? []);
  const semesters = lov.data?.semesters ?? [];
  const code = sem?.registrationcode ?? (isDefault ? lov.data?.registrationcode : undefined);
  const semLabel = formatSemester(code);
  const loading = lov.loading || detail.loading;
  const error = lov.error ?? detail.error;
  const retry = lov.error ? lov.retry : detail.retry;
  const badgeText = rows.length > 0 ? `${rows.length} graded` : undefined;

  return (
    <CollapsibleCard
      id="grades"
      title="Grades"
      subtitle={semLabel ? `· ${semLabel}` : undefined}
      badge={badgeText}
      defaultOpen={false}
      isOpen={card.isOpen}
      onToggle={card.toggle}
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
                <th>Subject</th>
                <th>Grade</th>
                <th>Credits</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.subjectcode && <span className="badge">{r.subjectcode}</span>}
                    {titleCase(r.subjectdesc ?? "")}
                    {r.minorsubject === "Y" && <span className="badge">Minor</span>}
                  </td>
                  <td><strong>{r.grade}</strong></td>
                  <td>{String(r.earnedcredit ?? "—")}</td>
                  <td>{String(r.gradepoint ?? "—")}</td>
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
    </CollapsibleCard>
  );
}
