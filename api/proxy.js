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
const PORTAL_PORT = Number(new URL(UPSTREAM).port) || 443;
const PORTAL_ORIGIN = "https://studentportal.juet.ac.in";
const PORTAL_REFERER = "https://studentportal.juet.ac.in/studentportal/";
const UPSTREAM_PATH = new URL(UPSTREAM).pathname.replace(/\/+$/, "");
const ALLOWED_METHODS = new Set(
  CORS_ALLOWED_METHODS.filter((method) => method !== "OPTIONS")
);
const ALLOW_HEADER = CORS_ALLOWED_METHODS.join(", ");
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

// Share connections across warm/Fluid invocations, but retain only a small
// idle pool. Active requests are not capped/queued (maxSockets is Infinity).
// The idle timeout is at most 5s, separate from each request's 45s upstream inactivity timeout.
const upstreamAgent = new https.Agent({
  keepAlive: true,
  maxFreeSockets: 8,
  timeout: 5_000,
});

// Hop-by-hop & infra headers to strip. Hoisted at module load.
const DROP_HEADERS = new Set([
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
  "accept-encoding", // forced to identity: preserves uncompressed contract
  "origin",
  "referer", // both spoofed to the portal
  "forwarded",
]);

export const MAX_BODY_BYTES = 512 * 1024; // 512 KiB payload protection guard

export class PayloadTooLargeError extends Error {
  constructor(message = "Payload Too Large") {
    super(message);
    this.name = "PayloadTooLargeError";
    this.status = 413;
  }
}

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

  const cleanPath = segments.map(encodeURIComponent).join("/");
  const search = new URLSearchParams(query).toString();
  return `${PORTAL_ORIGIN}${UPSTREAM_PATH}/${cleanPath}${search ? `?${search}` : ""}`;
}

/**
 * Read raw request body directly into a Buffer.
 * Throws a typed PayloadTooLargeError above the limit without destroying
 * the client stream, draining remaining bytes so the 413 response can be delivered cleanly.
 */
export async function readRawBody(req, limit = MAX_BODY_BYTES) {
  if (req.destroyed) throw new Error("stream destroyed");
  if (req.readableEnded) return null;

  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let exceeded = false;

    const cleanup = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("close", onClose);
    };

    const onData = (chunk) => {
      if (exceeded) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > limit) {
        exceeded = true;
        cleanup();
        req.on?.("error", () => {});
        req.resume?.();
        reject(new PayloadTooLargeError(`Request body exceeds ${limit} bytes`));
        return;
      }
      chunks.push(buffer);
    };

    const onEnd = () => {
      if (exceeded) return;
      cleanup();
      if (chunks.length === 1) resolve(chunks[0]);
      else if (length === 0) resolve(null);
      else resolve(Buffer.concat(chunks, length));
    };

    const onError = (err) => {
      if (exceeded) return;
      cleanup();
      req.on?.("error", () => {});
      reject(err);
    };

    const onClose = () => {
      if (exceeded) return;
      cleanup();
      req.on?.("error", () => {});
      const err = new Error("upload aborted");
      err.code = "ERR_UPLOAD_ABORTED";
      reject(err);
    };

    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("close", onClose);
  });
}

/**
 * Upstream fetch via node:https: resolves as soon as headers arrive.
 * Reuses the idle connection pool and honors the abort signal.
 */
function fetchUpstream(target, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : PORTAL_PORT,
        path: url.pathname + url.search,
        method,
        headers,
        agent: upstreamAgent,
        signal,
        // Portal TLS certificate hostname matches studentportal.juet.ac.in; bypass only for the portal host
        rejectUnauthorized: url.hostname !== PORTAL_HOST,
      },
      resolve
    );
    req.once("error", reject);
    req.setTimeout(45_000, () => req.destroy(new Error("upstream timeout")));
    req.end(body);
  });
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
  if (!incomingHeaders.accept && !incomingHeaders.Accept) headers.Accept = "application/json";

  const controller = new AbortController();
  const onAborted = () => controller.abort();
  const onClose = () => {
    // Normal response completion emits close with writableFinished=true;
    // do not abort reusable sockets on clean completion.
    if (!res.writableFinished) controller.abort();
  };
  req.once("aborted", onAborted);
  res.once("close", onClose);

  let upstream;
  try {
    let body;
    if (method !== "GET" && method !== "HEAD") {
      const contentLength = Number(incomingHeaders["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        req.on?.("error", () => {});
        req.resume?.();
        res.status(413).json({
          status: { responseStatus: "Failure" },
          message: "Payload Too Large",
          detail: `Request body exceeds ${MAX_BODY_BYTES} bytes`,
        });
        return;
      }

      try {
        const raw = await readRawBody(req, MAX_BODY_BYTES);
        if (raw && raw.length) {
          body = raw;
          headers["content-length"] = raw.length; // exact byte length, not chunked
        }
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          req.on?.("error", () => {});
          res.status(413).json({
            status: { responseStatus: "Failure" },
            message: "Payload Too Large",
            detail: err.message,
          });
          return;
        }
        if (
          req.aborted ||
          req.destroyed ||
          controller.signal.aborted ||
          err?.code === "ERR_UPLOAD_ABORTED" ||
          err?.message === "upload aborted"
        ) {
          return;
        }
        throw err;
      }
    }

    if (req.aborted || res.destroyed || controller.signal.aborted) return;

    upstream = await fetchUpstream(target, { method, headers, body, signal: controller.signal });

    res.status(upstream.statusCode ?? 502);
    res.setHeader("content-type", upstream.headers["content-type"] ?? "application/json");

    const setCookies = upstream.headers["set-cookie"];
    if (setCookies?.length) {
      // Relay session cookies for same-origin browser builds; strip Domain
      // and reset Path to / so browser can attach cookies on subsequent calls.
      res.setHeader(
        "set-cookie",
        setCookies.map((c) =>
          c.replace(/;\s*[Dd]omain=[^;]*/g, "").replace(/;\s*[Pp]ath=[^;]*/g, "; Path=/")
        )
      );
    }

    // Stream directly via pipeline: enforces backpressure and awaits finish
    await pipeline(upstream, res);
  } catch (err) {
    if (
      req.aborted ||
      err?.name === "AbortError" ||
      (controller.signal.aborted && err?.code === "ERR_STREAM_PREMATURE_CLOSE")
    ) {
      return;
    }

    console.error("proxy upstream fetch failed:", err);
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
