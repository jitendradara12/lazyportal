# Architecture

System design, boundaries, and operational invariants.

## Structure

- **`packages/core`**: Zero-dependency isomorphic protocol client (crypto, auth, session, features). Runs in Node and modern browsers; tested entirely with injected mocks (no network).
- **`packages/web`**: Vite + React UI shell. Thin consumer; never imports `crypto`, never hardcodes portal endpoints, and never communicates directly with JUET portal hosts.
- **`api/`**: Vercel serverless proxy (`/api/:path*`) providing CORS bridging, header sanitization, streaming responses, and connection pooling for browser traffic.
- **`android/`**: Capacitor shell loading the hosted web bundle (`server.url`) with direct native HTTP transport (`PortalHttp`) and an isolated official portal view.

## Core Invariants

- **Read-only**: All views are read-only. No payment processing, fee transactions, or profile/registration form submissions are supported.
- **Credential security**: Passwords saved via "Remember Password" are encrypted with AES-256-GCM using a non-exportable `CryptoKey` in IndexedDB. Ciphertext, nonce, and identity metadata reside in localStorage (`juet.portal.credentials.v1`). Legacy plaintext passwords migrate on boot.
- **Dual API transport**: The web client routes requests through either the native HTTP bridge (`PortalHttpPlugin`) or the hosted proxy (`/api`).
  - Native transport communicates directly with JUET, bypassing serverless limits and proxy refresh quotas.
  - Proxy transport is used by browsers, pre-bridge APKs, and endpoints not yet allowlisted in the APK policy.
  - Native errors/timeouts do not silently retry across the proxy. Attendance detail selects the proxy before dispatch on APKs without a declared 55-second read timeout. Published APKs without timeout metadata have a 20-second native read timeout, which is too short for normal history responses.
- **TLS validation**: Node and Android environments supply JUET's missing GoDaddy G2 intermediate (`shared/portal-intermediate.pem`) to the system validator without disabling root or hostname checks.
- **Sandboxed official portal**: Android's official portal view runs in an isolated WebView (`https://official.lazyportal.invalid`) with in-memory storage, strict route allowlisting, and no network fallback to Vercel. Session expiry triggers silent recovery in the main app.

## Attendance history

- Saved history remains visible during automatic and manual updates. A matching overview checksum keeps complete history fresh across portal days; age does not trigger a full refetch.
- Background sync loads changed, missing, or incomplete subjects one at a time, with each subject's L/T/P reads in parallel. An open sheet shares the same pending read and pauses queued subjects only while it is loading.
- Sync progress has one phase: idle, running, paused, complete, failed, or cancelled. A portal outage stops queued reads. Failed or cancelled batches preserve successful reads and spend no manual refresh quota.
- Valid completed components are checkpointed as they arrive. A first load can display them immediately; an existing full history stays visible until its replacement is complete. Retry reuse requires the same account, institute, registration, overview snapshot, and portal day.
- Only a missing component ID, an explicit zero component count without positive evidence, or a recognized attendance absence response can establish empty history. JUET's HTTP 404 with `NO Attendance Found` is an empty result; generic HTTP 404s and outages remain failures. Unknown percentages cannot establish empty history.
- Shared history reads own their cancellation signal. Closing a sheet keeps useful reads running for the cache; logout aborts them and invalidates late writes. Manual quota policy includes every route used by the batch, including detail reads through the proxy.

## Compatibility & Deployment

- **Remote web bundle**: The Capacitor shell loads the live deployment URL (`server.url`), allowing web bugfixes and UI updates to deploy instantly without redistributing the APK.
- **Bridge stability**: Native plugin interfaces retain backward compatibility so older APKs continue functioning through proxy fallbacks.
- **Cache evolution**: Cached data structures in localStorage/IndexedDB must maintain backwards compatibility across web deployments.

## Adding Features

1. Check the official portal's `main.*.js` bundle for the endpoint path, request format (plain vs AES JSON), and response shape.
2. Implement the read function in `packages/core/src/features.js` with mocked-client unit tests.
3. If native execution is desired, add the endpoint to `featurePostEndpoints` and run `npm run cap:sync` to update `portal-api-policy.json`.
4. Create the view component under `packages/web/src/sections/` and register it in `packages/web/src/sections/index.ts` (use `enabled: false` if upstream is broken or unstable).
