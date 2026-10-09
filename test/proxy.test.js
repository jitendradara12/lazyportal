import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import https from "node:https";
import { PassThrough, Readable, Writable } from "node:stream";
import { setImmediate as nextTurn } from "node:timers/promises";
import handler, { config, maxDuration } from "../api/proxy.js";
import { WEBVIEW_ORIGIN } from "../shared/cors.js";

function request({ method = "GET", chunks = [], headers = {}, query = {} } = {}) {
  return Object.assign(Readable.from(chunks), {
    method,
    headers,
    query: { path: "StudentClassAttendance/detail", ...query },
  });
}

class Response extends Writable {
  constructor({ holdWrites = false } = {}) {
    super({ highWaterMark: 16 * 1024 });
    this.headers = {};
    this.headersSent = false;
    this.statusCode = 200;
    this.chunks = [];
    this.jsonCalls = 0;
    this.holdWrites = holdWrites;
    this.pendingWrites = [];
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  setHeader(name, value) {
    assert.equal(this.headersSent, false, "headers must precede response bytes");
    this.headers[name.toLowerCase()] = value;
  }

  _write(chunk, encoding, done) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    if (this.holdWrites) this.pendingWrites.push(done);
    else done();
    this.emit("chunk", chunk);
  }

  releaseWrites() {
    this.holdWrites = false;
    for (const done of this.pendingWrites.splice(0)) done();
  }

  json(body) {
    this.jsonCalls++;
    this.end(JSON.stringify(body));
    return this;
  }

  get body() {
    return Buffer.concat(this.chunks);
  }
}

function upstream({ chunks = [], status = 200, headers = {} } = {}) {
  return Object.assign(Readable.from(chunks), { statusCode: status, headers });
}

// Mock only the remote transport. Real Node streams exercise backpressure,
// completion, errors, and cancellation; no live portal/network is involved.
function mockTransport(t, respond = (call) => call.respond(upstream())) {
  const calls = [];
  t.mock.method(https, "request", (options, onResponse) => {
    const client = new EventEmitter();
    client.destroyed = false;
    const call = {
      options,
      client,
      body: undefined,
      response: undefined,
      timeoutMs: undefined,
      timeout: undefined,
      respond(response) {
        this.response = response;
        response.once("error", () => {}); // Also safe if cancelled before pipe setup.
        response.once("close", cleanup);
        if (client.destroyed) response.destroy();
        else onResponse(response);
      },
    };
    const onAbort = () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      error.code = "ABORT_ERR";
      client.destroy(error);
    };
    const cleanup = () => options.signal?.removeEventListener("abort", onAbort);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    client.once("close", cleanup);
    client.setTimeout = (ms, callback) => {
      call.timeoutMs = ms;
      call.timeout = callback;
      return client;
    };
    client.end = (body) => {
      call.body = body;
      queueMicrotask(() => {
        if (!client.destroyed) respond(call);
      });
      return client;
    };
    client.destroy = (error = new Error("request destroyed")) => {
      if (client.destroyed) return client;
      client.destroyed = true;
      call.response?.destroy(error);
      client.emit("error", error);
      client.emit("close");
      return client;
    };
    calls.push(call);
    return client;
  });
  return calls;
}

test("proxy streams bytes before upstream completion and awaits final delivery", async (t) => {
  const remote = Object.assign(new PassThrough(), {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  mockTransport(t, (call) => call.respond(remote));
  const req = request();
  const res = new Response();
  let completed = false;
  const pending = handler(req, res).then(() => { completed = true; });
  const firstChunk = once(res, "chunk");
  remote.write('{"response":');
  await firstChunk;
  assert.equal(res.body.toString(), '{"response":');
  assert.equal(remote.readableEnded, false);
  assert.equal(completed, false);

  remote.end('{"name":"छात्र 😀"}}');
  await pending;
  assert.equal(res.body.toString(), '{"response":{"name":"छात्र 😀"}}');
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(res.writableFinished, true);
  assert.equal(req.listenerCount("aborted"), 0);
});

test("slow downstream applies backpressure instead of retaining the full response", async (t) => {
  const chunkSize = 16 * 1024;
  const totalChunks = 128;
  let produced = 0;
  const remote = Object.assign(new Readable({
    highWaterMark: chunkSize,
    read() {
      this.push(produced++ < totalChunks ? Buffer.alloc(chunkSize, "x") : null);
    },
  }), { statusCode: 200, headers: {} });
  mockTransport(t, (call) => call.respond(remote));
  const res = new Response({ holdWrites: true });
  const firstChunk = once(res, "chunk");
  const pending = handler(request(), res);
  await firstChunk;
  await nextTurn();
  assert.ok(produced < 10, `only stream buffers should fill, produced ${produced} chunks`);
  assert.equal(res.chunks.length, 1);
  assert.equal(remote.readableEnded, false);

  res.releaseWrites();
  await pending;
  assert.equal(res.body.length, chunkSize * totalChunks);
  assert.equal(res.headers["content-type"], "application/json");
});

test("POST preserves split UTF-8 bytes and recomputes the exact Content-Length", async (t) => {
  const payload = Buffer.from('{"name":"café छात्र 😀"}');
  const calls = mockTransport(t);
  await handler(request({
    method: "POST",
    chunks: [payload.subarray(0, 13), payload.subarray(13, 19), payload.subarray(19)],
    headers: { "content-length": "999", "content-type": "application/json" },
  }), new Response());
  assert.ok(Buffer.isBuffer(calls[0].body));
  assert.deepEqual(calls[0].body, payload);
  assert.equal(calls[0].options.headers["content-length"], payload.length);
});

test("one-chunk POST does not allocate another copy of the request body", async (t) => {
  const payload = Buffer.from('"encrypted-payload"');
  const calls = mockTransport(t);
  await handler(request({ method: "POST", chunks: [payload] }), new Response());
  assert.equal(calls[0].body, payload);
});

test("empty POST does not send a spurious body or client-supplied Content-Length", async (t) => {
  const calls = mockTransport(t);
  await handler(request({ method: "POST", headers: { "content-length": "123" } }), new Response());
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].options.headers["content-length"], undefined);
});

test("GET and HEAD never consume a request body; HEAD/204 complete with no bytes", async (t) => {
  const calls = mockTransport(t, (call) => call.respond(upstream({ status: 204 })));
  for (const method of ["GET", "HEAD"]) {
    const req = request({ method });
    req._read = () => { throw new Error("must not consume this body"); };
    const res = new Response();
    await handler(req, res);
    assert.equal(res.statusCode, 204);
    assert.equal(res.body.length, 0);
    assert.equal(res.writableFinished, true);
  }
  assert.ok(calls.every((call) => call.body === undefined));
});

test("forwarding preserves auth/custom headers and drops infrastructure/hop-by-hop headers", async (t) => {
  const calls = mockTransport(t);
  const req = request({
    headers: {
      authorization: "Bearer student-token",
      localname: "encrypted-localname",
      cookie: "portal-session=student",
      "user-agent": "Lazyportal",
      accept: "application/custom+json",
      "x-custom": "keep-me",
      host: "deployment.example",
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      "transfer-encoding": "chunked",
      te: "trailers",
      trailer: "x-trailer",
      via: "proxy",
      upgrade: "websocket",
      expect: "100-continue",
      "proxy-authenticate": "Basic",
      "proxy-authorization": "Basic secret",
      "cdn-loop": "vercel",
      "accept-encoding": "gzip, br",
      origin: WEBVIEW_ORIGIN,
      referer: `${WEBVIEW_ORIGIN}/`,
      forwarded: "for=client",
      "x-forwarded-for": "client-ip",
      "x-forwarded-host": "deployment.example",
      "x-vercel-id": "infra",
      "x-real-ip": "client-ip",
    },
    query: { lang: "en US" },
  });
  const res = new Response();
  await handler(req, res);
  assert.deepEqual(calls[0].options.headers, {
    Origin: "https://studentportal.juet.ac.in",
    Referer: "https://studentportal.juet.ac.in/studentportal/",
    "Accept-Encoding": "identity",
    authorization: "Bearer student-token",
    localname: "encrypted-localname",
    cookie: "portal-session=student",
    "user-agent": "Lazyportal",
    accept: "application/custom+json",
    "x-custom": "keep-me",
  });
  assert.equal(calls[0].options.hostname, "studentportal.juet.ac.in");
  assert.equal(calls[0].options.path, "/StudentPortalAPI/StudentClassAttendance/detail?lang=en+US");
  assert.equal(calls[0].options.rejectUnauthorized, false);
  assert.equal(res.headers["access-control-allow-origin"], WEBVIEW_ORIGIN);
  assert.equal(res.headers.vary, "Origin");
});

test("upstream status and cookies are relayed without sharing or caching student responses", async (t) => {
  const calls = mockTransport(t, (call) => call.respond(upstream({
    status: 401,
    headers: {
      "content-type": "application/json",
      "set-cookie": [
        "session=student; Domain=studentportal.juet.ac.in; Path=/StudentPortalAPI; HttpOnly; Secure",
        "other=1; domain=.juet.ac.in; path=/studentportal/; SameSite=Lax",
      ],
    },
    chunks: [Buffer.from('{"message":"expired"}')],
  })));
  for (let i = 0; i < 2; i++) {
    const res = new Response();
    await handler(request(), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.toString(), '{"message":"expired"}');
    assert.deepEqual(res.headers["set-cookie"], [
      "session=student; Path=/; HttpOnly; Secure",
      "other=1; Path=/; SameSite=Lax",
    ]);
  }
  assert.equal(calls.length, 2, "each call still goes upstream");
});

test("warm/concurrent requests share a bounded idle connection pool, not an active-request limit", async (t) => {
  const calls = mockTransport(t);
  await Promise.all(Array.from({ length: 4 }, () => handler(request(), new Response())));
  const agent = calls[0].options.agent;
  assert.ok(agent instanceof https.Agent);
  assert.equal(agent.keepAlive, true);
  assert.equal(agent.maxFreeSockets, 8);
  assert.equal(agent.options.timeout, 5000);
  assert.equal(agent.maxSockets, Infinity);
  for (const call of calls) {
    assert.equal(call.options.agent, agent);
    assert.equal(call.timeoutMs, 45000);
    assert.equal(call.options.signal.aborted, false, "normal completion must not abort the pooled socket");
    assert.equal(call.options.headers.Accept, "application/json");
  }
  assert.equal(new Set(calls.map((call) => call.options.signal)).size, calls.length);
  assert.equal(config.api.bodyParser, false);
  assert.equal(config.supportsResponseStreaming, true);
  assert.equal(maxDuration, 60);
});

test("connection errors still produce the existing bounded 502 JSON response", async (t) => {
  t.mock.method(console, "error", () => {});
  const detail = "unreachable ".repeat(40);
  mockTransport(t, (call) => call.client.destroy(new Error(detail)));
  const res = new Response();
  await handler(request({ headers: { origin: WEBVIEW_ORIGIN } }), res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(JSON.parse(res.body), {
    status: { responseStatus: "Failure" },
    message: "Upstream unreachable",
    detail: detail.slice(0, 200),
  });
  assert.equal(res.headers["access-control-allow-origin"], WEBVIEW_ORIGIN);
  assert.equal(console.error.mock.calls.length, 1);
});

test("the unchanged upstream inactivity timeout destroys the request and returns 502", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls = mockTransport(t, (call) => call.timeout());
  const res = new Response();
  await handler(request(), res);
  assert.equal(calls[0].timeoutMs, 45000);
  assert.equal(calls[0].client.destroyed, true);
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).detail, "upstream timeout");
});

test("a downstream disconnect while waiting for headers cancels upstream work", async (t) => {
  t.mock.method(console, "error", () => {});
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const calls = mockTransport(t, () => started());
  const req = request();
  const res = new Response();
  const pending = handler(req, res);
  await ready;
  res.destroy();
  await pending;
  assert.equal(calls[0].client.destroyed, true);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(res.jsonCalls, 0);
  assert.equal(req.listenerCount("aborted"), 0);
  assert.equal(console.error.mock.calls.length, 0);
});

test("a downstream disconnect during streaming cancels the upstream body", async (t) => {
  t.mock.method(console, "error", () => {});
  const remote = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
  const calls = mockTransport(t, (call) => call.respond(remote));
  const res = new Response();
  const firstChunk = once(res, "chunk");
  const pending = handler(request(), res);
  remote.write("partial response");
  await firstChunk;
  res.destroy();
  await pending;
  assert.equal(remote.destroyed, true);
  assert.equal(calls[0].client.destroyed, true);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(res.jsonCalls, 0);
  assert.equal(console.error.mock.calls.length, 0);
});

test("mid-stream upstream failures terminate the response without appending error JSON", async (t) => {
  t.mock.method(console, "error", () => {});
  const remote = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
  mockTransport(t, (call) => call.respond(remote));
  const res = new Response();
  const firstChunk = once(res, "chunk");
  const pending = handler(request(), res);
  remote.write('{"partial":');
  await firstChunk;
  remote.destroy(new Error("upstream connection reset"));
  await pending;
  assert.equal(res.destroyed, true);
  assert.equal(res.jsonCalls, 0);
  assert.equal(res.body.toString(), '{"partial":');
  assert.equal(console.error.mock.calls.length, 1);
});

test("an aborted POST upload never opens an upstream request", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls = mockTransport(t);
  const req = Object.assign(new PassThrough(), {
    method: "POST", headers: {}, query: { path: "token/generatewebtoken" },
  });
  const res = new Response();
  const pending = handler(req, res);
  req.write("partial upload");
  await nextTurn();
  req.aborted = true;
  req.emit("aborted");
  req.destroy(new Error("upload aborted"));
  await pending;
  assert.equal(calls.length, 0);
  assert.equal(res.jsonCalls, 0);
  assert.equal(req.listenerCount("aborted"), 0);
  assert.equal(console.error.mock.calls.length, 0);
});
