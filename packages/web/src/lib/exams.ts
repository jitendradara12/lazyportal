export interface ExamRow {
  datetime?: string;
  datetimefrom?: string;
  datetimeupto?: string;
  subjectdesc?: string;
  roomcode?: string;
  seatno?: string;
}

/** Portal schedules use Indian dates and IST, regardless of the device timezone. */
export function examTimes(row: ExamRow): { start: number; end: number } | null {
  const date = row.datetime?.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s|$)/);
  if (!date) return null;
  const [, day, month, year] = date;
  const midnight = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const check = new Date(midnight);
  if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) return null;

  // datetimeupto sometimes contains the entire range, e.g. "12:00 pm to 01:30 pm".
  const matches = [row.datetime, row.datetimefrom, row.datetimeupto]
    .filter(Boolean).join(" ").matchAll(/(\d{1,2}):(\d{2})\s*(AM|PM)?/gi);
  const minutes: number[] = [];
  for (const match of matches) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const ampm = match[3]?.toUpperCase();
    if (minute > 59 || hour > (ampm ? 12 : 23) || (ampm && hour === 0)) return null;
    if (ampm) hour = hour % 12 + (ampm === "PM" ? 12 : 0);
    minutes.push(hour * 60 + minute);
  }
  const istMidnight = midnight - 330 * 60_000;
  const start = istMidnight + (minutes[0] ?? 0) * 60_000;
  // With no end time, keep an exam visible for the whole portal date.
  const end = minutes.length > 1
    ? istMidnight + minutes[minutes.length - 1] * 60_000
    : istMidnight + 86_400_000;
  return { start, end: end < start ? end + 86_400_000 : end };
}

export function groupExams(rows: ExamRow[], now: number) {
  const upcoming: ExamRow[] = [];
  const past: ExamRow[] = [];
  const undated: ExamRow[] = [];
  const timed = rows.map((row) => ({ row, times: examTimes(row) }))
    .sort((a, b) => (a.times?.start ?? Infinity) - (b.times?.start ?? Infinity));
  for (const { row, times } of timed) {
    if (!times) undated.push(row);
    else if (times.end <= now) past.push(row);
    else upcoming.push(row);
  }
  return { upcoming, past, undated };
}

/**
 * Format portal room values (e.g. "LT-4: LECTURE THEATER 4" -> "LT-4").
 * Extracts concise room codes, cleans common labels, and preserves unrecognized text.
 */
export function formatExamRoom(room?: string | null): string {
  if (room == null) return "—";
  let s = String(room).trim();
  if (!s || s === "—" || s === "-") return "—";

  // Strip leading label like "Room:" or "Venue:" or "Location:"
  s = s.replace(/^(?:room|venue|location)\s*:\s*/i, "").trim();
  if (!s) return "—";

  // Full descriptive room names without code: "LECTURE THEATER 4" -> "LT-4"
  const descMatch = s.match(
    /^(lecture\s+theat(?:er|re)|class\s*room|computer\s+lab|tutorial\s+room)\s*[-#]?\s*(\d+[a-z]?)$/i
  );
  if (descMatch) {
    const kind = descMatch[1].toLowerCase();
    const num = descMatch[2].toUpperCase();
    if (kind.startsWith("lecture")) return `LT-${num}`;
    if (kind.startsWith("class")) return `CR-${num}`;
    if (kind.startsWith("computer")) return `CL-${num}`;
    if (kind.startsWith("tutorial")) return `TR-${num}`;
  }

  const colonIndex = s.indexOf(":");
  if (colonIndex !== -1) {
    const prefix = s.slice(0, colonIndex).trim();
    const rest = s.slice(colonIndex + 1).trim();

    if (!prefix) {
      return rest ? formatExamRoom(rest) : "—";
    }

    if (/^(?:note|notice|info|warning|alert)$/i.test(prefix)) {
      return s;
    }

    const words = prefix.split(/\s+/);
    if (prefix.length <= 20 && words.length <= 3) {
      const normMatch = prefix.match(/^([a-z]+)\s+(\d+[a-z]?)$/i);
      if (normMatch && /^(lt|cr|cl|tr)$/i.test(normMatch[1])) {
        return `${normMatch[1].toUpperCase()}-${normMatch[2].toUpperCase()}`;
      }
      const codeMatch = prefix.match(/^([a-z]+)-(\d+[a-z]?)$/i);
      if (codeMatch && /^(lt|cr|cl|tr)$/i.test(codeMatch[1])) {
        return `${codeMatch[1].toUpperCase()}-${codeMatch[2].toUpperCase()}`;
      }
      return prefix;
    }

    if (rest) {
      const cleanedRest = formatExamRoom(rest);
      if (cleanedRest !== "—" && cleanedRest.length <= 15) {
        return cleanedRest;
      }
    }

    return prefix.length <= 30 ? prefix : s;
  }

  const normMatch = s.match(/^([a-z]+)\s+(\d+[a-z]?)$/i);
  if (normMatch && /^(lt|cr|cl|tr)$/i.test(normMatch[1])) {
    return `${normMatch[1].toUpperCase()}-${normMatch[2].toUpperCase()}`;
  }
  const codeMatch = s.match(/^([a-z]+)-(\d+[a-z]?)$/i);
  if (codeMatch && /^(lt|cr|cl|tr)$/i.test(codeMatch[1])) {
    return `${codeMatch[1].toUpperCase()}-${codeMatch[2].toUpperCase()}`;
  }

  return s;
}
