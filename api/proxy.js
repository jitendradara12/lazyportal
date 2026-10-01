// Vercel serverless proxy: vercel.json rewrites /api/:path* here.
// Why a function and not a direct rewrite: the portal 403s non-portal
// Origin/Referer, so we must spoof them server-side. Same-origin from the
// browser => no CORS preflight. Zero deps, free-tier safe.
// Upstream base mirrors packages/web/vite.config.js dev proxy.

import https from "node:https";
import { corsHeaders, preflightHeaders } from "./cors.js";

const UPSTREAM = "https://studentportal.juet.ac.in/StudentPortalAPI";
const PORTAL_ORIGIN = "https://studentportal.juet.ac.in";
const PORTAL_REFERER = "https://studentportal.juet.ac.in/studentportal/";

export const config = { api: { bodyParser: false } };
export const maxDuration = 60;

/** Upstream fetch via node:https: the portal omits its intermediate cert, so
 * strict Node verification fails ("unable to verify the first certificate").
 * rejectUnauthorized:false is scoped to this single upstream host only. */
function fetchUpstream(target, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        rejectUnauthorized: false,
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
  const origin = req.headers?.origin;
  if (req.method === "OPTIONS") {
    // CORS preflight (native WebView only — see api/cors.js).
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

  const { path: _drop, ...rest } = req.query ?? {};
  const path = Array.isArray(_drop) ? _drop.join("/") : (_drop ?? "");
  const qs = new URLSearchParams(rest).toString();
  const target = `${UPSTREAM}/${path}${qs ? `?${qs}` : ""}`;

  // Dev parity: forward everything except hop-by-hop / infra headers.
  // (The old allowlist silently dropped anything new: UA, Cookie, ...).
  const DROP = new Set([
    "host",
    "connection",
    "content-length", // recomputed below from exact bytes
    "transfer-encoding",
    "accept-encoding", // forced to identity: our utf8 relay can't pass gzip through
    "origin",
    "referer", // both spoofed to the portal below
    "upgrade",
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
  if (req.method !== "GET" && req.method !== "HEAD") {
    const raw = await readRawBody(req);
    if (raw) {
      body = raw;
      headers["content-length"] = Buffer.byteLength(body); // exact length, not chunked (dev parity)
    }
  }

  let upstream;
  try {
    upstream = await fetchUpstream(target, { method: req.method, headers, body });
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
    // Relay session cookies; strip Domain (portal-domain cookie would be
    // rejected) and reset Path to / (portal paths like /StudentPortalAPI
    // would never match our /api/* routes, so the browser would not resend).
    res.setHeader(
      "set-cookie",
      upstream.setCookies.map((c) =>
        c.replace(/;\s*[Dd]omain=[^;]*/g, "").replace(/;\s*[Pp]ath=[^;]*/g, "; Path=/")
      )
    );
  }
  res.send(upstream.text);
}
