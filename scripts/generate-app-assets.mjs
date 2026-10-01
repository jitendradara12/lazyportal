#!/usr/bin/env node
/**
 * Android launcher icons + splash screens, derived from the committed web
 * assets (packages/web/public/*.png) so the installed app matches the PWA icon.
 *
 * Why not @capacitor/assets: its bundled sharp downloads libvips from GitHub at
 * install time, which fails behind TLS-inspecting proxies and mirrors. sharp
 * ≥0.33 ships libvips as a normal npm dependency, and the glyph here is lifted
 * from the already-rendered brand PNG instead of re-rendering SVG text — so this
 * needs no fonts, no ImageMagick, and produces the same bytes everywhere.
 *
 * Usage: npm run cap:assets   (then npm run cap:sync)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "packages/web/public");
const resDir = path.join(root, "android/app/src/main/res");

// Mirrors packages/web/public/icon.svg (background) and its white glyph.
const NAVY = { r: 0x1a, g: 0x23, b: 0x7e, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// Launcher icons are 48dp; adaptive foregrounds are the full 108dp canvas
// (66dp of which stay visible after the launcher's mask).
const DENSITIES = [
  { dir: "mdpi", icon: 48, foreground: 108 },
  { dir: "hdpi", icon: 72, foreground: 162 },
  { dir: "xhdpi", icon: 96, foreground: 216 },
  { dir: "xxhdpi", icon: 144, foreground: 324 },
  { dir: "xxxhdpi", icon: 192, foreground: 432 },
];

// Same pixel sizes Capacitor's template ships, so nothing changes layout.
const SPLASHES = [
  ["drawable/splash.png", 480, 320],
  ["drawable-land-mdpi/splash.png", 480, 320],
  ["drawable-land-hdpi/splash.png", 800, 480],
  ["drawable-land-xhdpi/splash.png", 1280, 720],
  ["drawable-land-xxhdpi/splash.png", 1600, 960],
  ["drawable-land-xxxhdpi/splash.png", 1920, 1280],
  ["drawable-port-mdpi/splash.png", 320, 480],
  ["drawable-port-hdpi/splash.png", 480, 800],
  ["drawable-port-xhdpi/splash.png", 720, 1280],
  ["drawable-port-xxhdpi/splash.png", 960, 1600],
  ["drawable-port-xxxhdpi/splash.png", 1280, 1920],
];

const iconPath = path.join(publicDir, "icon-512.png");
const maskablePath = path.join(publicDir, "icon-maskable-512.png");

if (!fs.existsSync(resDir)) {
  console.error("android/ is missing — run `npx cap add android` first.");
  process.exit(1);
}
for (const p of [iconPath, maskablePath]) {
  if (!fs.existsSync(p)) {
    console.error(`Missing source asset ${path.relative(root, p)} — run \`npm --workspace @juet/web run generate-icons\`.`);
    process.exit(1);
  }
}

/**
 * White glyph on transparency, un-mixed from the maskable icon (white glyph on
 * #1a237e). The green channel is linear between the two, so it doubles as
 * coverage for the antialiased edges.
 */
async function extractGlyph() {
  const { data, info } = await sharp(maskablePath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const green = data[i * 3 + 1];
    const coverage = (green - NAVY.g) / (0xff - NAVY.g);
    out[i * 4] = 0xff;
    out[i * 4 + 1] = 0xff;
    out[i * 4 + 2] = 0xff;
    out[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, coverage)) * 0xff);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** Glyph scaled to `height` px, trimmed so centring is predictable. */
async function glyphAt(glyph, height) {
  return sharp(glyph).trim().resize({ height, fit: "contain", background: TRANSPARENT }).png().toBuffer();
}

async function write(file, pipeline) {
  const dest = path.join(resDir, file);
  await pipeline.toFile(dest);
  console.log(`  ${path.relative(root, dest)}`);
}

const glyph = await extractGlyph();
const maskable = await sharp(maskablePath).ensureAlpha().png().toBuffer();

console.log("Launcher icons:");
for (const { dir, icon, foreground } of DENSITIES) {
  // Legacy icon (API < 26 launchers): same art as the PWA icon.
  await write(
    `mipmap-${dir}/ic_launcher.png`,
    sharp(iconPath).resize(icon, icon, { fit: "contain", background: TRANSPARENT })
  );

  // Round variant: circular crop of the full-bleed art.
  const circle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${icon}" height="${icon}"><circle cx="${icon / 2}" cy="${icon / 2}" r="${icon / 2}" fill="#fff"/></svg>`
  );
  await write(
    `mipmap-${dir}/ic_launcher_round.png`,
    sharp(maskable).resize(icon, icon).composite([{ input: circle, blend: "dest-in" }])
  );

  // Adaptive foreground: glyph alone, centred inside the 66dp safe zone.
  await write(
    `mipmap-${dir}/ic_launcher_foreground.png`,
    sharp({ create: { width: foreground, height: foreground, channels: 4, background: TRANSPARENT } })
      .composite([{ input: await glyphAt(glyph, Math.round(foreground * 0.5)), gravity: "center" }])
      .png()
  );
}

console.log("Splash screens:");
for (const [file, width, height] of SPLASHES) {
  await write(
    file,
    sharp({ create: { width, height, channels: 4, background: NAVY } })
      .composite([{ input: await glyphAt(glyph, Math.round(Math.min(width, height) * 0.3)), gravity: "center" }])
      .png()
  );
}

console.log("\nDone. Brand colour for values/ic_launcher_background.xml: #1a237e");
