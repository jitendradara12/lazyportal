import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { solveCaptcha } from "../src/captcha.js";

const manifest = JSON.parse(readFileSync(new URL("./fixtures/captcha/labels.json", import.meta.url)));
const pixels = gunzipSync(readFileSync(new URL("./fixtures/captcha/pixels.rgba.gz", import.meta.url)));
const imageBytes = manifest.width * manifest.height * 4;
function imageOptions(data) {
  return {
    createCanvas: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }),
    createImage: async () => ({ width: 310, height: 60 }),
  };
}

describe("captcha", () => {
  it("returns empty string if captcha is null", async () => {
    assert.equal(await solveCaptcha(null), "");
  });

  it("throws if no canvas environment is available", async () => {
    await assert.rejects(() => solveCaptcha({ image: "abc" }), /Canvas API not available/);
  });

  it("aborts while waiting for the captcha image to decode", async () => {
    const controller = new AbortController();
    const pending = solveCaptcha({ image: "abc" }, {
      signal: controller.signal,
      createCanvas: () => ({}),
      createImage: () => new Promise(() => {}),
    });
    await Promise.resolve();
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
  });

  it("rejects blank, transparent, solid dark and resized images", async () => {
    for (const shade of [0, 255]) {
      const data = new Uint8ClampedArray(imageBytes).fill(shade);
      assert.equal(await solveCaptcha({}, imageOptions(data)), "");
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      assert.equal(await solveCaptcha({}, imageOptions(data)), "");
    }
    assert.equal(await solveCaptcha({}, {
      ...imageOptions(pixels.subarray(0, imageBytes)),
      createImage: async () => ({ width: 155, height: 30 }),
    }), "");
  });

  it("recognizes real images without using device fonts, including held-out samples", async () => {
    let exact = 0, validation = 0;
    const errors = [];
    for (const [i, sample] of manifest.samples.entries()) {
      const actual = await solveCaptcha({}, imageOptions(pixels.subarray(i * imageBytes, (i + 1) * imageBytes)));
      if (actual === sample.expected) {
        exact++;
        if (sample.set === "validation") validation++;
      } else errors.push(`${sample.expected} → ${actual}`);
      if (sample.id === 1) assert.equal(actual, "r2g6p", "a following letter must not turn r into m");
    }
    assert.ok(exact >= 32, `${exact}/36 exact: ${errors.join(", ")}`);
    assert.ok(validation >= 21, `${validation}/24 validation images`);
  });
});
