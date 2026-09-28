// Deep module: API client.
// Hides baseUrl, AES body encryption, Auth+LocalName headers, error mapping.
// post = AES-encrypted JSON body. postRaw = plain JSON body (some endpoints
// take unencrypted JSON: fee summary, attendance LOV, personal info, service
// requests, medical info, hostel, photo window). getPublic = auth-free GET.

import { encrypt, makeLocalName } from "./crypto.js";
import { toPortalError, SessionExpiredError } from "./errors.js";

/**
 * @param baseUrl e.g. https://studentportal.juet.ac.in/StudentPortalAPI
 * @param getToken () => string — empty string when logged out (matches official app)
 * @param fetchImpl injectable (default global fetch). Return results, no side effects elsewhere.
 * @param onUnauthorized optional hook (e.g. clear store) on 401.
 */
export function createClient({
  baseUrl,
  getToken = () => "",
  fetchImpl = globalThis.fetch,
  onUnauthorized,
  now = () => new Date(),
} = {}) {
  if (!baseUrl) throw new Error("baseUrl required");

  async function headers() {
    const { encrypted } = await makeLocalName({ now: now() });
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
      LocalName: encrypted,
    };
  }

  async function handle(res) {
    const text = await res.text();
    if (res.status === 401) {
      await onUnauthorized?.();
      throw new SessionExpiredError();
    }
    if (!text) {
      // Official backend returns 200+empty when LocalName missing/decrypt fails.
      throw toPortalError(null, res.status);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw toPortalError(null, res.status);
    }
    if (body?.status?.responseStatus === "Failure") throw toPortalError(body, res.status);
    if (!res.ok) throw toPortalError(body, res.status);
    return body;
  }

  return {
    async post(endpoint, payloadObj) {
      const h = await headers();
      const res = await fetchImpl(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: h,
        body: await encrypt(JSON.stringify(payloadObj), { now: now() }),
      });
      return handle(res);
    },
    /** Raw POST: same headers, plain JSON body (some endpoints take unencrypted JSON). */
    async postRaw(endpoint, payloadObj) {
      const h = await headers();
      const res = await fetchImpl(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: h,
        body: JSON.stringify(payloadObj),
      });
      return handle(res);
    },
    /** Public GET: no Auth/LocalName/Content-Type, so no CORS preflight.
     * Use for unauthenticated endpoints (captcha, logo, marquee). */
    async getPublic(endpoint) {
      const res = await fetchImpl(`${baseUrl}${endpoint}`, {
        headers: { Accept: "application/json" },
      });
      return handle(res);
    },
  };
}
