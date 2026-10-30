import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { APK_DOWNLOAD_URL } from "../packages/web/src/lib/installPrompt.js";

const workflow = readFileSync(new URL("../.github/workflows/build-apk.yml", import.meta.url), "utf8");
const publishScript = workflow.split("      - name: Create or update the GitHub Release\n")[1]
  .split("        run: |\n")[1].replace(/^          /gm, "");

function publish(t, { tag = "v1.0.4", existing = false, body = "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lazyportal-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "release"));
  writeFileSync(join(dir, "release/app-release.apk"), "mock APK");
  writeFileSync(join(dir, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const entry = { args };
const notesIndex = args.indexOf("--notes-file");
if (notesIndex !== -1) entry.notes = fs.readFileSync(args[notesIndex + 1], "utf8");
fs.appendFileSync("calls.jsonl", JSON.stringify(entry) + "\\n");
if (args[1] === "view") {
  if (process.env.MOCK_EXISTING !== "true") process.exit(1);
  if (args.includes("--json")) process.stdout.write(process.env.MOCK_BODY);
}
`, { mode: 0o755 });
  const result = spawnSync("bash", ["-e", "-c", publishScript], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TAG: tag,
      GITHUB_REPOSITORY: "jitendradara12/lazyportal", MOCK_EXISTING: String(existing), MOCK_BODY: body },
  });
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
}

test("stable releases prepend permanent download links to generated notes", (t) => {
  const calls = publish(t);
  const create = calls.find(({ args }) => args[1] === "create");
  assert.ok(create.args.includes("--generate-notes"));
  assert.ok(create.args.includes("--verify-tag"));
  assert.ok(create.args.includes("release/app-release.apk"));
  assert.ok(!create.args.includes("--prerelease"));
  assert.ok(create.notes.includes(`(${APK_DOWNLOAD_URL})`));
  assert.ok(create.notes.includes("https://lazyportal-tan.vercel.app"));
});

test("prerelease notes download that build instead of the stable APK", (t) => {
  const create = publish(t, { tag: "v1.0.4-beta.1" }).find(({ args }) => args[1] === "create");
  assert.ok(create.args.includes("--prerelease"));
  assert.ok(create.notes.includes("/releases/download/v1.0.4-beta.1/app-release.apk"));
  assert.ok(!create.notes.includes("/releases/latest/"));
});

test("rerunning publication preserves written notes and adds the download links once", (t) => {
  const body = "My handwritten release notes.";
  const calls = publish(t, { existing: true, body });
  const edit = calls.find(({ notes }) => notes);
  assert.ok(edit.notes.startsWith(body));
  assert.ok(edit.notes.includes(APK_DOWNLOAD_URL));
  assert.ok(calls.some(({ args }) => args[1] === "upload" && args.includes("--clobber")));
  const rerun = publish(t, { existing: true, body: edit.notes });
  assert.ok(!rerun.some(({ notes }) => notes));
});

test("the shareable download URL temporarily redirects to the app's APK link", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.redirects.find(({ source }) => source === "/download"), {
    source: "/download", destination: APK_DOWNLOAD_URL, permanent: false,
  });
});
