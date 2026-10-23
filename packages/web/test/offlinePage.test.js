import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { offlinePage } from "../scripts/offline-page.mjs";
import vm from "node:vm";

async function offlineRuntime(fetch) {
  const html = await readFile(new URL("../public/offline.html", import.meta.url), "utf8");
  const timers = new Map(), listeners = new Map(), navigations = [], requests = [];
  let timerId = 0;
  const button = { classList: { add() {}, remove() {} }, addEventListener() {}, disabled: false };
  const sandbox = {
    navigator: { onLine: true }, AbortController,
    document: { hidden: false, getElementById: (id) => id === "retry-btn" ? button : {},
      addEventListener: (type, listener) => listeners.set(type, listener) },
    addEventListener: (type, listener) => listeners.set(type, listener),
    location: { replace: (url) => navigations.push(url) },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (...args) => { requests.push(args); return fetch(...args); },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { sandbox, timers, listeners, navigations, requests, button,
    run: (expression) => vm.runInContext(expression, context),
    tick: async () => {
      assert.equal(timers.size, 1, "one background recovery timer");
      const [id, timer] = timers.entries().next().value;
      timers.delete(id); await timer.callback();
    } };
}

test("offline recovery rejects HTTP errors and backs off instead of reloading the outage", async () => {
  const app = await offlineRuntime(() => new Response("Unavailable", { status: 503 }));
  assert.deepEqual([...app.timers.values()].map((timer) => timer.delay), [5000]);
  for (const delay of [10000, 20000, 40000, 60000, 60000]) {
    await app.tick();
    assert.deepEqual(app.navigations, []);
    assert.deepEqual([...app.timers.values()].map((timer) => timer.delay), [delay]);
  }
  assert.ok(app.requests.every(([url, options]) => url === "https://lazyportal-tan.vercel.app" &&
    options.method === "HEAD" && options.mode === "cors" && options.credentials === "omit"));
  for (const status of [404, 429, 500]) {
    const failed = await offlineRuntime(() => new Response(null, { status }));
    await failed.tick(); assert.deepEqual(failed.navigations, []);
  }
});

test("offline recovery navigates only for readable successful HTML", async () => {
  for (const response of [
    { ok: true, type: "opaque", headers: new Headers({ "content-type": "text/html" }) },
    new Response("{}", { headers: { "content-type": "application/json" } }),
  ]) {
    const app = await offlineRuntime(() => response);
    await app.tick(); assert.deepEqual(app.navigations, []);
  }
  const app = await offlineRuntime(() => new Response(null, { headers: { "content-type": "text/html; charset=utf-8" } }));
  await app.tick();
  assert.deepEqual(app.navigations, ["https://lazyportal-tan.vercel.app"]);
  assert.equal(app.timers.size, 0);
});

test("offline recovery pauses while hidden/disconnected and resumes without rapid checks", async () => {
  const app = await offlineRuntime(() => { throw new TypeError("Network unavailable"); });
  app.sandbox.document.hidden = true;
  app.listeners.get("visibilitychange")();
  assert.equal(app.timers.size, 0);
  app.sandbox.document.hidden = false;
  app.listeners.get("visibilitychange")();
  app.sandbox.navigator.onLine = false;
  app.listeners.get("offline")();
  assert.equal(app.timers.size, 0);
  app.sandbox.navigator.onLine = true;
  app.listeners.get("online")();
  assert.equal(app.requests.length, 0);
  await app.tick();
  assert.equal(app.requests.length, 1);
  assert.deepEqual(app.navigations, []);
  assert.equal(app.timers.size, 1);
});

test("manual Retry stays immediate after backoff and concurrent checks are coalesced", async () => {
  let resolve;
  const app = await offlineRuntime(() => new Promise((done) => { resolve = done; }));
  const checking = app.run("checkConnection(true)");
  await app.run("checkConnection(true)");
  assert.equal(app.requests.length, 1);
  resolve(new Response(null, { headers: { "content-type": "text/html" } }));
  await checking;
  assert.equal(app.navigations.length, 1);
});

test("static entry document exposes recovery status to Capacitor's local error origin", async () => {
  const deployment = JSON.parse(await readFile(new URL("../../../vercel.json", import.meta.url), "utf8"));
  assert.ok(deployment.headers.some((rule) => rule.source === "/" && rule.headers.some((header) =>
    header.key === "Access-Control-Allow-Origin" && header.value === "https://localhost")));
});

test("built offline page embeds the exact bundled image, requiring no image request or cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "lazyportal-offline-"));
  try {
    const outDir = join(root, "dist");
    await mkdir(outDir);
    const html = await readFile(new URL("../public/offline.html", import.meta.url), "utf8");
    const image = await readFile(new URL("../public/offline.jpg", import.meta.url));
    await writeFile(join(outDir, "offline.html"), html);
    await writeFile(join(outDir, "offline.jpg"), image);
    const plugin = offlinePage();
    plugin.configResolved({ root, build: { outDir: "dist" } });
    await plugin.writeBundle();

    const built = await readFile(join(outDir, "offline.html"), "utf8");
    const images = [...built.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)];
    assert.equal(images.length, 1);
    assert.ok(images[0][1].startsWith("data:image/jpeg;base64,"));
    assert.deepEqual(Buffer.from(images[0][1].split(",")[1], "base64"), image);
    assert.equal(built, html.replace('src="offline.jpg"', `src="${images[0][1]}"`), "only the image source changes; styling and reconnect behavior stay intact");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
