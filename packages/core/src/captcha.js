import { captchaGlyphs } from "./captchaGlyphs.js";

function abortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function waitWithAbort(promise, signal, onAbort) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) {
    try {
      onAbort?.();
    } catch {}
    return Promise.reject(abortError());
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", handleAbort);
    const handleAbort = () => {
      cleanup();
      try {
        onAbort?.();
      } catch {}
      reject(abortError());
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** Read the portal's five glyphs locally; an empty result requests manual entry. */
export async function solveCaptcha(captcha, options = {}) {
  const { createCanvas, createImage, signal } = options;
  if (!captcha) return "";
  throwIfAborted(signal);

  const getCanvas =
    createCanvas ??
    (typeof OffscreenCanvas !== "undefined"
      ? (w, h) => new OffscreenCanvas(w, h)
      : typeof document !== "undefined"
      ? (w, h) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          return c;
        }
      : null);

  if (!getCanvas) {
    throw new Error("Canvas API not available in this environment");
  }

  let img;
  if (createImage) {
    img = await waitWithAbort(
      Promise.resolve().then(() => createImage(captcha)),
      signal,
    );
  } else if (typeof Image !== "undefined") {
    img = new Image();
    const imageUrl = captcha.imageDataUrl || `data:image/png;base64,${captcha.image}`;
    if (img.decode) {
      img.src = imageUrl;
      await waitWithAbort(img.decode(), signal, () => {
        img.src = "";
      });
    } else {
      const imageLoaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      img.src = imageUrl;
      await waitWithAbort(imageLoaded, signal, () => {
        img.src = "";
      });
    }
  } else {
    throw new Error("Image API not available in this environment");
  }
  throwIfAborted(signal);

  // This matcher is calibrated for the portal's native image dimensions.
  if (img.width !== 310 || img.height !== 60) return "";

  const imgCanvas = getCanvas(310, 60);
  const iCtx = imgCanvas.getContext("2d", { willReadFrequently: true });
  iCtx.drawImage(img, 0, 0);
  const imgData = iCtx.getImageData(0, 0, 310, 60).data;

  function isDark(x, y) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx < 0 || rx >= 310 || ry < 0 || ry >= 60) return false;
    const idx = (ry * 310 + rx) * 4;
    if (imgData[idx + 3] < 128) return false;
    const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2];
    const approxBg = 55 + (rx / 310) * 200;
    return (r + g + b) / 3 < Math.min(approxBg - 25, 140);
  }

  // Trace strike-through line from right edge back to x=10
  let startY = 30;
  for (let x = 275; x >= 240; x--) {
    let found = false;
    for (let y = 4; y <= 56; y++) {
      if (isDark(x, y) && isDark(x - 1, y)) {
        startY = y;
        found = true;
        break;
      }
    }
    if (found) break;
  }
  // Fallback scan if 2-pixel entry wasn't found
  if (startY === 30) {
    for (let y = 0; y < 60; y++) {
      if (isDark(260, y)) {
        startY = y;
        break;
      }
    }
  }

  const lineY = new Array(310).fill(-1);
  let curY = startY;
  for (let x = 259; x >= 10; x--) {
    let bestY = curY;
    for (const dy of [0, -1, 1, -2, 2, -3, 3]) {
      if (isDark(x, curY + dy)) {
        bestY = curY + dy;
        break;
      }
    }
    curY = bestY;
    lineY[x] = curY;
  }

  // 3-tap median smoothing to prevent sudden 1-pixel spikes when crossing thick vertical stems
  for (let x = 11; x < 259; x++) {
    if (lineY[x - 1] !== -1 && lineY[x] !== -1 && lineY[x + 1] !== -1) {
      const a = lineY[x - 1], b = lineY[x], c = lineY[x + 1];
      lineY[x] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    }
  }

  // Find start of first character
  let startX = 18;
  for (let x = 12; x < 28; x++) {
    let count = 0;
    for (let y = 15; y < 50; y++) {
      if (isDark(x, y) && Math.abs(y - lineY[x]) > 1) count++;
    }
    if (count >= 5) {
      startX = x - 1;
      break;
    }
  }

  return matchCharacters(isDark, lineY, startX, options);
}

function popcount(value) {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const glyphs = captchaGlyphs.flatMap(([char, columns]) =>
  [0, 1, 2, 3].map((shift) => ({
    char,
    width: columns.length / 2,
    columns: Uint32Array.from(columns, (value, i) => i % 2 === 0
      ? value << shift
      : (value << shift) | (shift ? columns[i - 1] >>> (32 - shift) : 0)),
  })),
);

function matchCharacters(isDark, lineY, startX, { signal, debug }) {
  const dark = new Uint32Array(620);
  const valid = new Uint32Array(620);
  let totalDark = 0;
  for (let x = 0; x < 310; x++) {
    for (let y = 10; y < 55; y++) {
      if (Math.abs(y - lineY[x]) <= 1) continue;
      const index = x * 2 + (y >>> 5);
      valid[index] |= 1 << (y & 31);
      if (isDark(x, y)) {
        dark[index] |= 1 << (y & 31);
        totalDark++;
      }
    }
  }
  if (totalDark < 100 || totalDark > 5000) return "";

  const energy = (a, b, x) =>
    2 * (popcount(a & dark[x * 2]) + popcount(b & dark[x * 2 + 1])) - popcount(a) - popcount(b);
  const cache = new Map();
  function candidates(x) {
    if (cache.has(x)) return cache.get(x);
    const candidates = glyphs.map((glyph) => {
      const columns = new Uint32Array((glyph.width + 4) * 2);
      const prefix = new Int16Array(glyph.width + 5);
      for (let dx = 0; dx < glyph.width; dx++) {
        const a = glyph.columns[dx * 2] & valid[(x + dx) * 2];
        const b = glyph.columns[dx * 2 + 1] & valid[(x + dx) * 2 + 1];
        columns[dx * 2] = a;
        columns[dx * 2 + 1] = b;
        prefix[dx + 1] = prefix[dx] + energy(a, b, x + dx);
      }
      prefix.fill(prefix[glyph.width], glyph.width + 1);
      return { ...glyph, columns, prefix };
    });
    cache.set(x, candidates);
    return candidates;
  }

  let states = Array.from({ length: 7 }, (_, i) => ({
    x: startX - 3 + i, score: 0, tail: new Uint32Array(), parent: null, char: "",
  }));
  let best = null;
  // Score five glyphs as one image. Retain overlap pixels so a following
  // letter cannot be mistaken for a third leg of the current letter.
  for (let position = 0; position < 5; position++) {
    throwIfAborted(signal);
    const buckets = new Map();
    for (const state of states) {
      for (const glyph of candidates(state.x)) {
        const overlap = new Int16Array(state.tail.length / 2 + 1);
        for (let dx = 0; dx < state.tail.length / 2; dx++) {
          const a = glyph.columns[dx * 2];
          const b = glyph.columns[dx * 2 + 1];
          overlap[dx + 1] = overlap[dx] + energy(a | state.tail[dx * 2], b | state.tail[dx * 2 + 1], state.x + dx) - energy(a, b, state.x + dx);
        }
        if (position === 4) {
          const score = state.score + glyph.prefix[glyph.width] + overlap[overlap.length - 1];
          if (!best || score > best.score) best = { score, char: glyph.char, parent: state };
          continue;
        }
        for (let advance = Math.max(7, glyph.width - 8); advance <= glyph.width + 4; advance++) {
          const x = state.x + advance;
          if (x > 210) continue;
          const score = state.score + glyph.prefix[advance] + overlap[Math.min(advance, overlap.length - 1)];
          const bucket = buckets.get(x) ?? [];
          // ponytail: three paths per x; widen the beam if a larger corpus exposes pruning errors.
          if (bucket.length === 3 && score <= bucket[2].score) continue;
          const tailWidth = Math.max(glyph.width, state.tail.length / 2) - advance;
          const tail = new Uint32Array(Math.max(0, tailWidth) * 2);
          for (let i = 0; i < tail.length; i++) tail[i] = glyph.columns[advance * 2 + i] | state.tail[advance * 2 + i];
          const next = { x, score, tail, parent: state, char: glyph.char };
          const index = bucket.findIndex((s) => score > s.score);
          bucket.splice(index === -1 ? bucket.length : index, 0, next);
          if (bucket.length > 3) bucket.pop();
          buckets.set(x, bucket);
        }
      }
    }
    states = [...buckets.values()].flat();
  }
  const confidence = best ? best.score / totalDark : 0;
  const characters = [];
  for (let state = best; state?.char; state = state.parent) characters.push(state.char);
  const text = characters.reverse().join("");
  debug?.push({ text, confidence, totalDark });
  return confidence >= 0.45 && text.length === 5 ? text : "";
}
