import https from "node:https";
import {
  OFFICIAL_PORTAL_API_PROXY,
  OFFICIAL_PORTAL_API_UPSTREAM,
  OFFICIAL_PORTAL_PREFIX,
  OFFICIAL_PORTAL_UPSTREAM,
  transformOfficialPortalText,
} from "./officialPortal.js";

const PORTAL_ORIGIN = new URL(OFFICIAL_PORTAL_UPSTREAM).origin;
const PORTAL_HOST = new URL(OFFICIAL_PORTAL_UPSTREAM).hostname;
const PORTAL_REFERER = `${OFFICIAL_PORTAL_UPSTREAM}/`;
const PATH_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@-]+$/;
// Hashed Angular bundles, styles, fonts, images: immutable, safe for long edge
// caching. HTML shell is excluded on purpose: it carries the per-session
// bootstrap injection and must never be cached.
const CACHEABLE_ASSET_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".css",
  ".map",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".avif",
  ".json",
  ".txt",
  ".xml",
  ".webmanifest",
  ".mp3",
  ".mp4",
  ".webm",
  ".ogg",
  ".wav",
  ".pdf",
]);
// One function run populates every edge region; students after that are served
// from the CDN with zero invocations.
const EDGE_ASSET_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
const EDGE_UNKNOWN_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";
const HTML_NO_STORE = "private, no-store";
const DROP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-frame-options",
  "frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  // Upstream sends private/no-cache; we set our own edge policy below.
  "cache-control",
  "cdn-cache-control",
  "vercel-cdn-cache-control",
  "age",
  "expires",
  "pragma",
  // A proxied SPA shell must never plant upstream session cookies in the
  // browser (auth is bearer-token based), and caching a Set-Cookie response
  // at the edge would leak one user's session to everyone.
  "set-cookie",
]);

export function isCacheableOfficialPortalAsset(pathname = "") {
  const clean = String(pathname).split("?")[0].split("#")[0].toLowerCase();
  const slash = clean.lastIndexOf("/");
  const dot = clean.lastIndexOf(".");
  if (dot < 0 || dot < slash) return false;
  return CACHEABLE_ASSET_EXTENSIONS.has(clean.slice(dot));
}

export function isOfficialPortalHtmlContent(contentType = "") {
  return /text\/html|application\/xhtml\+xml/i.test(String(contentType));
}

function normalizeQuery(query) {
  if (!query) return new URLSearchParams();
  if (query instanceof URLSearchParams) return new URLSearchParams(query);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else if (value != null) {
      params.append(key, String(value));
    }
  }
  return params;
}

export function buildOfficialPortalTarget(pathValue = "", query) {
  const rawPath = Array.isArray(pathValue)
    ? pathValue.join("/")
    : typeof pathValue === "string"
      ? pathValue
      : "";
  if (rawPath.startsWith("/")) throw new TypeError("Invalid official portal path");
  const clean = rawPath;
  const segments = clean ? clean.split("/") : [];
  if (
    segments.some(
      (segment) =>
        !segment || !PATH_SEGMENT.test(segment) || segment === "." || segment === ".."
    )
  ) {
    throw new TypeError("Invalid official portal path");
  }

  const target = new URL(OFFICIAL_PORTAL_UPSTREAM);
  target.pathname = `${target.pathname}${segments.length ? `/${segments.map(encodeURIComponent).join("/")}` : "/"}`;
  target.search = normalizeQuery(query).toString();
  return target.toString();
}

export function buildOfficialPortalRequestHeaders(requestHeaders = {}) {
  const headers = {
    Origin: PORTAL_ORIGIN,
    Referer: PORTAL_REFERER,
    "Accept-Encoding": "identity",
  };
  const drop = new Set([
    "host",
    "connection",
    "keep-alive",
    "content-length",
    "transfer-encoding",
    "te",
    "trailer",
    "via",
    "upgrade",
    "expect",
    "proxy-authenticate",
    "proxy-authorization",
    "accept-encoding",
    "origin",
    "referer",
    "forwarded",
  ]);
  for (const [key, value] of Object.entries(requestHeaders)) {
    const lower = key.toLowerCase();
    if (drop.has(lower) || lower.startsWith("x-forwarded") || lower.startsWith("x-vercel") || lower === "x-real-ip") continue;
    headers[key] = value;
  }
  return headers;
}

export function fetchOfficialPortal(target, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        rejectUnauthorized: url.hostname !== PORTAL_HOST,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on("error", reject);
    req.setTimeout(45000, () => req.destroy(new Error("upstream timeout")));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Header-first upstream request for streaming: resolves as soon as upstream
 * headers arrive, before the body downloads. Lets the handler set edge cache
 * headers and pipe bytes through without ever buffering the full file.
 * TLS verification is skipped only for the portal host itself: it omits its
 * intermediate cert, so strict Node verification fails ("unable to verify the
 * first certificate"). Any other hostname keeps default verification.
 */
export function requestOfficialPortal(target, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        rejectUnauthorized: url.hostname !== PORTAL_HOST,
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 502,
          headers: res.headers,
          stream: res,
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(45000, () => req.destroy(new Error("upstream timeout")));
    req.end();
  });
}

export function collectOfficialPortalStream(stream, { maxBytes = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let ended = false;
    stream.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        try {
          stream.destroy();
        } catch {
          // ignored
        }
        reject(new Error("upstream body exceeds limit"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      ended = true;
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", reject);
    // An aborted socket may emit neither end nor error: fail instead of
    // hanging until the function timeout.
    stream.on("close", () => {
      if (!ended) reject(new Error("upstream closed mid-body"));
    });
  });
}

export function rewriteOfficialPortalLocation(location) {
  return String(location)
    .replaceAll(`${OFFICIAL_PORTAL_UPSTREAM}/`, `${OFFICIAL_PORTAL_PREFIX}/`)
    .replaceAll(OFFICIAL_PORTAL_UPSTREAM, OFFICIAL_PORTAL_PREFIX)
    .replaceAll(OFFICIAL_PORTAL_API_UPSTREAM, OFFICIAL_PORTAL_API_PROXY)
    .replaceAll("/studentportal/", `${OFFICIAL_PORTAL_PREFIX}/`)
    .replaceAll("/studentportal", OFFICIAL_PORTAL_PREFIX)
    .replaceAll("/StudentPortalAPI/", `${OFFICIAL_PORTAL_API_PROXY}/`)
    .replaceAll("/StudentPortalAPI", OFFICIAL_PORTAL_API_PROXY);
}

export function isOfficialPortalTextContent(contentType = "") {
  return /^(text\/|application\/(javascript|json|xml)|image\/svg\+xml)/i.test(String(contentType));
}

/**
 * Response headers for the client: strips frame blockers, rewrites redirects
 * onto same-origin routes, and replaces upstream private/no-cache with our own
 * edge policy (long cache for hashed assets, no-store for the HTML shell).
 */
export function buildOfficialPortalResponseHeaders(
  upstreamHeaders = {},
  { target = "", contentType = "", status = 200 } = {}
) {
  const headers = {};
  for (const [key, value] of Object.entries(upstreamHeaders ?? {})) {
    const lower = key.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(lower) || value == null) continue;
    if (lower === "location") {
      headers[key] = rewriteOfficialPortalLocation(Array.isArray(value) ? value[0] : value);
      continue;
    }
    headers[key] = value;
  }

  // Never cache errors: a 404/500 asset cached for a day would blackhole the
  // portal for every student until edge expiry.
  if (status < 200 || status > 299) {
    headers["cache-control"] = HTML_NO_STORE;
    headers["cdn-cache-control"] = "no-store";
    return headers;
  }

  let pathname = "";
  try {
    pathname = new URL(target, "http://localhost").pathname;
  } catch {
    pathname = String(target || "");
  }
  if (isOfficialPortalHtmlContent(contentType)) {
    headers["cache-control"] = HTML_NO_STORE;
    headers["cdn-cache-control"] = "no-store";
    // Frame blockers were stripped above so the dashboard iframe works; pin
    // framing back to our own shells instead of leaving it open to any site.
    headers["content-security-policy"] =
      "frame-ancestors 'self' https://localhost capacitor://localhost";
  } else if (isCacheableOfficialPortalAsset(pathname)) {
    headers["cache-control"] = EDGE_ASSET_CACHE_CONTROL;
    headers["cdn-cache-control"] = EDGE_ASSET_CACHE_CONTROL;
  } else {
    headers["cache-control"] = EDGE_UNKNOWN_CACHE_CONTROL;
    headers["cdn-cache-control"] = EDGE_UNKNOWN_CACHE_CONTROL;
  }
  return headers;
}

export function normalizeOfficialPortalResponse(upstream, { method = "GET", target = "" } = {}) {
  const rawContentType = upstream.headers?.["content-type"] ?? upstream.headers?.["Content-Type"];
  const contentType = (
    Array.isArray(rawContentType) ? rawContentType[0] : rawContentType || "application/octet-stream"
  ).toString();
  const headers = buildOfficialPortalResponseHeaders(upstream.headers, {
    target,
    contentType,
    status: upstream.status,
  });

  if (method === "HEAD") {
    return { status: upstream.status, headers, body: null };
  }

  if (!isOfficialPortalHtmlContent(contentType)) {
    // Static asset: pass bytes through byte-identical. API/asset URL rewiring
    // happens at runtime in the injected bootstrap (fetch/XHR patch), so
    // server-side string scans over multi-MB bundles are pure overhead.
    headers["content-length"] = String(upstream.body?.length ?? 0);
    return { status: upstream.status, headers, body: upstream.body ?? Buffer.alloc(0) };
  }

  const original = (upstream.body ?? Buffer.alloc(0)).toString("utf8");
  const transformed = transformOfficialPortalText(original, contentType);
  const body = Buffer.from(transformed, "utf8");
  headers["content-type"] = contentType;
  headers["content-length"] = String(body.length);
  return { status: upstream.status, headers, body };
}
