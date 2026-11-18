import { PortalError } from "./errors.js";

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

/** Stable identity key for a (course, exam) mark row. */
export function markRowKey(row) {
  const subject = row.subjectcode?.trim().toUpperCase() || row.subjectdesc?.trim().toUpperCase();
  const event = formatEventCode(row.eventcode) || String(row.exameventid ?? "").trim();
  return subject && event ? JSON.stringify([subject, event]) : null;
}

/** Portal refreshes may omit earlier exams. Keep them, replacing scores for exams returned again. */
export function mergeMarkRows(previous, incoming) {
  const rows = new Map();
  for (const row of previous) {
    const id = markRowKey(row);
    if (id) rows.set(id, row);
  }
  incoming.forEach((row, index) => rows.set(markRowKey(row) ?? `incoming-${index}`, row));
  return [...rows.values()];
}

const invalidReport = () =>
  new PortalError("The portal's marks report could not be read. Please retry.", { code: "INVALID_RESPONSE" });

/** Read the portal's event-wise table from positioned PDF text, ignoring weightage columns. */
export function parseMarksReport(pages, registrationcode) {
  const text = pages.flat().map((item) => item.text).join(" ").replace(/\s+/g, " ");
  const reportedSemester = text.match(/Registration\s*Code\s*:\s*(\S+)/i)?.[1];
  if (reportedSemester !== registrationcode) throw invalidReport();
  const rows = [];
  let sawTable = false;
  for (const page of pages) {
    const items = page.map((item) => ({ ...item, text: item.text.trim(), center: item.x + item.width / 2 }));
    const tpEvents = items.filter((item) => /^[TP]\d+$/.test(formatEventCode(item.text)));
    const columns = items.filter((item) => /^(OM\/FM|OW\/WT)$/.test(item.text)).sort((a, b) => a.center - b.center);
    if (!tpEvents.length || !columns.some((column) => column.text === "OM/FM")) continue;
    sawTable = true;
    const nearest = (list, x) => list.reduce((a, b) => Math.abs(a.center - x) <= Math.abs(b.center - x) ? a : b);
    const headerBottom = Math.min(...columns.map((item) => item.y));
    const subjectEdge = columns[0].x - 20;
    const eventY = tpEvents.reduce((sum, item) => sum + item.y, 0) / tpEvents.length;
    const events = items.filter((item) =>
      item.x >= subjectEdge && Math.abs(item.y - eventY) <= 5 && item.text && !/^(OM\/FM|OW\/WT)$/.test(item.text));
    const courses = items.filter((item) => item.x < subjectEdge && item.y < headerBottom && /^\([A-Z0-9][A-Z0-9._-]*\)$/.test(item.text))
      .sort((a, b) => b.y - a.y);
    courses.forEach((course, index) => {
      const top = index === 0 ? headerBottom : courses[index - 1].y;
      const band = items.filter((item) => item.y >= course.y - 2 && item.y < top - 2);
      const subjectcode = course.text.slice(1, -1);
      const subjectdesc = band.filter((item) => item.x < subjectEdge && item !== course && item.text !== course.text)
        .sort((a, b) => b.y - a.y || a.x - b.x).map((item) => item.text).filter(Boolean).join(" ");
      const cellsByColumn = new Map();
      for (const cell of band.filter((item) => item.x >= subjectEdge)) {
        const column = nearest(columns, cell.center);
        if (column.text !== "OM/FM") continue;
        const list = cellsByColumn.get(column) ?? [];
        list.push(cell);
        cellsByColumn.set(column, list);
      }
      for (const [column, cellItems] of cellsByColumn) {
        const text = cellItems
          .sort((a, b) => b.y - a.y || a.x - b.x)
          .map((item) => item.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const score = text.match(/^([^/]+)\s*\/\s*(\d+(?:\.\d+)?)$/);
        if (!score) continue;
        const event = nearest(events, column.center);
        const obtained = score[1].trim();
        const fullmarks = Number(score[2]);
        if (obtained === "-" || fullmarks <= 0) continue;
        rows.push({ subjectcode, subjectdesc, eventcode: event.text,
          obtainedmarks: Number.isFinite(Number(obtained)) ? Number(obtained) : obtained, fullmarks });
      }
    });
  }
  if (!sawTable) throw invalidReport();
  return rows;
}
