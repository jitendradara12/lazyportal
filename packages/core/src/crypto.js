// Deep module: campusCrypto.
// Small interface, all AES/date quirks hidden here.
// Isomorphic: WebCrypto Subtle only — no node:crypto, no Buffer — so the
// same file bundles for browser (Vite) and runs in Node tests.

export const IV = "dcek9wb8frty1pnm";
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
const te = new TextEncoder();
const td = new TextDecoder();

/** Date-derived 16-char key. Pure + deterministic for tests. */
export function generateValue(date = new Date()) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(2);
  const dow = String(date.getDay());
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

async function importKey(now) {
  return subtle().importKey("raw", te.encode(generateValue(now)), "AES-CBC", false, [
    "encrypt",
    "decrypt",
  ]);
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
  const day = String(now.getDate()).padStart(2, "0");
  const mon = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(2);
  const me = `${day[0]}${mon[0]}${yy[0]}${now.getDay()}${day[1]}${mon[1]}${yy[1]}`;
  const plain = `${h}${me}${m}`;
  return { plain, encrypted: await encrypt(plain, { now }) };
}
