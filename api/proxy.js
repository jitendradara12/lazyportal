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

// Pre-parsed upstream URL constants (avoids repeated new URL() construction)
const UPSTREAM_URL = new URL(UPSTREAM);
const PORTAL_HOST = UPSTREAM_URL.hostname;
const PORTAL_PORT = UPSTREAM_URL.port || 443;
const UPSTREAM_PATH = UPSTREAM_URL.pathname.replace(/\/+$/, "");

// Shared persistent agent for HTTP keep-alive connection reuse across warm invocations.
// Eliminates repetitive TCP handshakes and TLS cryptographic negotiation per request,
// reducing invocation latency by ~200-400ms and cutting active CPU / provisioned memory duration.
const upstreamAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 15_000,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 15_000,
});

// Hop-by-hop & infra headers to strip. Static set created once at module load.
const DROP = new Set([
  "host",
  "connection",
  "keep-alive",
  "content-length", // recomputed from exact bytes
  "transfer-encoding",
  "te",
  "trailer",
  "via",
  "upgrade",
  "expect", // e.g. 100-continue: the relay never answers it upstream
  "proxy-authenticate",
  "proxy-authorization", // client proxy creds must never reach the portal
  "cdn-loop",
  "accept-encoding", // forced to identity: safe single-pass byte forwarding
  "origin",
  "referer", // both spoofed to the portal
  "forwarded",
]);

const MAX_BODY_BYTES = 512 * 1024; // 512KB payload protection guard
const UPSTREAM_TIMEOUT_MS = 12_000; // 12s fail-fast avoids holding 2GB memory open during portal outages

export const config = { api: { bodyParser: false } };
export const maxDuration = 15;

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

  const cleanPath = segments.map(encodeURIComponent).join("/");
  const search = new URLSearchParams(query).toString();
  return `${UPSTREAM_URL.origin}${UPSTREAM_PATH}/${cleanPath}${search ? `?${search}` : ""}`;
}

/**
 * Read raw request body directly into a Buffer.
 * Avoids unnecessary UTF-8 string allocations and GC pressure.
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytesRead = 0;
    req.on("data", (chunk) => {
      bytesRead += chunk.length;
      if (bytesRead > MAX_BODY_BYTES) {
        req.destroy(new Error("Request body exceeds 512KB limit"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(bytesRead === 0 ? null : Buffer.concat(chunks, bytesRead));
    });
    req.on("error", reject);
  });
}

/**
 * Upstream fetch and stream relay via node:https.
 * Streams data directly to response (upstreamRes.pipe(clientRes)) to avoid
 * buffering entire response text into V8 heap strings, minimizing active CPU and memory.
 */
function relayUpstream(target, { method, headers, body }, clientReq, clientRes) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    let resolved = false;
    let clientClosed = false;

    const req = https.request(
      {
        agent: upstreamAgent,
        hostname: url.hostname,
        port: url.port || PORTAL_PORT,
        path: url.pathname + url.search,
        method,
        headers,
        rejectUnauthorized: url.hostname !== PORTAL_HOST,
      },
      (upstreamRes) => {
        if (clientClosed) {
          upstreamRes.destroy();
          resolve();
          return;
        }

        resolved = true;
        clientRes.status(upstreamRes.statusCode ?? 502);
        clientRes.setHeader("content-type", upstreamRes.headers["content-type"] ?? "application/json");

        if (upstreamRes.headers["content-length"]) {
          clientRes.setHeader("content-length", upstreamRes.headers["content-length"]);
        }

        if (upstreamRes.headers["set-cookie"]?.length) {
          // Relay session cookies for same-origin browser builds; strip Domain
          // and reset Path to / so browser can attach cookies on subsequent calls.
          clientRes.setHeader(
            "set-cookie",
            upstreamRes.headers["set-cookie"].map((c) =>
              c.replace(/;\s*[Dd]omain=[^;]*/g, "").replace(/;\s*[Pp]ath=[^;]*/g, "; Path=/")
            )
          );
        }

        if (typeof clientRes.write === "function") {
          upstreamRes.pipe(clientRes);
          upstreamRes.on("end", resolve);
          upstreamRes.on("error", (err) => {
            clientRes.destroy?.(err);
            resolve();
          });
        } else {
          // Fallback for mock response objects in tests
          const chunks = [];
          upstreamRes.on("data", (c) => chunks.push(c));
          upstreamRes.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (typeof clientRes.send === "function") clientRes.send(text);
            else clientRes.end?.(text);
            resolve();
          });
          upstreamRes.on("error", reject);
        }
      }
    );

    req.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      req.destroy(new Error("upstream timeout"));
    });

    req.on("error", (err) => {
      if (!resolved) reject(err);
    });

    // Abort upstream call immediately if the client disconnects or aborts,
    // avoiding wasted execution time and memory duration on zombie requests.
    clientReq.on("close", () => {
      clientClosed = true;
      if (!resolved) {
        req.destroy();
      }
    });

    if (body) req.write(body);
    req.end();
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
    // Allow edge caching for preflight so Vercel Edge can answer subsequent OPTIONS without invoking function
    res.setHeader("cache-control", "public, max-age=86400");
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
      headers["content-length"] = body.length; // exact byte length, not chunked
    }
  }

  try {
    await relayUpstream(target, { method, headers, body }, req, res);
  } catch (err) {
    console.error("proxy upstream fetch failed:", err);
    res.status(502).json({
      status: { responseStatus: "Failure" },
      message: "Upstream unreachable",
      detail: String(err?.message ?? err).slice(0, 200),
    });
  }
}
