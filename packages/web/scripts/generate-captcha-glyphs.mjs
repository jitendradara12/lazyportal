// Requires Liberation Sans Bold on the generator machine. Runtime needs no font.
// CHROME=/path/to/chrome node packages/web/scripts/generate-captcha-glyphs.mjs
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ executablePath: process.env.CHROME });
try {
  const page = await browser.newPage();
  const glyphs = await page.evaluate(() => {
    const canvas = new OffscreenCanvas(310, 60);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.font = "bold 42px 'Liberation Sans'";
    ctx.textBaseline = "alphabetic";
    return [..."23456789abcdefghjkmnpqrstuvwxyz"].map(char => {
      ctx.clearRect(0, 0, 310, 60);
      ctx.fillText(char, 50, 44);
      const { data } = ctx.getImageData(0, 0, 310, 60);
      let left = 310, right = 0;
      for (let x = 0; x < 310; x++) for (let y = 10; y < 55; y++) {
        if (data[(y * 310 + x) * 4 + 3] > 128) { left = Math.min(left, x); right = Math.max(right, x); }
      }
      const columns = Array((right - left + 1) * 2).fill(0);
      for (let x = left; x <= right; x++) for (let y = 10; y < 55; y++) {
        if (data[(y * 310 + x) * 4 + 3] > 128) {
          const i = (x - left) * 2 + (y >>> 5);
          columns[i] = (columns[i] | 1 << (y & 31)) >>> 0;
        }
      }
      return [char, columns];
    });
  });
  const source = "// Fixed raster glyphs keep recognition independent of the device's installed fonts.\n" +
    "// Liberation Sans Bold, 42px, baseline 44; columns store rows 0..31 and 32..59.\n" +
    "export const captchaGlyphs = [\n" + glyphs.map(([char, columns]) =>
      `  ["${char}", [${columns.map(value => `0x${value.toString(16)}`).join(",")}]],`).join("\n") + "\n];\n";
  await writeFile(new URL("../../core/src/captchaGlyphs.js", import.meta.url), source);
} finally {
  await browser.close();
}
