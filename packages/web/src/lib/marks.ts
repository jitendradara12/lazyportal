import { formatEventCode } from "@juet/core";
export { formatEventCode, mergeMarkRows } from "@juet/core";

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

export type ScoreBand = "good" | "neutral" | "warning" | "low";

const num = (v: unknown): number | null =>
  v != null && String(v).trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

const round = (n: number): number => Math.round(n * 100) / 100;

const normMark = (v: unknown): number | string => num(v) ?? String(v ?? "").trim().toUpperCase();

/** Stable identity key for a (course, exam) row. */
export function markRowKey(row: MarkRow): string | null {
  const subject = row.subjectcode?.trim().toUpperCase() || row.subjectdesc?.trim().toUpperCase();
  const event = formatEventCode(row.eventcode) || String(row.exameventid ?? "").trim();
  return subject && event ? JSON.stringify([subject, event]) : null;
}

/** Return keys of exam rows that were newly added or had their marks changed relative to a non-empty baseline. */
export function diffMarkRows(previous: MarkRow[], incoming: MarkRow[]): string[] {
  if (!previous.length || !incoming.length) return [];
  const prevMap = new Map<string, string>();
  for (const row of previous) {
    const id = markRowKey(row);
    if (id) prevMap.set(id, JSON.stringify([normMark(row.obtainedmarks), normMark(row.fullmarks)]));
  }
  if (!prevMap.size) return [];
  const changed = new Set<string>();
  for (const row of incoming) {
    const id = markRowKey(row);
    if (!id) continue;
    const sig = JSON.stringify([normMark(row.obtainedmarks), normMark(row.fullmarks)]);
    if (prevMap.get(id) !== sig) changed.add(id);
  }
  return [...changed];
}

/** Semantic performance band for an obtained/full mark pair (>=80% good, >=60% neutral, >=40% warning, <40% low). */
export function getScoreBand(row: MarkRow): ScoreBand {
  const earned = num(row.obtainedmarks);
  const maximum = num(row.fullmarks);
  if (earned === null || maximum === null || maximum <= 0) return "neutral";
  const pct = (earned / maximum) * 100;
  return pct >= 80 ? "good" : pct >= 60 ? "neutral" : pct >= 40 ? "warning" : "low";
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
