/**
 * Where API traffic goes.
 *
 * Browser builds call `/api`: same-origin, served by the Vite dev proxy
 * (vite.config.js) or the Vercel rewrite (vercel.json → api/proxy.js). The
 * portal only accepts its own origin, so browser code must never call it
 * directly.
 *
 * The native shell cannot do that. It serves the bundled app from
 * https://localhost (capacitor.config.json) and has no same-origin proxy, so it
 * calls the hosted proxy by absolute URL. That origin is CORS-allowed in
 * api/cors.js.
 *
 * Plain JS + JSDoc on purpose: it keeps this module importable from
 * `node --test` on every supported Node version (the tests import it directly).
 */

/**
 * Hosted Vercel proxy (the deployment in the repository's homepage URL).
 * Installed builds keep calling whatever was baked in, so treat this as a
 * release-time constant: if the deployment moves, ship a new app build.
 */
export const PROD_API_BASE = "https://lazyportal-tan.vercel.app/api";

/**
 * @param {object} [options]
 * @param {boolean} [options.nativePlatform] `Capacitor.isNativePlatform()` — true inside the app shell.
 * @param {string} [options.envBase] `VITE_API_BASE` — browser builds pointed at another proxy.
 * @param {string} [options.envNativeBase] `VITE_NATIVE_API_BASE` — forks with their own proxy.
 * @returns {string} base URL, never trailing-slashed; endpoints are appended as `/Endpoint`.
 */
export function resolveApiBase({ nativePlatform = false, envBase = "", envNativeBase = "" } = {}) {
  if (nativePlatform) return envNativeBase || PROD_API_BASE;
  return envBase || "/api";
}
