import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { AutoTable, CollapsibleCard, SectionError } from "../components/DataViews";
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

export function CgpaSection({ session }: SectionProps) {
  const lov = useFeature<{ student: SgpaStudent | null; currentsem?: string | null; semesters: SgpaRow[] }>({
    run: () => features.getSgpaLatest(client, session),
    deps: [session],
    cacheKey: `cgpa.latest:${session.username}`,
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
    cacheKey: sty ? `cgpa.detail:${session.username}:${sty}` : undefined,
  });

  const semesters = lov.data?.semesters ?? [];
  const detailRows = detail.data?.semesterList ?? [];
  const loading = lov.loading || detail.loading;
  const error = lov.error ?? detail.error;
  const retry = lov.error ? lov.retry : detail.retry;

  const currentCgpa = semesters[semesters.length - 1]?.cgpa;
  const badgeText = currentCgpa ? `CGPA: ${String(currentCgpa)}` : undefined;

  return (
    <CollapsibleCard
      id="cgpa"
      title="SGPA / CGPA"
      badge={badgeText}
      defaultOpen={false}
      action={
        semesters.length > 1 ? (
          <select
            value={sty ?? ""}
            onChange={(e) => setSty(e.target.value)}
            disabled={loading}
            className="sem-picker"
          >
            {semesters.map((s, i) => (
              <option key={String(s.stynumber ?? i)} value={String(s.stynumber ?? "")}>
                Sem {String(s.stynumber ?? "")} · SGPA {String(s.sgpa ?? "")} · CGPA {String(s.cgpa ?? "")}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      {loading && <p className="muted">Loading…</p>}
      {!detail.data && semesters.length > 0 && !detail.loading && (
        <AutoTable rows={semesters as Record<string, unknown>[]} />
      )}
      {detail.data && detailRows.length > 0 && (
        <AutoTable rows={detailRows as Record<string, unknown>[]} />
      )}
      {detail.data && detailRows.length === 0 && !error && !loading && (
        <p className="muted">No subject rows for this semester.</p>
      )}
      {lov.data && semesters.length === 0 && !error && !loading && (
        <p className="muted">No semester GPA data.</p>
      )}
      {error && <SectionError label="GPA" error={error} retry={retry} />}
    </CollapsibleCard>
  );
}
