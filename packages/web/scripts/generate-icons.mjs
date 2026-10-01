import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

const standardSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1a237e"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="32" font-weight="700" fill="#fff" text-anchor="middle">J</text></svg>`;

const maskableSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1a237e"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="32" font-weight="700" fill="#fff" text-anchor="middle">J</text></svg>`;

const targets = [
  { file: "icon-192.png", size: 192, svg: standardSvg(192) },
  { file: "icon-512.png", size: 512, svg: standardSvg(512) },
  { file: "icon-maskable-192.png", size: 192, svg: maskableSvg(192) },
  { file: "icon-maskable-512.png", size: 512, svg: maskableSvg(512) },
  { file: "apple-touch-icon.png", size: 180, svg: maskableSvg(180) },
];

const aliases = [
  ["icon-192.png", "icon-192x192.png"],
  ["icon-512.png", "icon-512x512.png"],
  ["icon-maskable-192.png", "icon-maskable-192x192.png"],
  ["icon-maskable-512.png", "icon-maskable-512x512.png"],
  ["apple-touch-icon.png", "apple-touch-icon-180x180.png"],
];

function generateWithMagick(svgContent, outPath) {
  execFileSync("magick", ["-background", "none", "svg:-", outPath], {
    input: Buffer.from(svgContent, "utf-8"),
  });
}

function generateWithChrome(svgContent, outPath, size) {
  const tmpSvg = `${outPath}.tmp.svg`;
  fs.writeFileSync(tmpSvg, svgContent, "utf-8");
  try {
    execFileSync("google-chrome-stable", [
      "--headless=new",
      "--no-sandbox",
      `--screenshot=${outPath}`,
      `--window-size=${size},${size}`,
      "--default-background-color=00000000",
      `file://${path.resolve(tmpSvg)}`,
    ]);
  } finally {
    if (fs.existsSync(tmpSvg)) fs.unlinkSync(tmpSvg);
  }
}

// Write maskable vector svg
fs.writeFileSync(
  path.join(publicDir, "icon-maskable.svg"),
  maskableSvg(64),
  "utf-8"
);
console.log("Wrote public/icon-maskable.svg");

for (const { file, size, svg } of targets) {
  const dest = path.join(publicDir, file);
  try {
    generateWithMagick(svg, dest);
    console.log(`Generated ${file} (${size}x${size}) via ImageMagick`);
  } catch {
    generateWithChrome(svg, dest, size);
    console.log(`Generated ${file} (${size}x${size}) via Chrome`);
  }
}

for (const [src, alias] of aliases) {
  const srcPath = path.join(publicDir, src);
  const aliasPath = path.join(publicDir, alias);
  fs.copyFileSync(srcPath, aliasPath);
  console.log(`Copied alias ${alias} <- ${src}`);
}
