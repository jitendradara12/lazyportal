// Vercel serverless proxy: vercel.json rewrites /api/:path* here.
// Why a function and not a direct rewrite: the portal 403s non-portal
// Origin/Referer, so we must spoof them server-side. Same-origin from the
// browser => no CORS preflight. Zero deps, free-tier safe.
// Upstream base mirrors packages/web/vite.config.js dev proxy.

import https from "node:https";
import { pipeline } from "node:stream/promises";
import {
  ALLOWED_METHODS as CORS_ALLOWED_METHODS,
  corsHeaders,
  preflightHeaders,
} from "../shared/cors.js";

const UPSTREAM = "https://studentportal.juet.ac.in/StudentPortalAPI";
const PORTAL_HOST = new URL(UPSTREAM).hostname;
const PORTAL_ORIGIN = "https://studentportal.juet.ac.in";
const PORTAL_REFERER = "https://studentportal.juet.ac.in/studentportal/";
const ALLOWED_METHODS = new Set(
  CORS_ALLOWED_METHODS.filter((method) => method !== "OPTIONS")
);
const ALLOW_HEADER = CORS_ALLOWED_METHODS.join(", ");
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

// Share connections across warm/Fluid invocations, but retain only a small
// idle pool. Active requests are not capped/queued. The idle timeout is at
// most 5s (upstream hints may shorten it), separate from each request's
// unchanged 45s upstream inactivity timeout.
const upstreamAgent = new https.Agent({
  keepAlive: true,
  maxFreeSockets: 8,
  timeout: 5_000,
});

// Dev parity: forward everything except hop-by-hop / infra headers.
// Hoisted so concurrent invocations do not each allocate the same Set.
const DROP_HEADERS = new Set([
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
  "accept-encoding", // identity preserves the existing uncompressed contract
  "origin",
  "referer", // both spoofed to the portal below
  "forwarded",
]);

export const config = {
  api: { bodyParser: false },
  // Prevent the platform adapter from buffering our streamed response again.
  supportsResponseStreaming: true,
};
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

/** Resolve as soon as headers arrive; the handler relays the response stream.
 * The portal omits its intermediate cert, so strict Node verification fails.
 * Verification is skipped only for the portal host itself (structural, not a
 * comment promise): any other hostname keeps Node's default verification. */
function fetchUpstream(target, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        agent: upstreamAgent,
        signal,
        rejectUnauthorized: url.hostname !== PORTAL_HOST,
      },
      resolve
    );
    req.once("error", reject);
    req.setTimeout(45000, () => req.destroy(new Error("upstream timeout")));
    req.end(body);
  });
}

async function readRawBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    length += buffer.length;
  }
  // Keep bytes as bytes: avoid the old decode -> byteLength -> re-encode path.
  // Small POSTs commonly arrive in one chunk, requiring no extra body copy.
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length);
}

export default async function handler(req, res) {
  const method = String(req.method ?? "").toUpperCase();
  const incomingHeaders = req.headers ?? {};
  const origin = incomingHeaders.origin;
  if (method === "OPTIONS") {
    // CORS preflight (native WebView only — see shared/cors.js).
    res.status(204);
    for (const [k, v] of Object.entries(
      preflightHeaders(origin, incomingHeaders["access-control-request-headers"])
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

  const headers = {
    Origin: PORTAL_ORIGIN,
    Referer: PORTAL_REFERER,
    "Accept-Encoding": "identity",
  };
  for (const [k, v] of Object.entries(incomingHeaders)) {
    const lk = k.toLowerCase();
    if (DROP_HEADERS.has(lk) || lk.startsWith("x-forwarded") || lk.startsWith("x-vercel") || lk === "x-real-ip") continue;
    headers[k] = v;
  }
  if (!incomingHeaders.accept) headers.Accept = "application/json";

  const controller = new AbortController();
  const onAborted = () => controller.abort();
  const onClose = () => {
    // A normal response also emits close; do not discard its reusable socket.
    if (!res.writableFinished) controller.abort();
  };
  req.once("aborted", onAborted);
  res.once("close", onClose);

  let upstream;
  try {
    if (req.aborted || res.destroyed) return;
    let body;
    if (method !== "GET" && method !== "HEAD") {
      const raw = await readRawBody(req);
      if (raw.length) {
        body = raw;
        headers["content-length"] = raw.length; // exact bytes, not chunked (dev parity)
      }
    }
    if (controller.signal.aborted) return;

    upstream = await fetchUpstream(target, { method, headers, body, signal: controller.signal });
    res.status(upstream.statusCode ?? 502);
    res.setHeader("content-type", upstream.headers["content-type"] ?? "application/json");
    const setCookies = upstream.headers["set-cookie"];
    if (setCookies?.length) {
      // Relay session cookies for same-origin browser builds; strip Domain
      // (portal-domain cookie would be rejected) and reset Path to / (portal
      // paths like /StudentPortalAPI would never match our /api/* routes, so
      // the browser would not resend). Inert for the native shell: it is
      // token-based (Authorization: Bearer) and cross-origin fetch omits
      // cookies by default.
      res.setHeader(
        "set-cookie",
        setCookies.map((c) =>
          c.replace(/;\s*[Dd]omain=[^;]*/g, "").replace(/;\s*[Pp]ath=[^;]*/g, "; Path=/")
        )
      );
    }

    // Backpressure bounds memory to stream buffers, not whole responses.
    // Await completion so Vercel keeps the invocation alive until delivery.
    // No Buffer.concat, UTF-8 conversion, or res.send body hashing/copying.
    await pipeline(upstream, res);
  } catch (err) {
    // The browser has gone away: stop its work without logging a portal outage.
    if (
      req.aborted ||
      err?.name === "AbortError" ||
      (controller.signal.aborted && err?.code === "ERR_STREAM_PREMATURE_CLOSE")
    ) return;

    console.error("proxy upstream fetch failed:", err);
    // Streaming may already have sent headers/bytes. Never append error JSON
    // to a partial portal response; pipeline destroys failed streams instead.
    if (res.destroyed) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(502).json({
      status: { responseStatus: "Failure" },
      message: "Upstream unreachable",
      detail: String(err?.message ?? err).slice(0, 200),
    });
  } finally {
    req.removeListener("aborted", onAborted);
    res.removeListener("close", onClose);
    if (upstream && !upstream.readableEnded) upstream.destroy();
  }
}
