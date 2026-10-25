import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { once } from "node:events";
import { portalTlsOptions } from "../shared/portal-tls.js";

// Keys exist only in a temporary directory. Offline, real Node/OpenSSL chain
// and hostname validation; no account, external service, or production CA keys.
let directory, root, intermediate, leaf, expired, key;
before(() => {
  directory = mkdtempSync(join(tmpdir(), "juet-tls-"));
  const openssl = (...args) => execFileSync("openssl", args, { cwd: directory, stdio: "pipe" });
  const request = (name) => openssl("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
    "-nodes", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${name}`);
  openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "root.key",
    "-out", "root.pem", "-subj", "/CN=Temporary test root", "-days", "2",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
  request("intermediate");
  writeFileSync(join(directory, "intermediate.ext"), "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n");
  openssl("x509", "-req", "-in", "intermediate.csr", "-CA", "root.pem", "-CAkey", "root.key", "-set_serial", "2",
    "-days", "1", "-extfile", "intermediate.ext", "-out", "intermediate.pem");
  request("leaf");
  writeFileSync(join(directory, "leaf.ext"), "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:portal.test\n");
  openssl("x509", "-req", "-in", "leaf.csr", "-CA", "intermediate.pem", "-CAkey", "intermediate.key",
    "-set_serial", "3", "-days", "1", "-extfile", "leaf.ext", "-out", "leaf.pem");
  writeFileSync(join(directory, "index"), "");
  writeFileSync(join(directory, "serial"), "04\n");
  writeFileSync(join(directory, "ca.conf"), "[ca]\ndefault_ca=issuer\n[issuer]\ndatabase=index\nnew_certs_dir=.\ncertificate=intermediate.pem\nprivate_key=intermediate.key\nserial=serial\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=supplied\n");
  openssl("ca", "-batch", "-notext", "-config", "ca.conf", "-in", "leaf.csr", "-out", "expired.pem",
    "-startdate", "000101000000Z", "-enddate", "000102000000Z", "-extfile", "leaf.ext");
  const read = (name) => readFileSync(join(directory, name), "utf8");
  root = read("root.pem"); intermediate = read("intermediate.pem");
  leaf = read("leaf.pem"); expired = read("expired.pem"); key = read("leaf.key");
});
after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

async function handshake(cert, options, servername = "portal.test") {
  const server = tls.createServer({ key, cert }, (socket) => socket.end());
  server.on("tlsClientError", () => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: "127.0.0.1", port: server.address().port, servername, ...options }, () => {
        socket.end(); resolve();
      });
      socket.once("error", (error) => { socket.destroy(); reject(error); });
      socket.setTimeout(2000, () => socket.destroy(new Error("TLS test timed out")));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("supplemental intermediate repairs a missing chain without becoming a trust anchor", async () => {
  await assert.rejects(handshake(leaf, { ca: [root], rejectUnauthorized: true }));
  await handshake(leaf, portalTlsOptions({ roots: [root], supplemental: intermediate }));
  await assert.rejects(handshake(leaf, portalTlsOptions({ roots: [], supplemental: intermediate })));
  await handshake(leaf + intermediate, { ca: [root], rejectUnauthorized: true });
});

test("repaired chains still reject wrong hostnames, expired leaves and untrusted roots", async () => {
  const options = portalTlsOptions({ roots: [root], supplemental: intermediate });
  await assert.rejects(handshake(leaf, options, "wrong.test"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  await assert.rejects(handshake(expired, options), { code: "CERT_HAS_EXPIRED" });
  await assert.rejects(handshake(leaf, portalTlsOptions({ supplemental: intermediate })));
});

test("default portal TLS retains default roots and the Android certificate stays in sync", () => {
  const options = portalTlsOptions();
  const defaults = tls.getCACertificates?.("default") ?? tls.rootCertificates;
  assert.deepEqual(options.ca.slice(0, -1), [...defaults]);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.allowPartialTrustChain, false);
  assert.equal(options.ca.at(-1), readFileSync(new URL("../android/app/src/main/assets/official-portal-intermediate.pem", import.meta.url), "utf8"));
});
