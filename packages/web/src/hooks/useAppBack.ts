import { createContext, useContext, useEffect, useRef } from "react";
import { appBack } from "../lib/nativeInteractions";

// Tabs stay mounted; only the visible tab may register its overlays.
export const BackScope = createContext(true);

export function useAppBack(active: boolean, callback: () => void, priority = 100) {
  const visible = useContext(BackScope);
  const current = useRef(callback);
  current.current = callback;
  useEffect(() => {
    if (active && visible) return appBack.add(() => current.current(), priority);
  }, [active, visible, priority]);
}
