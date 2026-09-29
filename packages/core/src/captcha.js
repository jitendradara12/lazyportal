/**
 * Canvas matcher that reads the 5-character unrotated Arial captcha text
 * from the portal PNG using an offscreen canvas.
 *
 * @param {Object} captcha - { hidden, image, imageDataUrl }
 * @param {Object} [options] - Injectable canvas/image factories for testing
 * @returns {Promise<string>} The 5-character solved text
 */
export async function solveCaptcha(captcha, { createCanvas, createImage } = {}) {
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
  for (let y = 0; y < 60; y++) {
    if (isDark(260, y)) {
      startY = y;
      break;
    }
  }
  const lineY = new Array(310).fill(-1);
  let curY = startY;
  for (let x = 259; x >= 10; x--) {
    let bestY = curY;
    for (const dy of [0, -1, 1, -2, 2]) {
      if (isDark(x, curY + dy)) {
        bestY = curY + dy;
        break;
      }
    }
    curY = bestY;
    lineY[x] = curY;
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

  // Characters used in portal captchas (excluding ambiguous 0, o, 1, l, i)
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const charCanvas = getCanvas(310, 60);
  const cCtx = charCanvas.getContext("2d", { willReadFrequently: true });
  cCtx.font = "bold 40px Arial, 'Liberation Sans', sans-serif";
  cCtx.textBaseline = "alphabetic";

  const templates = {};
  for (const ch of chars) {
    templates[ch] = {};
    for (const baseY of [43, 44]) {
      cCtx.clearRect(0, 0, 310, 60);
      cCtx.fillStyle = "black";
      cCtx.fillText(ch, 50, baseY);
      const w = cCtx.measureText(ch).width;
      const tData = cCtx.getImageData(50, 0, Math.ceil(w) + 2, 60).data;
      const pts = [];
      for (let dy = 10; dy < 55; dy++) {
        for (let dx = 0; dx < Math.ceil(w) + 2; dx++) {
          const idx = (dy * (Math.ceil(w) + 2) + dx) * 4;
          if (tData[idx + 3] > 128) pts.push([dx, dy]);
        }
      }
      templates[ch][baseY] = { w, pts, widthCeil: Math.ceil(w) + 2 };
    }
  }

  let solved = "";
  let curX = startX;

  for (let pos = 0; pos < 5; pos++) {
    let bestChar = "a";
    let bestScore = -999;
    let bestW = 22;
    let bestShiftX = 0;

    for (const ch of chars) {
      for (const baseY of [43, 44]) {
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
          if (dice > bestScore) {
            bestScore = dice;
            bestChar = ch;
            bestW = w;
            bestShiftX = shiftX;
          }
        }
      }
    }
    solved += bestChar;
    curX += bestShiftX + bestW;
  }

  return solved;
}
