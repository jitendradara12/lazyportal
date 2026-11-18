/**
 * Where API traffic goes.
 *
 * Browser builds call `/api`: same-origin, served by the Vite dev proxy
 * (vite.config.js) or the Vercel rewrite (vercel.json -> api/proxy.js). The
 * portal only accepts its own origin, so browser code must never call it
 * directly.
 *
 * Android keeps loading the live server.url deployment. New APKs use PortalHttp
 * for supported API requests. This base remains the compatibility route for
 * older APKs, newly reviewed endpoints, and explicit native development overrides.
 */

export const PROD_API_BASE = "https://lazyportal-tan.vercel.app/api";

export interface ResolveApiBaseOptions {
  nativePlatform?: boolean;
  envBase?: string;
  envNativeBase?: string;
}

export function resolveApiBase({
  nativePlatform = false,
  envBase = "",
  envNativeBase = "",
}: ResolveApiBaseOptions = {}): string {
  const strip = (s: string) => s.trim().replace(/\/+$/, "");
  if (nativePlatform) return strip(envNativeBase || PROD_API_BASE) || PROD_API_BASE;
  return strip(envBase || "/api") || "/";
}
