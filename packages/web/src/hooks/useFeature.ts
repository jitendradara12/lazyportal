import { useCallback, useEffect, useRef, useState } from "react";

interface UseFeatureOptions<T> {
  run: () => Promise<T>;
  /** Extra deps that retrigger the fetch (e.g. selected semester id). */
  deps?: unknown[];
  /** When false, the fetch is skipped (for chained selects). */
  enabled?: boolean;
  /** Optional key to enable stale-while-revalidate local caching. */
  cacheKey?: string;
  /** Skip network when cache is fresher than this (default 2h). */
  staleTimeMs?: number;
  scope?: "dashboard" | "attendance" | "all";
}

function isUnauthorized(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  const status = (e as { status?: unknown }).status;
  return code === "SESSION_EXPIRED" || status === 401;
}

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface CacheEntry<T> {
  data: T;
  updatedAt: number;
}

function getCached<T>(key?: string): { data: T | null; updatedAt: number | null } {
  if (!key) return { data: null, updatedAt: null };
  try {
    const raw = localStorage.getItem(`juet.cache.${key}`);
    if (!raw) return { data: null, updatedAt: null };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "updatedAt" in parsed && "data" in parsed) {
      return { data: parsed.data as T, updatedAt: parsed.updatedAt as number };
    }
    return { data: parsed as T, updatedAt: null };
  } catch {
    return { data: null, updatedAt: null };
  }
}

function setCached<T>(key: string | undefined, data: T): number {
  const now = Date.now();
  if (!key || data == null) return now;
  try {
    const entry: CacheEntry<T> = { data, updatedAt: now };
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    if (key.startsWith("att.")) {
      localStorage.setItem("juet.portal.last_sync", String(now));
      window.dispatchEvent(new CustomEvent("juet:sync"));
    }
  } catch {}
  return now;
}

export const STALE_MS = 2 * 60 * 60 * 1000;

export function useFeature<T>({ run, deps = [], enabled = true, cacheKey, staleTimeMs = STALE_MS, scope }: UseFeatureOptions<T>) {
  const targetScope = scope ?? (
    cacheKey?.startsWith("att.subject") || cacheKey?.startsWith("att.detail")
      ? "attendance"
      : cacheKey?.startsWith("att.")
      ? "all"
      : "dashboard"
  );
  const initialCache = getCached<T>(cacheKey);
  const [data, setData] = useState<T | null>(() => initialCache.data);
  const [updatedAt, setUpdatedAt] = useState<number | null>(() => initialCache.updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => enabled && initialCache.data === null);
  const [retryKey, setRetryKey] = useState(0);
  const forceRef = useRef(false);
  const runRef = useRef(run);
  runRef.current = run;

  // Sync state immediately when cacheKey changes
  useEffect(() => {
    const c = getCached<T>(cacheKey);
    setData(c.data);
    setUpdatedAt(c.updatedAt);
    if (!c.data && enabled) setLoading(true);
  }, [cacheKey, enabled]);

  const retry = useCallback(() => {
    forceRef.current = true;
    setError(null);
    setRetryKey((k) => k + 1);
  }, []);

  // Re-fetch live data when a scoped or global refresh is requested
  useEffect(() => {
    const handleRefresh = () => {
      forceRef.current = true;
      setError(null);
      setRetryKey((k) => k + 1);
    };

    window.addEventListener("juet:refresh-all", handleRefresh);
    if (targetScope === "attendance" || targetScope === "all") {
      window.addEventListener("juet:refresh-attendance", handleRefresh);
    }
    if (targetScope === "dashboard" || targetScope === "all") {
      window.addEventListener("juet:refresh-dashboard", handleRefresh);
    }
    return () => {
      window.removeEventListener("juet:refresh-all", handleRefresh);
      if (targetScope === "attendance" || targetScope === "all") {
        window.removeEventListener("juet:refresh-attendance", handleRefresh);
      }
      if (targetScope === "dashboard" || targetScope === "all") {
        window.removeEventListener("juet:refresh-dashboard", handleRefresh);
      }
    };
  }, [targetScope]);

  useEffect(() => {
    if (!enabled) {
      forceRef.current = false;
      setLoading(false);
      setError(null);
      return;
    }
    let live = true;
    const isForce = forceRef.current;
    forceRef.current = false;
    const cached = getCached<T>(cacheKey);
    // ponytail: cache-first — fresh cache skips network entirely unless forced
    if (!isForce && cached.data && cached.updatedAt && Date.now() - cached.updatedAt < staleTimeMs) {
      setUpdatedAt(cached.updatedAt);
      setLoading(false);
      setError(null);
      return () => void (live = false);
    }
    if (!cached.data && !data) {
      setLoading(true);
    }
    setError(null);
    runRef.current().then(
      (d) => {
        if (!live) return;
        setData(d);
        const time = setCached(cacheKey, d);
        setUpdatedAt(time);
        setLoading(false);
      },
      (e) => {
        if (!live) return;
        if (isUnauthorized(e)) {
          if (!data) setError(toMessage(e));
          setLoading(false);
          return;
        }
        setError(toMessage(e));
        setLoading(false);
      },
    );
    return () => void (live = false);
    // Deps are caller-controlled (session, selected ids) plus retry counter and cacheKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, retryKey, cacheKey, ...deps]);

  return { data, error, loading, retry, updatedAt };
}
