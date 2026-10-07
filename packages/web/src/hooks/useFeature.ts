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
  /** Custom freshness check (e.g. portal day schedule). Overrides staleTimeMs when provided. */
  isFresh?: (updatedAt: number | null) => boolean;
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

export interface FeatureState<T> {
  cacheKey: string | undefined;
  data: T | null;
  updatedAt: number | null;
  error: string | null;
  loading: boolean;
}

function createFeatureState<T>(cacheKey: string | undefined, enabled: boolean): FeatureState<T> {
  const cached = getCached<T>(cacheKey);
  return {
    cacheKey,
    data: cached.data,
    updatedAt: cached.updatedAt,
    error: null,
    loading: enabled && cached.data === null,
  };
}

/** Never expose one cache key's in-memory result as another key's data. */
export function resolveFeatureState<T>(
  state: FeatureState<T>,
  cacheKey: string | undefined,
  enabled: boolean,
): FeatureState<T> {
  return state.cacheKey === cacheKey ? state : createFeatureState<T>(cacheKey, enabled);
}

// ponytail: in-flight request deduplication across concurrent hooks sharing a cacheKey
const inFlight = new Map<string, Promise<{ data: unknown; updatedAt: number }>>();
let cacheGeneration = 0;

/** Capture before an async request so it can avoid repopulating cache after logout. */
export function getCacheGeneration(): number {
  return cacheGeneration;
}

export function isCacheGenerationCurrent(generation: number): boolean {
  return generation === cacheGeneration;
}

/** Invalidate pending cache writes and deduplication after the user logs out. */
export function invalidateCacheGeneration(): void {
  cacheGeneration++;
  inFlight.clear();
}

/** Build a persistent cache key scoped to both account and selected institute. */
export function sessionCacheKey(
  feature: string,
  session: { username?: unknown; instituteid?: unknown },
  ...parts: unknown[]
): string {
  return [
    feature,
    session.username ?? "unknown-user",
    session.instituteid ?? "default-institute",
    ...parts.map((part) => part ?? "default"),
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join(":");
}

export function getCached<T>(key?: string): { data: T | null; updatedAt: number | null } {
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

export function setCached<T>(key: string | undefined, data: T, extra?: Record<string, unknown>): number {
  const now = Date.now();
  if (!key || data == null) return now;
  try {
    let existingChecksum: unknown;
    try {
      const raw = localStorage.getItem(`juet.cache.${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "checksum" in parsed) {
          existingChecksum = parsed.checksum;
        }
      }
    } catch {}
    const entry: Record<string, unknown> = {
      data,
      updatedAt: now,
      ...(existingChecksum !== undefined ? { checksum: existingChecksum } : {}),
      ...(extra ?? {}),
    };
    localStorage.setItem(`juet.cache.${key}`, JSON.stringify(entry));
    if (key.startsWith("att.")) {
      localStorage.setItem("juet.portal.last_sync", String(now));
      window.dispatchEvent(new CustomEvent("juet:sync"));
    }
  } catch {}
  return now;
}

export const STALE_MS = 2 * 60 * 60 * 1000;

export function useFeature<T>({ run, deps = [], enabled = true, cacheKey, staleTimeMs = STALE_MS, isFresh, scope }: UseFeatureOptions<T>) {
  const targetScope = scope ?? (
    cacheKey?.startsWith("att.")
      ? "attendance"
      : "dashboard"
  );
  const [state, setState] = useState<FeatureState<T>>(() => createFeatureState<T>(cacheKey, enabled));
  // Resolve against the requested key during render, so an institute/semester
  // switch cannot briefly show the previous key's data before effects run.
  const visibleState = resolveFeatureState(state, cacheKey, enabled);
  const [retryKey, setRetryKey] = useState(0);
  const forceRef = useRef(false);
  const runRef = useRef(run);
  runRef.current = run;

  const setStateForKey = useCallback((key: string | undefined, update: Partial<FeatureState<T>>) => {
    setState((previous) => {
      const base = previous.cacheKey === key ? previous : createFeatureState<T>(key, enabled);
      return { ...base, ...update, cacheKey: key };
    });
  }, [enabled]);

  // Store the newly selected key after render; visibleState already switches
  // synchronously, while this keeps later updates based on the same key.
  useEffect(() => {
    setState((previous) =>
      previous.cacheKey === cacheKey ? previous : createFeatureState<T>(cacheKey, enabled),
    );
  }, [cacheKey, enabled]);

  const retry = useCallback(() => {
    forceRef.current = true;
    setStateForKey(cacheKey, { error: null });
    setRetryKey((k) => k + 1);
  }, [cacheKey, setStateForKey]);

  // Re-fetch live data when a scoped or global refresh is requested
  useEffect(() => {
    const handleRefresh = () => {
      forceRef.current = true;
      setStateForKey(cacheKey, { error: null });
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
  }, [cacheKey, setStateForKey, targetScope]);

  useEffect(() => {
    if (!enabled) {
      forceRef.current = false;
      setStateForKey(cacheKey, { loading: false, error: null });
      return;
    }
    let live = true;
    const isForce = forceRef.current;
    forceRef.current = false;
    const cached = getCached<T>(cacheKey);
    const isVeryFresh = cached.data && cached.updatedAt && Date.now() - cached.updatedAt < 15_000;
    const isFreshEntry = isFresh
      ? isFresh(cached.updatedAt)
      : Boolean(cached.updatedAt && Date.now() - cached.updatedAt < staleTimeMs);
    if ((!isForce || isVeryFresh) && cached.data && cached.updatedAt && isFreshEntry) {
      setStateForKey(cacheKey, {
        data: cached.data,
        updatedAt: cached.updatedAt,
        loading: false,
        error: null,
      });
      return () => void (live = false);
    }
    if (cached.data === null) {
      // Keep this key's loading state visible while its request is in flight.
      setStateForKey(cacheKey, { loading: true });
    }
    setStateForKey(cacheKey, { error: null });

    let promise = cacheKey ? inFlight.get(cacheKey) : undefined;
    if (!promise) {
      const generation = getCacheGeneration();
      let request: Promise<{ data: unknown; updatedAt: number }>;
      request = Promise.resolve()
        .then(() => runRef.current())
        .then((d) => {
          const time = Date.now();
          if (isCacheGenerationCurrent(generation)) setCached(cacheKey, d);
          return { data: d, updatedAt: time };
        })
        .finally(() => {
          if (cacheKey && inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
        });
      promise = request;
      if (cacheKey) inFlight.set(cacheKey, request);
    }

    promise.then(
      ({ data: d, updatedAt: time }) => {
        if (!live) return;
        setStateForKey(cacheKey, { data: d as T, updatedAt: time, loading: false });
      },
      (e) => {
        if (!live) return;
        if (isUnauthorized(e)) {
          // Only suppress auth errors when this key itself has stale cached
          // data. Data left over from a previous key is not a valid fallback.
          setStateForKey(cacheKey, {
            ...(cached.data === null ? { error: toMessage(e) } : {}),
            loading: false,
          });
          return;
        }
        setStateForKey(cacheKey, { error: toMessage(e), loading: false });
      },
    );
    return () => void (live = false);
    // Deps are caller-controlled (session, selected ids) plus retry counter and cacheKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, retryKey, cacheKey, ...deps]);

  return {
    data: visibleState.data,
    error: visibleState.error,
    loading: visibleState.loading,
    retry,
    updatedAt: visibleState.updatedAt,
  };
}
