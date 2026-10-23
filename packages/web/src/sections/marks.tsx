import { useState, useMemo } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature, sessionCacheKey } from "../hooks/useFeature";
import { useSemester } from "../hooks/useSemester";
import { FEATURE_TTL } from "../lib/portalSchedule";
import { formatEventCode, extractEvents, combineSubjectMarks, type MarkRow } from "../lib/marks.ts";
import { SectionError, titleCase, formatSemester } from "../components/DataViews";
import { TopBar, SemesterPicker } from "../components/AppBar";
import type { SectionProps, Semester } from "../types";

export type { MarkRow };

interface MarksDetail {
  rows: MarkRow[];
}

interface MarksLatest extends MarksDetail {
  semesters: Semester[];
  registrationcode?: string | null;
}

export function MarksSection({ session }: SectionProps) {
  const lov = useFeature<MarksLatest>({
    run: () => features.getMarksLatest(client, session),
    deps: [session],
    enabled: true,
    cacheKey: sessionCacheKey("marks.latest", session),
    staleTimeMs: FEATURE_TTL.marks,
  });
  const [semId, setSemId, sem] = useSemester(sessionCacheKey("semester", session, "marks"), lov.data?.semesters);
  const isDefault = semId === String(lov.data?.semesters?.[0]?.registrationid);
  const detail = useFeature<MarksDetail>({
    run: () => features.getMarks(client, session, { registrationid: sem?.registrationid }),
    deps: [session, semId],
    enabled: sem !== null && !isDefault,
    cacheKey: semId ? sessionCacheKey("marks.detail", session, semId) : undefined,
    staleTimeMs: FEATURE_TTL.marks,
  });

  const rawRows = isDefault ? (lov.data?.rows ?? []) : (detail.data?.rows ?? []);
  const semesters = lov.data?.semesters ?? [];
  const code = sem?.registrationcode ?? (isDefault ? lov.data?.registrationcode : undefined);
  const semLabel = formatSemester(code);
  const error = lov.error ?? detail.error;
  // Include the gaps between chained reads/semester selection, before their
  // effects start the next request. Those are still loading, not empty results.
  const loading = lov.loading || detail.loading || (!error && (
    lov.data === null || (semesters.length > 0 && sem === null) ||
    (sem !== null && !isDefault && detail.data === null)
  ));
  const retry = lov.error ? lov.retry : detail.retry;
  const [filter, setFilter] = useState<string>("All");

  const events = useMemo(() => extractEvents(rawRows), [rawRows]);

  const activeFilter = events.length > 1 && events.includes(filter) ? filter : "All";

  const filteredRows = useMemo(() => {
    if (activeFilter === "All") return combineSubjectMarks(rawRows);
    return rawRows.filter((r) => formatEventCode(r.eventcode) === activeFilter);
  }, [rawRows, activeFilter]);

  const num = (v: unknown) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

  return (
    <div className="page">
      <TopBar title="Marks" subtitle={semLabel || undefined} busy={loading} refreshLabel="Refresh marks" />
      <div className="page-body">
        {(events.length > 1 || semesters.length > 1) && (
          <div className="page-toolbar">
            {events.length > 1 && (
              <div className="chip-row" role="tablist" aria-label="Filter marks by test">
                {["All", ...events].map((ev) => (
                  <button key={ev} type="button" role="tab" aria-selected={activeFilter === ev}
                    className={`chip-btn ${activeFilter === ev ? "active" : ""}`} onClick={() => setFilter(ev)}>
                    {ev}
                  </button>
                ))}
              </div>
            )}
            <SemesterPicker semesters={semesters} value={semId} onChange={setSemId} disabled={loading} format={formatSemester} />
          </div>
        )}
        {loading && rawRows.length === 0 && <p className="muted page-note">Loading…</p>}
        {filteredRows.length > 0 && (
          <ul className="score-list">
            {filteredRows.map((r, i) => {
              const got = num(r.obtainedmarks);
              const full = num(r.fullmarks);
              return (
                <li key={i} className="score-row">
                  <div className="score-info">
                    <span className="score-subject">{titleCase(r.subjectdesc ?? "")}</span>
                    <span className="score-meta">
                      {r.subjectcode && <span className="att-code">{r.subjectcode}</span>}
                      {activeFilter === "All" && r.eventcode}
                    </span>
                  </div>
                  <span className="score-value">
                    <strong>{got ?? (r.obtainedmarks ? String(r.obtainedmarks) : "—")}</strong>
                    <span className="score-total">/{full ?? "—"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {lov.data && rawRows.length === 0 && !error && !loading && (
          <p className="muted page-note">No marks records found for {semLabel || "this semester"}. They show up here once faculty upload them.</p>
        )}
        {error && <SectionError label="Marks" error={error} retry={retry} />}
      </div>
    </div>
  );
}
