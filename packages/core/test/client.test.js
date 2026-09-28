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

  it("401 refreshes once and retries with the live token", async () => {
    const calls = [];
    let token = "old";
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => token,
      fetchImpl: mockFetch(async (url, init) => {
        calls.push(init.headers.Authorization);
        if (calls.length === 1) return { ok: false, status: 401, text: async () => "{}" };
        return ok({ status: { responseStatus: "Success" }, response: { v: 1 } });
      }),
      onRefresh: async () => {
        token = "new";
        return true;
      },
      onUnauthorized: async () => {
        throw new Error("should not log out");
      },
      now: () => NOW,
    });
    const body = await client.post("/a", {});
    assert.equal(body.response.v, 1);
    assert.deepEqual(calls, ["Bearer old", "Bearer new"]);
  });

  it("concurrent 401s share one refresh", async () => {
    let refreshes = 0;
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: false, status: 401, text: async () => "{}" })),
      onRefresh: async () => {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return false;
      },
      onUnauthorized: async () => {},
      now: () => NOW,
    });
    await Promise.all([
      assert.rejects(() => client.post("/a", {}), SessionExpiredError),
      assert.rejects(() => client.post("/b", {}), SessionExpiredError),
    ]);
    assert.equal(refreshes, 1);
  });

  it("failed refresh logs out without retry", async () => {
    const calls = [];
    let hooked = false;
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async (url) => {
        calls.push(url);
        return { ok: false, status: 401, text: async () => "{}" };
      }),
      onRefresh: async () => false,
      onUnauthorized: async () => void (hooked = true),
      now: () => NOW,
    });
    await assert.rejects(() => client.post("/a", {}), SessionExpiredError);
    assert.equal(hooked, true);
    assert.equal(calls.length, 1);
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

  it("maps 200+empty body to PortalError", async () => {
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: true, status: 200, text: async () => "" })),
      now: () => NOW,
    });
    const err = await client.post("/a", {}).catch((e) => e);
    assert.ok(err instanceof PortalError);
    assert.equal(err.status, 200);
    assert.match(err.message, /HTTP 200/);
  });

  it("maps invalid JSON to PortalError", async () => {
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: true, status: 200, text: async () => "<html>not json" })),
      now: () => NOW,
    });
    const err = await client.post("/a", {}).catch((e) => e);
    assert.ok(err instanceof PortalError);
    assert.equal(err.status, 200);
    assert.match(err.message, /HTTP 200/);
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
