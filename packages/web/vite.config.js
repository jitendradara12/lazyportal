import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  buildOfficialPortalRequestHeaders,
  buildOfficialPortalTarget,
  fetchOfficialPortal,
  normalizeOfficialPortalResponse,
} from "../../shared/officialPortalProxy.js";

function officialPortalDevProxy() {
  return {
    name: "official-portal-dev-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/officialportal")) return next();

        const method = String(req.method ?? "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          res.statusCode = 405;
          res.setHeader("Allow", "GET, HEAD");
          res.end();
          return;
        }

        const parsed = new URL(url, "http://localhost");
        const pathValue = parsed.pathname.replace(/^\/officialportal\/?/, "");
        let target;
        try {
          target = buildOfficialPortalTarget(pathValue, parsed.searchParams);
        } catch {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ message: "Invalid official portal path" }));
          return;
        }

        try {
          const upstream = await fetchOfficialPortal(target, {
            method,
            headers: buildOfficialPortalRequestHeaders(req.headers ?? {}),
          });
          const response = normalizeOfficialPortalResponse(upstream, { method });
          res.statusCode = response.status;
          for (const [key, value] of Object.entries(response.headers)) {
            if (value != null) res.setHeader(key, value);
          }
          if (method === "HEAD" || response.body == null) {
            res.end();
            return;
          }
          res.end(response.body);
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              message: "Official portal unreachable",
              detail: String(err?.message ?? err).slice(0, 200),
            })
          );
        }
      });
    },
  };
}

// Dev proxy: browser talks same-origin to /api, Vite forwards server-side.
// Direct browser -> studentportal.juet.ac.in is blocked by CORS:
// preflight OPTIONS returns 403 and ACAO allowlists only the portal origin.
// Same-origin via proxy => no preflight, no ACAO check.
export default defineConfig({
  plugins: [react(), officialPortalDevProxy()],
  server: {
    allowedHosts: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "https://studentportal.juet.ac.in/StudentPortalAPI",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
        secure: false,
        // Upstream 403s non-portal Origin/Referer (browser sends localhost).
        // Same-origin from the browser's view; spoof portal origin upstream.
        headers: {
          Origin: "https://studentportal.juet.ac.in",
          Referer: "https://studentportal.juet.ac.in/studentportal/",
        },
      },
    },
  },
});
