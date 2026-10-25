import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey } from "../hooks/useFeature";
import { FEATURE_TTL } from "../lib/portalSchedule";
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
    cacheKey: sessionCacheKey("subjects.latest", session),
    staleTimeMs: FEATURE_TTL.subjects,
    manualRefreshEnabled: card.isOpen,
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
        <ul className="more-data-list" aria-label="Registered subjects">
          {rows.map((r, i) => (
            <li key={i} className="more-data-row">
              <div className="more-data-main">
                <span className="more-data-title">{titleCase(r.subjectdesc || r.subjectcode || "Subject")}</span>
                <span className="more-data-meta">
                  {r.subjectcode && <span className="att-code">{r.subjectcode}</span>}
                </span>
              </div>
              {r.subjecttypedesc && (
                <span className="more-data-tag">{titleCase(r.subjecttypedesc)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {latest.data && rows.length === 0 && !latest.error && !latest.loading && (
        <p className="muted">No registered subjects found for {semLabel || "this semester"}.</p>
      )}
      {latest.error && <SectionError label="Subjects" error={latest.error} retry={latest.retry} />}
    </CollapsibleCard>
  );
}
