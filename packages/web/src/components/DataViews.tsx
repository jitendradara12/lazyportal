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

/** Parse an exam datetime; null when missing/unparseable. */
export function examTime(v?: string): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function countdown(ms: number): string {
  const days = Math.floor(ms / 86400000);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `in ${hours}h`;
  return "today";
}

export function pct(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

/** Below 75% in any component counts as short. */
export function isShort(r: { Lpercentage?: string; Tpercentage?: string; Ppercentage?: string }): boolean {
  return [pct(r.Lpercentage), pct(r.Tpercentage), pct(r.Ppercentage)].some((n) => n !== null && n < 75);
}

/** Keep only columns matching any pattern (case-insensitive key spelling varies live). */
export function selectColumns(rows: Record<string, unknown>[], keep: RegExp[]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.some((re) => re.test(k)))));
}

export interface PayslipRow {
  currencycode?: string;
  dueamount?: string | number;
}

export function payslipTotals(rows: PayslipRow[]): { currency: string; total: number }[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const cur = r.currencycode ?? "";
    sums.set(cur, (sums.get(cur) ?? 0) + num(r.dueamount));
  }
  return [...sums.entries()].map(([currency, total]) => ({ currency, total }));
}
