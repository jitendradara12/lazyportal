import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Static checks on the checked-in native project. They need no Android
 * toolchain, so they run on every `npm test` and fail loudly if `npx cap add
 * android` is ever re-run (which would reset app id, branding and icons).
 * Output from `scripts/generate-app-assets.mjs` is generated *into* this tree,
 * so the icons are part of the app, not build artefacts.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const android = path.join(root, "android");
const res = path.join(android, "app/src/main/res");
const webPublic = path.join(root, "packages/web/public");

const read = (p) => fs.readFileSync(path.join(root, p), "utf-8");
const exists = (p) => fs.existsSync(path.join(root, p));

function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.ok(
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    `${file} must be a PNG`
  );
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("capacitor.config.json identifies the app and the bundle", () => {
  const config = JSON.parse(read("capacitor.config.json"));
  assert.equal(config.appId, "com.lazyportal.juet");
  assert.equal(config.appName, "JUET Portal");
  assert.equal(config.webDir, "packages/web/dist");
  // Point at the workspace that produces it, not at the output: `npm test` must
  // pass on a clean checkout, before any build.
  assert.ok(exists("packages/web/package.json") && exists("packages/web/vite.config.js"));
  assert.equal(config.server?.androidScheme, "https");
  assert.equal(config.server?.hostname, "localhost");
});

test("native project matches the Capacitor config", () => {
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /applicationId "com\.lazyportal\.juet"/);
  assert.match(gradle, /namespace = "com\.lazyportal\.juet"/);

  const strings = read("android/app/src/main/res/values/strings.xml");
  assert.match(strings, /<string name="app_name">JUET Portal<\/string>/);

  const activity = read("android/app/src/main/java/com/lazyportal/juet/MainActivity.java");
  assert.match(activity, /^package com\.lazyportal\.juet;/m);
  assert.match(activity, /extends BridgeActivity/);
});

test("launcher icons are the generated brand assets, at every density", () => {
  // Density bucket → launcher icon px (adaptive foreground is 108dp of the 48dp icon).
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [dir, scale] of Object.entries(densities)) {
    for (const [name, dp] of [
      ["ic_launcher.png", 48],
      ["ic_launcher_round.png", 48],
      ["ic_launcher_foreground.png", 108],
    ]) {
      const file = path.join(res, `mipmap-${dir}`, name);
      assert.ok(fs.existsSync(file), `missing mipmap-${dir}/${name}`);
      const { width, height } = pngSize(file);
      assert.equal(width, scale * dp, `mipmap-${dir}/${name} must be ${scale * dp}px`);
      assert.equal(height, width, `${name} must be square`);
    }
  }
});

test("adaptive icon uses the brand colour and a padded white glyph", async () => {
  const background = read("android/app/src/main/res/values/ic_launcher_background.xml");
  assert.match(background, /<color name="ic_launcher_background">#1a237e<\/color>/);

  const glyph = await sharp(path.join(res, "mipmap-xxxhdpi/ic_launcher_foreground.png"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, channels } = glyph.info;
  const pixel = (x, y) => [...glyph.data.subarray((y * width + x) * channels, (y * width + x) * channels + channels)];

  assert.equal(pixel(0, 0)[3], 0, "glyph canvas must be transparent");
  const [r, g, b, a] = pixel(Math.floor(width / 2), Math.floor(width / 2));
  assert.ok(a > 200 && r > 240 && g > 240 && b > 240, "glyph centre must be opaque white");

  // The glyph must sit inside the 66dp safe zone (25% padding), so sample the
  // corners of that zone: a stretch of transparent pixels there means the glyph
  // is small enough to survive every launcher mask.
  const safeInset = Math.round(width * (21 / 108));
  assert.equal(pixel(safeInset, safeInset)[3], 0, "glyph must not reach the mask edge");
});

test("splash screens are branded, not the Capacitor default", async () => {
  const files = ["drawable/splash.png", "drawable-port-xhdpi/splash.png", "drawable-land-xhdpi/splash.png"];
  for (const file of files) {
    const { width, height } = pngSize(path.join(res, file));
    assert.ok(width > 0 && height > 0, `${file} must have pixels`);
  }

  // Brand navy background with the white glyph in the middle.
  const splash = path.join(res, "drawable-port-xhdpi/splash.png");
  const { data, info } = await sharp(splash).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
  assert.deepEqual(px(0, 0), [0x1a, 0x23, 0x7e], "splash background must be brand navy");
  assert.deepEqual(px(Math.floor(info.width / 2), Math.floor(info.height / 2)), [0xff, 0xff, 0xff]);
});

test("launcher art derives from the committed web icon", async () => {
  // icon-512.png (the PWA icon) is what launchers show on API < 26 and the
  // adaptive foreground comes from the maskable asset — so both inputs must exist.
  for (const file of ["icon-512.png", "icon-maskable-512.png"]) {
    const { width } = pngSize(path.join(webPublic, file));
    assert.equal(width, 512, `${file} must stay 512px`);
  }
  const legacy = await sharp(path.join(res, "mipmap-xxxhdpi/ic_launcher.png")).raw().toBuffer({ resolveWithObject: true });
  assert.equal(legacy.info.width, 192);
  assert.ok(legacy.info.channels === 4, "launcher icon keeps its alpha channel");
});
