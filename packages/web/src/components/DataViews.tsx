/** Shared bits for dashboard sections. */

/** Humanize a backend key for table headers: camelCase/snake_case -> words. */
export function prettyKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/** Fallback table for responses whose columns we haven't mapped yet. */
export function AutoTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c}>{prettyKey(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c}>{cell(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function personalScalars(general: Record<string, unknown> | null): [string, string][] {
  if (!general || typeof general !== "object") return [];
  return Object.entries(general)
    .filter(([k, v]) => {
      if (/photo/i.test(k)) return false;
      if (v === null || v === undefined) return false;
      if (typeof v === "object") return false;
      return true;
    })
    .map(([k, v]) => [k, String(v)]);
}

/** Render an unmapped response: arrays as tables, objects as key/value lists (nested included). */
export function UnknownData({ data }: { data: unknown }) {
  if (Array.isArray(data)) return <AutoTable rows={data as Record<string, unknown>[]} />;
  if (data !== null && typeof data !== "object") return <p className="muted">{String(data)}</p>;
  if (data && typeof data === "object") {
    const entries = personalScalars(data as Record<string, unknown>);
    const nested = Object.entries(data as Record<string, unknown>).filter(
      ([k, v]) => v !== null && typeof v === "object" && !/photo/i.test(k)
    );
    if (entries.length === 0 && nested.length === 0) return null;
    return (
      <>
        {entries.length > 0 && (
          <dl>
            {entries.map(([k, v]) => (
              <div key={k}><dt>{prettyKey(k)}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
        {nested.map(([k, v]) => (
          <div key={k}>
            <h3>{prettyKey(k)}</h3>
            <UnknownData data={v} />
          </div>
        ))}
      </>
    );
  }
  return null;
}

/** Error line with retry, shared by every section. */
export function SectionError({ label, error, retry }: { label: string; error: string; retry: () => void }) {
  return (
    <p role="alert" className="error">
      {label} failed: {error} <button onClick={retry}>Retry</button>
    </p>
  );
}

/** Number() yields NaN for non-numeric input — coerce those to 0 so one bad row can't poison the total. */
export function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
