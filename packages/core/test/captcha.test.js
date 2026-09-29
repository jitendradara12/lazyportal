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

  it("solves 5 characters with canvas mock", async () => {
    const mockImage = { width: 310, height: 60 };
    const mockData = new Uint8ClampedArray(310 * 60 * 4);

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

    assert.equal(typeof res, "string");
    assert.equal(res.length, 5);
  });
});
