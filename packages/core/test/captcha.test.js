import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { solveCaptcha } from "../src/captcha.js";

describe("captcha", () => {
  it("returns empty string if captcha is null", async () => {
    const res = await solveCaptcha(null);
    assert.equal(res, "");
  });

  it("throws if no canvas environment is available", async () => {
    await assert.rejects(
      () => solveCaptcha({ image: "abc" }),
      /Canvas API not available/
    );
  });

  it("aborts while waiting for the captcha image to decode", async () => {
    const controller = new AbortController();
    const pending = solveCaptcha(
      { image: "abc" },
      {
        signal: controller.signal,
        createCanvas: () => ({}),
        createImage: () => new Promise(() => {}),
      },
    );
    await Promise.resolve();
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
  });

  it("returns empty string on blank image (no confident match)", async () => {
    const mockImage = { width: 310, height: 60 };

    // Mock CanvasRenderingContext2D
    const mockContext = {
      font: "",
      fillStyle: "",
      textBaseline: "",
      measureText(text) {
        return { width: text.length * 22 };
      },
      clearRect() {},
      drawImage() {},
      fillText() {},
      getImageData(x, y, w, h) {
        return { data: new Uint8ClampedArray(w * h * 4) };
      },
    };

    const mockCanvas = {
      width: 310,
      height: 60,
      getContext() {
        return mockContext;
      },
    };

    const res = await solveCaptcha(
      { image: "test", hidden: "h" },
      {
        createCanvas: () => mockCanvas,
        createImage: async () => mockImage,
      }
    );

    assert.equal(res, "");
  });

  it("solves 5 characters with canvas mock", async () => {
    const mockImage = { width: 310, height: 60 };

    // Uniform dark + opaque: image dark everywhere, templates fully
    // filled -> high Dice, so solver returns a 5-char guess.
    const mockContext = {
      font: "",
      fillStyle: "",
      textBaseline: "",
      measureText(text) {
        return { width: text.length * 22 };
      },
      clearRect() {},
      drawImage() {},
      fillText() {},
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          data[i * 4] = 0;
          data[i * 4 + 1] = 0;
          data[i * 4 + 2] = 0;
          data[i * 4 + 3] = 255;
        }
        return { data };
      },
    };

    const mockCanvas = {
      width: 310,
      height: 60,
      getContext() {
        return mockContext;
      },
    };

    const res = await solveCaptcha(
      { image: "test", hidden: "h" },
      {
        createCanvas: () => mockCanvas,
        createImage: async () => mockImage,
      }
    );

    assert.equal(typeof res, "string");
    assert.equal(res.length, 5);

    // Second call to verify stability and template reuse
    const res2 = await solveCaptcha(
      { image: "test", hidden: "h" },
      {
        createCanvas: () => mockCanvas,
        createImage: async () => mockImage,
      }
    );
    assert.equal(res2, res);
  });
});
