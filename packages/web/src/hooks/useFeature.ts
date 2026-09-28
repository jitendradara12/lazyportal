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

function getCached<T>(key?: string): T | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(`juet.cache.${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCached<T>(key: string | undefined, data: T): void {
  if (!key || data == null) return;
  try {
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(data));
  } catch {}
}

/** Centralized per-section fetch status: data + error + loading + retry with SWR caching. */
export function useFeature<T>({ run, deps = [], enabled = true, onUnauthorized, cacheKey }: UseFeatureOptions<T>) {
  const [data, setData] = useState<T | null>(() => getCached<T>(cacheKey));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => enabled && getCached<T>(cacheKey) === null);
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
        setCached(cacheKey, d);
        setLoading(false);
      },
      (e) => {
        if (!live) return;
        if (isUnauthorized(e)) {
          setLoading(false);
          unauthorizedRef.current?.();
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

  return { data, error, loading, retry };
}
