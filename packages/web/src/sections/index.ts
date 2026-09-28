import type { ComponentType } from "react";
import type { SectionProps } from "../types";
import { AttendanceSection } from "./attendance";
import { MarksSection } from "./marks";
import { GradesSection } from "./grades";
import { CgpaSection } from "./cgpa";
import { ExamsSection } from "./exams";
import { FacultySection } from "./faculty";
import { SubjectsSection } from "./subjects";

export interface SectionEntry {
  id: string;
  label: string;
  Component: ComponentType<SectionProps>;
  /** Flip to false to hide without deleting the file. */
  enabled?: boolean;
}

/**
 * Dashboard registry. One line per section, rendered in order.
 * To turn a section off, set enabled: false. To drop it, delete its line + file.
 * Grades/CGPA are off: new portal returns 500/empty even officially. Flip on when fixed.
 */
export const SECTIONS: SectionEntry[] = [
  { id: "attendance", label: "Attendance", Component: AttendanceSection },
  { id: "marks", label: "Marks", Component: MarksSection },
  { id: "grades", label: "Grades", Component: GradesSection, enabled: false },
  { id: "cgpa", label: "CGPA", Component: CgpaSection, enabled: false },
  { id: "exams", label: "Exams", Component: ExamsSection },
  { id: "faculty", label: "Faculty", Component: FacultySection },
  { id: "subjects", label: "Subjects", Component: SubjectsSection },
];
