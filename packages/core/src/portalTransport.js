import { authEndpoints } from "./auth.js";
import { officialPortalPolicy } from "./officialPortal.js";
import { PortalError } from "./errors.js";
import { featurePostEndpoints, isMarksReportPath, marksReportEndpoints } from "./features.js";

// Separate APK policy: the isolated official view must never gain login access.
export const portalApiPolicy = Object.freeze({
  ...officialPortalPolicy,
  version: 1,
  post: [...new Set([...officialPortalPolicy.post, ...Object.values(featurePostEndpoints).flatMap(Object.values), ...authEndpoints.post])],
  get: [...new Set([...officialPortalPolicy.get, ...authEndpoints.get])],
});

/** One routing decision for client fetches and policy queries. The APK owns
 * networking; live core owns encryption, payloads, parsing and recovery. */
export function createPortalTransport({ baseUrl, native, fetchImpl = globalThis.fetch, mode = "auto", capabilityTimeoutMs = 5_000 }) {
  if (mode === "proxy") native = undefined;
  let capabilities;
  let sequence = 0;
  const prefix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const allows = (policy, method, path) =>
    (method === "POST" ? policy.post : method === "GET" ? policy.get : [])?.includes(path);
  const routeFor = async (method, path) => {
    // Installed APKs only support exact JSON paths. Reports use the proxy until
    // the native bridge explicitly supports parameterized binary report routes.
    if (method === "GET" && (isMarksReportPath(path) || Object.values(marksReportEndpoints).includes(path))) return "proxy";
    if (!native) return "proxy";
    // Discovery has not sent an API request. An unavailable/older bridge can
    // safely use the proxy for this page's lifetime, including later retries.
    if (!capabilities) {
      let timer;
      capabilities = Promise.race([
        Promise.resolve().then(() => native.capabilities()),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), capabilityTimeoutMs); }),
      ]).then((value) =>
        value?.version === portalApiPolicy.version &&
        Array.isArray(value.post) && value.post.every((path) => typeof path === "string") &&
        Array.isArray(value.get) && value.get.every((path) => typeof path === "string") ? value : null,
      ).catch(() => null).finally(() => clearTimeout(timer));
    }
    const installed = await capabilities;
    return installed && allows(installed, method, path) ? "native" : "proxy";
  };

  const fetch = !native ? fetchImpl : (url, init = {}) => {
    const path = typeof url === "string" && url.startsWith(baseUrl) ? url.slice(baseUrl.length) : "";
    const method = init.method ?? "GET";
    if (!allows(portalApiPolicy, method, path) && !(method === "GET" && isMarksReportPath(path))) {
      return Promise.reject(new PortalError("This portal request is not supported.", { code: "UNSUPPORTED_ENDPOINT" }));
    }
    const { signal } = init;
    const id = `${prefix}:${++sequence}`;
    return new Promise((resolve, reject) => {
      let sent = false;
      const finish = (callback, value) => {
        signal?.removeEventListener("abort", abort);
        callback(value);
      };
      const abort = () => {
        if (sent) void native.cancel({ id }).catch(() => {});
        finish(reject, signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(async () => {
        const route = await routeFor(method, path);
        if (signal?.aborted) throw signal.reason;
        // Future reviewed reads can deploy without forcing an APK update.
        // This choice happens before sending anything to JUET, never on failure.
        if (route === "proxy") {
          return fetchImpl(url, init);
        }
        sent = true;
        let reply;
        try {
          reply = await native.request({ id, method, path, body: init.body ?? "",
            headers: Object.fromEntries(new Headers(init.headers).entries()) });
        } catch (nativeErr) {
          if (signal?.aborted) throw signal.reason;
          const isAttendanceDetail = path === featurePostEndpoints.attendance.current ||
            path === featurePostEndpoints.attendance.previous;
          if (isAttendanceDetail && (nativeErr?.code === "NETWORK_ERROR" || /reach.*portal|portal.*busy|timeout/i.test(nativeErr?.message ?? ""))) {
            return fetchImpl(url, init);
          }
          throw nativeErr;
        }
        const bytes = Uint8Array.from(atob(reply.body), (char) => char.charCodeAt(0));
        return new Response(reply.status === 204 ? null : bytes, { status: reply.status, headers: reply.headers });
      }).then((response) => finish(resolve, response), (error) => finish(reject, error));
    });
  };
  return {
    fetch,
    async usesProxyFor(method, paths) {
      if (!paths.length) return true;
      const routes = await Promise.all(paths.map((path) => routeFor(method, path)));
      return routes.includes("proxy");
    },
  };
}
