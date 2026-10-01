// Deep module: API client.
// Hides baseUrl, AES body encryption, Auth+LocalName headers, error mapping,
// and transparent session refresh: a 401 triggers one shared refresh + retry,
// so callers only see SessionExpiredError when refresh truly fails.
// post = AES-encrypted JSON body. postRaw = plain JSON body (some endpoints
// take unencrypted JSON: fee summary, attendance LOV, personal info, service
// requests, medical info, hostel, photo window, token refresh).
// getPublic = auth-free GET.

import { encrypt, makeLocalName } from "./crypto.js";
import { toPortalError, SessionExpiredError, PortalError } from "./errors.js";

/**
 * @param baseUrl e.g. https://studentportal.juet.ac.in/StudentPortalAPI
 * @param getToken () => string — read live each request so a refreshed token applies instantly.
 * @param fetchImpl injectable (default global fetch).
 * @param onRefresh () => Promise<boolean> — refresh the session (save any new token); true = retry once.
 * @param onUnauthorized optional hook (e.g. clear store) when refresh fails or is absent.
 */
export function createClient({
  baseUrl,
  getToken = () => "",
  fetchImpl = globalThis.fetch,
  onRefresh,
  onUnauthorized,
  now = () => new Date(),
} = {}) {
  if (!baseUrl) throw new Error("baseUrl required");
  let refreshing = null;

  async function safeFetch(url, init) {
    try {
      return await fetchImpl(url, init);
    } catch (err) {
      if (err instanceof PortalError) throw err;
      throw new PortalError(
        typeof navigator !== "undefined" && navigator.onLine === false
          ? "You are offline."
          : "JUET's portal is down (not us).",
        { code: "NETWORK_ERROR" }
      );
    }
  }

  async function headers() {
    const { encrypted } = await makeLocalName({ now: now() });
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
      LocalName: encrypted,
    };
  }

  /** Single shared refresh for concurrent 401s; returns a retry response or null. */
  async function refreshedRetry(sent) {
    if (!onRefresh) return null;
    if (!refreshing) {
      refreshing = onRefresh().finally(() => {
        refreshing = null;
      });
    }
    if (!(await refreshing)) return null;
    // Rebuild headers: the token may have rotated during refresh.
    const retry = await safeFetch(`${baseUrl}${sent.endpoint}`, await sent.build());
    return retry.status === 401 ? null : retry;
  }

  async function handle(res, sent, opts = {}) {
    if (res.status === 401) {
      if (!opts.skipRefresh) {
        const retry = await refreshedRetry(sent);
        // The retry gets no second refresh: another 401 here is final.
        if (retry) return handle(retry, sent, { ...opts, skipRefresh: true });
      }
      if (!opts.silent) await onUnauthorized?.();
      throw new SessionExpiredError();
    }
    if (res.status === 204) {
      return { status: { responseStatus: "Success" }, response: null };
    }
    const text = await res.text();
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
    async post(endpoint, payloadObj, opts = {}) {
      const build = async () => ({
        method: "POST",
        headers: await headers(),
        body: await encrypt(JSON.stringify(payloadObj), { now: now() }),
      });
      const sent = { endpoint, build };
      const res = await safeFetch(`${baseUrl}${endpoint}`, await build());
      return handle(res, sent, opts);
    },
    /** Raw POST: same headers, plain JSON body (some endpoints take unencrypted JSON). */
    async postRaw(endpoint, payloadObj, opts = {}) {
      const build = async () => ({
        method: "POST",
        headers: await headers(),
        body: JSON.stringify(payloadObj),
      });
      const sent = { endpoint, build };
      const res = await safeFetch(`${baseUrl}${endpoint}`, await build());
      return handle(res, sent, opts);
    },
    /** Public GET: no Auth/LocalName/Content-Type, so no CORS preflight.
     * Use for unauthenticated endpoints (captcha, logo, marquee). */
    async getPublic(endpoint) {
      const sent = { endpoint, init: { headers: { Accept: "application/json" } } };
      const res = await safeFetch(`${baseUrl}${endpoint}`, sent.init);
      // Public endpoints never refresh: a 401 here means logged out.
      return handle(res, sent, { skipRefresh: true });
    },
  };
}
