/**
 * Canvas matcher that reads the 5-character unrotated Arial captcha text
 * from the portal PNG using an offscreen canvas.
 *
 * @param {Object} captcha - { hidden, image, imageDataUrl }
 * @param {Object} [options] - Injectable canvas/image factories for testing
 * @returns {Promise<string>} The 5-character solved text
 */

// Global template cache for standard environment (OffscreenCanvas/browser DOM).
let cachedDefaultTemplates = null;

function generateTemplates(getCanvas) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const charCanvas = getCanvas(310, 60);
  const cCtx = charCanvas.getContext("2d", { willReadFrequently: true });
  cCtx.font = "bold 40px Arial, 'Liberation Sans', sans-serif";
  cCtx.textBaseline = "alphabetic";

  const templates = {};
  for (const ch of chars) {
    templates[ch] = {};
    for (const baseY of [42, 43, 44, 45]) {
      cCtx.clearRect(0, 0, 310, 60);
      cCtx.fillStyle = "black";
      cCtx.fillText(ch, 50, baseY);
      const m = cCtx.measureText(ch);
      const tWidth = Math.ceil(m.width) + 20;
      const tData = cCtx.getImageData(40, 0, tWidth, 60).data;

      // Find actual minX, maxX of dark pixels
      let minX = tWidth, maxX = -1;
      for (let dy = 10; dy < 55; dy++) {
        for (let dx = 0; dx < tWidth; dx++) {
          const idx = (dy * tWidth + dx) * 4;
          if (tData[idx + 3] > 128) {
            if (dx < minX) minX = dx;
            if (dx > maxX) maxX = dx;
          }
        }
      }

      const actualW = maxX >= minX ? maxX - minX + 1 : Math.round(m.width);
      const pts = [];
      for (let dy = 10; dy < 55; dy++) {
        for (let dx = minX; dx <= maxX; dx++) {
          const idx = (dy * tWidth + dx) * 4;
          if (tData[idx + 3] > 128) {
            pts.push([dx - minX, dy]);
          }
        }
      }
      templates[ch][baseY] = { w: actualW, pts, widthCeil: actualW };
    }
  }
  return templates;
}

function disambiguate(charA, charB, curX, isDark, lineY, w) {
  const pair = new Set([charA, charB]);

  // Wide character 'm' vs narrow subset 'r' or 'n':
  // 'm' has a 3rd vertical leg at x = curX + 20 .. curX + 28, y = 26 .. 42.
  if (charA === "r" || charA === "n" || pair.has("m")) {
    let rightLegDark = 0;
    const xStart = Math.round(curX + 20);
    const xEnd = Math.round(curX + 28);
    for (let x = xStart; x <= xEnd; x++) {
      for (let y = 26; y <= 42; y++) {
        if (Math.abs(y - lineY[x]) > 1 && isDark(x, y)) rightLegDark++;
      }
    }
    if (rightLegDark >= 7) return "m";
  }

  // Wide character 'w' vs narrow subset 'v' or 'u':
  // 'w' has a 4th diagonal stroke at x = curX + 20 .. curX + 28, y = 24 .. 42.
  if (charA === "v" || charA === "u" || pair.has("w")) {
    let rightStrokeDark = 0;
    const xStart = Math.round(curX + 20);
    const xEnd = Math.round(curX + 28);
    for (let x = xStart; x <= xEnd; x++) {
      for (let y = 24; y <= 42; y++) {
        if (Math.abs(y - lineY[x]) > 1 && isDark(x, y)) rightStrokeDark++;
      }
    }
    if (rightStrokeDark >= 7) return "w";
  }

  // 'c' vs 'e': 'e' has a solid horizontal crossbar at y=27..32
  if (pair.has("c") && pair.has("e")) {
    let eBarDark = 0;
    const xStart = Math.round(curX + w * 0.45);
    const xEnd = Math.round(curX + w * 0.85);
    for (let x = xStart; x <= xEnd; x++) {
      for (let y = 26; y <= 32; y++) {
        if (Math.abs(y - lineY[x]) > 1 && isDark(x, y)) eBarDark++;
      }
    }
    return eBarDark >= 4 ? "e" : "c";
  }

  // 'n' vs 'h': 'h' has a tall ascender at y=14..21
  if (pair.has("n") && pair.has("h")) {
    let ascenderDark = 0;
    const xStart = Math.round(curX);
    const xEnd = Math.round(curX + 6);
    for (let x = xStart; x <= xEnd; x++) {
      for (let y = 14; y <= 21; y++) {
        if (Math.abs(y - lineY[x]) > 1 && isDark(x, y)) ascenderDark++;
      }
    }
    return ascenderDark >= 4 ? "h" : "n";
  }

  return charA;
}

export async function solveCaptcha(captcha, options = {}) {
  const { createCanvas, createImage } = options;
  if (!captcha) return "";

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
    img = await createImage(captcha);
  } else if (typeof Image !== "undefined") {
    img = new Image();
    img.src = captcha.imageDataUrl || `data:image/png;base64,${captcha.image}`;
    if (img.decode) {
      await img.decode();
    } else {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
    }
  } else {
    throw new Error("Image API not available in this environment");
  }

  const imgCanvas = getCanvas(310, 60);
  const iCtx = imgCanvas.getContext("2d", { willReadFrequently: true });
  iCtx.drawImage(img, 0, 0);
  const imgData = iCtx.getImageData(0, 0, 310, 60).data;

  function isDark(x, y) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx < 0 || rx >= 310 || ry < 0 || ry >= 60) return false;
    const idx = (ry * 310 + rx) * 4;
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

  // Use cached templates if default environment, or build for custom canvas
  let templates;
  if (!createCanvas) {
    if (!cachedDefaultTemplates) {
      cachedDefaultTemplates = generateTemplates(getCanvas);
    }
    templates = cachedDefaultTemplates;
  } else {
    templates = generateTemplates(getCanvas);
  }

  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let solved = "";
  let curX = startX;

  for (let pos = 0; pos < 5; pos++) {
    let bestChar = "";
    let bestScore = -999;
    let bestW = 22;
    let bestShiftX = 0;
    let secondBestChar = "";
    let secondBestScore = -999;

    for (const ch of chars) {
      let maxCharScore = -999;
      let maxCharW = 22;
      let maxCharShiftX = 0;

      for (const baseY of [42, 43, 44, 45]) {
        const { w, pts, widthCeil } = templates[ch][baseY];
        for (let shiftX = -2; shiftX <= 2; shiftX++) {
          let bothDark = 0, validCand = 0;
          for (let i = 0; i < pts.length; i++) {
            const px = curX + shiftX + pts[i][0];
            const dy = pts[i][1];
            if (Math.abs(dy - lineY[px]) <= 1) continue;
            validCand++;
            if (isDark(px, dy)) bothDark++;
          }
          if (validCand === 0) continue;

          let imgDarkInBox = 0;
          for (let dy = 10; dy < 55; dy++) {
            for (let dx = 0; dx < widthCeil; dx++) {
              const px = curX + shiftX + dx;
              if (Math.abs(dy - lineY[px]) <= 1) continue;
              if (isDark(px, dy)) imgDarkInBox++;
            }
          }
          const dice = (2 * bothDark) / (validCand + imgDarkInBox);
          if (dice > maxCharScore) {
            maxCharScore = dice;
            maxCharW = w;
            maxCharShiftX = shiftX;
          }
        }
      }

      if (maxCharScore > bestScore) {
        secondBestScore = bestScore;
        secondBestChar = bestChar;
        bestScore = maxCharScore;
        bestChar = ch;
        bestW = maxCharW;
        bestShiftX = maxCharShiftX;
      } else if (maxCharScore > secondBestScore) {
        secondBestScore = maxCharScore;
        secondBestChar = ch;
      }
    }

    if (options && options.debug) {
      options.debug.push({ pos, curX, bestChar, bestScore, secondBestChar, secondBestScore });
    }

    // No confident match (blank / resized / heavy noise): signal failure
    if (!bestChar || bestScore < 0.15) return "";

    // Resolve tight ties between frequently confused glyph pairs,
    // and prevent narrow sub-characters ('n', 'r', 'u', 'v') from falsely winning over wide characters ('m', 'w')
    let finalChar = bestChar;
    const needsCheck =
      (secondBestChar && (bestScore - secondBestScore < 0.08)) ||
      bestChar === "n" ||
      bestChar === "r" ||
      bestChar === "u" ||
      bestChar === "v";

    if (needsCheck) {
      finalChar = disambiguate(bestChar, secondBestChar || "", curX + bestShiftX, isDark, lineY, bestW);
      if (finalChar === "m") bestW = templates["m"][44].w;
      if (finalChar === "w") bestW = templates["w"][44].w;
    }

    solved += finalChar;

    // Advance to next character with inter-character gap detection to prevent cumulative drift
    const expectedX = curX + bestShiftX + bestW;
    let foundStart = -1;
    let inGap = false;
    for (let x = expectedX - 3; x <= expectedX + 5; x++) {
      let colCount = 0;
      for (let y = 15; y < 50; y++) {
        if (isDark(x, y) && Math.abs(y - lineY[x]) > 1) colCount++;
      }
      if (colCount <= 2) {
        inGap = true;
      } else if (inGap && colCount >= 4) {
        foundStart = x;
        break;
      }
    }

    if (foundStart !== -1 && Math.abs(foundStart - expectedX) <= 4) {
      curX = foundStart;
    } else {
      curX = expectedX;
    }
  }

  return solved;
}
