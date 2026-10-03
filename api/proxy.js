// Vercel serverless proxy: vercel.json rewrites /api/:path* here.
// Why a function and not a direct rewrite: the portal 403s non-portal
// Origin/Referer, so we must spoof them server-side. Same-origin from the
// browser => no CORS preflight. Zero deps, free-tier safe.
// Upstream base mirrors packages/web/vite.config.js dev proxy.

import https from "node:https";
import {
  ALLOWED_METHODS as CORS_ALLOWED_METHODS,
  corsHeaders,
  preflightHeaders,
} from "../shared/cors.js";

const UPSTREAM = "https://studentportal.juet.ac.in/StudentPortalAPI";
const PORTAL_ORIGIN = "https://studentportal.juet.ac.in";
const PORTAL_REFERER = "https://studentportal.juet.ac.in/studentportal/";
const ALLOWED_METHODS = new Set(
  CORS_ALLOWED_METHODS.filter((method) => method !== "OPTIONS")
);
const ALLOW_HEADER = CORS_ALLOWED_METHODS.join(", ");
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

export const config = { api: { bodyParser: false } };
export const maxDuration = 60;

/** Build a target beneath the fixed API prefix, rejecting URL delimiters and
 * dot segments before WHATWG URL normalization can remove the prefix. */
export function buildUpstreamTarget(pathValue, query = {}) {
  const rawPath = Array.isArray(pathValue)
    ? pathValue.join("/")
    : typeof pathValue === "string"
      ? pathValue
      : "";
  const segments = rawPath.split("/");
  if (
    !rawPath ||
    segments.some(
      (segment) =>
        !PATH_SEGMENT.test(segment) || segment === "." || segment === ".."
    )
  ) {
    throw new TypeError("Invalid proxy path");
  }

  const target = new URL(UPSTREAM);
  target.pathname = `${target.pathname}/${segments.map(encodeURIComponent).join("/")}`;
  target.search = new URLSearchParams(query).toString();
  return target.toString();
}

/** Upstream fetch via node:https: the portal omits its intermediate cert, so
 * strict Node verification fails ("unable to verify the first certificate").
 * Verification is skipped only for the portal host itself (structural, not a
 * comment promise): any other hostname keeps Node's default verification. */
function fetchUpstream(target, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const portalHost = new URL(UPSTREAM).hostname;
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        rejectUnauthorized: url.hostname !== portalHost,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 502,
            contentType: res.headers["content-type"],
            setCookies: res.headers["set-cookie"],
            text: Buffer.concat(chunks).toString("utf8"),
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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  const method = String(req.method ?? "").toUpperCase();
  const origin = req.headers?.origin;
  if (method === "OPTIONS") {
    // CORS preflight (native WebView only — see shared/cors.js).
    res.status(204);
    for (const [k, v] of Object.entries(
      preflightHeaders(origin, req.headers["access-control-request-headers"])
    )) {
      res.setHeader(k, v);
    }
    res.end();
    return;
  }
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);

  if (!ALLOWED_METHODS.has(method)) {
    res.setHeader("Allow", ALLOW_HEADER);
    res.status(405).end();
    return;
  }

  const { path: pathValue, ...rest } = req.query ?? {};
  let target;
  try {
    target = buildUpstreamTarget(pathValue, rest);
  } catch {
    res.status(400).json({ message: "Invalid proxy path" });
    return;
  }

  // Dev parity: forward everything except hop-by-hop / infra headers.
  // (The old allowlist silently dropped anything new: UA, Cookie, ...).
  const DROP = new Set([
    "host",
    "connection",
    "keep-alive",
    "content-length", // recomputed below from exact bytes
    "transfer-encoding",
    "te",
    "trailer",
    "via",
    "upgrade",
    "expect", // e.g. 100-continue: the relay never answers it upstream
    "proxy-authenticate",
    "proxy-authorization", // client proxy creds must never reach the portal
    "cdn-loop",
    "accept-encoding", // forced to identity: our utf8 relay can't pass gzip through
    "origin",
    "referer", // both spoofed to the portal below
    "forwarded",
  ]);
  const headers = {
    Origin: PORTAL_ORIGIN,
    Referer: PORTAL_REFERER,
    "Accept-Encoding": "identity",
  };
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    const lk = k.toLowerCase();
    if (DROP.has(lk) || lk.startsWith("x-forwarded") || lk.startsWith("x-vercel") || lk === "x-real-ip") continue;
    headers[k] = v;
  }
  if (!req.headers.accept) headers.Accept = "application/json";

  let body;
  if (method !== "GET" && method !== "HEAD") {
    const raw = await readRawBody(req);
    if (raw) {
      body = raw;
      headers["content-length"] = Buffer.byteLength(body); // exact length, not chunked (dev parity)
    }
  }

  let upstream;
  try {
    upstream = await fetchUpstream(target, { method, headers, body });
  } catch (err) {
    console.error("proxy upstream fetch failed:", err);
    res.status(502).json({
      status: { responseStatus: "Failure" },
      message: "Upstream unreachable",
      detail: String(err?.message ?? err).slice(0, 200),
    });
    return;
  }

  res.status(upstream.status);
  res.setHeader("content-type", upstream.contentType ?? "application/json");
  if (upstream.setCookies?.length) {
    // Relay session cookies for same-origin browser builds; strip Domain
    // (portal-domain cookie would be rejected) and reset Path to / (portal
    // paths like /StudentPortalAPI would never match our /api/* routes, so
    // the browser would not resend). Inert for the native shell: it is
    // token-based (Authorization: Bearer) and cross-origin fetch omits
    // cookies by default.
    res.setHeader(
      "set-cookie",
      upstream.setCookies.map((c) =>
        c.replace(/;\s*[Dd]omain=[^;]*/g, "").replace(/;\s*[Pp]ath=[^;]*/g, "; Path=/")
      )
    );
  }
  res.send(upstream.text);
}
