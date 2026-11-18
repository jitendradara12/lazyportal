# Captcha regression corpus

36 public portal captchas fetched 2026-11-03 with manually transcribed labels (first 12 dev, remaining 24 validation; not login-verified). `pixels.rgba.gz` stores raw `310 × 60 × 4` RGBA pixels concatenated in `labels.json` order.

Known matcher misses on this corpus: `bm5ax → bn5ax`, `gr67b → gn57b`, `h8pw8 → h8pu8`, `wr8yp → wf8yp`.

```sh
node --test packages/core/test/captcha.test.js              # headless Node regression
CHROME=/path/to/chrome node packages/web/scripts/bench-captcha.mjs
```

The checked-in glyph atlas (`packages/core/src/captchaGlyphs.js`) is rasterized Liberation Sans Bold at 42px (baseline 44, 4 vertical alignments) so device fonts do not affect matching. Regenerate via `packages/web/scripts/generate-captcha-glyphs.mjs` on a host with Liberation Sans Bold installed.
