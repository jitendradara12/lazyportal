import type { ComponentType } from "react";
import type { SectionProps } from "../types";
import { MarksSection } from "./marks";
import { GradesSection } from "./grades";
import { CgpaSection } from "./cgpa";
import { ExamsSection } from "./exams";
import { FacultySection } from "./faculty";
import { SubjectsSection } from "./subjects";
import { MarksIcon, ExamsIcon } from "../components/icons";

export interface SectionEntry {
  id: string;
  label: string;
  Component: ComponentType<SectionProps>;
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
  { id: "marks", label: "Marks", Component: MarksSection, Icon: MarksIcon },
  { id: "exams", label: "Exams", Component: ExamsSection, Icon: ExamsIcon },
];

/**
 * Sections listed on the More page, rendered in order.
 * To turn a section off, set enabled: false. To drop it, delete its line + file.
 * Grades/CGPA are off: new portal returns 500/empty even officially. Flip on when fixed.
 */
export const SECTIONS: SectionEntry[] = [
  { id: "grades", label: "Grades", Component: GradesSection, enabled: false },
  { id: "cgpa", label: "CGPA", Component: CgpaSection, enabled: false },
  { id: "faculty", label: "Faculty", Component: FacultySection },
  { id: "subjects", label: "Subjects", Component: SubjectsSection },
];
