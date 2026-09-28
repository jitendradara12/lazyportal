import type { ComponentType } from "react";
import type { SectionProps } from "../types";
import { NoticesSection } from "./notices";
import { AttendanceSection } from "./attendance";
import { MarksSection } from "./marks";
import { GradesSection } from "./grades";
import { CgpaSection } from "./cgpa";
import { ExamsSection } from "./exams";
import { FeesSection } from "./fees";
import { RequestsSection } from "./requests";
import { ProfileSection } from "./profile";
import { FacultySection } from "./faculty";
import { NoduesSection } from "./nodues";
import { HostelSection } from "./hostel";
import { SubjectsSection } from "./subjects";

export interface SectionEntry {
  id: string;
  label: string;
  Component: ComponentType<SectionProps>;
}

/**
 * Dashboard registry. One line per section, rendered in order.
 * To turn a section off, delete its line. To add one, add a file
 * plus one line here. Nothing else changes.
 */
export const SECTIONS: SectionEntry[] = [
  { id: "notices", label: "Announcements", Component: NoticesSection },
  { id: "attendance", label: "Attendance", Component: AttendanceSection },
  { id: "marks", label: "Marks", Component: MarksSection },
  { id: "grades", label: "Grades", Component: GradesSection },
  { id: "cgpa", label: "CGPA", Component: CgpaSection },
  { id: "exams", label: "Exams", Component: ExamsSection },
  { id: "fees", label: "Fees", Component: FeesSection },
  { id: "requests", label: "Requests", Component: RequestsSection },
  { id: "profile", label: "Profile", Component: ProfileSection },
  { id: "faculty", label: "Faculty", Component: FacultySection },
  { id: "nodues", label: "No-dues", Component: NoduesSection },
  { id: "hostel", label: "Hostel", Component: HostelSection },
  { id: "subjects", label: "Subjects", Component: SubjectsSection },
];
