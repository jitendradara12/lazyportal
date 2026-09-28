// Vercel serverless proxy: vercel.json rewrites /api/:path* here.
// Why a function and not a direct rewrite: the portal 403s non-portal
// Origin/Referer, so we must spoof them server-side. Same-origin from the
// browser => no CORS preflight. Zero deps, free-tier safe.
// Upstream base mirrors packages/web/vite.config.js dev proxy.

const UPSTREAM = "https://studentportal.juet.ac.in/StudentPortalAPI";
const PORTAL_ORIGIN = "https://studentportal.juet.ac.in";
const PORTAL_REFERER = "https://studentportal.juet.ac.in/studentportal/";

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const { path: _drop, ...rest } = req.query ?? {};
  const path = Array.isArray(_drop) ? _drop.join("/") : (_drop ?? "");
  const qs = new URLSearchParams(rest).toString();
  const target = `${UPSTREAM}/${path}${qs ? `?${qs}` : ""}`;

  const headers = {
    Accept: req.headers.accept ?? "application/json",
    Origin: PORTAL_ORIGIN,
    Referer: PORTAL_REFERER,
  };
  for (const h of ["authorization", "localname", "content-type"]) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const raw = await readRawBody(req);
    if (raw) body = raw;
  }

  let upstream;
  try {
    upstream = await fetch(target, { method: req.method, headers, body });
  } catch (err) {
    console.error("proxy upstream fetch failed:", err);
    res.status(502).json({
      status: { responseStatus: "Failure" },
      message: "Upstream unreachable",
      detail: String(err?.message ?? err).slice(0, 200),
    });
    return;
  }

  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
  res.send(text);
}
