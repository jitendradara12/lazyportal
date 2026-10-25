# Release review, 2026-10-25

Reviewed the local working changes against `661762286cd26b9746de7da8303db5fe929fc60d`,
including new files. Independent architecture, implementation and standards
reviewers found no reason to replace the hybrid design. No hard AGENTS.md breaches
were reported. The fixes below received a final independent review.

## Findings and fixes

- Capability discovery could reject once and permanently strand the new APK,
  even with a healthy proxy. Rejected/malformed discovery now selects the proxy
  before dispatch, with matching refresh policy. A sent native request never
  retries through the proxy. Core and browser regression tests cover this.
- Main-app policy depended on the isolated official view's endpoint list.
  Main feature endpoints now join the main policy independently. Adding a main
  read need not broaden the isolated view.
- Browser CI already existed on PRs and master pushes. The actual gap was tagged
  APK publication. Tags now call the same reusable browser workflow, and release
  publication waits for it as well as the two Android device jobs.
- The production and development proxies bypassed portal TLS validation. Both now
  use default Node roots plus the supplemental intermediate, require a full
  trusted chain, and retain hostname checks. Real offline TLS tests cover repair,
  hostname mismatch, expiry, untrusted roots and intermediate-only rejection.
  An unauthenticated HEAD to JUET's public page returned 200 with TLS authorized.

## Compatibility rules

1. Keep bridge version 1 stable for additive capabilities/endpoints. Breaking
   contracts need an additional compatible adapter for older APKs.
2. Keep the existing hosted entry origin reachable. APK startup and saved
   localStorage/IndexedDB state depend on it.
3. Retain the proxy for browsers, pre-bridge APKs, unsupported installed endpoints
   and failed discovery. Proxy mode is a web deployment plus page reload, not an
   instant change to an already open page.
4. Preserve cached data shapes across web upgrades and rollback. Breaking shapes
   need a new cache key or migration. This change does not alter cache schemas.
5. Public APKs must keep the persistent release signing identity. The privately
   shared debug APK uses another signature with the same app ID; moving from that
   test APK to production generally needs uninstall/reinstall and loses its local
   state.

Broader proxy endpoint restrictions, server abuse protection and telemetry remain
out of scope, per the user's decision. No extra configuration service or framework
is needed for the current architecture.

## Verification

- `npm test`: 383 tests passed, including real offline Node TLS handshakes.
- Full Android Chromium browser suite: 70 tests passed with Playwright's matching
  browser build. An earlier run with the newer system Chrome had timing/focus
  failures; the matching full suite passed without changing the affected tests.
- Production web build and generated-policy checks passed.
- Public JUET page: HTTP 200 with TLS authorized and no student credentials.
- Chromium/WebKit and Android API24/API36 are configured as release gates. WebKit
  and the full native device matrix were not rerun locally during this review.

## Release order

1. Finish automated checks and deploy the backward-compatible web/proxy changes.
2. Smoke-test the deployed website, a pre-bridge APK and the new bridge APK against
   JUET. Cover login, attendance, expired-session recovery and offline retry.
3. Publish the consistently signed APK only after the browser/device release gates
   pass. Keep the old entry URL and proxy available after publication.

Mocked tests and the public-page TLS probe do not replace the authenticated
website/old-APK/new-APK smoke test. These changes have not been deployed or released
from this chat.
