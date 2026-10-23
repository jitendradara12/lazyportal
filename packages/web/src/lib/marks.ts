/**
 * Pure helper logic for marks section.
 * Kept zero-dependency and isolated from React/JSX so it can be tested directly in Node.
 */

export interface MarkRow {
  subjectcode?: string;
  subjectdesc?: string;
  eventcode?: string;
  fullmarks?: string | number;
  obtainedmarks?: string | number;
  [key: string]: unknown;
}

export interface SubjectMarks extends MarkRow {
  exams: MarkRow[];
}

const num = (v: unknown): number | null =>
  v != null && String(v).trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

const round = (n: number): number => Math.round(n * 100) / 100;

/** Format exam/test event codes into concise student-friendly labels (e.g. TEST-1 -> T1, P-1 -> P1). */
export function formatEventCode(code?: unknown): string {
  if (code == null) return "";
  const s = String(code).trim().toUpperCase();
  if (!s) return "";
  const tMatch = s.match(/^(?:TEST|T)[-_\s]*([0-9]+)$/);
  if (tMatch) return `T${tMatch[1]}`;
  const pMatch = s.match(/^(?:PRACTICAL|PRAC|PR|P)[-_\s]*([0-9]+)$/);
  if (pMatch) return `P${pMatch[1]}`;
  return s;
}

/** Sort T1, T2, T3 before P1, P2, then remaining event codes numerically. */
export function compareEventCodes(a: string, b: string): number {
  const aP = a[0];
  const bP = b[0];
  if (aP !== bP) {
    if (aP === "T") return -1;
    if (bP === "T") return 1;
    if (aP === "P") return -1;
    if (bP === "P") return 1;
  }
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Sum the recorded exams per course, retaining their rows in exam order. */
export function groupSubjectMarks(rows: MarkRow[]): SubjectMarks[] {
  const map = new Map<
    string,
    {
      subjectcode?: string;
      subjectdesc?: string;
      exams: MarkRow[];
      gotSum: number;
      hasGot: boolean;
      fallbackGot?: string | number;
      fullSum: number;
      hasFull: boolean;
    }
  >();

  rows.forEach((r, i) => {
    const code = r.subjectcode?.trim();
    const desc = r.subjectdesc?.trim();
    const key = (code || desc || `row-${i}`).toUpperCase();
    let entry = map.get(key);
    if (!entry) {
      entry = {
        subjectcode: code ?? r.subjectcode,
        subjectdesc: desc ?? r.subjectdesc,
        exams: [],
        gotSum: 0,
        hasGot: false,
        fallbackGot: r.obtainedmarks,
        fullSum: 0,
        hasFull: false,
      };
      map.set(key, entry);
    } else {
      if (!entry.subjectcode && code) entry.subjectcode = code;
      if (!entry.subjectdesc && desc) entry.subjectdesc = desc;
    }
    entry.exams.push(r);
    const got = num(r.obtainedmarks);
    if (got !== null) {
      entry.gotSum = round(entry.gotSum + got);
      entry.hasGot = true;
    }
    const full = num(r.fullmarks);
    if (full !== null) {
      entry.fullSum = round(entry.fullSum + full);
      entry.hasFull = true;
    }
  });

  return Array.from(map.values(), (entry) => ({
    subjectcode: entry.subjectcode,
    subjectdesc: entry.subjectdesc,
    obtainedmarks: entry.hasGot ? entry.gotSum : entry.fallbackGot,
    fullmarks: entry.hasFull ? entry.fullSum : undefined,
    exams: entry.exams.sort((a, b) => compareEventCodes(formatEventCode(a.eventcode), formatEventCode(b.eventcode))),
  }));
}
