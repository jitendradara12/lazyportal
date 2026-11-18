import { useEffect, useRef, useState } from "react";
import { useShell } from "../components/AppBar";
import { sessionCacheKey, getCacheGeneration, isCacheGenerationCurrent } from "./useFeature";
import { recordRefreshAttempt, shouldThrottleRefresh } from "../lib/portalSchedule";
import { getRefreshThrottleMs, getSessionStatus, type RefreshPage } from "../lib/portal";
import type { Session } from "../types";
import { selectionHaptic } from "../lib/nativeInteractions";

export function usePageRefresh(
  page: RefreshPage,
  session: Session,
  busy = false,
  onRun?: () => Promise<unknown>,
) {
  const shell = useShell();
  const [refreshing, setRefreshing] = useState(false);
  const pending = useRef(false);
  const lastAttempt = useRef({ key: "", at: 0 });
  const key = sessionCacheKey(`refresh.${page}`, session);
  const activeKey = useRef<string | null>(key);
  activeKey.current = key;
  useEffect(() => {
    activeKey.current = key;
    return () => { activeKey.current = null; };
  }, [key]);
  const onRefresh = async () => {
    if (pending.current || busy || shell.isExpired || shell.isRecovering ||
        navigator.onLine === false) return;
    pending.current = true;
    const generation = getCacheGeneration();
    try {
      const throttleMs = await getRefreshThrottleMs(page);
      if (activeKey.current !== key || !isCacheGenerationCurrent(generation) || getSessionStatus() !== "authenticated" || navigator.onLine === false) return;
      if (shouldThrottleRefresh(key, throttleMs) ||
          (lastAttempt.current.key === key && Date.now() - lastAttempt.current.at < throttleMs)) return;
      if (!onRun) return;
      selectionHaptic();
      lastAttempt.current = { key, at: Date.now() };
      recordRefreshAttempt(key);
      setRefreshing(true);
      try { await onRun(); } catch {}
    } finally {
      pending.current = false;
      setRefreshing(false);
    }
  };
  return { onRefresh, busy: busy || refreshing };
}
