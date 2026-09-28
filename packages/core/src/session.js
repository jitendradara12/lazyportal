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

/** Remember that the last logout was a server-side expiry (LoginPage shows a notice). */
export function markSessionExpired() {
  try {
    safeStorage()?.setItem(PREFIX + EXPIRED_KEY, "1");
  } catch {
    /* storage blocked */
  }
}

/** Read + clear the expiry flag. */
export function consumeSessionExpired() {
  return consumeKey(EXPIRED_KEY);
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
  return {
    get: (k) => {
      const s = safeStorage();
      try {
        return s ? s.getItem(PREFIX + k) : fallback.get(k);
      } catch {
        return fallback.get(k);
      }
    },
    set: (k, v) => {
      const s = safeStorage();
      try {
        if (s) s.setItem(PREFIX + k, v);
        else fallback.set(k, v);
      } catch {
        fallback.set(k, v);
      }
    },
    remove: (k) => {
      const s = safeStorage();
      try {
        if (s) s.removeItem(PREFIX + k);
        else fallback.remove(k);
      } catch {
        fallback.remove(k);
      }
    },
  };
}

const SESSION_KEY = "session.v1";

/** Store owns serialization. Interface: load/save/clear/loadValid. */
export function createStore(adapter = memoryAdapter()) {
  return {
    load() {
      const raw = adapter.get(SESSION_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    save(session) {
      adapter.set(SESSION_KEY, JSON.stringify(session));
    },
    clear() {
      adapter.remove(SESSION_KEY);
    },
    loadValid(opts) {
      const s = this.load();
      if (!s?.token) return null;
      return isExpired(s.token, opts) ? null : s;
    },
  };
}
