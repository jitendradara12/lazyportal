import test from "node:test";
import assert from "node:assert/strict";
import {
  isNewerVersion,
  fetchLatestRelease,
  LATEST_RELEASE_URL,
  getSharedAppUpdateCheck,
  resetSharedAppUpdateCheck,
  isUpdatePromptDismissed,
  dismissUpdatePrompt,
} from "../src/lib/appUpdates.ts";

test("compares numeric release versions without suggesting downgrades", () => {
  for (const [installed, latest, expected] of [
    ["1.0.3", "1.0.4", true], ["1.0.9", "1.0.10", true],
    ["0.3", "0.4", true], ["v1.0.4", "1.0.4", false],
    ["1.0.4", "1.0.3", false], ["2.0.0", "1.99.99", false],
    ["1.0.4-beta.1", "1.0.4", true], ["1.0.5-beta.1", "1.0.4", false],
    ["1.0.4+build.1", "1.0.4", false], [null, "1.0.4", null],
    ["unknown", "1.0.4", null], ["1.0.3", "1.0.4-beta.1", null],
  ]) assert.equal(isNewerVersion(installed, latest), expected, `${installed} -> ${latest}`);
});

const release = { tag_name: "v1.0.4", draft: false, prerelease: false,
  assets: [{ name: "app-release.apk", state: "uploaded" }] };

test("reads a public release and pins the download to the displayed version", async () => {
  const result = await fetchLatestRelease(async (url, options) => {
    assert.equal(url, LATEST_RELEASE_URL);
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true, json: async () => release };
  });
  assert.deepEqual(result, {
    tag: "v1.0.4",
    version: "1.0.4",
    url: "https://github.com/jitendradara12/lazyportal/releases/download/v1.0.4/app-release.apk",
    sha256: null,
  });
});

test("extracts a valid sha256 asset digest and ignores missing or malformed digests", async () => {
  const upperHash = "A".repeat(64);
  const withDigest = {
    ...release,
    assets: [{ name: "app-release.apk", state: "uploaded", digest: `sha256:${upperHash}` }],
  };
  const valid = await fetchLatestRelease(async () => ({ ok: true, json: async () => withDigest }));
  assert.deepEqual(valid, {
    tag: "v1.0.4",
    version: "1.0.4",
    url: "https://github.com/jitendradara12/lazyportal/releases/download/v1.0.4/app-release.apk",
    sha256: "a".repeat(64),
  });

  for (const digest of [null, "", "sha256:short", "md5:" + "0".repeat(32)]) {
    const malformed = { ...release, assets: [{ name: "app-release.apk", state: "uploaded", digest }] };
    const result = await fetchLatestRelease(async () => ({ ok: true, json: async () => malformed }));
    assert.equal(result.sha256, null);
  }
});

test("rejects failed checks and releases without a usable stable APK", async () => {
  await assert.rejects(fetchLatestRelease(async () => ({ ok: false, status: 403 })));
  await assert.rejects(fetchLatestRelease(async () => { throw new Error("Offline"); }));
  for (const value of [null, { ...release, prerelease: true }, { ...release, draft: true },
    { ...release, tag_name: "garbage" }, { ...release, tag_name: "v1.0.4-beta.1" },
    { ...release, assets: [] }, { ...release, assets: [{ name: "app-release.apk", state: "new" }] }]) {
    await assert.rejects(fetchLatestRelease(async () => ({ ok: true, json: async () => value })));
  }
});

test("shared update check caches installed version across retries and dismisses per target version", async () => {
  resetSharedAppUpdateCheck();
  let versionCalls = 0;
  let releaseCalls = 0;
  const readVersion = async () => { versionCalls++; return "1.0.3"; };

  const first = await getSharedAppUpdateCheck(readVersion, async () => {
    releaseCalls++;
    return { ok: false, status: 503 };
  });
  assert.equal(first[0], "1.0.3");
  assert.equal(first[1], null);

  const second = await getSharedAppUpdateCheck(readVersion, async () => {
    releaseCalls++;
    return { ok: true, json: async () => release };
  });
  assert.equal(second[0], "1.0.3");
  assert.equal(second[1]?.version, "1.0.4");
  assert.equal(versionCalls, 1);
  assert.equal(releaseCalls, 2);

  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
  };
  assert.equal(isUpdatePromptDismissed("1.0.4"), false);
  dismissUpdatePrompt("1.0.4");
  assert.equal(isUpdatePromptDismissed("1.0.4"), true);
  assert.equal(isUpdatePromptDismissed("1.0.5"), false);
});
