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
]);

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

export function normalizeOfficialPortalResponse(upstream, { method = "GET" } = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(upstream.headers ?? {})) {
    const lower = key.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(lower) || value == null) continue;
    if (lower === "location") {
      headers[key] = rewriteOfficialPortalLocation(Array.isArray(value) ? value[0] : value);
      continue;
    }
    headers[key] = value;
  }

  const contentType = Array.isArray(headers["content-type"])
    ? headers["content-type"][0]
    : headers["content-type"] || headers["Content-Type"] || "application/octet-stream";

  if (method === "HEAD") {
    return { status: upstream.status, headers, body: null };
  }

  if (!isOfficialPortalTextContent(contentType)) {
    headers["content-type"] = contentType;
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
