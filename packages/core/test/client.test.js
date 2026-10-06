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

  it("opts.silent suppresses onUnauthorized hook on 401", async () => {
    let hooked = false;
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: false, status: 401, text: async () => "{}" })),
      onUnauthorized: async () => void (hooked = true),
      now: () => NOW,
    });
    await assert.rejects(() => client.postRaw("/a", {}, { silent: true }), SessionExpiredError);
    assert.equal(hooked, false);
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

  it("concurrent 401s share one refresh and notify expiry once", async () => {
    let refreshes = 0;
    let unauthorized = 0;
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: false, status: 401, text: async () => "{}" })),
      onRefresh: async () => {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return false;
      },
      onUnauthorized: async () => {
        unauthorized++;
      },
      now: () => NOW,
    });
    await Promise.all([
      assert.rejects(() => client.post("/a", {}), SessionExpiredError),
      assert.rejects(() => client.post("/b", {}), SessionExpiredError),
    ]);
    assert.equal(refreshes, 1);
    assert.equal(unauthorized, 1);
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

  it("does not restart failed silent recovery for the same token", async () => {
    const statuses = [];
    let refreshes = 0;
    let unauthorized = 0;
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => "dead-token",
      fetchImpl: mockFetch(async () => ({ ok: false, status: 401, text: async () => "{}" })),
      onRefresh: async () => {
        refreshes++;
        return false;
      },
      onUnauthorized: async () => {
        unauthorized++;
      },
      onSessionStatusChange: (status) => statuses.push(status),
      now: () => NOW,
    });

    await assert.rejects(() => client.post("/first", {}), SessionExpiredError);
    await assert.rejects(() => client.post("/later-background-fetch", {}), SessionExpiredError);
    assert.equal(refreshes, 1);
    assert.equal(unauthorized, 1);
    assert.deepEqual(statuses, ["recovering", "expired"]);
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

  it("getPublic sends no custom headers and forwards cancellation", async () => {
    let seen;
    const controller = new AbortController();
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => "tok123",
      fetchImpl: mockFetch(async (url, init) => {
        seen = { url, init };
        return ok({ status: { responseStatus: "Success" }, response: {} });
      }),
      now: () => NOW,
    });
    await client.getPublic("/token/getcaptcha", { signal: controller.signal });
    assert.match(seen.url, /getcaptcha/);
    assert.equal(seen.init.headers.Authorization, undefined);
    assert.equal(seen.init.headers.LocalName, undefined);
    assert.equal(seen.init.headers["Content-Type"], undefined);
    assert.equal(seen.init.signal, controller.signal);
  });

  it("maps network failures to PortalError with NETWORK_ERROR code", async () => {
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => {
        throw new TypeError("Failed to fetch");
      }),
      now: () => NOW,
    });
    const err = await client.post("/a", {}).catch((e) => e);
    assert.ok(err instanceof PortalError);
    assert.equal(err.code, "NETWORK_ERROR");
  });

  it("handles 204 No Content as success with null response", async () => {
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: true, status: 204, text: async () => "" })),
      now: () => NOW,
    });
    const res = await client.post("/exam-schedule", {});
    assert.equal(res.status.responseStatus, "Success");
    assert.equal(res.response, null);
  });

  it("recovers from session-expired Failure payloads returned with HTTP 200", async () => {
    const statuses = [];
    let token = "old";
    let calls = 0;
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => token,
      fetchImpl: mockFetch(async () => {
        calls++;
        if (calls === 1) {
          return ok({ status: { responseStatus: "Failure", errors: ["Session expired! Please login again."] } });
        }
        return ok({ status: { responseStatus: "Success" }, response: { ok: true } });
      }),
      onRefresh: async () => {
        token = "new";
        return true;
      },
      onSessionStatusChange: (status) => statuses.push(status),
      now: () => NOW,
    });
    const result = await client.post("/data", {});
    assert.equal(result.response.ok, true);
    assert.deepEqual(statuses, ["recovering", "authenticated"]);
    assert.equal(calls, 2);
  });

  it("getPublic 401 is silent (no global logout hook)", async () => {
    let hooked = false;
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: false, status: 401, text: async () => "{}" })),
      onUnauthorized: async () => void (hooked = true),
      now: () => NOW,
    });
    await assert.rejects(() => client.getPublic("/token/getcaptcha"), SessionExpiredError);
    assert.equal(hooked, false);
  });

  it("signals recovering -> authenticated on successful refresh", async () => {
    const statuses = [];
    let token = "old";
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => token,
      fetchImpl: mockFetch(async (url, init) => {
        if (init.headers.Authorization === "Bearer old") return { ok: false, status: 401, text: async () => "{}" };
        return ok({ status: { responseStatus: "Success" }, response: { ok: true } });
      }),
      onRefresh: async () => {
        token = "new";
        return true;
      },
      onSessionStatusChange: (s) => statuses.push(s),
      now: () => NOW,
    });
    await client.post("/test", {});
    assert.deepEqual(statuses, ["recovering", "authenticated"]);
  });

  it("signals recovering -> expired when refresh fails", async () => {
    const statuses = [];
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: false, status: 401, text: async () => "{}" })),
      onRefresh: async () => false,
      onSessionStatusChange: (s) => statuses.push(s),
      now: () => NOW,
    });
    await assert.rejects(() => client.post("/test", {}), SessionExpiredError);
    assert.deepEqual(statuses, ["recovering", "expired"]);
  });

  it("aborts a timed-out recovery before exposing the expired state", async () => {
    const statuses = [];
    let refreshSignal;
    let unauthorized = 0;
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: false, status: 401, text: async () => "{}" })),
      onRefresh: (signal) => {
        refreshSignal = signal;
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve(false), { once: true });
        });
      },
      refreshTimeoutMs: 10,
      onSessionStatusChange: (s) => statuses.push(s),
      onUnauthorized: async () => {
        unauthorized++;
      },
      now: () => NOW,
    });

    // The production guard is unref'ed in Node; keep this unit test's loop
    // alive while it waits for the short injected timeout.
    const keepAlive = setTimeout(() => {}, 30);
    await assert.rejects(() => client.post("/test", {}), SessionExpiredError);
    clearTimeout(keepAlive);
    assert.equal(refreshSignal.aborted, true);
    assert.deepEqual(statuses, ["recovering", "expired"]);
    assert.equal(unauthorized, 1);
  });

  it("does not flash authenticated if an abandoned refresh resolves late", async () => {
    const statuses = [];
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () => ({ ok: false, status: 401, text: async () => "{}" })),
      onRefresh: () => new Promise((resolve) => setTimeout(() => resolve(true), 35)),
      refreshTimeoutMs: 5,
      onSessionStatusChange: (s) => statuses.push(s),
      now: () => NOW,
    });

    await assert.rejects(() => client.post("/test", {}), SessionExpiredError);
    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.deepEqual(statuses, ["recovering", "expired"]);
  });

  it("cancelling recovery does not mark a manually replaced session expired", async () => {
    const statuses = [];
    const calls = [];
    let token = "old";
    let recovering;
    const recoveryStarted = new Promise((resolve) => {
      recovering = resolve;
    });
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => token,
      fetchImpl: mockFetch(async (url, init) => {
        calls.push(init.headers.Authorization);
        if (init.headers.Authorization === "Bearer old") {
          return { ok: false, status: 401, text: async () => "{}" };
        }
        return ok({ status: { responseStatus: "Success" }, response: { ok: true } });
      }),
      onRefresh: (signal) => {
        if (signal.aborted) return false;
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve(false), { once: true });
        });
      },
      onSessionStatusChange: (s) => {
        statuses.push(s);
        if (s === "recovering") recovering();
      },
      now: () => NOW,
    });

    const request = client.post("/test", {});
    await recoveryStarted;
    token = "new";
    client.cancelRefresh();

    const result = await request;
    assert.equal(result.response.ok, true);
    assert.deepEqual(calls, ["Bearer old", "Bearer new"]);
    assert.deepEqual(statuses, ["recovering", "authenticated"]);
  });

  it("a late 401 reuses a sibling request's renewed token", async () => {
    let token = "old";
    let refreshes = 0;
    const calls = [];
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => token,
      fetchImpl: mockFetch(async (url, init) => {
        calls.push([url, init.headers.Authorization]);
        if (init.headers.Authorization === "Bearer old") {
          if (url.endsWith("/slow")) await new Promise((resolve) => setTimeout(resolve, 25));
          return { ok: false, status: 401, text: async () => "{}" };
        }
        return ok({ status: { responseStatus: "Success" }, response: { ok: true } });
      }),
      onRefresh: async () => {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        token = "new";
        return true;
      },
      now: () => NOW,
    });

    const [fast, slow] = await Promise.all([
      client.post("/fast", {}),
      client.post("/slow", {}),
    ]);
    assert.equal(fast.response.ok, true);
    assert.equal(slow.response.ok, true);
    assert.equal(refreshes, 1);
    assert.deepEqual(calls, [
      ["https://x/fast", "Bearer old"],
      ["https://x/slow", "Bearer old"],
      ["https://x/fast", "Bearer new"],
      ["https://x/slow", "Bearer new"],
    ]);
  });
});

