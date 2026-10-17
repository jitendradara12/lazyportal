# Architecture

Small interfaces, everything tricky behind them.

## Core (`packages/core`, zero dependencies)

| Module | What you call | What it hides |
|---|---|---|
| `crypto.js` | `generateValue`, `encrypt`, `decrypt`, `makeLocalName`, `importKey` | Date-derived AES key, fixed IV, CBC/padding/base64. WebCrypto only, so browsers and Node share it |
| `errors.js` | `PortalError`, `SessionExpiredError`, `CaptchaError`, `toPortalError` | The portal's `{status:{responseStatus,errors}}` shape |
| `session.js` | `createStore`, `memoryAdapter`, `browserLocalAdapter`, `isExpired` | JWT expiry checks, `juet.portal.*` key names |
| `client.js` | `createClient` gives `{post, postRaw, getPublic}` | AES bodies, `Authorization` + `LocalName` headers, 401 mapping. `postRaw`/`getPublic` exist because some endpoints take plain JSON or no auth headers |
| `auth.js` | `fetchCaptcha`, `login` | The two-step login, single-use `random`, parent `P` prefix |
| `captcha.js` | `solveCaptcha` | Offscreen canvas template matcher for the 5-character Arial captcha (no OCR/ML dependencies) |
| `features.js` | `getAttendance*` (+`fetchSubjectAttendance`/`getSubjectAttendanceAll`), `getMarks*`, `getExam*`, `getGrade*`, `getSgpa*`, `getChoice*`, `getFacultyRegistrations`/`getFaculties` | Endpoint paths and payload shapes (read-only views, no payments) |

Tests inject the clock, random source, storage, and fetch, so nothing touches the network.

### Session recovery

`client.js`: `authenticated → recovering → authenticated|expired`. Concurrent 401s
share one refresh attempt; a late 401 reuses a token that attempt already renewed.
A 90-second guard aborts stuck refresh/captcha/login work before publishing
`expired`. The portal's HTTP 200 `Failure` session-expired payload follows the
same path as HTTP 401.

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
components/DataViews.tsx # tables, shared error line
sections/           # one file per dashboard section + index.ts registry;
                    # sections/attendance.tsx is attendance's shared helper module
pages/LoginPage.tsx # captcha, login once, save session
pages/DashboardPage.tsx # header, registry render (skips enabled:false)
pages/AttendancePage.tsx # full attendance view, opened from the dashboard hero
```

Grades/CGPA ship disabled (`enabled: false` in `sections/index.ts`: the new portal
returns 500/empty even officially). New reads: check `main.*.js` for the
`dataService.post("/xxx",…)` call and whether the call site encrypts — one
function in `features.js` with a mocked-client test, then a section file plus one
registry line. UI never imports `crypto`.

The floating install card (`lib/installPrompt.js`, `components/InstallBanner.tsx`) handles
`beforeinstallprompt` on Android and Share → Add to Home Screen guidance on iOS Safari,
with a 14-day dismissal cooldown in `localStorage`.

## Proxy (`api/`)

| Module | What you call | What it hides |
|---|---|---|
| `proxy.js` | Vercel handler for `/api/:path*` | Origin/Referer spoofing, StudentPortalAPI path confinement, GET/HEAD/POST method allow-list, hop-by-hop header stripping, `rejectUnauthorized:false` scoped to the portal host, cookie relay, backpressure-aware response streaming, shared HTTPS idle pool, disconnect cancellation, timeout/502 mapping |
| `shared/cors.js` | `corsHeaders`, `preflightHeaders` | The only origin allowed cross-origin: the Capacitor shell's origin (`WEBVIEW_ORIGIN` ↔ `server.url`, a test asserts the sync). Browser builds are same-origin and need none of it |

### Streaming & resource limits

- Responses relay via `pipeline` with backpressure; `config.supportsResponseStreaming: true` prevents Vercel buffering.
- POST bodies are capped at 512 KiB (HTTP 413) without tearing down the socket.
- Warm invocations share a keep-alive HTTPS agent (≤8 idle sockets, ≤5s retention).
- Downstream disconnect cleanly aborts the upstream request.

### Client scheduling & caching

- Portal day cutover occurs at 02:00 AM IST (`portalSchedule.ts`), resetting daily refresh quotas.
- The attendance overview updates once per portal day. Cached subject history
  stays usable across days while its overview checksum matches; opening a cached
  subject does not revalidate by age. Missing/incomplete history or changed rows
  trigger background reads. Equal percentages can hide new classes (7/7 → 8/8);
  those counts catch up on an overview change or explicit refresh.
- Automatic refresh, manual refresh, and expanded subjects share pending reads
  and cache updates (`requestFeature`, `attendanceSync.ts`). Expanding fresh
  history does not make another request; queued jobs recheck the cache before fetching.
- Explicit attendance refresh rechecks every subject, even with matching cached
  percentages. Quota is committed only after the whole batch succeeds. An unfinished
  manual refresh retains successful reads and change detection for retry on the
  same page and portal day; a new day or changed row requires another read.
  Failed/cancelled batches spend no quota. Sync timestamps advance only on completion.
- In-memory read-through cache for features and sessions, with 20s cooldowns on manual refresh buttons.

### Deployment and asset caching

- `vercel.json` pins the API function to Mumbai (`bom1`), near the app's Indian users and portal.
- Only Vite's generated `/assets/` files get a one-year immutable browser cache.
  Their names contain content hashes, so a new build gets new URLs. Do not put
  unversioned public files under `packages/web/public/assets/`.
- HTML, the service worker, and the manifest keep their normal revalidation policy
  so daily deployments are discoverable immediately.
- The service worker uses cache-first reads for hashed assets, network-first for
  navigation, and background revalidation for other static files. Background
  cache writes use `waitUntil`; storage failures never block an online response.
- API responses bypass the service worker. No shared student-response cache is used.

## Native shell (`android/`)

Capacitor wraps the same web bundle; `lib/apiBase.js` is the only place that
knows the shell must call the hosted proxy by absolute URL instead of `/api`.
Details in `docs/ANDROID.md`.

## Portal bundle

To read an endpoint: open `https://studentportal.juet.ac.in/studentportal/`, find
the `main.*.js` script URL in page source, download it, and grep. The class
timetable does not exist there, only the exam-schedule endpoint.
