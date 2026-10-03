import {
  buildOfficialPortalRequestHeaders,
  buildOfficialPortalResponseHeaders,
  buildOfficialPortalTarget,
  collectOfficialPortalStream,
  isOfficialPortalHtmlContent,
  requestOfficialPortal,
} from "../shared/officialPortalProxy.js";
import { transformOfficialPortalText } from "../shared/officialPortal.js";

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

  // Header-first request: static assets stream straight through without ever
  // being buffered or string-rewritten; only the HTML shell is collected and
  // transformed (bootstrap injection). Upstream sends identity encoding, so its
  // content-length stays accurate for byte-identical streams.
  let upstream;
  try {
    upstream = await requestOfficialPortal(target, {
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

  const rawContentType = upstream.headers?.["content-type"] ?? "application/octet-stream";
  const contentType = (
    Array.isArray(rawContentType) ? rawContentType[0] : rawContentType
  ).toString();
  const isHtml = isOfficialPortalHtmlContent(contentType);
  const headers = buildOfficialPortalResponseHeaders(upstream.headers, {
    target,
    contentType,
    status: upstream.status,
  });
  if (!isHtml) {
    // Byte-identical stream: preserve the exact length/encoding so the
    // browser doesn't hang waiting for bytes that never come.
    for (const name of ["content-length", "content-encoding"]) {
      const value = upstream.headers?.[name];
      if (value != null) headers[name] = Array.isArray(value) ? value[0] : String(value);
    }
  }

  res.status(upstream.status);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  if (method === "HEAD") {
    try {
      upstream.stream.resume();
    } catch {
      // ignored
    }
    res.end();
    return;
  }

  if (!isHtml) {
    try {
      res.on("close", () => {
        try {
          upstream.stream.destroy();
        } catch {
          // ignored
        }
      });
    } catch {
      // ignored
    }
    upstream.stream.on("error", (err) => {
      console.error("official portal stream failed:", err);
      try {
        upstream.stream.unpipe(res);
      } catch {
        // ignored
      }
      try {
        res.destroy(err);
      } catch {
        try {
          res.end();
        } catch {
          // ignored
        }
      }
    });
    upstream.stream.pipe(res);
    return;
  }

  let body;
  try {
    // HTML shell is ~26KB; the cap only trips on a mislabeled giant body.
    body = await collectOfficialPortalStream(upstream.stream, {
      maxBytes: 2 * 1024 * 1024,
    });
  } catch (err) {
    console.error("official portal read failed:", err);
    try {
      upstream.stream.destroy();
    } catch {
      // ignored
    }
    // Headers were already set above: a json() 502 now would leak upstream
    // cache/content-type onto the error, or throw if headers already sent.
    if (!res.headersSent) {
      res.status(502).json({
        message: "Official portal unreachable",
        detail: String(err?.message ?? err).slice(0, 200),
      });
    } else {
      try {
        res.end();
      } catch {
        // ignored
      }
    }
    return;
  }
  const transformed = transformOfficialPortalText(body.toString("utf8"), contentType);
  const out = Buffer.from(transformed, "utf8");
  res.setHeader("content-length", String(out.length));
  res.send(out);
}
