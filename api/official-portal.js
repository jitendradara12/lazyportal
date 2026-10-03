import {
  buildOfficialPortalRequestHeaders,
  buildOfficialPortalTarget,
  fetchOfficialPortal,
  normalizeOfficialPortalResponse,
} from "../shared/officialPortalProxy.js";

export const config = { api: { bodyParser: false } };
export const maxDuration = 60;

export default async function handler(req, res) {
  const method = String(req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).end();
    return;
  }

  const { path: pathValue, ...rest } = req.query ?? {};
  let target;
  try {
    target = buildOfficialPortalTarget(pathValue, rest);
  } catch {
    res.status(400).json({ message: "Invalid official portal path" });
    return;
  }

  let upstream;
  try {
    upstream = await fetchOfficialPortal(target, {
      method,
      headers: buildOfficialPortalRequestHeaders(req.headers ?? {}),
    });
  } catch (err) {
    console.error("official portal fetch failed:", err);
    res.status(502).json({
      message: "Official portal unreachable",
      detail: String(err?.message ?? err).slice(0, 200),
    });
    return;
  }

  const response = normalizeOfficialPortalResponse(upstream, { method });
  res.status(response.status);
  for (const [key, value] of Object.entries(response.headers)) {
    res.setHeader(key, value);
  }
  if (method === "HEAD" || response.body == null) {
    res.end();
    return;
  }
  res.send(response.body);
}
