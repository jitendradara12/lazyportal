import { useCallback, useEffect, useRef, useState } from "react";
import {
  consumePendingTabRefresh,
  getAlertsStatus,
  getCachedAlertsStatus,
  onTabRefresh,
  openAlertSettings,
  setAlertsMuted,
  setOptimisticAlertsStatus,
  subscribeAlertsStatus,
  type AlertsStatus,
} from "../lib/alerts";

export function useAlerts() {
  const [status, setStatus] = useState<AlertsStatus>(getCachedAlertsStatus);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeAlertsStatus((next) => {
      if (mounted.current) setStatus(next);
    });
    const refreshStatus = () => {
      void getAlertsStatus().then((next) => {
        if (mounted.current) setStatus(next);
      });
    };
    refreshStatus();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshStatus();
    };
    window.addEventListener("focus", refreshStatus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener("focus", refreshStatus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const setMuted = useCallback(async (muted: boolean): Promise<AlertsStatus | null> => {
    const prev = statusRef.current;
    const needsPrompt = !muted && prev.permission === "prompt";
    if (needsPrompt && busyRef.current) return null;

    const seq = ++seqRef.current;
    if (needsPrompt) {
      busyRef.current = true;
      setBusy(true);
    } else {
      const optimistic: AlertsStatus = {
        ...prev,
        muted,
        enabled: prev.supported && !muted && prev.permission === "granted",
      };
      statusRef.current = optimistic;
      setOptimisticAlertsStatus(optimistic);
    }
    setError(null);
    try {
      const next = await setAlertsMuted(muted);
      if (mounted.current && seq === seqRef.current) {
        statusRef.current = next;
        setStatus(next);
      }
      return next;
    } catch (e) {
      if (mounted.current && seq === seqRef.current) {
        statusRef.current = prev;
        setOptimisticAlertsStatus(prev);
        setError(e instanceof Error ? e.message : "Could not update alert preference.");
      }
      return null;
    } finally {
      if (needsPrompt) {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }, []);

  const openSettings = useCallback(async () => {
    setError(null);
    return openAlertSettings();
  }, []);

  return { status, busy, error, setMuted, openSettings };
}

export function useTabRefresh(key: string, onRefresh: () => void): void {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    const run = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      refreshRef.current();
    };
    if (consumePendingTabRefresh(key)) {
      run();
    }
    return onTabRefresh(key, run);
  }, [key]);
}
