# Captcha regression corpus

36 public portal images fetched on 2026-11-03, with manually transcribed labels. No login was attempted to validate these labels. The first 12 images were used during development. The remaining 24 were collected separately and evaluated after selecting the matcher settings.

`pixels.rgba.gz` contains the original decoded RGBA pixels concatenated in `labels.json` order, 310 × 60 × 4 bytes per image. Gzip lets the Node tests load authentic pixels using only the standard library. Challenge tokens and account data are not included.

Measured with Chrome and Liberation Sans on the development machine:

| Matcher | All 36 images | Separate validation set |
| --- | --- | --- |
| Previous greedy matcher | 14/36 | 11/24 |
| Fixed glyphs and whole-image matching | 32/36 | 21/24 |

This small corpus measures exact visual transcription, not production login success. Known errors are `bm5ax → bn5ax`, `gr67b → gn57b`, `h8pw8 → h8pu8`, and `wr8yp → wf8yp`. Touching glyphs and strike-through strokes remain difficult.

Run the regression without a browser:

```sh
node --test packages/core/test/captcha.test.js
```

Run the same corpus through browser image encoding, decoding and matching:

```sh
node packages/web/scripts/bench-captcha.mjs
# With a system Chrome:
CHROME=/path/to/chrome node packages/web/scripts/bench-captcha.mjs
```

The checked-in glyph atlas is rasterized Liberation Sans Bold at 42px, baseline 44, with four vertical alignments. It avoids differences between device fonts. Regenerate it with `packages/web/scripts/generate-captcha-glyphs.mjs` on a machine with Liberation Sans Bold installed, then rerun the corpus. The fit score is a pixel similarity measure, not a calibrated probability. The search retains three paths at each horizontal position and permits up to eight pixels of glyph overlap. Blank, solid, unsupported-size and poorly matched images return an empty result for manual entry.
