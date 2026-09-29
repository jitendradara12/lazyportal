import { useCallback, useEffect, useRef, useState } from "react";

interface UseFeatureOptions<T> {
  run: () => Promise<T>;
  /** Extra deps that retrigger the fetch (e.g. selected semester id). */
  deps?: unknown[];
  /** When false, the fetch is skipped (for chained selects). */
  enabled?: boolean;
  /** Called on 401/SESSION_EXPIRED instead of surfacing an error. */
  onUnauthorized?: () => void;
  /** Optional key to enable stale-while-revalidate local caching. */
  cacheKey?: string;
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
    }
  } catch {}
  return now;
}

/** Centralized per-section fetch status: data + error + loading + retry with SWR caching. */
export function useFeature<T>({ run, deps = [], enabled = true, onUnauthorized, cacheKey }: UseFeatureOptions<T>) {
  const initialCache = getCached<T>(cacheKey);
  const [data, setData] = useState<T | null>(() => initialCache.data);
  const [updatedAt, setUpdatedAt] = useState<number | null>(() => initialCache.updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => enabled && initialCache.data === null);
  const [retryKey, setRetryKey] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  const retry = useCallback(() => {
    setError(null);
    setRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
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
          setLoading(false);
          unauthorizedRef.current?.();
          return;
        }
        // Ponytail / SWR: Keep showing cached data in class rather than flashing red errors
        if (initialCache.data === null) {
          setError(toMessage(e));
        }
        setLoading(false);
      },
    );
    return () => void (live = false);
    // Deps are caller-controlled (session, selected ids) plus retry counter and cacheKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, retryKey, cacheKey, ...deps]);

  return { data, error, loading, retry, updatedAt };
}
