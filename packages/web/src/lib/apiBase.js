/**
 * Where API traffic goes.
 *
 * Browser builds call `/api`: same-origin, served by the Vite dev proxy
 * (vite.config.js) or the Vercel rewrite (vercel.json → api/proxy.js). The
 * portal only accepts its own origin, so browser code must never call it
 * directly.
 *
 * Android keeps loading the live server.url deployment. New APKs use PortalHttp
 * for supported API requests. This base remains the compatibility route for
 * older APKs, newly reviewed endpoints, and explicit native development overrides.
 *
 * Plain JS + JSDoc on purpose: it keeps this module importable from
 * `node --test` on every supported Node version (the tests import it directly).
 */

/**
 * Hosted Vercel proxy (the deployment in the repository's homepage URL).
 * The live web bundle supplies this compatibility URL. Moving server.url itself
 * still requires an APK update.
 */
export const PROD_API_BASE = "https://lazyportal-tan.vercel.app/api";

/**
 * @param {object} [options]
 * @param {boolean} [options.nativePlatform] native bridge `isNativePlatform()` — true inside the app shell.
 * @param {string} [options.envBase] `VITE_API_BASE` — browser builds pointed at another proxy.
 * @param {string} [options.envNativeBase] `VITE_NATIVE_API_BASE` — forks with their own proxy.
 * @returns {string} base URL, never trailing-slashed; endpoints are appended as `/Endpoint`.
 */
export function resolveApiBase({ nativePlatform = false, envBase = "", envNativeBase = "" } = {}) {
  const strip = (s) => s.trim().replace(/\/+$/, "");
  if (nativePlatform) return strip(envNativeBase || PROD_API_BASE) || PROD_API_BASE;
  return strip(envBase || "/api") || "/";
}
