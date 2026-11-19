/** Persist to localStorage (best effort) and broadcast in-memory update across mounted hooks. */
export function writePersistentValue(key: string, next: string | null): void {
  try {
    if (next === null) globalThis.localStorage?.removeItem(`juet.portal.${key}`);
    else globalThis.localStorage?.setItem(`juet.portal.${key}`, next);
  } catch {
    /* storage blocked or quota exceeded */
  }
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("juet:persistent-state", { detail: { key, value: next } }));
    }
  } catch {
    /* dispatch blocked */
  }
}
