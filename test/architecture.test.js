import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { officialPortalPolicy } from "../packages/core/src/officialPortal.js";
import { portalApiPolicy } from "../packages/core/src/portalTransport.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_SRC = join(ROOT, "packages/web/src");
const CORE_SRC = join(ROOT, "packages/core/src");

const LAYER_RANK = { lib: 1, data: 1, hooks: 2, components: 3, pages: 4, sections: 4 };
const IMPORT_RE = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function listFiles(dir, exts = new Set([".ts", ".tsx", ".js"])) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.has(extname(entry.name))) out.push(full);
  }
  return out.sort();
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function toModuleKey(absPath) {
  return relative(WEB_SRC, absPath).replace(/\.tsx?$/, "").replace(/\\/g, "/");
}

test("web source keeps acyclic layering (lib/data -> hooks -> components -> pages & sections)", () => {
  const files = listFiles(WEB_SRC);
  const byKey = new Map(files.map((file) => [toModuleKey(file), file]));
  const graph = new Map();
  const upward = [];

  for (const [key, file] of byKey) {
    const edges = [];
    graph.set(key, edges);
    const srcRank = LAYER_RANK[key.split("/")[0]];
    const code = stripComments(readFileSync(file, "utf8"));
    for (const match of code.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (!spec?.startsWith(".")) continue;
      const base = toModuleKey(resolve(dirname(file), spec));
      const target = byKey.has(base) ? base : byKey.has(`${base}/index`) ? `${base}/index` : null;
      if (!target) continue;
      edges.push(target);
      const targetRank = LAYER_RANK[target.split("/")[0]];
      if (srcRank && targetRank && targetRank > srcRank) {
        upward.push(`${key} -> ${target} (move shared logic down a layer)`);
      }
    }
  }

  assert.deepEqual(upward, [], `Upward layer imports violate AGENTS.md:\n${upward.join("\n")}`);

  const visited = new Set();
  const onStack = new Set();
  const stack = [];
  const cycles = [];
  const visit = (node) => {
    visited.add(node);
    onStack.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!visited.has(next)) visit(next);
      else if (onStack.has(next)) cycles.push([...stack.slice(stack.indexOf(next)), next].join(" -> "));
    }
    stack.pop();
    onStack.delete(node);
  };
  for (const key of byKey.keys()) if (!visited.has(key)) visit(key);
  assert.deepEqual(cycles, [], `Circular imports in packages/web/src:\n${cycles.join("\n")}`);
});

test("web stays isolated from crypto, portal hostnames, endpoint paths, and slow locale formatters", () => {
  const failures = [];
  for (const file of listFiles(WEB_SRC)) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const raw = readFileSync(file, "utf8");
    const code = stripComments(raw);
    for (const match of code.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (spec && /(?:^|\/)crypto(?:\.js)?$|^node:crypto$/.test(spec)) {
        failures.push(`${rel}: imports crypto (${spec}); route crypto through @juet/core`);
      }
    }
    if (/studentportal\.juet\.ac\.in|\/StudentPortalAPI\/|\/token\/(?:getcaptcha|pretoken|generatewebtoken)/i.test(code)) {
      failures.push(`${rel}: hardcodes portal URL/endpoint; use lib/portal.ts + @juet/core features`);
    }
    if (rel !== "packages/web/src/lib/dateFormat.ts" && /\.toLocale(?:Date|Time)?String\s*\(/.test(code)) {
      failures.push(`${rel}: calls toLocale*String(); use cached formatters in lib/dateFormat.ts`);
    }
    if (/eslint-disable/.test(raw)) {
      failures.push(`${rel}: dead eslint-disable comment (repo has no ESLint)`);
    }
  }
  for (const file of listFiles(CORE_SRC)) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (/eslint-disable/.test(readFileSync(file, "utf8"))) {
      failures.push(`${rel}: dead eslint-disable comment (repo has no ESLint)`);
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("Android policy JSON assets stay in sync with @juet/core (run npm run cap:sync if changed)", () => {
  const officialAsset = JSON.parse(
    readFileSync(join(ROOT, "android/app/src/main/assets/official-portal-policy.json"), "utf8"),
  );
  const apiAsset = JSON.parse(
    readFileSync(join(ROOT, "android/app/src/main/assets/portal-api-policy.json"), "utf8"),
  );
  assert.deepEqual(officialAsset, officialPortalPolicy, "official-portal-policy.json is stale — run npm run cap:sync");
  assert.deepEqual(apiAsset, portalApiPolicy, "portal-api-policy.json is stale — run npm run cap:sync");
});
