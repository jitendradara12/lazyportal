# Architecture

Small interfaces, everything tricky behind them.

## Core (`packages/core`, zero dependencies)

| Module | What you call | What it hides |
|---|---|---|
| `crypto.js` | `generateValue`, `encrypt`, `decrypt`, `makeLocalName`, `importKey` | Date-derived AES key, fixed IV, CBC/padding/base64. WebCrypto only, so browsers and Node share it |
| `errors.js` | `PortalError`, `SessionExpiredError`, `CaptchaError`, `toPortalError` | The portal's `{status:{responseStatus,errors}}` shape |
| `credentials.js` | `createStore`, `browserCredentialKeys` | AES-256-GCM saved passwords, non-exportable per-origin IndexedDB key, legacy plaintext migration |
| `session.js` | `createStore`, `memoryAdapter`, `browserLocalAdapter`, `isExpired` | JWT expiry checks, `juet.portal.*` key names |
| `client.js` | `createClient` gives `{post, postRaw, getPublic, recoverSession, cancelRefresh}` | AES bodies, `Authorization` + `LocalName` headers, 401 mapping. `postRaw`/`getPublic` exist because some endpoints take plain JSON or no auth headers |
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
`recoverSession(token)` joins that same recovery when another transport reports
expiry. Passing the token used by that transport lets a late expiry reuse a newer
session. Failed attempts stay final for that token; logout/session changes cancel
pending recovery.

### Saved passwords

`credentials.js` encrypts remembered passwords with a random AES-256-GCM key
stored as a non-exportable `CryptoKey` in IndexedDB. Each save uses a fresh
96-bit nonce. Only versioned ciphertext, nonce, and account metadata live in
`juet.portal.credentials.v1` in localStorage; username/role are authenticated and
normalized to the portal's login identity. This deliberately does not reuse the
portal's date-derived encryption key.

On app boot, `juet.portal.saved_pw` is removed immediately and migrated to encrypted
storage, including when the session is still valid. Saved passwords are decrypted
only for login/recovery and are never populated into form inputs. Logout, clearing
a profile, and disabling remember remove saved ciphertext and cancel pending writes.
If persistence is blocked, an encrypted in-memory copy supports the current tab;
if WebCrypto is unavailable, login still works but remembering a password cannot.
Missing keys or corrupt ciphertext require password entry again.

This protects against casual inspection of storage, not code or a person able to
execute JavaScript in the app's origin. Session tokens remain in the existing
session store. No backend, unlock prompt, or new dependency is introduced.

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

### Academic calendar and shared calendar modules

The Calendar navigation tab opens `#calendar`, a static Academic Calendar page. Its data comes from
`web/src/data/academic-calendars/*.json`, automatically included by Vite. It
needs no portal read, login refresh, or backend. Contributors fix dates or add
terms through pull requests. The footer links to the data folder's short JSON
guide; PDFs and general university notices are not bundled.

`lib/academicCalendar.ts` owns India-time term selection, range grouping, date
labels and conversion to all-day events. Published end dates are inclusive;
exported all-day end dates are exclusive. Proposed dates and relative/open-ended
rules remain visible but cannot export as fixed events. Events marked “onwards”
keep an unknown end and move to date guidance when their start date arrives. Student and staff dates
are retained separately where the source differs.

`components/Timeline.tsx` shares markers and collapsible groups with Exams while
each page owns its cards and ordering. `lib/calendar.ts` generates Google links
and ICS for timed or all-day events; `calendarActions.ts` owns browser/native
saving, and `CalendarButton.tsx` owns the picker. Existing exam modules adapt
portal rows into this shared format and retain their current behavior.

The native bridge keeps its installed name, `ExamCalendar`. Its additive
`getCapabilities` method reports all-day support. Older APKs retain timed exam
insertion and use Google/ICS for academic events rather than misrepresenting
all-day dates as timed events. Native all-day insertion uses UTC date midnights
and Android's all-day flag; this capability requires an updated APK. Calendar
files and Google links remain available on the web. Imports are snapshots, not
calendar subscriptions.

## Proxy (`api/`)

| Module | What you call | What it hides |
|---|---|---|
| `proxy.js` | Vercel handler for `/api/:path*` | Origin/Referer spoofing, StudentPortalAPI path confinement, GET/HEAD/POST method allow-list, hop-by-hop header stripping, validated portal TLS, cookie relay, backpressure-aware response streaming, shared HTTPS idle pool, disconnect cancellation, timeout/502 mapping |
| `shared/cors.js` | `corsHeaders`, `preflightHeaders` | The only origin allowed cross-origin: the Capacitor shell's origin (`WEBVIEW_ORIGIN` ↔ `server.url`, a test asserts the sync). Browser builds are same-origin and need none of it |
| `shared/portal-tls.js` | `portalTlsOptions` | Default Node trust roots plus JUET's missing intermediate, with certificate/hostname checks enabled and partial-chain trust disabled; shared by production and Vite's portal agents |

The public certificate source is `shared/portal-intermediate.pem`. `cap:sync`
copies it into Android's existing certificate asset, and tests reject drift.
Vercel explicitly bundles the PEM. No global trust store or TLS defaults change.
Offline TLS tests generate temporary certificates with OpenSSL and exercise real
Node handshakes over loopback, including wrong-host, expired and untrusted chains.

### Streaming & resource limits

- Responses relay via `pipeline` with backpressure; `config.supportsResponseStreaming: true` prevents Vercel buffering.
- POST bodies are capped at 512 KiB (HTTP 413) without tearing down the socket.
- Warm invocations share a keep-alive HTTPS agent (≤8 idle sockets, ≤5s retention).
- Downstream disconnect cleanly aborts the upstream request.

### Client scheduling & caching

- Refresh cost controls follow the actual API transport, independently of the
  page's URL. `core/features.js` declares the POST endpoints used by each page;
  `createPortalTransport` exposes `fetch` and `usesProxyFor` using one shared
  capability decision. No page infers transport from `localhost` or Android alone.
- `web/lib/refreshPolicy.ts` owns the two policies. A fully native page has a
  2s tap cooldown and no daily attendance quota or 6h unchanged-result wait.
  A page needing any proxy-backed read keeps the 20s cooldown and existing
  attendance quotas. Native refreshes neither read nor spend saved proxy quotas;
  switching back restores those counters. Pending capabilities use proxy limits.
  Caching, shared in-flight reads, daily automatic sync, cancellation, transport
  concurrency and response limits apply to both routes.
- Portal day cutover occurs at 02:00 AM IST (`portalSchedule.ts`), resetting daily refresh quotas.
- The attendance overview updates once per portal day. Cached subject history
  stays usable across days while its overview checksum matches; opening a cached
  subject does not revalidate by age. Missing/incomplete history or changed rows
  trigger background reads. Equal percentages can hide new classes (7/7 → 8/8);
  those counts catch up when the overview checksum changes.
- Automatic refresh, manual refresh, and expanded subjects share pending reads
  and cache updates (`requestFeature`, `attendanceSync.ts`). Expanding fresh
  history does not make another request; queued jobs recheck the cache before fetching.
- Explicit attendance refresh reads a fresh overview and fetches only changed,
  missing, or incomplete subject history. Quota is committed only after the whole batch succeeds. An unfinished
  manual refresh retains successful reads and change detection for retry on the
  same page and portal day. A new day resets change detection; matching cached
  history remains reusable, while a changed row requires another read.
  Failed/cancelled batches spend no quota. Sync timestamps advance only on completion.
- Failed background detail syncs expose a retry that reuses the overview and
  successful subjects; it does not consume manual refresh quota. Quota blocks
  show “Up to date with portal” without a countdown; attendance updates in the
  midnight batch before the 02:00 AM IST refresh reset.
- Attendance registration LOV expiry is measured from its actual portal lookup,
  not subsequent overview reads. Malformed registration/overview/detail payloads
  cannot replace a good cache entry with an empty result.
- Marks, exams, faculty, and registered subjects use persistent, manual-only caches.
  Missing selections fetch once; returning to a page, reopening the app, focus,
  and attendance day rollover do not revalidate cached entries.
- Refresh buttons target only their page, with independent transport-based cooldowns per
  account/institute/page. Marks refreshes only the selected semester; More
  refreshes only expanded sections. Hidden tabs and collapsed sections do no work.
  Reconnecting revalidates attendance without broadcasting other page reads.
- In-memory read-through cache for features and sessions, with shared in-flight reads.
  Successful feature reads remain available in the tab when localStorage is full
  or blocked; volatile entries are cleared on logout and storage invalidation.

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

Capacitor loads the live `server.url` deployment, so UI releases do not require
installing another APK. `PortalHttpPlugin` handles the main app's supported API
requests directly on the phone using the official view's existing
`PortalTransport` and `PortalTls`. There is no localhost server or listening port.

`core/portalTransport.js` supplies the transport injected into
`createClient`. Encryption, payloads, parsing, captcha and shared session recovery
remain in live core. These depend on JUET's protocol and need to be fixable without
an APK. The stable native layer owns networking, TLS validation, fixed upstream
addresses, exact endpoint checks, request limits and cancellation.

The plugin reports its installed version and GET/POST capabilities once per page.
Browsers and APKs without the plugin use the existing hosted proxy. A reviewed
endpoint present in live `portalApiPolicy` but absent from the installed APK also
uses that proxy, selected before dispatch. Native failures, redirects, HTTP errors,
and cancellation never retry through the proxy. An explicit `VITE_NATIVE_API_BASE`
override uses the proxy for development/forks.

Rejected or malformed capability discovery selects the proxy for that page's
lifetime. Discovery sends no JUET request, so this cannot duplicate a request.
Keep bridge version `1` for additive endpoint changes. A future breaking contract
must retain an adapter for already shipped APKs rather than replacing version 1.

The hosted build can set `VITE_API_TRANSPORT=proxy` to disable native networking;
`auto` is the default and uses installed capabilities per request.
`VITE_ATTENDANCE_QUOTA=auto|on|off` independently selects automatic, forced or
disabled attendance quotas. Tap cooldowns remain transport-based. These are web
build settings, so changing them needs a deployment rather than an APK update.
Both transport adapters and policy selection accept injected inputs for tests.

The separate generated `portal-api-policy.json` adds login/captcha to the reviewed
reads. The isolated official view retains its stricter policy without login.
Neither accepts arbitrary hosts, writes or payments. Both policies are generated
by `cap:sync` and checked against core in tests. Main feature endpoints are included
from `featurePostEndpoints`, independently of the isolated official policy, so a
new main-only read does not grant that operation to the isolated view. Older APKs
use the proxy until their native policy includes the endpoint. New endpoints must
be reviewed explicitly.

The main-app plugin has four workers and a 32-request queue, with the transport's
512 KiB request and 8 MiB response limits. Abort signals cancel individual native
requests. Main-page reload and activity destruction reject pending requests and
disconnect their connections. The plugin does not persist credentials, tokens or
student responses. Session/feature storage remains owned by the live app.
Details and device checks are in `docs/ANDROID.md`.

### Android official portal view

The More page's `OfficialPortalEntry` is available only when Android exposes the
`OfficialPortal` plugin. The main app still loads `server.url` from Vercel. This
feature has **no Vercel function, rewrite, iframe, hosted fallback, or API refresh
on open**. Existing feature caches are unchanged; the main app's API routing
follows the capability selection above.

| Layer | Responsibility |
|---|---|
| `core/officialPortal.js` | Exact reviewed read endpoints, routes, upstream addresses, versioned contract, minimal session handoff and bypass encryption |
| `core/officialPortalRuntime.js` | Bootstrap serialized by the live UI into the isolated view before Angular; seed exact official storage keys, adapt fetch/XHR to native messages, filter navigation to read pages |
| `web/lib/officialPortal.ts` | Capability check, handoff, cancellation on account changes/logout, shared session recovery after native expiry; no credential persistence |
| `OfficialPortalPlugin` | Narrow `open({version, bootstrap})` / `clear()` interface; closes on main-page reload/destruction |
| `officialportal/OfficialPortalView` | Disposable WebView on `https://official.lazyportal.invalid`, floating close/refresh icons, native pinch-to-zoom, origin-scoped message bridge |
| `officialportal/PortalPolicy` | APK-pinned contract; validates exact API path/method, static-resource targets, redirects and navigation independently of remote JavaScript |
| `officialportal/PortalTransport` | Direct JUET networking with fixed Origin/Referer, header allowlist, timeouts, size limits, bounded API concurrency and cancellation; HTML-only bootstrap injection, streaming assets |
| `officialportal/PortalAssetCache` | Up to 32 MiB of public content-hashed JS/CSS, atomically published after EOF; no HTML, tokens or API responses |
| `officialportal/PortalTls` | Supplies JUET's missing intermediate to Android's existing certificate validator for that host only; no new trust anchor or disabled hostname checks |

There is no localhost HTTP server or listening port: WebView resource interception
serves the private HTTPS origin, and its asynchronous message bridge carries API
bodies that ordinary interception cannot read. Every intercepted network request
returns a response, including denials; none falls through to another network
stack or Vercel. The CSP blocks third-party scripts, frames, forms, workers and
connections. An exact alias serves the shell's Material Icons font locally.
The HTML shell receives a 60% initial viewport with native pinch zoom enabled;
the overlay controls consume no page height. Read-only guidance lives on More
and appears as a brief message for blocked actions, rather than a header/banner.

The generated `android/app/src/main/assets/official-portal-policy.json` comes from
core (`node scripts/sync-official-portal.mjs`, also run by `cap:sync`). A test
checks that it matches. The native allowlist is not supplied by the live UI:
adding an endpoint requires a new APK even if the bootstrap contract version
stays compatible. Web/UI/bootstrap changes can still deploy through Vercel.

The official SPA owns its read screens; these are not additional React feature
sections or calls through `features.js`. New Lazyportal-native read sections
continue to follow the existing core feature/section registry pattern.

The session handoff excludes saved passwords and unrelated storage. Only the
isolated origin is cleared on open/close; the main origin's localStorage,
IndexedDB key and cookies remain intact. In-view refresh calls go directly to
JUET. An expired read (HTTP 401 or HTTP 200 session-expired failure) or failed
in-view refresh closes the isolated view and starts the main app's existing
silent recovery through its selected API transport. This first tries token
refresh, then saved credentials and captcha; only a failed recovery exposes manual reconnect. The
user can reopen the portal with the recovered session. No idle timer, resume
polling, automatic reopening, or portal-content proxy fallback is added.
Submissions and payment operations
are denied by native policy, even if a form is reachable in the original SPA.

## Portal bundle

To read an endpoint: open `https://studentportal.juet.ac.in/studentportal/`, find
the `main.*.js` script URL in page source, download it, and grep. The class
timetable does not exist there, only the exam-schedule endpoint.
