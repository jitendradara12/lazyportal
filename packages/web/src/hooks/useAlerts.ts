import { useCallback, useEffect, useRef, useState } from "react";
import {
  consumePendingTabRefresh,
  getAlertsStatus,
  getCachedAlertsStatus,
  onTabRefresh,
  openAlertSettings,
  setAlertsEnabled,
  subscribeAlertsStatus,
  type AlertsStatus,
} from "../lib/alerts";

export function useAlerts() {
  const [status, setStatus] = useState<AlertsStatus>(getCachedAlertsStatus);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
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

  const setEnabled = useCallback(async (enabled: boolean): Promise<AlertsStatus | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await setAlertsEnabled(enabled);
      if (mounted.current) setStatus(next);
      return next;
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "Could not update alert preference.");
      }
      return null;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  const openSettings = useCallback(async () => {
    setError(null);
    return openAlertSettings();
  }, []);

  return { status, busy, error, setEnabled, openSettings };
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
