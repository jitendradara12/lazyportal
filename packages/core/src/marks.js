/** Format exam/test event codes into concise student-friendly labels (e.g. TEST-1 -> T1, P-1 -> P1). */
export function formatEventCode(code) {
  if (code == null) return "";
  const s = String(code).trim().toUpperCase();
  if (!s) return "";
  const tMatch = s.match(/^(?:TEST|T)[-_\s]*([0-9]+)$/);
  if (tMatch) return `T${tMatch[1]}`;
  const pMatch = s.match(/^(?:PRACTICAL|PRAC|PR|P)[-_\s]*([0-9]+)$/);
  if (pMatch) return `P${pMatch[1]}`;
  return s;
}

/** Portal refreshes may omit earlier exams. Keep them, replacing scores for exams returned again. */
export function mergeMarkRows(previous, incoming) {
  const key = (row) => {
    const subject = row.subjectcode?.trim().toUpperCase() || row.subjectdesc?.trim().toUpperCase();
    const event = formatEventCode(row.eventcode) || String(row.exameventid ?? "").trim();
    return subject && event ? JSON.stringify([subject, event]) : null;
  };
  const rows = new Map();
  for (const row of previous) {
    const id = key(row);
    if (id) rows.set(id, row);
  }
  incoming.forEach((row, index) => rows.set(key(row) ?? `incoming-${index}`, row));
  return [...rows.values()];
}

