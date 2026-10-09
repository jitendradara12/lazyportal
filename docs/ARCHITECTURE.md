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

### Session recovery transitions

`client.js` owns the shared recovery lifecycle: `authenticated → recovering → authenticated`
when renewal succeeds, or `authenticated → recovering → expired` when it gives up.
Concurrent 401s join the same attempt; a late 401 reuses a token another request
already renewed. The 90-second guard aborts the silent refresh/captcha/login work
before publishing `expired`. A failed token is not silently retried again in the
background; explicit session save/logout cancels and invalidates any old attempt.
The portal's HTTP 200 `Failure` session-expired payload follows the same path as
HTTP 401.

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
components/DataViews.tsx # tables, key/value lists, shared error line
sections/           # one file per dashboard section + index.ts registry
pages/LoginPage.tsx # captcha, login once, save session
pages/DashboardPage.tsx # header, anchor nav, registry render (skips enabled:false)
```

To turn a section off, set `enabled: false` in `sections/index.ts`
(grades/CGPA ship disabled: new portal returns 500/empty even officially).
To drop it, delete its line + file. To add one, add a file plus one
registry line and use `useSemester` for the semester pick. Nothing else changes.

## Proxy (`api/`)

| Module | What you call | What it hides |
|---|---|---|
| `proxy.js` | Vercel handler for `/api/:path*` | Origin/Referer spoofing, StudentPortalAPI path confinement, GET/HEAD/POST method allow-list, hop-by-hop header stripping, `rejectUnauthorized:false` scoped to the portal host, cookie relay, backpressure-aware response streaming, shared HTTPS idle pool, disconnect cancellation, timeout/502 mapping |
| `shared/cors.js` | `corsHeaders`, `preflightHeaders` | The only origin allowed to call the proxy cross-origin: the Capacitor WebView (`https://localhost`). Browser builds are same-origin and need none of it |

Proxy performance and Fluid Compute validation: [PERFORMANCE.md](PERFORMANCE.md).

## Native shell (`android/`)

Capacitor wraps the same `packages/web/dist` bundle; `packages/web/src/lib/apiBase.js`
is the single place that knows the shell must call the hosted proxy by absolute
URL instead of `/api`. Everything else — core, sections, hooks — is untouched by
the native build. See `docs/ANDROID.md`.

## Adding a feature

Check `main.*.js` for the `dataService.post("/xxx",…)` call and whether the call site encrypts. Add one function in `features.js` with a mocked-client test, then call it from a page. UI never imports `crypto`.

To get the bundle: open `https://studentportal.juet.ac.in/studentportal/`, find the `main.*.js` script URL in page source, download it, and grep. The class timetable does not exist there, only the exam-schedule endpoint, so don't promise one.
