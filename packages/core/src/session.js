// Deep module: session.
// Hides JWT parsing, key namespacing, expiry policy.
// Isomorphic: no Buffer, no import-time localStorage access.

const PREFIX = "juet.portal.";

function b64urlToJson(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function decodeExp(token) {
  try {
    const [, payload] = String(token).split(".");
    if (!payload) return null;
    const json = b64urlToJson(payload);
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

export function isExpired(token, { nowSec = Date.now() / 1000, skewSec = 60 } = {}) {
  const exp = decodeExp(token);
  if (exp === null) return false; // opaque token: trust server 401
  return exp <= nowSec + skewSec;
}

export function memoryAdapter(map = new Map()) {
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked cookies / sandboxed iframe
  }
}

const EXPIRED_KEY = "expired";
let memoryExpired = false;

/** Remember that the last logout was a server-side expiry (LoginPage shows a notice). */
export function markSessionExpired() {
  try {
    const s = safeStorage();
    if (s) {
      s.setItem(PREFIX + EXPIRED_KEY, "1");
      return;
    }
  } catch {
    /* storage blocked */
  }
  memoryExpired = true;
}

/** Read + clear the expiry flag. */
export function consumeSessionExpired() {
  const inMemory = memoryExpired;
  memoryExpired = false;
  const inStorage = consumeKey(EXPIRED_KEY);
  return inMemory || inStorage;
}

/** Clear any pending expiry flag (on explicit logout or fresh login/reconnect). */
export function clearSessionExpired() {
  memoryExpired = false;
  try {
    safeStorage()?.removeItem(PREFIX + EXPIRED_KEY);
  } catch {
    /* storage blocked */
  }
}

function consumeKey(key) {
  try {
    const s = safeStorage();
    if (s?.getItem(PREFIX + key) === "1") {
      s.removeItem(PREFIX + key);
      return true;
    }
  } catch {
    /* storage blocked */
  }
  return false;
}

/**
 * Browser adapter. Never clears unrelated keys (unlike official app).
 * Storage is resolved lazily per call with in-memory fallback, so module
 * import never throws during React mount.
 */
export function browserLocalAdapter(fallback = memoryAdapter()) {
  const volatile = new Set();
  return {
    get: (k) => {
      if (volatile.has(k)) return fallback.get(k);
      const s = safeStorage();
      try {
        return s ? s.getItem(PREFIX + k) : fallback.get(k);
      } catch {
        return fallback.get(k);
      }
    },
    set: (k, v) => {
      fallback.set(k, v);
      volatile.add(k);
      const s = safeStorage();
      try {
        if (s) {
          s.setItem(PREFIX + k, v);
          volatile.delete(k);
        }
      } catch {}
    },
    remove: (k) => {
      fallback.remove(k);
      volatile.add(k);
      const s = safeStorage();
      try {
        if (s) {
          s.removeItem(PREFIX + k);
          volatile.delete(k);
        }
      } catch {}
    },
  };
}

const SESSION_KEY = "session.v1";

/** Store owns serialization. Interface: load/save/clear/loadValid. */
export function createStore(adapter = memoryAdapter()) {
  let cachedRaw = null;
  let cachedSession = null;
  let persistFailed = false;

  return {
    load() {
      if (persistFailed && cachedSession !== null) {
        return { ...cachedSession };
      }
      let raw = null;
      try {
        raw = adapter.get(SESSION_KEY);
      } catch {
        return cachedSession ? { ...cachedSession } : null;
      }
      if (!raw) {
        cachedRaw = null;
        cachedSession = null;
        return null;
      }
      if (raw === cachedRaw && cachedSession !== null) {
        return { ...cachedSession };
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          cachedRaw = raw;
          cachedSession = parsed;
          return { ...parsed };
        }
      } catch {}
      cachedRaw = null;
      cachedSession = null;
      try {
        adapter.remove(SESSION_KEY);
      } catch {}
      return null;
    },
    save(session) {
      const raw = JSON.stringify(session);
      cachedRaw = raw;
      cachedSession = JSON.parse(raw);
      persistFailed = false;
      try {
        adapter.set(SESSION_KEY, raw);
      } catch {
        persistFailed = true;
      }
    },
    clear() {
      cachedRaw = null;
      cachedSession = null;
      persistFailed = false;
      try {
        adapter.remove(SESSION_KEY);
      } catch {}
    },
    loadValid(opts) {
      const s = this.load();
      if (!s?.token) return null;
      return isExpired(s.token, opts) ? null : s;
    },
  };
}
