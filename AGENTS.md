# AGENTS.md

Monorepo: `packages/core` (zero-dep isomorphic protocol: crypto, client, auth, session, features) + `packages/web` (Vite + React, thin wiring only).

## Commands

```sh
npm install
npm test                          # core + web + proxy (node --test, mocked — no network)
npm --workspace @juet/web run dev # dev proxy /api -> portal (portal blocks cross-origin); open http://localhost:5173
npm --workspace @juet/web run build
npm run cap:sync                  # build web + copy into android/ (Capacitor)
npm run android:apk               # cap:sync + ./gradlew assembleDebug
```

## Rules

- Web never imports `crypto`, never hardcodes endpoint strings — all protocol lives in core.
- The native shell (Capacitor) is served from `https://localhost`, which is cross-origin to the hosted proxy: `shared/cors.js` echoes that exact origin and `docs/ANDROID.md` lists what must stay in sync (`WEBVIEW_ORIGIN` ↔ `capacitor.config.json`). Web code never calls the portal host directly.
- New reads: one function in `packages/core/src/features.js` + mocked-client test, then one section file + one line in `packages/web/src/sections/index.ts`. Reuse `useFeature`, `useSemester`, `DataViews`.
- Sections have `enabled?: boolean` — set `false` to park broken ones (grades/CGPA: portal 500s), don't delete.
- No payments / money-movement, ever. Views are read-only.
- Details in `docs/ARCHITECTURE.md`, `docs/PROTOCOL.md` and `docs/ANDROID.md` (native shell: API base, icons, releases).
