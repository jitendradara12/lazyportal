import { usePersistentState } from "./usePersistentState";

export const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["value"];

export function readStoredThemePreference(): ThemePreference {
  try {
    const raw = globalThis.localStorage?.getItem("juet.portal.theme");
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    /* storage blocked */
  }
  return "system";
}

export function applyThemePreference(preference: ThemePreference = readStoredThemePreference()): void {
  if (typeof document === "undefined") return;
  const systemDark = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
  const resolved = preference === "light" || preference === "dark"
    ? preference
    : (systemDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", resolved);
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute("content", preference === "light" || preference === "dark" ? preference : "light dark");
  }
}

export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const [stored, setStored] = usePersistentState("theme", null);
  const preference: ThemePreference = stored === "light" ? "light" : stored === "dark" ? "dark" : "system";
  const setPreference = (next: ThemePreference) => {
    setStored(next === "system" ? null : next);
    applyThemePreference(next);
  };
  return [preference, setPreference];
}
