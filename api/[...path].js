// Vercel serverless proxy: /api/* -> portal (same upstream as vite.config.js dev proxy).
// Why a function and not a rewrite: the portal 403s non-portal Origin/Referer,
// so we must spoof them server-side. Same-origin from the browser => no CORS preflight.
// Zero deps, free-tier safe. Upstream base duplicated from packages/web/vite.config.js.

const UPSTREAM = "https://studentportal.juet.ac.in/StudentPortalAPI";
const PORTAL_ORIGIN = "https://studentportal.juet.ac.in";
const PORTAL_REFERER = "https://studentportal.juet.ac.in/studentportal/";

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined && typeof req.body !== "object") return resolve(req.body);
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

  const segs = req.query?.path;
  const path = Array.isArray(segs) ? segs.join("/") : (segs ?? "");
  const qIndex = (req.url ?? "").indexOf("?");
  const query = qIndex >= 0 ? (req.url ?? "").slice(qIndex) : "";
  const target = `${UPSTREAM}/${path}${query}`;

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
  } catch {
    res.status(502).json({ status: { responseStatus: "Failure" }, message: "Upstream unreachable" });
    return;
  }

  const text = await upstream.text();
  res.status(upstream.status);
  const ct = upstream.headers.get("content-type");
  res.setHeader("content-type", ct ?? "application/json");
  res.send(text);
}
