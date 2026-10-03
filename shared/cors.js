// CORS for the Capacitor WebView.
//
// The web build calls this proxy same-origin (`/api` on the deployment), so it
// never needs CORS headers. The native shell does: it serves the bundled app
// from https://localhost (capacitor.config.json → server.hostname/androidScheme
// = the origin below), which makes every /api call cross-origin. Chromium
// blocks cross-origin responses without `Access-Control-Allow-Origin`, so
// without this the app cannot talk to the portal at all.
//
// The origin is echoed rather than "*" so browsers block cross-origin reads
// from any other site. (Non-browser callers like curl never enforce CORS, so
// this is browser hygiene, not an access-control boundary.)

/** WebView origin of the shipped shell. Keep in sync with capacitor.config.json. */
export const WEBVIEW_ORIGIN = "https://lazyportal-tan.vercel.app";

/** Methods supported by the proxy; keep its request guard in sync. */
export const ALLOWED_METHODS = Object.freeze(["GET", "HEAD", "POST", "OPTIONS"]);

/**
 * Headers to add to any proxy response.
 *
 * `Vary: Origin` is unconditional: the body never depends on the origin, but
 * these headers do, so a cache must not hand a browser response to the WebView
 * (or the reverse).
 */
export function corsHeaders(origin) {
  const headers = { Vary: "Origin" };
  if (origin === WEBVIEW_ORIGIN) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/**
 * Headers for a CORS preflight (OPTIONS).
 *
 * The client sends `Authorization`, `Content-Type` and `LocalName`, which makes
 * every POST preflighted; grant whatever the WebView asked for, reduced to
 * plain header names so a crafted request can never inject response headers.
 * A non-WebView origin gets the same 204 as before, without the allow headers.
 */
export function preflightHeaders(origin, requestedHeaders) {
  const headers = corsHeaders(origin);
  if (origin !== WEBVIEW_ORIGIN) return headers;
  headers["Access-Control-Allow-Methods"] = ALLOWED_METHODS.join(", ");
  const allow = sanitizeHeaderList(requestedHeaders);
  if (allow) headers["Access-Control-Allow-Headers"] = allow;
  headers["Access-Control-Max-Age"] = "600";
  return headers;
}

/** "Authorization, X-Y\r\nX-Evil: 1" → "authorization, x-y" */
function sanitizeHeaderList(value) {
  if (typeof value !== "string") return "";
  return value
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => /^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) // RFC 7230 token
    .join(", ");
}
