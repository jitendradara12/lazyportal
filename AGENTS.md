# AGENTS.md

Monorepo: `packages/core` (zero-dep protocol), `packages/web` (Vite + React UI), `api/` (Vercel proxy), `shared/` (CORS + TLS), `android/` (Capacitor shell).

## Commands
- `npm test` — `core` + `web` + root infra & architecture tests (`node --test`, no network; TLS test needs OpenSSL)
- `npm --workspace @juet/web run dev` / `build` / `test:e2e`
- `npm run cap:sync` — syncs Android policy assets from `core` + builds web into `android/`
- `npm run android:apk` — `cap:sync` + `./gradlew assembleDebug`

## Non-Obvious Invariants
- **Read-only**: no payments or portal mutations.
- **Boundaries** (enforced by `test/architecture.test.js`): acyclic web layering (`lib/data -> hooks -> components -> pages & sections`), no `crypto`/portal URLs/endpoint strings/`toLocale*String()` in `web`, and Android `*-policy.json` assets must stay synced (`npm run cap:sync`).
- **Adding a read**: add reader (+ `featurePostEndpoints` if native) in `packages/core/src/features.js`, run `npm run cap:sync` if policy changed, register via `split()` in `packages/web/src/sections/index.ts`.
- **JUET quirks**: `/token/getcaptcha` fails CORS preflight if `Authorization` is sent; every authenticated call requires a fresh `LocalName` header or returns empty 200; server omits GoDaddy G2 intermediate (`shared/portal-intermediate.pem`); `getstudent-exammarks` drops older exam events so PDF report (`marks.parseMarksReport`) backfills history; portal finalizes daily attendance by 02:00 IST; old APKs have a 20s native read timeout so attendance detail pre-selects proxy.
- **Android signing & `PROD_API_BASE`**: see `docs/ANDROID.md`.
