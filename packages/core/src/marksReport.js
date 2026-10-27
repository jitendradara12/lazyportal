import { formatEventCode } from "./marks.js";
import { PortalError } from "./errors.js";

const invalid = () => new PortalError("The portal's marks report could not be read. Please retry.", { code: "INVALID_RESPONSE" });

/** Read the portal's event-wise table from positioned PDF text, ignoring weightage columns. */
export function parseMarksReport(pages, registrationcode) {
  const text = pages.flat().map((item) => item.text).join(" ").replace(/\s+/g, " ");
  const reportedSemester = text.match(/Registration\s*Code\s*:\s*(\S+)/i)?.[1];
  if (reportedSemester !== registrationcode) throw invalid();
  const rows = [];
  let sawTable = false;
  for (const page of pages) {
    const items = page.map((item) => ({ ...item, text: item.text.trim(), center: item.x + item.width / 2 }));
    const events = items.filter((item) => /^[TP]\d+$/.test(formatEventCode(item.text)));
    const columns = items.filter((item) => /^(OM\/FM|OW\/WT)$/.test(item.text)).sort((a, b) => a.center - b.center);
    if (!events.length || !columns.some((column) => column.text === "OM/FM")) continue;
    sawTable = true;
    const nearest = (list, x) => list.reduce((a, b) => Math.abs(a.center - x) <= Math.abs(b.center - x) ? a : b);
    const headerBottom = Math.min(...columns.map((item) => item.y));
    const subjectEdge = columns[0].x - 40;
    const courses = items.filter((item) => item.x < subjectEdge && item.y < headerBottom && /^\([A-Z0-9][A-Z0-9._-]*\)$/.test(item.text))
      .sort((a, b) => b.y - a.y);
    courses.forEach((course, index) => {
      const top = index === 0 ? headerBottom : courses[index - 1].y;
      const band = items.filter((item) => item.y >= course.y - 2 && item.y < top - 2);
      const subjectcode = course.text.slice(1, -1);
      const subjectdesc = band.filter((item) => item.x < subjectEdge && item !== course && item.text !== course.text)
        .sort((a, b) => b.y - a.y || a.x - b.x).map((item) => item.text).filter(Boolean).join(" ");
      for (const cell of band.filter((item) => item.x >= subjectEdge)) {
        const score = cell.text.match(/^([^/]+)\s*\/\s*(\d+(?:\.\d+)?)$/);
        if (!score) continue;
        const column = nearest(columns, cell.center);
        if (column.text !== "OM/FM") continue;
        const event = nearest(events, column.center);
        const obtained = score[1].trim();
        const fullmarks = Number(score[2]);
        if (obtained === "-" || fullmarks <= 0) continue;
        rows.push({ subjectcode, subjectdesc, eventcode: event.text,
          obtainedmarks: Number.isFinite(Number(obtained)) ? Number(obtained) : obtained, fullmarks });
      }
    });
  }
  if (!sawTable) throw invalid();
  return rows;
}
