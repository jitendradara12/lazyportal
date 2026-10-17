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
  scope?: "dashboard" | "attendance" | "subject" | "all";
  /** Optional extra metadata to persist in the cache entry (e.g. checksum). */
  writeExtra?: Record<string, unknown> | ((data: T) => Record<string, unknown>);
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

// ponytail: in-flight request deduplication across concurrent hooks sharing a cacheKey
const inFlight = new Map<string, Promise<{ data: unknown; updatedAt: number }>>();
// In-memory read-through cache to eliminate redundant localStorage + JSON.parse on mobile renders
const memoryCache = new Map<string, { raw: string; parsed: { data: unknown; updatedAt: number | null; checksum?: string | null } & Record<string, unknown> }>();
let storageListenerBound = false;
let cacheGeneration = 0;

function ensureStorageListener(): void {
  if (storageListenerBound || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  storageListenerBound = true;
  window.addEventListener("storage", (e: Event) => {
    const key = (e as { key?: string | null })?.key;
    if (!key) {
      memoryCache.clear();
    } else if (key.startsWith("juet.cache.")) {
      memoryCache.delete(key.slice("juet.cache.".length));
    }
  });
}

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
  memoryCache.clear();
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

export function getCached<T>(key?: string): { data: T | null; updatedAt: number | null; checksum?: string | null } & Record<string, unknown> {
  if (!key) return { data: null, updatedAt: null };
  ensureStorageListener();
  try {
    const raw = localStorage.getItem(`juet.cache.${key}`);
    if (!raw) {
      memoryCache.delete(key);
      return { data: null, updatedAt: null };
    }
    const hit = memoryCache.get(key);
    if (hit && hit.raw === raw) {
      return { ...hit.parsed } as { data: T | null; updatedAt: number | null; checksum?: string | null } & Record<string, unknown>;
    }
    const parsed = JSON.parse(raw);
    let result: { data: T | null; updatedAt: number | null; checksum?: string | null } & Record<string, unknown>;
    if (parsed && typeof parsed === "object" && "updatedAt" in parsed && "data" in parsed) {
      const { data, updatedAt, ...rest } = parsed as { data: T; updatedAt: number } & Record<string, unknown>;
      result = { ...rest, data: data as T, updatedAt: updatedAt as number };
    } else {
      result = { data: parsed as T, updatedAt: null };
    }
    memoryCache.set(key, { raw, parsed: result });
    return { ...result };
  } catch {
    return { data: null, updatedAt: null };
  }
}

export function resolveTargetScope(
  scope?: "dashboard" | "attendance" | "subject" | "all",
  cacheKey?: string,
): "dashboard" | "attendance" | "subject" | "all" {
  return scope ?? (
    cacheKey?.startsWith("att.subject")
      ? "subject"
      : cacheKey?.startsWith("att.")
      ? "attendance"
      : "dashboard"
  );
}

export function setCached<T>(key: string | undefined, data: T, extra?: Record<string, unknown>): number {
  const now = Date.now();
  if (!key || data == null) return now;
  ensureStorageListener();
  try {
    const entry: Record<string, unknown> = {
      data,
      updatedAt: now,
      ...(extra ?? {}),
    };
    const raw = JSON.stringify(entry);
    localStorage.setItem(`juet.cache.${key}`, raw);
    memoryCache.set(key, {
      raw,
      parsed: { ...(extra ?? {}), data, updatedAt: now },
    });
    window.dispatchEvent(new CustomEvent("juet:cache-updated", { detail: { key } }));
  } catch {}
  return now;
}

export const STALE_MS = 2 * 60 * 60 * 1000;

/** Share hook and imperative reads, including their single cache write. */
export function requestFeature<T>(
  cacheKey: string | undefined,
  run: () => Promise<T>,
  writeExtra?: Record<string, unknown> | ((data: T) => Record<string, unknown>),
): Promise<{ data: T; updatedAt: number }> {
  const existing = cacheKey ? inFlight.get(cacheKey) : undefined;
  if (existing) return existing as Promise<{ data: T; updatedAt: number }>;
  const generation = getCacheGeneration();
  const request = Promise.resolve().then(run).then((data) => {
    let updatedAt = Date.now();
    if (isCacheGenerationCurrent(generation)) {
      updatedAt = setCached(cacheKey, data, typeof writeExtra === "function" ? writeExtra(data) : writeExtra);
    }
    return { data, updatedAt };
  }).finally(() => {
    if (cacheKey && inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
  });
  if (cacheKey) inFlight.set(cacheKey, request);
  return request;
}

export function useFeature<T>({
  run,
  deps = [],
  enabled = true,
  cacheKey,
  staleTimeMs = STALE_MS,
  isFresh,
  scope,
  writeExtra,
}: UseFeatureOptions<T>) {
  const targetScope = resolveTargetScope(scope, cacheKey);
  const [state, setState] = useState<FeatureState<T>>(() => createFeatureState<T>(cacheKey, enabled));
  // Resolve against the requested key during render, so an institute/semester
  // switch cannot briefly show the previous key's data before effects run.
  const visibleState = resolveFeatureState(state, cacheKey, enabled);
  const [retryKey, setRetryKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(false);
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
    setRefreshing(true);
    setStateForKey(cacheKey, { error: null });
    try {
      const result = await requestFeature(cacheKey, runRef.current, writeExtraRef.current);
      if (mounted.current) setStateForKey(cacheKey, { ...result, loading: false, error: null });
      return result.data;
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [cacheKey, setStateForKey]);

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

  // Re-fetch live data when a scoped or global refresh is requested
  useEffect(() => {
    const handleRefresh = () => {
      forceRef.current = true;
      setStateForKey(cacheKey, { error: null });
      setRetryKey((k) => k + 1);
    };

    const events = [
      "juet:refresh-all",
      ...(targetScope === "attendance" || targetScope === "all" ? ["juet:refresh-attendance"] : []),
      ...(targetScope === "dashboard" || targetScope === "all" ? ["juet:refresh-dashboard"] : []),
    ];
    for (const name of events) window.addEventListener(name, handleRefresh);
    return () => {
      for (const name of events) window.removeEventListener(name, handleRefresh);
    };
  }, [cacheKey, setStateForKey, targetScope]);

  useEffect(() => {
    if (!enabled) {
      setRefreshing(false);
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
      setRefreshing(false);
      setStateForKey(cacheKey, {
        data: cached.data,
        updatedAt: cached.updatedAt,
        loading: false,
        error: null,
      });
      return () => void (live = false);
    }
    if (cached.data === null && !visibleState.error) {
      // Keep this key's loading state visible while its request is in flight.
      setStateForKey(cacheKey, { loading: true });
    }

    setRefreshing(true);
    const promise = requestFeature(cacheKey, runRef.current, writeExtraRef.current);

    promise.then(
      ({ data: d, updatedAt: time }) => {
        if (!live) return;
        setRefreshing(false);
        setStateForKey(cacheKey, { data: d as T, updatedAt: time, loading: false, error: null });
      },
      (e) => {
        if (!live) return;
        setRefreshing(false);
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
    refresh,
    refreshing,
    updatedAt: visibleState.updatedAt,
  };
}
