import { useCallback, useEffect, useRef, useState } from "react";

interface UseFeatureOptions<T> {
  run: () => Promise<T>;
  /** Extra deps that retrigger the fetch (e.g. selected semester id). */
  deps?: unknown[];
  /** When false, the fetch is skipped (for chained selects). */
  enabled?: boolean;
  /** Called on 401/SESSION_EXPIRED instead of surfacing an error. */
  onUnauthorized?: () => void;
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

/** Centralized per-section fetch status: data + error + loading + retry. */
export function useFeature<T>({ run, deps = [], enabled = true, onUnauthorized }: UseFeatureOptions<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
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
    // Deps are caller-controlled (session, selected ids) plus retry counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, retryKey, ...deps]);

  return { data, error, loading, retry };
}
