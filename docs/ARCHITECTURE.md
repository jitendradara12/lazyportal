# Architecture

Small interfaces, everything tricky behind them. Each module below earns its place: delete it and every caller re-implements the same logic.

## Core (`packages/core`, zero dependencies)

| Module | What you call | What it hides |
|---|---|---|
| `crypto.js` | `generateValue`, `encrypt`, `decrypt`, `makeLocalName` | Date-derived AES key, fixed IV, CBC/padding/base64. WebCrypto only, so browsers and Node share it |
| `errors.js` | `PortalError`, `SessionExpiredError`, `CaptchaError`, `toPortalError` | The portal's `{status:{responseStatus,errors}}` shape |
| `session.js` | `createStore`, `memoryAdapter`, `browserLocalAdapter`, `isExpired` | JWT expiry checks, `juet.portal.*` key names |
| `client.js` | `createClient` gives `{post, postRaw, getPublic}` | AES bodies, `Authorization` + `LocalName` headers, 401 mapping. `postRaw`/`getPublic` exist because some endpoints take plain JSON or no auth headers |
| `auth.js` | `fetchCaptcha`, `login` | The two-step login, single-use `random`, parent `P` prefix |
| `features.js` | `getAttendance*` (+`fetchSubjectAttendance`/`getSubjectAttendanceAll`), `getMarks*`, `getExam*`, `getGrade*`, `getSgpa*`, `getChoice*`, `getFacultyRegistrations`/`getFaculties`, `getFeeSummary`, `getPayslipDues`, `getFeeEvents`, `getPersonalInfo`, `getMedicalInfo`, `getPendingServiceRequests` + approved/closed/paid/withdrawn/cancelled | Endpoint paths and payload shapes (read-only views, no payments) |

Tests inject the clock, random source, storage, and fetch, so nothing touches the network.

## Web (`packages/web`)

Wiring only. No crypto, no endpoint strings, no storage wiping.

```
lib/portal.ts       # client + store singletons
lib/installPrompt.js # browser install-event lifecycle + 14-day dismissal policy
hooks/useInstallPrompt.ts # React subscription to the shared install controller
components/InstallBanner.tsx # floating card + inline browser-specific guidance
hooks/useSession.ts # restore session on boot, logout
hooks/useFeature.ts # fetch + error + retry + 401 handling for sections
hooks/useSemester.ts # persisted semester pick (defaults to first row)
lib/officialPortal.ts # bridge current lazyportal session into the proxied official portal shell
components/DataViews.tsx # tables, key/value lists, shared error line
sections/           # one file per dashboard section + index.ts registry
pages/LoginPage.tsx # captcha, login once, save session
pages/DashboardPage.tsx # header, anchor nav, registry render (skips enabled:false)
pages/OfficialPortalPage.tsx # iframe wrapper around the proxied official portal UI
```

To turn a section off, set `enabled: false` in `sections/index.ts`
(grades/CGPA ship disabled: new portal returns 500/empty even officially).
To drop it, delete its line + file. To add one, add a file plus one
registry line and use `useSemester` for the semester pick. Nothing else changes.

## Proxy (`api/`)

| Module | What you call | What it hides |
|---|---|---|
| `proxy.js` | Vercel handler for `/api/:path*` | Origin/Referer spoofing, StudentPortalAPI path confinement, GET/HEAD/POST method allow-list, hop-by-hop header stripping, `rejectUnauthorized:false` scoped to the portal host, cookie relay, timeout/502 mapping |
| `official-portal.js` + `shared/officialPortal*.js` | Vercel handler for `/officialportal/:path*` and Vite dev middleware | Reverse-proxy the official SPA, rewrite `/studentportal` and `/StudentPortalAPI` URLs onto same-origin routes, strip frame-blocking headers, inject a bootstrap script that seeds the official app with the current lazyportal session |
| `shared/cors.js` | `corsHeaders`, `preflightHeaders` | The only origin allowed to call the proxy cross-origin: the Capacitor WebView (`https://localhost`). Browser builds are same-origin and need none of it |

## Native shell (`android/`)

Capacitor wraps the same `packages/web/dist` bundle; `packages/web/src/lib/apiBase.js`
is the single place that knows the shell must call the hosted proxy by absolute
URL instead of `/api`. Everything else — core, sections, hooks — is untouched by
the native build. See `docs/ANDROID.md`.

## Adding a feature

Check `main.*.js` for the `dataService.post("/xxx",…)` call and whether the call site encrypts. Add one function in `features.js` with a mocked-client test, then call it from a page. UI never imports `crypto`.

To get the bundle: open `https://studentportal.juet.ac.in/studentportal/`, find the `main.*.js` script URL in page source, download it, and grep. The class timetable does not exist there, only the exam-schedule endpoint, so don't promise one.
