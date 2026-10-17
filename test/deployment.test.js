import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

test("long browser caching is restricted to generated assets, leaving shell and API freshness intact", async () => {
  const immutable = config.headers.filter((route) => route.headers.some((header) =>
    header.key.toLowerCase() === "cache-control" && header.value.includes("immutable"),
  ));
  assert.equal(immutable.length, 1);
  assert.equal(immutable[0].source, "/assets/:path*");
  // Vite public files keep their names. They cannot be placed under the path
  // whose generated, content-hashed files receive immutable caching.
  await assert.rejects(access(new URL("../packages/web/public/assets", import.meta.url)), { code: "ENOENT" });
  assert.equal(config.rewrites.find((route) => route.source === "/api/:path*")?.destination, "/api/proxy?path=:path*");
});
