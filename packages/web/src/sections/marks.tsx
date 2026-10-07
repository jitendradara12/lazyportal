import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import {
  CollapsibleCard,
  SectionError,
  useCardState,
  titleCase,
  formatSemester,
  num,
} from "../components/DataViews";
import type { SectionProps, Semester } from "../types";

interface MarkRow {
  subjectcode?: string;
  subjectdesc?: string;
  fullmarks?: string | number;
  obtainedmarks?: string | number;
  [key: string]: unknown;
}

interface MarksDetail {
  rows: MarkRow[];
}

interface MarksLatest extends MarksDetail {
  semesters: Semester[];
  registrationcode?: string | null;
}

export const MARKS_STALE_MS = 12 * 60 * 60 * 1000; // 12 hours

export function MarksSection({ session }: SectionProps) {
  const card = useCardState("marks", false);
  const lov = useFeature<MarksLatest>({
    run: () => features.getMarksLatest(client, session),
    deps: [session],
    enabled: card.hasExpanded,
    cacheKey: sessionCacheKey("marks.latest", session),
    staleTimeMs: MARKS_STALE_MS,
  });
  const [semId, setSemId, sem] = useSemester(sessionCacheKey("semester", session, "marks"), lov.data?.semesters);
  const isDefault = semId === String(lov.data?.semesters?.[0]?.registrationid);
  const detail = useFeature<MarksDetail>({
    run: () => features.getMarks(client, session, { registrationid: sem?.registrationid }),
    deps: [session, semId],
    enabled: card.hasExpanded && sem !== null && !isDefault,
    cacheKey: semId ? sessionCacheKey("marks.detail", session, semId) : undefined,
    staleTimeMs: MARKS_STALE_MS,
  });

  const rawRows = isDefault ? (lov.data?.rows ?? []) : (detail.data?.rows ?? []);
  const semesters = lov.data?.semesters ?? [];
  const code = sem?.registrationcode ?? (isDefault ? lov.data?.registrationcode : undefined);
  const semLabel = formatSemester(code);
  const loading = lov.loading || detail.loading;
  const error = lov.error ?? detail.error;
  const retry = lov.error ? lov.retry : detail.retry;
  const badgeText = rawRows.length > 0 ? `${rawRows.length} subjects` : (card.hasExpanded ? "No marks" : "Evaluation & test marks");

  return (
    <CollapsibleCard
      id="marks"
      title="Marks"
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
      {rawRows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th className="num-col">Full Marks</th>
                <th className="num-col">Obtained</th>
              </tr>
            </thead>
            <tbody>
              {rawRows.map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.subjectcode && <span className="badge">{r.subjectcode}</span>}
                    {titleCase(r.subjectdesc ?? "")}
                  </td>
                  <td className="num-col">{r.fullmarks != null && r.fullmarks !== "" ? String(r.fullmarks) : "—"}</td>
                  <td className="num-col">
                    <strong>{r.obtainedmarks != null && r.obtainedmarks !== "" ? String(r.obtainedmarks) : "—"}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lov.data && rawRows.length === 0 && !error && !loading && (
        <p className="muted">No marks records found for {semLabel || "this semester"}.</p>
      )}
      {error && <SectionError label="Marks" error={error} retry={retry} />}
    </CollapsibleCard>
  );
}
