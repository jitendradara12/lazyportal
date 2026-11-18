# AGENTS.md

Monorepo: `packages/core` (zero-dep isomorphic protocol), `packages/web` (Vite + React UI), `api/` (Vercel proxy), `android/` (Capacitor shell).

## Commands
- `npm install`
- `npm test` — mocked `core` + `web` + root infra tests (`node --test`, no network; TLS test needs OpenSSL)
- `npm --workspace @juet/web run dev` / `build` / `test:e2e` — dev proxies `/api` to JUET (`http://localhost:5173`)
- `npm run cap:sync` — syncs Android policy assets from `core` + builds web into `android/`
- `npm run android:apk` — `cap:sync` + `./gradlew assembleDebug`

## File Map
- `packages/core/src/`: `index.js`, `client.js` (HTTP + 401 refresh), `crypto.js` (AES-128-CBC + IST key), `auth.js`, `session.js`, `credentials.js` (AES-GCM + IndexedDB key), `features.js` (all endpoints + `featurePostEndpoints`), `marks.js`, `captcha.js`, `captchaGlyphs.js`, `portalTransport.js`, `officialPortal.js`, `officialPortalRuntime.js`, `errors.js`
- `packages/web/src/` (acyclic layering: `core -> lib/hooks -> components -> pages & sections`):
  - `lib/`: `portal.ts` (wiring root: `client`, `transport`, `store`, `savedCredentials`, `getRefreshThrottleMs`), `attendanceCalc.ts`, `attendanceSync.ts`, `portalSchedule.ts`, `cgpa.ts`, `marks.ts`, `exams.ts`, `academicCalendar.ts`, `calendar.ts`, `calendarActions.ts`, `examCalendar.ts`, `captchaSolve.ts`, `readPdfText.ts`, `nativeInteractions.ts`, `officialPortal.ts`, `appUpdates.ts`, `installPrompt.ts`, `apiBase.ts`, `backHandlers.ts`, `lazyImport.ts`, `sessionSelection.ts`, `dateFormat.ts`
  - `hooks/`: `useFeature.ts`, `usePageRefresh.ts`, `useSemester.ts`, `useSession.ts`, `usePersistentState.ts`, `useCaptcha.ts`, `useAppBack.ts`, `useKeyboardViewport.ts`, `useThemePreference.ts`, `useDefaultAttendanceTarget.ts`, `useInstallPrompt.ts`, `useSlowRequest.ts`, `useNow.ts`
  - `components/`: `AppBar.tsx`, `NavigationBar.tsx`, `DataViews.tsx`, `SubjectDetailSheet.tsx`, `WhatIfStepper.tsx`, `TargetFab.tsx`, `ReconnectModal.tsx`, `CaptchaFields.tsx`, `Timeline.tsx`, `MonthGrid.tsx`, `CalendarButton.tsx`, `OfficialPortalEntry.tsx`, `AppUpdateAction.tsx`, `InstallBanner.tsx`, `ErrorBoundary.tsx`, `icons.tsx`
  - `pages/`: `AttendancePage.tsx` (home tab), `DashboardPage.tsx`, `LoginPage.tsx`, `AcademicCalendarPage.tsx` (tab), `MorePage.tsx`
  - `sections/`: `index.ts` (`TABS` + `SECTIONS`), `marks.tsx` (+ `cgpa.tsx`), `exams.tsx`, `faculty.tsx`
- `api/proxy.js` & `shared/`: Vercel `/api/:path*` relay, `cors.js` (`WEBVIEW_ORIGIN` === `capacitor.config.json` `server.url`), `portal-tls.js` + `portal-intermediate.pem`
- `scripts/sync-official-portal.mjs` (writes `android/.../assets/*-policy.json`), `test/*.test.js` (root infra/Android/release checks)

## Rules & Non-Obvious Invariants
- **Boundaries**: `web` never imports `crypto`, never hardcodes endpoint strings, and never calls `studentportal.juet.ac.in` directly (use `lib/portal.ts` + `core/features`). All views are read-only; no payments or mutations.
- **Adding a read**: add reader (+ `featurePostEndpoints` if native) in `packages/core/src/features.js` + mocked test → run `npm run cap:sync` if policy changed → register via `split()` in `packages/web/src/sections/index.ts` (`enabled: false` to park). Reuse `useFeature`, `useSemester`, `DataViews`.
- **JUET quirks**: `/token/getcaptcha` fails CORS preflight if `Authorization` is sent; every authenticated API call requires a fresh `LocalName` header or returns empty 200; server omits GoDaddy G2 intermediate (`shared/portal-intermediate.pem`); `getstudent-exammarks` drops older exam events so PDF report (`marks.parseMarksReport`) backfills history; portal finalizes daily attendance by 02:00 IST.
- **Perf & APK**: never call `toLocaleDateString(locale, opts)` in render paths (use `lib/dateFormat.ts`); old APKs without timeout metadata have a 20s native read timeout so attendance detail pre-selects proxy. Benchmark with `packages/web/scripts/bench-load.mjs` & `bench-interact.mjs`. See `docs/ANDROID.md` for signing & `PROD_API_BASE`.
