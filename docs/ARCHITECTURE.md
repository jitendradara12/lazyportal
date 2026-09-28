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
| `features.js` | `getNavigation`, `getFeeSummary`, `getAttendance*`, `getMarks*`, `getExam*`, `getGrade*`, `getSgpa*`, `getPersonalInfo`, `getPendingServiceRequests` + lifecycle, `getNoDues*`, `getHostelDetail`, `getDisciplinary`, `getPayslipDues`, `getNotices`, `getMedicalInfo`, `getFaculties*` | Endpoint paths and payload shapes |

Tests inject the clock, random source, storage, and fetch, so nothing touches the network.

## Web (`packages/web`)

Wiring only. No crypto, no endpoint strings, no storage wiping.

```
lib/portal.ts       # client + store singletons
hooks/useSession.ts # restore session on boot, logout
hooks/useFeature.ts # fetch + error + retry + 401 handling for sections
components/DataViews.tsx # tables, key/value lists, shared error line
sections/           # one file per dashboard section + index.ts registry
pages/LoginPage.tsx # captcha, login once, save session
pages/DashboardPage.tsx # header, anchor nav, registry render
```

To turn a section off, delete its line in `sections/index.ts`. To add one,
add a file plus one registry line. Nothing else changes.

## Adding a feature

Check `main.*.js` for the `dataService.post("/xxx",…)` call and whether the call site encrypts. Add one function in `features.js` with a mocked-client test, then call it from a page. UI never imports `crypto`.

To get the bundle: open `https://studentportal.juet.ac.in/studentportal/`, find the `main.*.js` script URL in page source, download it, and grep. The class timetable does not exist there, only the exam-schedule endpoint, so don't promise one.
