// Local credential storage, separate from the portal's wire-format encryption.
// A non-exportable per-origin key lives in IndexedDB; only ciphertext goes in
// localStorage. This hides stored passwords, not secrets from running page code.
const PASSWORD_KEY = "juet.portal.credentials.v1";
const LEGACY_KEY = "juet.portal.saved_pw";
const encoder = new TextEncoder();

export function browserCredentialKeys() {
  async function open() {
    return new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open("juet.portal.credentials", 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore("keys");
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Credential storage blocked"));
      };
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
    });
  }
  async function access(candidate) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        // One read/write transaction makes first-key creation safe across tabs.
        const tx = db.transaction("keys", candidate ? "readwrite" : "readonly");
        const keys = tx.objectStore("keys");
        const request = keys.get("password");
        let key;
        request.onsuccess = () => {
          key = request.result;
          if (!key && candidate) {
            key = candidate;
            keys.put(key, "password");
          }
        };
        tx.oncomplete = () => resolve(key ?? null);
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Credential storage unavailable"));
      });
    } finally {
      db.close();
    }
  }
  return { load: () => access(), getOrCreate: (candidate) => access(candidate) };
}

function identity({ username = "", usertype = "S" } = {}) {
  const role = usertype === "P" ? "P" : "S";
  const normalized = String(username).trim().toUpperCase();
  return { username: role === "P" && !normalized.startsWith("P") ? `P${normalized}` : normalized, usertype: role };
}
function matches(a, b) {
  return a.username === b.username && a.usertype === b.usertype;
}
function additionalData(record) {
  return encoder.encode(JSON.stringify([1, record.username, record.usertype]));
}
function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
function fromBase64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function createStore({
  storage = () => globalThis.localStorage,
  keys = browserCredentialKeys(),
  crypto = () => globalThis.crypto,
} = {}) {
  let generation = 0;
  let migration;
  let migratingIdentity = null;
  let volatile = null;

  function get(key) {
    try { return storage()?.getItem(key) ?? null; } catch { return null; }
  }
  function remove(key) {
    try { storage()?.removeItem(key); } catch { /* storage blocked */ }
  }
  function readRecord() {
    if (volatile) return volatile.record;
    try {
      const record = JSON.parse(get(PASSWORD_KEY));
      return record?.version === 1 && typeof record.username === "string" &&
        ["S", "P"].includes(record.usertype) && typeof record.iv === "string" &&
        typeof record.data === "string" ? record : null;
    } catch { return null; }
  }

  async function write(password, account, revision) {
    const api = crypto();
    const candidate = await api.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    let key = candidate;
    let persistent = true;
    try { key = await keys.getOrCreate(candidate); } catch { persistent = false; }
    const iv = api.getRandomValues(new Uint8Array(12));
    const record = { version: 1, ...identity(account) };
    const data = await api.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(record) }, key, encoder.encode(password));
    if (revision !== generation) return false;
    Object.assign(record, { iv: toBase64(iv), data: toBase64(data) });
    // Retain an encrypted tab-only copy if browser persistence is unavailable.
    volatile = { record, key };
    if (persistent) {
      try {
        const target = storage();
        if (target) {
          target.setItem(PASSWORD_KEY, JSON.stringify(record));
          volatile = null;
        }
      } catch { /* keep the encrypted volatile copy */ }
    }
    return true;
  }

  function migrate() {
    if (migration) return migration;
    const password = get(LEGACY_KEY);
    if (!password) return Promise.resolve();
    const account = identity({ username: get("juet.portal.last_user") ?? "", usertype: get("juet.portal.last_usertype") });
    const revision = generation;
    migratingIdentity = account;
    // Remove plaintext immediately, including if encryption/persistence fails.
    remove(LEGACY_KEY);
    migration = (async () => {
      if (!readRecord()) await write(password, account, revision);
    })().catch(() => {}).finally(() => {
      migratingIdentity = null;
      migration = null;
    });
    return migration;
  }

  return {
    migrate,
    has(account) {
      const expected = identity(account);
      const record = readRecord();
      return Boolean((record && matches(record, expected)) || (migratingIdentity && matches(migratingIdentity, expected)));
    },
    async load(account) {
      const revision = generation;
      await migrate();
      const record = readRecord();
      if (!record || !matches(record, identity(account))) return "";
      try {
        const key = volatile?.key ?? await keys.load();
        if (!key) return "";
        const bytes = await crypto().subtle.decrypt({ name: "AES-GCM", iv: fromBase64(record.iv), additionalData: additionalData(record) }, key, fromBase64(record.data));
        // Logout/account switching must invalidate a decryption already in flight.
        if (revision !== generation || JSON.stringify(record) !== JSON.stringify(readRecord())) return "";
        return new TextDecoder().decode(bytes);
      } catch { return ""; }
    },
    async save(password, account) {
      const revision = ++generation;
      volatile = null;
      remove(LEGACY_KEY);
      remove(PASSWORD_KEY);
      if (!password) return false;
      try { return await write(password, account, revision); } catch { return false; }
    },
    clear() {
      ++generation;
      volatile = null;
      migratingIdentity = null;
      remove(LEGACY_KEY);
      remove(PASSWORD_KEY);
    },
  };
}
