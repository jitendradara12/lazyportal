import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://app.example";

function worker({ network = async () => new Response("fresh"), failWrites = false, beforeWrite = async () => {} } = {}) {
  const listeners = new Map();
  const entries = new Map();
  const calls = [];
  const key = (request) => new URL(typeof request === "string" ? request : request.url, origin).href;
  const caches = {
    async match(request) { return entries.get(key(request))?.clone(); },
    async open() {
      return { async put(request, response) {
        await beforeWrite();
        if (failWrites) throw new Error("Quota exceeded");
        entries.set(key(request), response.clone());
      } };
    },
  };
  vm.runInNewContext(source, {
    self: { addEventListener: (name, fn) => listeners.set(name, fn) },
    location: { origin }, URL, Response, caches,
    fetch: async (request) => { calls.push(request.url); return network(request); },
  });
  return {
    calls, entries,
    seed(path, text) { entries.set(key(path), new Response(text)); },
    read(path) { return entries.get(key(path))?.clone().text(); },
    dispatch(path, { mode = "cors", method = "GET" } = {}) {
      const lifetime = [];
      let response;
      listeners.get("fetch")({
        request: { url: key(path), mode, method },
        respondWith(promise) { response = Promise.resolve(promise); },
        waitUntil(promise) { lifetime.push(promise); },
      });
      return { response, settled: () => Promise.all(lifetime) };
    },
  };
}

test("cached hashed bundles make zero network requests on repeat visits", async () => {
  const sw = worker();
  sw.seed("/assets/index-Abcd1234.js", "cached bundle");
  for (let visit = 0; visit < 20; visit++) {
    const event = sw.dispatch("/assets/index-Abcd1234.js");
    assert.equal(await (await event.response).text(), "cached bundle");
    await event.settled();
  }
  assert.equal(sw.calls.length, 0);
});

test("a new deployment's hash fetches new bytes and remains available offline", async () => {
  let online = true;
  const sw = worker({ network: async () => {
    if (!online) throw new Error("Offline");
    return new Response("new bundle");
  } });
  sw.seed("/assets/index-OldHash1.js", "old bundle");
  const fresh = sw.dispatch("/assets/index-NewHash2.js");
  assert.equal(await (await fresh.response).text(), "new bundle");
  await fresh.settled();
  online = false;
  assert.equal(await (await sw.dispatch("/assets/index-NewHash2.js").response).text(), "new bundle");
  assert.equal(sw.calls.length, 1);
});

test("unversioned assets still revalidate in the background", async () => {
  for (const path of ["/icon-512.png", "/manifest.webmanifest", "/assets/unversioned.js"]) {
    const sw = worker();
    sw.seed(path, "old");
    const event = sw.dispatch(path);
    assert.equal(await (await event.response).text(), "old");
    await event.settled();
    assert.equal(await sw.read(path), "fresh");
    assert.equal(sw.calls.length, 1);
  }
});

test("navigation stays network-first and stores the updated shell for offline use", async () => {
  let online = true;
  const sw = worker({ network: async () => {
    if (!online) throw new Error("Offline");
    return new Response("new shell");
  } });
  sw.seed("/", "old shell");
  const event = sw.dispatch("/", { mode: "navigate" });
  assert.equal(await (await event.response).text(), "new shell");
  await event.settled();
  online = false;
  assert.equal(await (await sw.dispatch("/", { mode: "navigate" }).response).text(), "new shell");
  assert.equal(await (await sw.dispatch("/other", { mode: "navigate" }).response).text(), "new shell");
});

test("cache write failures never break an online page or asset load", async () => {
  const sw = worker({ failWrites: true });
  for (const [path, mode] of [["/", "navigate"], ["/assets/index-Abcd1234.js", "cors"]]) {
    const event = sw.dispatch(path, { mode });
    assert.equal(await (await event.response).text(), "fresh");
    await event.settled();
  }
});

test("cache writes extend worker lifetime without delaying the response", async () => {
  let finishWrite;
  const pending = new Promise((resolve) => { finishWrite = resolve; });
  const sw = worker({ beforeWrite: () => pending });
  const event = sw.dispatch("/", { mode: "navigate" });
  assert.equal(await (await event.response).text(), "fresh");
  let settled = false;
  const writing = event.settled().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  finishWrite();
  await writing;
  assert.equal(await sw.read("/"), "fresh");
});

test("failed network responses are not saved as successful assets", async () => {
  const sw = worker({ network: async () => new Response("missing", { status: 404 }) });
  const path = "/assets/index-Abcd1234.js";
  const event = sw.dispatch(path);
  assert.equal((await event.response).status, 404);
  await event.settled();
  assert.equal(await sw.read(path), undefined);
});

test("API traffic and non-GET requests bypass the service worker", () => {
  const sw = worker();
  for (const [path, method] of [["/api/token/getcaptcha", "GET"], ["/api/attendance", "POST"], ["/icon.svg", "HEAD"], ["/assets/index-Abcd1234.js", "POST"]]) {
    assert.equal(sw.dispatch(path, { method }).response, undefined);
  }
  assert.equal(sw.calls.length, 0);
  assert.equal(sw.entries.size, 0);
});

test("offline cache misses return a network error rather than an invalid undefined response", async () => {
  const sw = worker({ network: async () => { throw new Error("Offline"); } });
  for (const [path, mode] of [["/", "navigate"], ["/assets/index-Abcd1234.js", "cors"]]) {
    const event = sw.dispatch(path, { mode });
    assert.equal((await event.response).type, "error");
    await event.settled();
  }
});
