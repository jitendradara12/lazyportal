import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { offlinePage } from "../scripts/offline-page.mjs";

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
