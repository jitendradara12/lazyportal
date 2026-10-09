# Portal compute performance / Vercel Fluid Compute

The web build is static. Portal calls invoke `api/proxy.js`, so this is the
server-side CPU/memory hot path. Client cache and scheduling policies avoid
redundant calls, while proxy streaming bounds memory consumption under load.

## Changes

- Relay upstream responses with `pipeline` and backpressure instead of holding
  all chunks, concatenating them, decoding UTF-8, and re-encoding the result.
  Response memory is bounded by stream buffers rather than response size.
- Set `config.supportsResponseStreaming: true` so the Vercel Node adapter does
  not buffer the streamed response again. Successful responses bypass
  `res.send`'s whole-body copy/ETag generation.
- Keep POST bodies as Buffers with exact byte lengths. A single-chunk body needs
  no extra copy. Request buffering remains necessary because the portal expects
  a known Content-Length, not chunked requests.
- Guard inbound requests with a 512 KiB (`MAX_BODY_BYTES`) body limit, returning
  HTTP 413 (`PayloadTooLargeError`) and safely draining excess client bytes
  without destroying downstream sockets or buffering arbitrary payload sizes.
- Share a keep-alive HTTPS agent across warm/concurrent invocations, retaining
  at most eight idle sockets per origin for at most five seconds. Node may
  shorten that timeout using the upstream's keep-alive hint. Active connections
  are not capped, so this does not introduce a request queue. Node 22 already
  enables keep-alive on its global agent; the explicit pool chiefly bounds idle
  retention and makes this behavior independent of the runtime's defaults.
- Abort upstream work when the browser disconnects; do not keep an abandoned
  invocation waiting for the portal. Remove the handler's cancellation listeners
  on completion. Reuse the header-filter Set and portal hostname at module scope.
- Align the portal day cutoff to 02:00 AM IST (UTC+05:30), reflecting JUET's actual
  midnight batch commit schedule, and dispatch overnight rollover events
  (`juet:refresh-attendance`) when users resume their tab.
- Preserve the daily manual refresh quota when attendance data is unchanged
  (`attendanceChanged`), preventing wasteful quota depletion when the portal returns
  identical data.
- Isolate refresh throttling per screen (20-second cooldown between Attendance
  and Dashboard) rather than enforcing a blunt global lock.
- Optimize subject sheet inspection with on-demand deep-fetch based on row
  checksums (`doesSubjectNeedDeepFetch`), skipping redundant fetches when totals
  match existing cached records.

Unchanged: API paths/methods, auth headers, Origin/Referer spoofing, cookie
rewriting, CORS, 45-second upstream inactivity timeout, 60-second function limit,
and login retries. In-flight request deduplication in core is transient only
(`.finally` cleanup) — no shared cache of student responses is introduced across
requests or sessions.

Streaming changes transport timing, not successful payloads. If the portal fails
before headers arrive, the existing 502 JSON response is returned. If it fails
mid-stream, terminate the response rather than append error JSON to partial data.
The handler awaits stream completion before returning.

## Reproducible synthetic benchmark

```sh
npm run bench:proxy

# Compare with the original handler in this repository's ignored scratch area:
mkdir -p scratch
git show 44fc3a386c3bb0b4fe69e2cd33ab9bc1ab27f9f7:api/proxy.js > scratch/proxy-before.mjs
npm run bench:proxy -- scratch/proxy-before.mjs
```

The benchmark mocks HTTPS (no network, credentials, or real student data), emits
fresh 16 KiB chunks, overlaps requests, and discards downstream bytes. Defaults:
16 concurrent 2 MiB responses, eight rounds, 256 MiB transferred after warm-up.
`PROXY_BENCH_CONCURRENCY`, `PROXY_BENCH_BYTES`, and `PROXY_BENCH_ROUNDS` override
these defaults. Use separate processes and compare several runs; timings and
sampled memory peaks vary with GC and the host.

Example on 2026-10-09, Node 22.22.3, medians of three runs per handler:

| Measurement | Original | Streaming |
|---|---:|---:|
| Process CPU time | 717.09 ms | 211.10 ms |
| Elapsed relay time | 582.34 ms | 155.86 ms |
| Sampled peak RSS | 209.86 MiB | 95.04 MiB |
| Sampled peak JS heap | 37.06 MiB | 8.27 MiB |

This large-response stress test isolates relay work. It does **not** measure
portal latency, TLS handshakes, Vercel's adapter/ETag overhead, typical payload
sizes, or production bill savings. For small responses, stream setup overhead
can offset relay CPU savings; benchmark representative sizes as well as this
stress case. `npm test` also covers backpressure, byte
preservation, headers/cookies, pool configuration, completion, failures, timeout,
and disconnect/upload cancellation using real Node streams and mocked HTTPS.

## Validate after deployment

Fluid's **provisioned memory** usage depends on configured memory and instance
lifetime, not the Node RSS measured above. A smaller heap alone does not imply
an equal percentage reduction in billed GB-hours. Function memory allocation is
intentionally unchanged: lowering it without the project's plan/settings and
production measurements could reduce available CPU or fail deployment.

Compare similar traffic windows before/after deployment:

1. Fluid active CPU per request, provisioned memory usage, and invocation count.
2. Response latency and 502/connection-error rate, especially during portal outages.
3. Actual peak memory under realistic concurrency before considering a smaller
   supported allocation.

Client-side request scheduling and refresh optimizations in PR #17 include aligning
the portal day cutoff to 02:00 AM IST, preserving the daily manual refresh quota when
attendance data has not changed, isolating 20-second throttles per screen, and
avoiding redundant subject detail fetches via row checksums (`doesSubjectNeedDeepFetch`).
Any further behavioral changes or request-volume reductions should be evaluated as
deliberate product decisions based on student user experience rather than compute
metrics alone.
