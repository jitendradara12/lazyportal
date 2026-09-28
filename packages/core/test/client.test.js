import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../src/client.js";
import { decrypt } from "../src/crypto.js";
import { SessionExpiredError, PortalError } from "../src/errors.js";

const NOW = new Date(2026, 8, 28);

function mockFetch(handler) {
  return async (url, init) => handler(url, init);
}
const ok = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });

describe("client", () => {
  it("encrypts body and sends Auth+LocalName", async () => {
    let seen;
    const fetchImpl = mockFetch(async (url, init) => {
      seen = { url, init };
      return ok({ status: { responseStatus: "Success" }, response: {} });
    });
    const client = createClient({
      baseUrl: "https://x/StudentPortalAPI",
      getToken: () => "tok123",
      fetchImpl,
      now: () => NOW,
    });
    await client.post("/clxuser/getmenulist", { userid: "u1" });
    assert.match(seen.url, /getmenulist/);
    assert.equal(seen.init.headers.Authorization, "Bearer tok123");
    assert.ok(seen.init.headers.LocalName.length > 10);
    const body = JSON.parse(await decrypt(seen.init.body, { now: NOW }));
    assert.equal(body.userid, "u1");
  });

  it("postRaw sends plain JSON (unencrypted endpoints)", async () => {
    let seen;
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async (url, init) => {
        seen = { url, init };
        return ok({ status: { responseStatus: "Success" }, response: {} });
      }),
      now: () => NOW,
    });
    await client.postRaw("/studentfeeledger/loadfeesummary", { instituteid: "i1" });
    assert.equal(seen.init.body, JSON.stringify({ instituteid: "i1" }));
    assert.ok(seen.init.headers.LocalName.length > 10);
  });

  it("maps 401 to SessionExpiredError and calls hook", async () => {
    let hooked = false;
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: false, status: 401, text: async () => "{}" })),
      onUnauthorized: async () => void (hooked = true),
      now: () => NOW,
    });
    await assert.rejects(() => client.post("/a", {}), SessionExpiredError);
    assert.equal(hooked, true);
  });

  it("maps Failure+captcha to PortalError with code", async () => {
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () =>
        ok({ status: { responseStatus: "Failure", errors: ["Invalid captcha submitted.."] } })
      ),
      now: () => NOW,
    });
    const err = await client.post("/token/pretoken-check", {}).catch((e) => e);
    assert.ok(err instanceof PortalError);
    assert.match(err.message, /captcha/i);
  });

  it("getPublic sends no custom headers (no CORS preflight)", async () => {    let seen;
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => "tok123",
      fetchImpl: mockFetch(async (url, init) => {
        seen = { url, init };
        return ok({ status: { responseStatus: "Success" }, response: {} });
      }),
      now: () => NOW,
    });
    await client.getPublic("/token/getcaptcha");
    assert.match(seen.url, /getcaptcha/);
    assert.equal(seen.init.headers.Authorization, undefined);
    assert.equal(seen.init.headers.LocalName, undefined);
    assert.equal(seen.init.headers["Content-Type"], undefined);
  });
});
