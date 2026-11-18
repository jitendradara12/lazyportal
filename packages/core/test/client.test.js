import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "../src/client.js";
import { decrypt } from "../src/crypto.js";
import { SessionExpiredError, PortalError } from "../src/errors.js";

const NOW = new Date(2026, 8, 28);

function mockFetch(handler) {
  return async (url, init) => handler(url, init);
}
const ok = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });

describe("client", () => {
  it("authenticated PDF reads preserve bytes and retry after session recovery", async () => {
    let token = "old";
    const requests = [];
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 255]);
    const client = createClient({ baseUrl: "https://x", now: () => NOW, getToken: () => token,
      onRefresh: async () => { token = "new"; return true; },
      fetchImpl: async (url, init) => {
        requests.push(init);
        return requests.length === 1 ? new Response("", { status: 401 }) : new Response(bytes, { headers: { "content-type": "application/pdf" } });
      },
    });
    assert.deepEqual(await client.getReport("/fixture/report"), bytes);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].headers.Authorization, "Bearer new");
    assert.equal(requests[1].method, "GET");
    assert.ok(requests[1].headers.LocalName);
  });
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

  it("uses a single clock reading for LocalName and encrypted body across IST midnight", async () => {
    const beforeMidnightIst = new Date("2026-09-28T18:29:59.999Z");
    const afterMidnightIst = new Date("2026-09-28T18:30:00.001Z");
    let nowCalls = 0;
    let seen;
    const client = createClient({
      baseUrl: "https://x/StudentPortalAPI",
      getToken: () => "tok123",
      now: () => (++nowCalls === 1 ? beforeMidnightIst : afterMidnightIst),
      fetchImpl: mockFetch(async (_url, init) => {
        seen = init;
        return ok({ status: { responseStatus: "Success" }, response: {} });
      }),
    });
    await client.post("/clxuser/getmenulist", { userid: "u1" });
    assert.equal(nowCalls, 1);
    const localPlain = await decrypt(seen.headers.LocalName, { now: beforeMidnightIst });
    assert.equal(localPlain.length, 16);
    const body = JSON.parse(await decrypt(seen.body, { now: beforeMidnightIst }));
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
    await client.postRaw("/fixture/postRaw", { instituteid: "i1" });
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

  it("native and HTTP expiry share recovery, and late native expiry reuses the new token", async () => {
    let token = "old", refreshes = 0, release, readStarted;
    const readSent = new Promise((resolve) => { readStarted = resolve; });
    const statuses = [];
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => token,
      fetchImpl: mockFetch(async (_url, init) => {
        if (init.headers.Authorization === "Bearer old") {
          readStarted();
          return { status: 401 };
        }
        return ok({ response: { recovered: true } });
      }),
      onRefresh: async () => {
        refreshes++;
        await new Promise((resolve) => { release = resolve; });
        token = "new";
        return true;
      },
      onSessionStatusChange: (status) => statuses.push(status),
    });
    const native = client.recoverSession("old");
    const read = client.postRaw("/read", {});
    await readSent;
    await new Promise(setImmediate);
    release();
    assert.equal(await native, true);
    assert.equal((await read).response.recovered, true);
    assert.equal(await client.recoverSession("old"), true);
    assert.equal(refreshes, 1);
    assert.deepEqual(statuses, ["recovering", "authenticated"]);
  });

  it("native recovery failure is final for that token and cancellation leaves the new session alone", async () => {
    let refreshes = 0, unauthorized = 0, started, token = "old";
    const statuses = [];
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => token,
      onRefresh: async (signal) => {
        if (++refreshes === 1) return false;
        started();
        return new Promise((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true }));
      },
      onUnauthorized: () => { unauthorized++; },
      onSessionStatusChange: (status) => statuses.push(status),
    });
    assert.equal(await client.recoverSession(), false);
    assert.equal(await client.recoverSession(), false);
    assert.equal(refreshes, 1);
    assert.equal(unauthorized, 1);
    const recovering = new Promise((resolve) => { started = resolve; });
    client.cancelRefresh();
    const pending = client.recoverSession();
    await recovering;
    client.cancelRefresh();
    token = "replacement";
    assert.equal(await pending, false);
    assert.deepEqual(statuses, ["recovering", "expired", "recovering"]);
    assert.equal(unauthorized, 1);
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

  it("normalizes string status.errors payloads without slicing first character", async () => {
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () =>
        ok({ status: { responseStatus: "Failure", errors: "Invalid captcha submitted." } })
      ),
      now: () => NOW,
    });
    const err = await client.post("/token/pretoken-check", {}).catch((e) => e);
    assert.equal(err.code, "CAPTCHA_INVALID");
    assert.equal(err.message, "Invalid captcha submitted.");

    const plainClient = createClient({
      baseUrl: "https://x",
      fetchImpl: mockFetch(async () =>
        ok({ status: { responseStatus: "Failure", errors: "Custom portal failure" } })
      ),
      now: () => NOW,
    });
    const plainErr = await plainClient.post("/a", {}).catch((e) => e);
    assert.equal(plainErr.message, "Custom portal failure");
    assert.deepEqual(plainErr.errors, ["Custom portal failure"]);
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
    assert.equal(seen.init.signal.aborted, false);
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

  it("does not remain recovering if an aborted request observes a token changed elsewhere", async () => {
    const statuses = [];
    const requestController = new AbortController();
    let token = "old";
    let calls = 0;
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => token,
      fetchImpl: mockFetch(async (url, init) => {
        calls++;
        if (calls === 1) return { ok: false, status: 401, text: async () => "{}" };
        if (init.signal?.aborted) {
          const error = new Error("request aborted");
          error.name = "AbortError";
          throw error;
        }
        return ok({ status: { responseStatus: "Success" }, response: {} });
      }),
      onRefresh: async () => {
        token = "renewed-elsewhere";
        requestController.abort();
        return false;
      },
      onSessionStatusChange: (status) => statuses.push(status),
      now: () => NOW,
    });

    await assert.rejects(
      () => client.post("/test", {}, { signal: requestController.signal }),
      (error) => error.name === "AbortError",
    );
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
    assert.deepEqual(
      calls.slice(0, 2).sort((a, b) => a[0].localeCompare(b[0])),
      [
        ["https://x/fast", "Bearer old"],
        ["https://x/slow", "Bearer old"],
      ]
    );
    assert.deepEqual(calls.slice(2), [
      ["https://x/fast", "Bearer new"],
      ["https://x/slow", "Bearer new"],
    ]);
  });

  for (const makeTransient of [
    () => new PortalError("You are offline.", { code: "NETWORK_ERROR" }),
    () => new PortalError("JUET's portal took too long to respond. Please retry.", { code: "REQUEST_TIMEOUT" }),
    () => Object.assign(new Error("Transport aborted"), { name: "AbortError" }),
  ]) {
    it(`transient refresh failure (${makeTransient().code || makeTransient().name}) does not pin failedAuthorization or expire session`, async () => {
      let token = "old";
      let refreshes = 0;
      let unauthorized = 0;
      const statuses = [];
      const client = createClient({
        baseUrl: "https://x",
        getToken: () => token,
        fetchImpl: mockFetch(async (_url, init) => {
          if (init.headers.Authorization === "Bearer old") {
            return { ok: false, status: 401, text: async () => "{}" };
          }
          return ok({ status: { responseStatus: "Success" }, response: { ok: true } });
        }),
        onRefresh: async () => {
          refreshes++;
          if (refreshes === 1) throw makeTransient();
          token = "new";
          return true;
        },
        onUnauthorized: () => {
          unauthorized++;
        },
        onSessionStatusChange: (status) => statuses.push(status),
        now: () => NOW,
      });

      const firstErr = await client.post("/first", {}).catch((e) => e);
      assert.notEqual(firstErr.name, "SessionExpiredError");
      assert.equal(unauthorized, 0);
      assert.deepEqual(statuses, ["recovering", "authenticated"]);

      const recovered = await client.post("/retry", {});
      assert.equal(recovered.response.ok, true);
      assert.equal(refreshes, 2);
      assert.equal(unauthorized, 0);
      assert.deepEqual(statuses, ["recovering", "authenticated", "recovering", "authenticated"]);
    });
  }

  it("recoverSession after a transient refresh failure can retry once connectivity returns", async () => {
    let token = "old";
    let refreshes = 0;
    let unauthorized = 0;
    const statuses = [];
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => token,
      onRefresh: async () => {
        refreshes++;
        if (refreshes === 1) throw new PortalError("You are offline.", { code: "NETWORK_ERROR" });
        token = "new";
        return true;
      },
      onUnauthorized: () => {
        unauthorized++;
      },
      onSessionStatusChange: (status) => statuses.push(status),
      now: () => NOW,
    });

    assert.equal(await client.recoverSession("old"), false);
    assert.equal(unauthorized, 0);
    assert.deepEqual(statuses, ["recovering", "authenticated"]);

    assert.equal(await client.recoverSession("old"), true);
    assert.equal(refreshes, 2);
    assert.equal(unauthorized, 0);
    assert.deepEqual(statuses, ["recovering", "authenticated", "recovering", "authenticated"]);
  });

  it("non-transient error thrown by onRefresh still expires and pins the token", async () => {
    let refreshes = 0;
    let unauthorized = 0;
    const statuses = [];
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => "bad-token",
      fetchImpl: mockFetch(async () => ({ ok: false, status: 401, text: async () => "{}" })),
      onRefresh: async () => {
        refreshes++;
        throw new PortalError("Wrong password");
      },
      onUnauthorized: () => {
        unauthorized++;
      },
      onSessionStatusChange: (status) => statuses.push(status),
      now: () => NOW,
    });

    await assert.rejects(() => client.post("/first", {}), SessionExpiredError);
    await assert.rejects(() => client.post("/second", {}), SessionExpiredError);
    assert.equal(refreshes, 1);
    assert.equal(unauthorized, 1);
    assert.deepEqual(statuses, ["recovering", "expired"]);
  });
});


describe("request deadlines", () => {
  for (const method of ["post", "postRaw", "getPublic", "getReport"]) {
    it(`${method} times out and aborts a transport that never settles`, async () => {
      let signal;
      const client = createClient({ baseUrl: "https://x", requestTimeoutMs: 10,
        fetchImpl: async (_url, init) => { signal = init.signal; return new Promise(() => {}); },
      });
      const read = method === "post" || method === "postRaw" ? client[method]("/hung", {}) : client[method]("/hung");
      await assert.rejects(read, (error) => error.code === "REQUEST_TIMEOUT");
      assert.equal(signal.aborted, true);
    });
  }

  it("bounds response body reads as well as waiting for headers", async () => {
    const client = createClient({ baseUrl: "https://x", requestTimeoutMs: 10,
      fetchImpl: async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) }),
    });
    await assert.rejects(client.getPublic("/hung-body"), (error) => error.code === "REQUEST_TIMEOUT");
  });

  it("caller cancellation settles even when the transport ignores its signal", async () => {
    const controller = new AbortController();
    const client = createClient({ baseUrl: "https://x", requestTimeoutMs: 100,
      fetchImpl: async () => new Promise(() => {}),
    });
    const read = client.getPublic("/cancel", { signal: controller.signal });
    controller.abort();
    await assert.rejects(read, (error) => error.name === "AbortError");
  });

  it("session recovery has its own deadline and the replay gets a fresh request deadline", async () => {
    let calls = 0;
    const statuses = [];
    const client = createClient({ baseUrl: "https://x", requestTimeoutMs: 10, refreshTimeoutMs: 100,
      onRefresh: async () => { await new Promise((resolve) => setTimeout(resolve, 25)); return true; },
      onSessionStatusChange: (status) => statuses.push(status),
      fetchImpl: async () => ++calls === 1 ? { status: 401 } : ok({ response: { fresh: true } }),
    });
    assert.equal((await client.getReport("/recover")).response.fresh, true);
    assert.deepEqual(statuses, ["recovering", "authenticated"]);
  });

  it("aborted signal without reason property rejects with standard AbortError during refresh recovery", async () => {
    const emitter = new EventTarget();
    const mockSignal = {
      aborted: false,
      reason: undefined,
      addEventListener: emitter.addEventListener.bind(emitter),
      removeEventListener: emitter.removeEventListener.bind(emitter),
    };
    let signalRefreshStarted;
    const refreshStarted = new Promise((resolve) => { signalRefreshStarted = resolve; });
    let releaseRefresh;
    const client = createClient({
      baseUrl: "https://x",
      getToken: () => "t1",
      onRefresh: () => {
        signalRefreshStarted();
        return new Promise((resolve) => { releaseRefresh = () => resolve(false); });
      },
      fetchImpl: async () => ({ status: 401 }),
    });
    const req = client.postRaw("/test", {}, { signal: mockSignal });
    await refreshStarted;
    mockSignal.aborted = true;
    emitter.dispatchEvent(new Event("abort"));
    await assert.rejects(
      req,
      (err) => err && (err.name === "AbortError" || err.code === "ABORT_ERR")
    );
    releaseRefresh?.();
  });

  it("response body stream read failure maps to NETWORK_ERROR PortalError", async () => {
    const client = createClient({
      baseUrl: "https://x",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => { throw new Error("Premature stream closure"); },
      }),
    });
    await assert.rejects(
      client.getPublic("/stream-break"),
      (err) => err instanceof PortalError && err.code === "NETWORK_ERROR"
    );
  });

  it("keeps the Node event loop alive until requestTimeoutMs fires", async () => {
    // Regression test for Node 22 node:test beforeExit failures when safeFetch
    // unrefs its deadline timer while awaiting a promise-only transport.
    const clientUrl = new URL("../src/client.js", import.meta.url).href;
    const script = [
      `import { createClient } from ${JSON.stringify(clientUrl)};`,
      `process.exitCode = 1;`,
      `const client = createClient({ baseUrl: "https://x", requestTimeoutMs: 15, fetchImpl: () => new Promise(() => {}) });`,
      `try {`,
      `  await client.getPublic("/hung");`,
      `} catch (err) {`,
      `  if (err?.code === "REQUEST_TIMEOUT") { process.exitCode = 0; console.log(err.code); }`,
      `}`,
    ].join("\n");
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script]);
    assert.equal(stdout.trim(), "REQUEST_TIMEOUT");
  });
});
