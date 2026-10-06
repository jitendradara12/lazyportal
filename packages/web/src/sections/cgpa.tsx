import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { AutoTable, CollapsibleCard, SectionError, useCardState } from "../components/DataViews";
import type { SectionProps } from "../types";

interface SgpaRow {
  stynumber?: string | number;
  sgpa?: string | number;
  cgpa?: string | number;
  earnedcredit?: string | number;
  points?: string | number;
  [key: string]: unknown;
}

interface SgpaStudent {
  studentid?: string;
  stynumber?: string | number;
}

export function CgpaSection({ session }: SectionProps) {
  const card = useCardState("cgpa", false);
  const lov = useFeature<{ student: SgpaStudent | null; currentsem?: string | null; semesters: SgpaRow[] }>({
    run: () => features.getSgpaLatest(client, session),
    deps: [session],
    enabled: card.hasExpanded,
    cacheKey: sessionCacheKey("cgpa.latest", session),
  });
  const [sty, setSty, sem] = useSemester(sessionCacheKey("semester", session, "cgpa"), lov.data?.semesters, (s) => s.stynumber);
  const detail = useFeature<{ semesterList?: Record<string, unknown>[] }>({
    run: () =>
      features.getSgpaDetail(client, session, {
        studentid: lov.data?.student?.studentid,
        stynumber: sem?.stynumber,
      }),
    deps: [session, sty],
    enabled: card.hasExpanded && sem !== null,
    cacheKey: sty ? sessionCacheKey("cgpa.detail", session, sty) : undefined,
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
      isOpen={card.isOpen}
      onToggle={card.toggle}
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
      {semesters.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Semester</th>
                <th>SGPA</th>
                <th>CGPA</th>
                {semesters.some((s) => s.earnedcredit !== undefined) && <th>Earned Credits</th>}
                {semesters.some((s) => s.points !== undefined) && <th>Points</th>}
              </tr>
            </thead>
            <tbody>
              {semesters.map((s, i) => (
                <tr key={String(s.stynumber ?? i)}>
                  <td><strong>Sem {String(s.stynumber ?? i + 1)}</strong></td>
                  <td>{String(s.sgpa ?? "—")}</td>
                  <td>{String(s.cgpa ?? "—")}</td>
                  {semesters.some((s) => s.earnedcredit !== undefined) && (
                    <td>{String(s.earnedcredit ?? "—")}</td>
                  )}
                  {semesters.some((s) => s.points !== undefined) && (
                    <td>{String(s.points ?? "—")}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailRows.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <p className="muted" style={{ margin: "0 0 0.5rem 0", fontWeight: 500 }}>
            Semester {String(sty ?? "")} Course Details
          </p>
          <AutoTable rows={detailRows} />
        </div>
      )}
      {detail.data && detailRows.length === 0 && !error && !loading && (
        <p className="muted">No subject rows for semester {String(sty ?? "")}.</p>
      )}
      {lov.data && semesters.length === 0 && !error && !loading && (
        <p className="muted">No semester GPA data.</p>
      )}
      {error && <SectionError label="GPA" error={error} retry={retry} />}
    </CollapsibleCard>
  );
}
