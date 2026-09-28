import { Fragment, useEffect, useState } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { SectionError, UnknownData } from "../components/DataViews";
import type { SectionProps, Semester } from "../types";

interface AttRow {
  subjectcode?: string;
  Lpercentage?: string;
  Tpercentage?: string;
  Ppercentage?: string;
}

interface AttData {
  header: { stynumber?: string } | null;
  semesters: Semester[];
  registrationcode?: string | null;
  rows: AttRow[];
}

function pct(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

/** Below 75% in any component counts as short. */
function short(r: AttRow): boolean {
  return [pct(r.Lpercentage), pct(r.Tpercentage), pct(r.Ppercentage)].some((n) => n !== null && n < 75);
}

function SubjectDetailToggle(props: {
  row: AttRow & Record<string, unknown>;
  registrationid?: string;
  registrationcode?: string;
  session: SectionProps["session"];
  onLogout: () => void;
}) {
  const [which, setWhich] = useState<"current" | "previous">("current");
  return (
    <>
      <span className="semrow">
        <button onClick={() => setWhich("current")} disabled={which === "current"}>Current</button>
        <button onClick={() => setWhich("previous")} disabled={which === "previous"}>Previous</button>
      </span>
      <SubjectDetail {...props} which={which} />
    </>
  );
}

function SubjectDetail({ row, registrationid, registrationcode, session, onLogout, which }: {
  row: AttRow & Record<string, unknown>;
  registrationid?: string;
  registrationcode?: string;
  session: SectionProps["session"];
  onLogout: () => void;
  which: "current" | "previous";
}) {
  const base = { subjectid: row.subjectid, registrationid, subjectcode: row.individualsubjectcode ?? row.subjectcode, registrationcode };
  const current = useFeature<Record<string, Record<string, unknown>>>({
    run: () => features.getSubjectAttendanceAll(client, session, row, { registrationid, registrationcode }),
    deps: [session, registrationid, String(row.subjectid)],
    enabled: which === "current",
    onUnauthorized: onLogout,
  });
  const previous = useFeature<Record<string, unknown>>({
    run: () =>
      features.getPreviousSubjectAttendance(client, session, {
        ...base,
        components: [row.Lsubjectcomponentid, row.Tsubjectcomponentid, row.Psubjectcomponentid]
          .filter(Boolean)
          .join(","),
      }),
    deps: [session, registrationid, String(row.subjectid)],
    enabled: which === "previous",
    onUnauthorized: onLogout,
  });
  const active = which === "current" ? current : previous;
  if (active.loading) return <p className="muted">Loading detail…</p>;
  if (active.error) return <SectionError label="Subject detail" error={active.error} retry={active.retry} />;
  if (which === "current") {
    const types = Object.keys(current.data ?? {});
    if (types.length === 0) return <p className="muted">No detail rows.</p>;
    return (
      <>
        {types.map((t) => (
          <div key={t}>
            <h3>{t} component</h3>
            <UnknownData data={current.data?.[t]} />
          </div>
        ))}
      </>
    );
  }
  return <UnknownData data={previous.data} />;
}

export function AttendanceSection({ session, onLogout }: SectionProps) {
  const att = useFeature<AttData>({
    run: () => features.getAttendance(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const [semId, setSemId] = usePersistentState("sem.attendance", null);
  useEffect(() => {
    const first = att.data?.semesters?.[0]?.registrationid;
    if (first != null && semId === null) setSemId(String(first));
  }, [att.data, semId]);
  const sem = att.data?.semesters?.find((s) => String(s.registrationid) === semId) ?? null;
  const isDefault = semId === String(att.data?.semesters?.[0]?.registrationid);
  const detail = useFeature<{ rows: AttRow[] }>({
    run: () =>
      features.getAttendanceDetail(client, session, {
        stynumber: att.data?.header?.stynumber,
        registrationid: sem?.registrationid,
        registrationcode: sem?.registrationcode,
      }),
    deps: [session, semId],
    enabled: sem !== null && !isDefault,
    onUnauthorized: onLogout,
  });

  const initial = att.data;
  const rows = detail.data?.rows ?? initial?.rows ?? [];
  const [open, setOpen] = useState<number | null>(null);
  const semesters = initial?.semesters ?? [];
  const code = detail.data ? sem?.registrationcode : initial?.registrationcode;
  const loading = att.loading || detail.loading;
  const error = att.error ?? detail.error;
  const retry = att.error ? att.retry : detail.retry;

  if (!initial && !error) {
    return (
      <section className="card" id="attendance" aria-busy="true">
        <h2>Attendance</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  return (
    <section className="card" id="attendance">
      <h2>Attendance{code ? ` · ${code}` : ""}</h2>
      {semesters.length > 0 && (
        <label className="semrow">
          Semester{" "}
          <select value={semId ?? ""} onChange={(e) => setSemId(e.target.value)} disabled={loading}>
            {semesters.map((s) => (
              <option key={String(s.registrationid)} value={String(s.registrationid)}>
                {s.registrationcode}
              </option>
            ))}
          </select>
          {detail.loading && <span className="muted">Loading…</span>}
        </label>
      )}
      <p className="muted">Previous day's entry. Today's attendance reflects tomorrow. Below 75% counts as short — confirm your course rules.</p>
      {rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Subject</th><th>L%</th><th>T%</th><th>P%</th><th></th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={i}>
                  <tr className={short(r) ? "short" : undefined}>
                    <td>{r.subjectcode}</td><td>{r.Lpercentage}</td><td>{r.Tpercentage}</td><td>{r.Ppercentage}</td>
                    <td>{short(r) ? "Short" : ""}</td>
                    <td>
                      <button onClick={() => setOpen(open === i ? null : i)}>
                        {open === i ? "Hide" : "Detail"}
                      </button>
                    </td>
                  </tr>
                  {open === i && (
                    <tr key={`${i}-detail`}>
                      <td colSpan={6}>
                        <SubjectDetailToggle
                          row={r as AttRow & Record<string, unknown>}
                          registrationid={sem?.registrationid}
                          registrationcode={sem?.registrationcode}
                          session={session}
                          onLogout={onLogout}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {initial && rows.length === 0 && !error && !loading && (
        <p className="muted">No attendance rows for {code ?? "this registration"}.</p>
      )}
      {error && <SectionError label="Attendance" error={error} retry={retry} />}
    </section>
  );
}
