import { lazy, memo, type ComponentType, type ExoticComponent } from "react";
import type { SectionProps } from "../types";
import { lazyImport } from "../lib/lazyImport";
import { FacultySection } from "./faculty";
import { MarksIcon, ExamsIcon, CalendarIcon } from "../components/icons";

/**
 * Code-split a section: its chunk loads on first use (or from `prefetchTabs`), keeping it out of
 * the startup bundle. `memo` keeps a mounted-but-hidden tab from re-rendering with the dashboard.
 */
const split = (factory: () => Promise<{ default: ComponentType<SectionProps> }>) => {
  const load = lazyImport(factory);
  const Component = memo(lazy(load));
  return { Component, prefetch: () => { void load().catch(() => {}); } };
};

const marks = split(() => import("./marks").then((m) => ({ default: m.MarksSection })));
const exams = split(() => import("./exams").then((m) => ({ default: m.ExamsSection })));
const calendar = split(() => import("../pages/AcademicCalendarPage").then((m) => ({ default: m.AcademicCalendarPage })));
const grades = split(() => import("./grades").then((m) => ({ default: m.GradesSection })));
const cgpa = split(() => import("./cgpa").then((m) => ({ default: m.CgpaSection })));
const subjects = split(() => import("./subjects").then((m) => ({ default: m.SubjectsSection })));

export interface SectionEntry {
  id: string;
  label: string;
  Component: ComponentType<SectionProps> | ExoticComponent<SectionProps>;
  /** Flip to false to hide without deleting the file. */
  enabled?: boolean;
}

export interface TabEntry extends SectionEntry {
  Icon: ComponentType;
}

/**
 * Bottom-nav tabs between Attendance (always first, the landing tab) and More.
 * Each tab is a full page that renders its own TopBar.
 */
export const TABS: TabEntry[] = [
  { id: "marks", label: "Marks", Component: marks.Component, Icon: MarksIcon },
  { id: "exams", label: "Exams", Component: exams.Component, Icon: ExamsIcon },
  { id: "calendar", label: "Calendar", Component: calendar.Component, Icon: CalendarIcon },
];

/** Warm every tab chunk once the first screen is idle, so first visits and offline use stay instant. */
export const prefetchTabs = () => [marks, exams, calendar].forEach((tab) => tab.prefetch());

/**
 * Sections listed on the More page, rendered in order.
 * To turn a section off, set enabled: false. To drop it, delete its line + file.
 * Grades/CGPA are off: new portal returns 500/empty even officially. Flip on when fixed.
 */
export const SECTIONS: SectionEntry[] = [
  { id: "grades", label: "Grades", Component: grades.Component, enabled: false },
  { id: "cgpa", label: "CGPA", Component: cgpa.Component, enabled: false },
  { id: "faculty", label: "Faculty", Component: FacultySection },
  { id: "subjects", label: "Subjects", Component: subjects.Component, enabled: false },
];
