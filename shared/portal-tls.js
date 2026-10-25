import { readFileSync } from "node:fs";
import tls from "node:tls";

const intermediate = readFileSync(new URL("./portal-intermediate.pem", import.meta.url), "utf8");

/** Complete JUET's missing chain link while still requiring a trusted root.
 * These options belong only to the portal agents, never global TLS defaults. */
export function portalTlsOptions({ roots = tls.getCACertificates?.("default") ?? tls.rootCertificates,
  supplemental = intermediate } = {}) {
  return {
    rejectUnauthorized: true,
    allowPartialTrustChain: false,
    ca: [...roots, supplemental],
  };
}
