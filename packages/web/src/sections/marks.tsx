import { useState, useMemo } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { FEATURE_TTL } from "../lib/portalSchedule";
import { formatEventCode } from "../lib/marks.ts";
import {
  CollapsibleCard,
  SectionError,
  useCardState,
  titleCase,
  formatSemester,
} from "../components/DataViews";
import type { SectionProps, Semester } from "../types";

export interface MarkRow {
  subjectcode?: string;
  subjectdesc?: string;
  eventcode?: string;
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

export function MarksSection({ session }: SectionProps) {
  const card = useCardState("marks", false);
  const lov = useFeature<MarksLatest>({
    run: () => features.getMarksLatest(client, session),
    deps: [session],
    enabled: card.hasExpanded,
    cacheKey: sessionCacheKey("marks.latest", session),
    staleTimeMs: FEATURE_TTL.marks,
  });
  const [semId, setSemId, sem] = useSemester(sessionCacheKey("semester", session, "marks"), lov.data?.semesters);
  const isDefault = semId === String(lov.data?.semesters?.[0]?.registrationid);
  const detail = useFeature<MarksDetail>({
    run: () => features.getMarks(client, session, { registrationid: sem?.registrationid }),
    deps: [session, semId],
    enabled: card.hasExpanded && sem !== null && !isDefault,
    cacheKey: semId ? sessionCacheKey("marks.detail", session, semId) : undefined,
    staleTimeMs: FEATURE_TTL.marks,
  });

  const rawRows = isDefault ? (lov.data?.rows ?? []) : (detail.data?.rows ?? []);
  const semesters = lov.data?.semesters ?? [];
  const code = sem?.registrationcode ?? (isDefault ? lov.data?.registrationcode : undefined);
  const semLabel = formatSemester(code);
  const loading = lov.loading || detail.loading;
  const error = lov.error ?? detail.error;
  const retry = lov.error ? lov.retry : detail.retry;
  const badgeText = rawRows.length > 0 ? `${rawRows.length} subjects` : (card.hasExpanded ? "No marks" : "Evaluation & test marks");

  const [filter, setFilter] = useState<string>("All");

  const events = useMemo(() => {
    const set = new Set<string>();
    for (const r of rawRows) {
      const formatted = formatEventCode(r.eventcode);
      if (formatted) set.add(formatted);
    }
    const list = Array.from(set);
    list.sort((a, b) => {
      const aP = a[0];
      const bP = b[0];
      if (aP !== bP) {
        if (aP === "T") return -1;
        if (bP === "T") return 1;
      }
      return a.localeCompare(b, undefined, { numeric: true });
    });
    return list;
  }, [rawRows]);

  const activeFilter = events.includes(filter) ? filter : "All";

  const filteredRows = useMemo(() => {
    if (activeFilter === "All") return rawRows;
    return rawRows.filter((r) => formatEventCode(r.eventcode) === activeFilter);
  }, [rawRows, activeFilter]);

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
      {rawRows.length > 0 && events.length > 1 && (
        <div className="segmented-pill-toggle att-target-toggle" role="tablist" aria-label="Filter marks" style={{ margin: "0 auto 12px" }}>
          {["All", ...events].map((ev) => (
            <button
              key={ev}
              type="button"
              role="tab"
              aria-selected={activeFilter === ev}
              className={`segmented-pill ${activeFilter === ev ? "active" : ""}`}
              onClick={() => setFilter(ev)}
            >
              {ev}
            </button>
          ))}
        </div>
      )}
      {filteredRows.length > 0 && (
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
              {filteredRows.map((r, i) => {
                const tag = formatEventCode(r.eventcode);
                return (
                  <tr key={i}>
                    <td>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "6px" }}>
                        {r.subjectcode && <span className="badge">{r.subjectcode}</span>}
                        {tag && <span className="att-log-type-tag">{tag}</span>}
                      </div>
                      {titleCase(r.subjectdesc ?? "")}
                    </td>
                    <td className="num-col">{r.fullmarks != null && r.fullmarks !== "" ? String(r.fullmarks) : "—"}</td>
                    <td className="num-col">
                      <strong>{r.obtainedmarks != null && r.obtainedmarks !== "" ? String(r.obtainedmarks) : "—"}</strong>
                    </td>
                  </tr>
                );
              })}
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
