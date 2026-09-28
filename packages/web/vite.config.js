import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: browser talks same-origin to /api, Vite forwards server-side.
// Direct browser -> studentportal.juet.ac.in is blocked by CORS:
// preflight OPTIONS returns 403 and ACAO allowlists only the portal origin.
// Same-origin via proxy => no preflight, no ACAO check.
export default defineConfig({
  plugins: [react()],
  server: {
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
