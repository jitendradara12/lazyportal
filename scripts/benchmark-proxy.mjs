// Synthetic relay benchmark: no network, credentials, or live portal data.
// Run in separate processes to compare handlers without sharing their heaps:
// node --expose-gc scripts/benchmark-proxy.mjs [path/to/handler.mjs]
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const concurrency = positiveInteger("PROXY_BENCH_CONCURRENCY", 16);
const responseBytes = positiveInteger("PROXY_BENCH_BYTES", 2 * 1024 * 1024);
const rounds = positiveInteger("PROXY_BENCH_ROUNDS", 8);
const chunkBytes = 16 * 1024;
const handlerPath = path.resolve(process.argv[2] ?? "api/proxy.js");
const { default: handler } = await import(pathToFileURL(handlerPath).href);

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}

// One new Buffer per chunk, as with an HTTP IncomingMessage. Yield between
// chunks so requests overlap and memory sampling can observe retained bodies.
class UpstreamResponse extends Readable {
  constructor() {
    super({ highWaterMark: chunkBytes });
    this.remaining = responseBytes;
    this.statusCode = 200;
    this.headers = { "content-type": "application/json" };
  }

  _read() {
    setImmediate(() => {
      if (this.destroyed) return;
      const size = Math.min(chunkBytes, this.remaining);
      this.remaining -= size;
      this.push(size ? Buffer.alloc(size, "x") : null);
    });
  }
}

class BrowserResponse extends Writable {
  constructor() {
    super({ highWaterMark: chunkBytes });
    this.bytes = 0;
    this.statusCode = 200;
    this.headersSent = false;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  setHeader() {}

  _write(chunk, encoding, done) {
    this.headersSent = true;
    this.bytes += chunk.length;
    done(); // Discard bytes, as a browser/socket would; do not retain results.
  }

  send(body) {
    this.end(body);
  }

  json(body) {
    this.end(JSON.stringify(body));
  }
}

const originalRequest = https.request;
https.request = (options, onResponse) => {
  const request = new EventEmitter();
  request.setTimeout = () => request;
  request.write = () => true;
  request.end = () => queueMicrotask(() => onResponse(new UpstreamResponse()));
  return request;
};

try {
  // Warm up the code paths before measuring steady-state relay work.
  await runRound();
  globalThis.gc?.();
  const initial = process.memoryUsage();
  const peak = { ...initial };
  const sampleMemory = () => {
    const current = process.memoryUsage();
    for (const key of ["rss", "heapUsed", "external"]) {
      peak[key] = Math.max(peak[key], current[key]);
    }
  };
  const sampler = setInterval(sampleMemory, 5);
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  try {
    for (let round = 0; round < rounds; round++) {
      await runRound();
      sampleMemory();
    }
  } finally {
    clearInterval(sampler);
  }
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuStart);
  const mib = (bytes) => Number((bytes / 1024 / 1024).toFixed(2));
  console.log(JSON.stringify({
    handler: path.relative(process.cwd(), handlerPath),
    node: process.version,
    concurrency,
    responseMiB: mib(responseBytes),
    rounds,
    transferredMiB: mib(concurrency * rounds * responseBytes),
    elapsedMs: Number(elapsedMs.toFixed(2)),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(2)),
    sampledPeakMiB: {
      rss: mib(peak.rss),
      heapUsed: mib(peak.heapUsed),
      external: mib(peak.external),
    },
    sampledGrowthMiB: {
      rss: mib(peak.rss - initial.rss),
      heapUsed: mib(peak.heapUsed - initial.heapUsed),
      external: mib(peak.external - initial.external),
    },
  }, null, 2));
} finally {
  https.request = originalRequest;
}

async function runRound() {
  await Promise.all(Array.from({ length: concurrency }, async () => {
    const request = Readable.from([]);
    request.method = "GET";
    request.query = { path: "benchmark/read" };
    request.headers = {};
    const response = new BrowserResponse();
    await handler(request, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.bytes, responseBytes);
  }));
}
