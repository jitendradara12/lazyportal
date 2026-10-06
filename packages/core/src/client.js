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

const DEFAULT_REFRESH_TIMEOUT_MS = 90_000;

/**
 * @param baseUrl e.g. https://studentportal.juet.ac.in/StudentPortalAPI
 * @param getToken () => string — read live each request so a refreshed token applies instantly.
 * @param fetchImpl injectable (default global fetch).
 * @param onRefresh (signal: AbortSignal) => Promise<boolean> — true = retry once.
 * @param onUnauthorized optional hook (e.g. clear store) when refresh fails or is absent.
 */
export function createClient({
  baseUrl,
  getToken = () => "",
  fetchImpl = globalThis.fetch,
  onRefresh,
  onUnauthorized,
  onSessionStatusChange,
  now = () => new Date(),
  refreshTimeoutMs = DEFAULT_REFRESH_TIMEOUT_MS,
} = {}) {
  if (!baseUrl) throw new Error("baseUrl required");
  let refreshing = null;
  let refreshGeneration = 0;
  let currentStatus = null;
  let unauthorizedNotified = false;
  let failedAuthorization = null;

  function setStatus(status) {
    if (currentStatus === status) return false;
    currentStatus = status;
    if (status !== "expired") unauthorizedNotified = false;
    try {
      onSessionStatusChange?.(status);
    } catch {
      // Status observers must not break the request that caused the transition.
    }
    return true;
  }

  function currentAuthorization() {
    return `Bearer ${getToken() ?? ""}`;
  }

  function hasToken(authorization) {
    return typeof authorization === "string" && authorization !== "Bearer ";
  }

  function authorizationFrom(init) {
    const headers = init?.headers;
    return headers?.Authorization ?? headers?.authorization;
  }

  async function safeFetch(url, init) {
    try {
      return await fetchImpl(url, init);
    } catch (err) {
      // Aborts are control flow for recovery/logout, not a portal outage.
      if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) throw err;
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
      Authorization: currentAuthorization(),
      LocalName: encrypted,
    };
  }

  async function fetchSent(sent) {
    const init = await sent.build();
    const request = { ...sent, usedAuthorization: authorizationFrom(init) };
    const response = await safeFetch(`${baseUrl}${sent.endpoint}`, init);
    return { response, sent: request };
  }

  /**
   * Start (or join) one cancellable recovery attempt shared by concurrent 401s.
   * A timeout aborts the attempt before it is considered final, so no silent
   * captcha/login work is left running behind an expired UI state.
   */
  function beginRefresh() {
    const controller = new AbortController();
    const generation = ++refreshGeneration;
    const cycle = {
      controller,
      generation,
      authorizationAtStart: currentAuthorization(),
      cancelled: false,
      timer: null,
      resolveCancelled: null,
      promise: null,
    };

    setStatus("recovering");

    const cancelled = new Promise((resolve) => {
      cycle.resolveCancelled = () => resolve({ kind: "cancelled" });
    });

    const attempt = Promise.resolve()
      .then(() => onRefresh(controller.signal))
      .then(
        (ok) => ({ kind: "result", ok: Boolean(ok) }),
        () => ({ kind: "result", ok: false }),
      );

    const timeoutMs = Number.isFinite(refreshTimeoutMs)
      ? Math.max(0, refreshTimeoutMs)
      : DEFAULT_REFRESH_TIMEOUT_MS;
    const timeout = new Promise((resolve) => {
      cycle.timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: "timeout" });
      }, timeoutMs);
      if (cycle.timer?.unref) cycle.timer.unref();
    });

    cycle.promise = Promise.race([attempt, timeout, cancelled])
      .then((outcome) => {
        if (
          cycle.cancelled ||
          generation !== refreshGeneration ||
          outcome.kind === "cancelled"
        ) {
          return { kind: "cancelled", generation };
        }

        const tokenChanged = currentAuthorization() !== cycle.authorizationAtStart;
        if (outcome.kind === "result" && outcome.ok && !controller.signal.aborted) {
          failedAuthorization = null;
          setStatus("authenticated");
          return { kind: "ok", generation };
        }

        // Another tab or a user-initiated login may have installed a new token
        // while the old request was waiting. Retry it instead of showing a
        // misleading expired state or starting a second background login.
        if (tokenChanged) return { kind: "token-changed", generation };

        // This token has now had its full silent recovery attempt. Keep later
        // background 401s from restarting the same work and making the expired
        // UI flicker back to "recovering". An explicit session change clears it.
        failedAuthorization = cycle.authorizationAtStart;
        setStatus("expired");
        return { kind: "failed", generation };
      })
      .finally(() => {
        if (cycle.timer) clearTimeout(cycle.timer);
        if (refreshing === cycle) refreshing = null;
      });

    refreshing = cycle;
    return cycle;
  }

  /** Cancel recovery when the app explicitly saves a new session or logs out. */
  function cancelRefresh() {
    refreshGeneration++;
    const cycle = refreshing;
    if (cycle) {
      cycle.cancelled = true;
      if (cycle.timer) clearTimeout(cycle.timer);
      cycle.controller.abort();
      cycle.resolveCancelled?.();
      refreshing = null;
    }
    // The app owns the explicit next status. Reset the client's transition
    // memory so the next request still emits its recovering/expired changes.
    currentStatus = null;
    unauthorizedNotified = false;
    failedAuthorization = null;
  }

  async function refreshedRetry(sent) {
    if (!onRefresh) return { kind: "failed" };

    const liveAuthorization = currentAuthorization();
    if (failedAuthorization !== null && failedAuthorization !== liveAuthorization) {
      failedAuthorization = null;
    }
    if (failedAuthorization === liveAuthorization) return { kind: "failed" };

    // A concurrent request may already have completed recovery before this
    // response arrived. Reuse its token instead of launching a duplicate login.
    if (
      sent.usedAuthorization !== undefined &&
      sent.usedAuthorization !== liveAuthorization
    ) {
      return { kind: "token-changed" };
    }

    const cycle = refreshing ?? beginRefresh();
    const outcome = await cycle.promise;
    if (outcome.generation !== refreshGeneration || outcome.kind === "cancelled") {
      return { kind: "cancelled", generation: cycle.generation };
    }
    if (outcome.kind !== "ok") return outcome;

    const retry = await fetchSent(sent);
    return { kind: "response", ...retry, generation: cycle.generation };
  }

  async function expireSession(opts) {
    if (opts.silent) return;
    setStatus("expired");
    if (unauthorizedNotified) return;
    unauthorizedNotified = true;
    try {
      await onUnauthorized?.();
    } catch {
      // Expiry reporting must not replace the useful SessionExpiredError.
    }
  }

  async function retryWithCurrentToken(sent, opts) {
    if (!hasToken(currentAuthorization())) throw new SessionExpiredError();
    const retry = await fetchSent(sent);
    const result = await handle(retry.response, retry.sent, {
      ...opts,
      skipRefresh: true,
      tokenRetry: true,
    });
    failedAuthorization = null;
    setStatus("authenticated");
    return result;
  }

  async function handle(res, sent, opts = {}) {
    if (res.status === 401) {
      // A delayed 401 from an old token should not launch another refresh after
      // a sibling request has already renewed the session.
      if (
        !opts.skipRefresh &&
        !opts.tokenRetry &&
        sent.usedAuthorization !== undefined &&
        sent.usedAuthorization !== currentAuthorization()
      ) {
        return retryWithCurrentToken(sent, opts);
      }

      if (!opts.skipRefresh) {
        const retry = await refreshedRetry(sent);
        if (retry.kind === "response") {
          // A logout/session switch may have happened while the retry was in
          // flight. Do not let its stale 401 overwrite the newer state.
          if (retry.generation !== refreshGeneration) {
            if (
              hasToken(currentAuthorization()) &&
              currentAuthorization() !== retry.sent.usedAuthorization
            ) {
              return retryWithCurrentToken(sent, opts);
            }
            throw new SessionExpiredError();
          }
          return handle(retry.response, retry.sent, { ...opts, skipRefresh: true });
        }
        if (retry.kind === "token-changed") {
          return retryWithCurrentToken(sent, opts);
        }
        if (retry.kind === "cancelled") {
          const authorization = currentAuthorization();
          if (hasToken(authorization) && authorization !== sent.usedAuthorization) {
            return retryWithCurrentToken(sent, opts);
          }
          // Explicit logout/session replacement owns the status transition.
          throw new SessionExpiredError();
        }
      }

      await expireSession(opts);
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
    if (body?.status?.responseStatus === "Failure") {
      const error = toPortalError(body, res.status);
      // CampusLynx sometimes reports an expired token as HTTP 200 + Failure.
      // Route it through the same recovery state machine as an HTTP 401.
      if (error.code === "SESSION_EXPIRED") {
        return handle({ status: 401 }, sent, opts);
      }
      throw error;
    }
    if (!res.ok) throw toPortalError(body, res.status);
    return body;
  }

  return {
    async post(endpoint, payloadObj, opts = {}) {
      const build = async () => ({
        method: "POST",
        headers: await headers(),
        body: await encrypt(JSON.stringify(payloadObj), { now: now() }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const { response, sent } = await fetchSent({ endpoint, build });
      return handle(response, sent, opts);
    },
    /** Raw POST: same headers, plain JSON body (some endpoints take unencrypted JSON). */
    async postRaw(endpoint, payloadObj, opts = {}) {
      const build = async () => ({
        method: "POST",
        headers: await headers(),
        body: JSON.stringify(payloadObj),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const { response, sent } = await fetchSent({ endpoint, build });
      return handle(response, sent, opts);
    },
    /** Public GET: no Auth/LocalName/Content-Type, so no CORS preflight.
     * Use for unauthenticated endpoints (captcha, logo, marquee).
     * Silent by default: a 401 here is not a session expiry (e.g. captcha
     * fetch failing inside silent re-login must not fire global logout). */
    async getPublic(endpoint, opts = {}) {
      const build = async () => ({
        headers: { Accept: "application/json" },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const { response, sent } = await fetchSent({ endpoint, build });
      return handle(response, sent, { skipRefresh: true, silent: true, ...opts });
    },
    /** Abort a background recovery after an explicit session save/logout. */
    cancelRefresh,
  };
}
