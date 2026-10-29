import { useCallback, useEffect, useRef, useState } from "react";
import type { PageRefreshRequest, RefreshPage } from "./usePageRefresh";

type FeatureScope = RefreshPage | "attendance" | "subject";

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
  scope?: FeatureScope;
  /** Keep cached discovery data available without refreshing an inactive semester. */
  manualRefreshEnabled?: boolean | (() => boolean);
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

// ponytail: in-flight request deduplication across concurrent hooks sharing a cacheKey
const inFlight = new Map<string, { promise: Promise<{ data: unknown; updatedAt: number }>; version?: string; controller: AbortController }>();
// In-memory read-through cache to eliminate redundant localStorage + JSON.parse on mobile renders
const memoryCache = new Map<string, { raw: string; volatile?: boolean; parsed: { data: unknown; updatedAt: number | null; checksum?: string | null } & Record<string, unknown> }>();
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
  for (const request of inFlight.values()) request.controller.abort();
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
  const hit = memoryCache.get(key);
  // A successful read still belongs in this tab when persistence is blocked or
  // full. Storage events and logout invalidate these entries as usual.
  if (hit?.volatile) return { ...hit.parsed } as ReturnType<typeof getCached<T>>;
  try {
    const raw = localStorage.getItem(`juet.cache.${key}`);
    if (!raw) {
      memoryCache.delete(key);
      return { data: null, updatedAt: null };
    }
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
    return hit ? { ...hit.parsed } as ReturnType<typeof getCached<T>> : { data: null, updatedAt: null };
  }
}

export function resolveTargetScope(
  scope?: FeatureScope,
  cacheKey?: string,
): FeatureScope {
  return scope ?? (
    cacheKey?.startsWith("att.subject")
      ? "subject"
      : cacheKey?.startsWith("att.")
      ? "attendance"
      : cacheKey?.startsWith("marks.") ? "marks"
      : cacheKey?.startsWith("exams.") ? "exams"
      : "more"
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
    let volatile = false;
    try { localStorage.setItem(`juet.cache.${key}`, raw); } catch { volatile = true; }
    memoryCache.set(key, {
      raw, volatile,
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
  run: (signal: AbortSignal) => Promise<T>,
  writeExtra?: Record<string, unknown> | ((data: T) => Record<string, unknown>),
  requestVersion?: string,
): Promise<{ data: T; updatedAt: number }> {
  const generation = getCacheGeneration();
  const existing = cacheKey ? inFlight.get(cacheKey) : undefined;
  if (existing) {
    if (existing.version === requestVersion) return existing.promise as Promise<{ data: T; updatedAt: number }>;
    return existing.promise.then(() => {
      if (!isCacheGenerationCurrent(generation)) throw new DOMException("Request cancelled.", "AbortError");
      return requestFeature(cacheKey, run, writeExtra, requestVersion);
    });
  }
  const controller = new AbortController();
  const request = Promise.resolve().then(() => {
    if (!isCacheGenerationCurrent(generation)) throw new DOMException("Request cancelled.", "AbortError");
    return run(controller.signal);
  }).then((data) => {
    let updatedAt = Date.now();
    if (isCacheGenerationCurrent(generation)) {
      updatedAt = setCached(cacheKey, data, typeof writeExtra === "function" ? writeExtra(data) : writeExtra);
    }
    return { data, updatedAt };
  }).finally(() => {
    if (cacheKey && inFlight.get(cacheKey)?.promise === request) inFlight.delete(cacheKey);
  });
  if (cacheKey) inFlight.set(cacheKey, { promise: request, version: requestVersion, controller });
  return request;
}

export function useFeature<T>({
  run,
  deps = [],
  enabled = true,
  cacheKey,
  requestVersion,
  staleTimeMs = STALE_MS,
  isFresh,
  scope,
  manualRefreshEnabled = enabled,
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
    setRefreshing(true);
    setStateForKey(cacheKey, { error: null });
    try {
      const result = await requestFeature(cacheKey, runRef.current, writeExtraRef.current, requestVersion);
      if (current()) setStateForKey(cacheKey, { ...result, loading: false, error: null });
      return result.data;
    } catch (error) {
      if (current()) setStateForKey(cacheKey, { error: toMessage(error), loading: false });
      throw error;
    } finally {
      if (current()) setRefreshing(false);
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

  // Attendance's day rollover remains independent of manual page refreshes.
  useEffect(() => {
    const handleRefresh = (event: Event) => {
      if (!enabled) return;
      if (targetScope !== "attendance") {
        if (!(typeof manualRefreshEnabled === "function" ? manualRefreshEnabled() : manualRefreshEnabled)) return;
        const detail = (event as CustomEvent<PageRefreshRequest>).detail;
        if (detail?.requests) detail.requests.push(refresh());
        return;
      }
      forceRef.current = (event as CustomEvent<{ force?: boolean }>).detail?.force === true;
      setStateForKey(cacheKey, { error: null });
      setRetryKey((k) => k + 1);
    };

    if (targetScope === "subject") return;
    const name = `juet:refresh-${targetScope}`;
    window.addEventListener(name, handleRefresh);
    return () => window.removeEventListener(name, handleRefresh);
  }, [cacheKey, setStateForKey, targetScope, enabled, manualRefreshEnabled, refresh]);

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
    const isFreshEntry = isFresh
      ? isFresh(cached.updatedAt)
      : Boolean(cached.updatedAt && Date.now() - cached.updatedAt < staleTimeMs);
    if (!isForce && cached.data && cached.updatedAt && isFreshEntry) {
      setRefreshing(false);
      setStateForKey(cacheKey, {
        data: cached.data,
        updatedAt: cached.updatedAt,
        loading: false,
        error: null,
      });
      return () => void (live = false);
    }
    setStateForKey(cacheKey, { error: null, loading: cached.data === null });

    setRefreshing(true);
    const promise = requestFeature(cacheKey, runRef.current, writeExtraRef.current, requestVersion);

    promise.then(
      ({ data: d, updatedAt: time }) => {
        if (!live) return;
        setRefreshing(false);
        setStateForKey(cacheKey, { data: d as T, updatedAt: time, loading: false, error: null });
      },
      (e) => {
        if (!live) return;
        setRefreshing(false);
        setStateForKey(cacheKey, { error: toMessage(e), loading: false });
      },
    );
    return () => void (live = false);
    // Deps are caller-controlled (session, selected ids) plus retry counter and cacheKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
