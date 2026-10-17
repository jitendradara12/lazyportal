import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Capacitor's errorPath serves the HTML locally, but not its relative images. */
export function offlinePage() {
  let outDir;
  return {
    name: "self-contained-offline-page",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      const htmlPath = resolve(outDir, "offline.html");
      const [html, image] = await Promise.all([
        readFile(htmlPath, "utf8"),
        readFile(resolve(outDir, "offline.jpg")),
      ]);
      const source = 'src="offline.jpg"';
      if (!html.includes(source)) {
        throw new Error("Offline page image reference changed; update its build embedding.");
      }
      await writeFile(htmlPath, html.replaceAll(source, `src="data:image/jpeg;base64,${image.toString("base64")}"`));
    },
  };
}
