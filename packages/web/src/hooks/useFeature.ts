import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCached,
  setCached,
  sessionCacheKey,
  getCacheGeneration,
  isCacheGenerationCurrent,
  invalidateCacheGeneration,
  requestFeature,
  STALE_MS,
} from "../lib/featureCache.ts";

export {
  getCached,
  setCached,
  sessionCacheKey,
  getCacheGeneration,
  isCacheGenerationCurrent,
  invalidateCacheGeneration,
  requestFeature,
  STALE_MS,
};

interface UseFeatureOptions<T> {
  run: (signal: AbortSignal) => Promise<T>;
  /** Extra deps that retrigger the fetch (e.g. selected semester id). */
  deps?: unknown[];
  /** When false, the fetch is skipped (for chained selects). */
  enabled?: boolean;
  /** Optional key to enable stale-while-revalidate local caching. */
  cacheKey?: string;
  /** Serialize different snapshots that write to the same persistent cache. */
  requestVersion?: string;
  /** Skip network when cache is fresher than this (default 2h). */
  staleTimeMs?: number;
  /** Custom freshness check (e.g. portal day schedule). Overrides staleTimeMs when provided. */
  isFresh?: (updatedAt: number | null) => boolean;
  /** Optional extra metadata to persist in the cache entry (e.g. checksum). */
  writeExtra?: Record<string, unknown> | ((data: T) => Record<string, unknown>);
}

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface CacheEntry<T> {
  data: T;
  updatedAt: number;
  checksum?: string | null;
  [key: string]: unknown;
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

export const NOT_REFRESHING = Symbol("idle");
export type RefreshingKey = string | undefined | typeof NOT_REFRESHING;

/** True only when the active refresh belongs to the currently visible cache key (including unkeyed undefined). */
export function isRefreshingForKey(refreshingKey: RefreshingKey, cacheKey: string | undefined): boolean {
  return refreshingKey === cacheKey;
}

/** Clear refreshing state only if no newer key has superseded it. */
export function clearRefreshingForKey(prev: RefreshingKey, cacheKey: string | undefined): RefreshingKey {
  return prev === cacheKey ? NOT_REFRESHING : prev;
}

export function useFeature<T>({
  run,
  deps = [],
  enabled = true,
  cacheKey,
  requestVersion,
  staleTimeMs = STALE_MS,
  isFresh,
  writeExtra,
}: UseFeatureOptions<T>) {
  const [state, setState] = useState<FeatureState<T>>(() => createFeatureState<T>(cacheKey, enabled));
  // Resolve against the requested key during render, so an institute/semester
  // switch cannot briefly show the previous key's data before effects run.
  const visibleState = resolveFeatureState(state, cacheKey, enabled);
  const [retryKey, setRetryKey] = useState(0);
  const [refreshingKey, setRefreshingKey] = useState<RefreshingKey>(NOT_REFRESHING);
  const refreshing = isRefreshingForKey(refreshingKey, cacheKey);
  const mounted = useRef(false);
  const activeKey = useRef(cacheKey);
  activeKey.current = cacheKey;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const forceRef = useRef(false);
  const runRef = useRef(run);
  runRef.current = run;
  const writeExtraRef = useRef(writeExtra);
  writeExtraRef.current = writeExtra;

  const setStateForKey = useCallback((key: string | undefined, update: Partial<FeatureState<T>>) => {
    if (!mounted.current) return;
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
    setRetryKey((k) => k + 1);
  }, []);

  const refresh = useCallback(async () => {
    const generation = getCacheGeneration();
    const current = () => mounted.current && activeKey.current === cacheKey && isCacheGenerationCurrent(generation);
    if (mounted.current) setRefreshingKey(cacheKey);
    setStateForKey(cacheKey, { error: null });
    try {
      const result = await requestFeature(cacheKey, runRef.current, writeExtraRef.current, requestVersion);
      if (current()) setStateForKey(cacheKey, { ...result, loading: false, error: null });
      return result.data;
    } catch (error) {
      if (current()) setStateForKey(cacheKey, { error: toMessage(error), loading: false });
      throw error;
    } finally {
      if (current()) setRefreshingKey((prev) => clearRefreshingForKey(prev, cacheKey));
    }
  }, [cacheKey, requestVersion, setStateForKey]);

  // A completed manual/background read updates every mounted consumer without
  // broadcasting another network refresh (e.g. the dashboard attendance hero).
  useEffect(() => {
    if (!cacheKey) return;
    const update = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key !== cacheKey) return;
      const cached = getCached<T>(cacheKey);
      setStateForKey(cacheKey, { data: cached.data, updatedAt: cached.updatedAt, error: null, loading: false });
    };
    window.addEventListener("juet:cache-updated", update);
    return () => window.removeEventListener("juet:cache-updated", update);
  }, [cacheKey, setStateForKey]);

  useEffect(() => {
    if (!enabled) {
      setRefreshingKey(NOT_REFRESHING);
      forceRef.current = false;
      setStateForKey(cacheKey, { loading: false, error: null });
      return;
    }
    let live = true;
    const isForce = forceRef.current;
    forceRef.current = false;
    const cached = getCached<T>(cacheKey);
    const isFreshEntry = isFresh
      ? isFresh(cached.updatedAt)
      : Boolean(cached.updatedAt && Date.now() - cached.updatedAt < staleTimeMs);
    if (!isForce && cached.data && cached.updatedAt && isFreshEntry) {
      setRefreshingKey(NOT_REFRESHING);
      setStateForKey(cacheKey, {
        data: cached.data,
        updatedAt: cached.updatedAt,
        loading: false,
        error: null,
      });
      return () => { live = false; };
    }
    setStateForKey(cacheKey, { error: null, loading: cached.data === null });

    setRefreshingKey(cacheKey);
    const promise = requestFeature(cacheKey, runRef.current, writeExtraRef.current, requestVersion);

    promise.then(
      ({ data: d, updatedAt: time }) => {
        if (!live) return;
        setRefreshingKey((prev) => clearRefreshingForKey(prev, cacheKey));
        setStateForKey(cacheKey, { data: d as T, updatedAt: time, loading: false, error: null });
      },
      (e) => {
        if (!live) return;
        setRefreshingKey((prev) => clearRefreshingForKey(prev, cacheKey));
        setStateForKey(cacheKey, { error: toMessage(e), loading: false });
      },
    );
    return () => { live = false; };
    // Deps are caller-controlled (session, selected ids) plus retry counter and cacheKey.
  }, [enabled, retryKey, cacheKey, requestVersion, ...deps]);

  return {
    data: visibleState.data,
    error: visibleState.error,
    loading: visibleState.loading,
    retry,
    refresh,
    refreshing,
    updatedAt: visibleState.updatedAt,
  };
}
