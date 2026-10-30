import { useState } from "react";
import { nextDate, prevDate, type AcademicDay } from "../lib/academicCalendar";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const shift = (month: string, by: number) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, 7);
};
const shares = (a?: AcademicDay, b?: AcademicDay) => Boolean(a && b && a.tone === b.tone && a.events.some((event) => b.events.includes(event)));
const Chevron = ({ back }: { back?: boolean }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={back ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} /></svg>;

/** Month view. Multi-day events read as one band with solid ends, like Material's range picker. */
export function MonthGrid({ days, today, first, last, selected, onSelect }: {
  days: Map<string, AcademicDay>;
  today: string;
  /** Earliest and latest browsable month, YYYY-MM. */
  first: string;
  last: string;
  selected: string | null;
  onSelect: (date: string | null) => void;
}) {
  const [month, setMonth] = useState(() => (today.slice(0, 7) < first ? first : today.slice(0, 7) > last ? last : today.slice(0, 7)));
  const start = new Date(`${month}-01T00:00:00Z`);
  const lead = start.getUTCDay();
  const count = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const monthName = start.toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" });

  return <section className="month-grid" aria-label="Month view">
    <div className="mg-head">
      <button type="button" className="mg-nav" aria-label="Previous month" disabled={month <= first} onClick={() => setMonth(shift(month, -1))}><Chevron back /></button>
      <div className="mg-title" aria-live="polite">{monthName} <span>{start.getUTCFullYear()}</span></div>
      <button type="button" className="mg-nav" aria-label="Next month" disabled={month >= last} onClick={() => setMonth(shift(month, 1))}><Chevron /></button>
    </div>
    <div className="mg-grid">
      {WEEKDAYS.map((day, i) => <div key={i} className="mg-weekday" aria-hidden="true">{day}</div>)}
      {Array.from({ length: lead }, (_, i) => <div key={`blank-${i}`} />)}
      {Array.from({ length: count }, (_, i) => {
        const n = i + 1;
        const date = `${month}-${String(n).padStart(2, "0")}`;
        const day = days.get(date);
        const col = (lead + i) % 7;
        const joinL = shares(day, days.get(prevDate(date)));
        const joinR = shares(day, days.get(nextDate(date)));
        const cls = ["mg-day", day && `tone-${day.tone}`, day && !joinL && "s", day && !joinR && "e", (joinL || joinR) && "range",
          joinL && n === 1 && "fade-l", joinR && n === count && "fade-r",
          col === 0 && "rs", col === 6 && "re", date === today && "is-today", date === selected && "is-selected"].filter(Boolean).join(" ");
        return day
          ? <button key={date} type="button" className={cls} aria-pressed={date === selected} aria-label={`${n} ${monthName}: ${day.events.map((event) => event.title).join(", ")}`} onClick={() => onSelect(date === selected ? null : date)}><span>{n}</span></button>
          : <div key={date} className={cls}><span>{n}</span></div>;
      })}
    </div>
  </section>;
}
