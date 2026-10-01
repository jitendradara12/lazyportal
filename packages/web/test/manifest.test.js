import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "..");
const publicDir = path.join(webDir, "public");

function getPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const signature = buf.subarray(0, 8);
  const expectedSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(signature.equals(expectedSig), `${filePath} must be a valid PNG file`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

test("PWA manifest meets Chrome WebAPK and installability criteria", () => {
  const manifestPath = path.join(publicDir, "manifest.webmanifest");
  assert.ok(fs.existsSync(manifestPath), "manifest.webmanifest must exist");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert.ok(manifest.name, "manifest must have a name");
  assert.ok(manifest.short_name, "manifest must have a short_name");
  assert.equal(manifest.display, "standalone", "manifest display must be standalone");
  assert.ok(manifest.start_url, "manifest must have start_url");
  assert.ok(manifest.theme_color, "manifest must have theme_color");
  assert.ok(manifest.background_color, "manifest must have background_color");
  assert.ok(Array.isArray(manifest.icons), "manifest must declare icons array");

  // WebAPK requirements: standard 192 and 512 PNG icons
  const icon192 = manifest.icons.find(
    (i) => i.sizes === "192x192" && (i.purpose === "any" || !i.purpose) && i.type === "image/png"
  );
  assert.ok(icon192, "manifest must include 192x192 standard icon (purpose: any)");

  const icon512 = manifest.icons.find(
    (i) => i.sizes === "512x512" && (i.purpose === "any" || !i.purpose) && i.type === "image/png"
  );
  assert.ok(icon512, "manifest must include 512x512 standard icon (purpose: any)");

  // WebAPK adaptive icon requirements: maskable 192 and 512 PNG icons
  const maskable192 = manifest.icons.find(
    (i) => i.sizes === "192x192" && i.purpose === "maskable" && i.type === "image/png"
  );
  assert.ok(maskable192, "manifest must include 192x192 maskable icon (purpose: maskable)");

  const maskable512 = manifest.icons.find(
    (i) => i.sizes === "512x512" && i.purpose === "maskable" && i.type === "image/png"
  );
  assert.ok(maskable512, "manifest must include 512x512 maskable icon (purpose: maskable)");

  // Verify all icon paths exist and have exact dimensions
  for (const item of manifest.icons) {
    const cleanSrc = item.src.replace(/^\//, "");
    const iconPath = path.join(publicDir, cleanSrc);
    assert.ok(fs.existsSync(iconPath), `Icon file must exist: ${item.src}`);

    if (item.type === "image/png" && item.sizes && item.sizes !== "any") {
      const [expectedW, expectedH] = item.sizes.split("x").map(Number);
      const { width, height } = getPngDimensions(iconPath);
      assert.equal(width, expectedW, `${item.src} width must match declared sizes`);
      assert.equal(height, expectedH, `${item.src} height must match declared sizes`);
    }
  }
});

test("HTML head includes apple-touch-icon (180x180) and iOS metadata", () => {
  const htmlPath = path.join(webDir, "index.html");
  assert.ok(fs.existsSync(htmlPath), "index.html must exist");

  const html = fs.readFileSync(htmlPath, "utf-8");
  assert.match(
    html,
    /<link[^>]+rel=["']apple-touch-icon["'][^>]*>/i,
    "index.html must configure apple-touch-icon"
  );
  assert.match(
    html,
    /<meta[^>]+name=["']apple-mobile-web-app-capable["'][^>]*content=["']yes["']/i,
    "index.html must include apple-mobile-web-app-capable meta tag"
  );

  const appleIconPath = path.join(publicDir, "apple-touch-icon.png");
  assert.ok(fs.existsSync(appleIconPath), "apple-touch-icon.png must exist in public directory");
  const { width, height } = getPngDimensions(appleIconPath);
  assert.equal(width, 180, "apple-touch-icon.png width must be 180px");
  assert.equal(height, 180, "apple-touch-icon.png height must be 180px");
});
