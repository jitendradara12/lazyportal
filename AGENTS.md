# AGENTS.md

Monorepo: `packages/core` (zero-dep isomorphic protocol: crypto, client, auth, session, features) + `packages/web` (Vite + React, thin wiring only).

## Commands

```sh
npm install
npm --workspace @juet/core test   # node --test, mocked client/fetch/clock — no network
npm --workspace @juet/web run dev # dev proxy /api -> portal (portal blocks cross-origin); open http://localhost:5173
npm --workspace @juet/web run build
```

## Rules

- Web never imports `crypto`, never hardcodes endpoint strings — all protocol lives in core.
- New reads: one function in `packages/core/src/features.js` + mocked-client test, then one section file + one line in `packages/web/src/sections/index.ts`. Reuse `useFeature`, `useSemester`, `DataViews`.
- Sections have `enabled?: boolean` — set `false` to park broken ones (grades/CGPA: portal 500s), don't delete.
- No payments / money-movement, ever. Views are read-only.
- Details in `docs/ARCHITECTURE.md` and `docs/PROTOCOL.md`.
