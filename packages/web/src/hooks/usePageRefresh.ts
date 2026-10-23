import { useRef, useState } from "react";
import { useShell } from "../components/AppBar";
import { sessionCacheKey } from "./useFeature";
import { recordRefreshAttempt, shouldThrottleRefresh, REFRESH_THROTTLE_MS } from "../lib/portalSchedule";
import type { Session } from "../types";
import { selectionHaptic } from "../lib/nativeInteractions";

export type RefreshPage = "marks" | "exams" | "more";
export interface PageRefreshRequest { requests: Promise<unknown>[] }

/** Only enabled readers on this page participate; no polling or server state. */
export function usePageRefresh(page: RefreshPage, session: Session, busy = false) {
  const shell = useShell();
  const [refreshing, setRefreshing] = useState(false);
  const pending = useRef(false);
  const lastAttempt = useRef({ key: "", at: 0 });
  const key = sessionCacheKey(`refresh.${page}`, session);
  const onRefresh = async () => {
    if (pending.current || busy || shell.isExpired || shell.isRecovering ||
        navigator.onLine === false || shouldThrottleRefresh(key) ||
        (lastAttempt.current.key === key && Date.now() - lastAttempt.current.at < REFRESH_THROTTLE_MS)) return;
    pending.current = true;
    const detail: PageRefreshRequest = { requests: [] };
    window.dispatchEvent(new CustomEvent(`juet:refresh-${page}`, { detail }));
    if (detail.requests.length) {
      selectionHaptic();
      lastAttempt.current = { key, at: Date.now() };
      recordRefreshAttempt(key);
    }
    setRefreshing(true);
    try {
      await Promise.allSettled(detail.requests);
    } finally {
      pending.current = false;
      setRefreshing(false);
    }
  };
  return { onRefresh, busy: busy || refreshing };
}
