import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "vite";
import config from "../vite.config.js";

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

test("disconnecting after a completed upload cancels the development proxy's upstream read", async (t) => {
  let uploaded, disconnected;
  const upload = new Promise((resolve) => { uploaded = resolve; });
  const disconnect = new Promise((resolve) => { disconnected = resolve; });
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.once("end", uploaded);
    res.once("close", disconnected);
  });
  await listen(upstream);
  const vite = await createServer({ configFile: false, appType: "custom", logLevel: "silent",
    server: { middlewareMode: true, hmr: false, ws: false, proxy: {
      "/api": { ...config.server.proxy["/api"], target: `http://127.0.0.1:${upstream.address().port}`, agent: undefined },
    } },
  });
  const downstream = http.createServer(vite.middlewares);
  await listen(downstream);
  t.after(async () => {
    downstream.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([vite.close(), new Promise((resolve) => downstream.close(resolve)), new Promise((resolve) => upstream.close(resolve))]);
  });
  const request = http.request(`http://127.0.0.1:${downstream.address().port}/api/test`, { method: "POST" });
  request.on("error", () => {});
  request.end("fixture");
  await upload;
  request.destroy();
  const cancelled = await Promise.race([disconnect.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 200))]);
  assert.equal(cancelled, true, "upstream must close when the browser stops waiting");
});
