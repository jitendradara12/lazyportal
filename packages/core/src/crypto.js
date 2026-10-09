// Deep module: campusCrypto.
// Small interface, all AES/date quirks hidden here.
// Isomorphic: WebCrypto Subtle only — no node:crypto, no Buffer — so the
// same file bundles for browser (Vite) and runs in Node tests.

export const IV = "dcek9wb8frty1pnm";
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
const te = new TextEncoder();
const td = new TextDecoder();

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Module-level cached formatter: constructing Intl.DateTimeFormat is expensive
// and constructing it repeatedly on every crypto operation / request burns CPU.
const istFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

/**
 * Return date components in Indian Standard Time (IST, UTC+05:30),
 * which is the timezone evaluated by the JUET portal server.
 */
export function getIstParts(date = new Date()) {
  const parts = istFormatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const dow = String(DAYS.indexOf(map.weekday));
  const day = map.day;
  const month = map.month;
  const yy = map.year.slice(2);
  return { day, month, yy, dow };
}

/** Date-derived 16-char key in IST. Pure + deterministic for tests. */
export function generateValue(date = new Date()) {
  const { day, month, yy, dow } = getIstParts(date);
  return `qa8y${day[0]}${month[0]}${yy[0]}${dow}${day[1]}${month[1]}${yy[1]}ty1pn`;
}

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto Subtle unavailable (needs https or localhost)");
  return s;
}

function bytesToB64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Map of day value -> Promise<CryptoKey>. Avoids thrashing on mixed-day
// concurrency and coalesces parallel cold-start imports.
const keyCache = new Map();

export function _resetCryptoCacheForTesting() {
  keyCache.clear();
}

export function _getCryptoCacheSizeForTesting() {
  return keyCache.size;
}

export async function importKey(now) {
  const val = generateValue(now);
  let promise = keyCache.get(val);
  if (promise) {
    keyCache.delete(val);
    keyCache.set(val, promise);
    return promise;
  }

  if (keyCache.size >= 4) keyCache.delete(keyCache.keys().next().value);

  promise = subtle().importKey("raw", te.encode(val), "AES-CBC", false, [
    "encrypt",
    "decrypt",
  ]).catch((err) => {
    keyCache.delete(val);
    throw err;
  });

  keyCache.set(val, promise);
  return promise;
}

/** CryptoJS AES.encrypt(plain, Utf8(key), {iv, CBC, Pkcs7}) equivalent. Returns base64. */
export async function encrypt(plainText, { now = new Date() } = {}) {
  const key = await importKey(now);
  const ct = await subtle().encrypt({ name: "AES-CBC", iv: te.encode(IV) }, key, te.encode(plainText));
  return bytesToB64(new Uint8Array(ct));
}

/** Inverse of encrypt. Test-only seam; portal never sends encrypted responses. */
export async function decrypt(cipherB64, { now = new Date() } = {}) {
  const key = await importKey(now);
  const pt = await subtle().decrypt(
    { name: "AES-CBC", iv: te.encode(IV) },
    key,
    b64ToBytes(cipherB64)
  );
  return td.decode(pt);
}

/**
 * Per-request `LocalName` header value.
 * Plain = rand4 + date7 + rand5 (16 chars), encrypted with same key.
 * `random` injectable for deterministic tests; defaults to Math.random.
 */
export async function makeLocalName({ now = new Date(), random = Math.random } = {}) {
  const pick = () => ALPHABET[Math.floor(random() * ALPHABET.length)];
  const h = Array.from({ length: 4 }, pick).join("");
  const m = Array.from({ length: 5 }, pick).join("");
  const { day, month, yy, dow } = getIstParts(now);
  const me = `${day[0]}${month[0]}${yy[0]}${dow}${day[1]}${month[1]}${yy[1]}`;
  const plain = `${h}${me}${m}`;
  return { plain, encrypted: await encrypt(plain, { now }) };
}
