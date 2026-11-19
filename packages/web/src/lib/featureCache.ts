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
    const next = () => {
      if (!isCacheGenerationCurrent(generation)) throw new DOMException("Request cancelled.", "AbortError");
      return requestFeature(cacheKey, run, writeExtra, requestVersion);
    };
    return existing.promise.then(next, next);
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
