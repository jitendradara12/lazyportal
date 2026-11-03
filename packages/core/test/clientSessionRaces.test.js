import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../src/client.js";
import { SessionExpiredError } from "../src/errors.js";

for (const status of [200, 401]) {
  test(`a late token-reuse response (${status}) cannot change a replacement session's status`, async () => {
    let token = "old", release, replayStarted;
    const statuses = [];
    let unauthorized = 0;
    const replaySent = new Promise((resolve) => { replayStarted = resolve; });
    const client = createClient({
      baseUrl: "https://fixture.invalid",
      getToken: () => token,
      onSessionStatusChange: (value) => statuses.push(value),
      onUnauthorized: () => { unauthorized++; },
      fetchImpl: async (_url, init) => {
        if (init.headers.Authorization === "Bearer old") {
          // A sibling has already renewed the token before this 401 arrives.
          token = "renewed";
          return new Response("", { status: 401 });
        }
        replayStarted();
        return new Promise((resolve) => { release = resolve; });
      },
    });
    const request = client.postRaw("/read", {});
    await replaySent;
    client.cancelRefresh();
    token = "replacement";
    release(new Response(JSON.stringify({ response: { ok: true } }), { status }));
    await assert.rejects(request, SessionExpiredError);
    assert.deepEqual(statuses, []);
    assert.equal(unauthorized, 0);
    assert.equal(token, "replacement");
  });
}

for (const mode of ["refresh", "token-reuse"]) {
  test(`a late ${mode} retry cannot expire a token renewed in another tab`, async () => {
    let token = "old", release, replayStarted;
    const statuses = [];
    let unauthorized = 0;
    const replaySent = new Promise((resolve) => { replayStarted = resolve; });
    const client = createClient({
      baseUrl: "https://fixture.invalid",
      getToken: () => token,
      onRefresh: mode === "refresh" ? async () => { token = "renewed"; return true; } : undefined,
      onSessionStatusChange: (status) => statuses.push(status),
      onUnauthorized: () => { unauthorized++; },
      fetchImpl: async (_url, init) => {
        if (init.headers.Authorization === "Bearer old") {
          if (mode === "token-reuse") token = "renewed";
          return new Response("", { status: 401 });
        }
        if (init.headers.Authorization === "Bearer replacement") return new Response('{"response":{"ok":true}}');
        replayStarted();
        return new Promise((resolve) => { release = resolve; });
      },
    });
    const request = client.postRaw("/read", {});
    await replaySent;
    token = "replacement";
    release(new Response("", { status: 401 }));
    if (mode === "refresh") assert.equal((await request).response.ok, true);
    else await assert.rejects(request, SessionExpiredError);
    assert.equal(statuses.includes("expired"), false);
    assert.equal(unauthorized, 0);
    assert.equal(token, "replacement");
  });
}
