import test from "node:test";
import assert from "node:assert/strict";
import { isNewerVersion, fetchLatestRelease, LATEST_RELEASE_URL } from "../src/lib/appUpdates.js";

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
  assert.deepEqual(result, { version: "1.0.4", url: "https://github.com/jitendradara12/lazyportal/releases/download/v1.0.4/app-release.apk" });
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
