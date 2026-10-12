<!-- SPDX-License-Identifier: MIT -->

# Security review

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

The security review of the backend and the image (its operational guards, and the security and privacy
principles of [ADR 0035](adr/0035-decisions-inherited-from-the-implementation-plan.md) §4), as a checklist: each item with its status and the evidence, a command and its result. Verified on
2026-10-11 on macOS (arm64), Node 22.23.2, pnpm 10.18.1, against the working tree of that day; the commands
are in [section 13](#13-re-running-the-checks). [threat-model.md](threat-model.md) says what is protected from
whom and why these are the controls that matter; [section 12](#12-open-findings) lists what is still open,
with a severity.

Status: **met** (it held before this review), **fixed** (this review changed it, with a test), **open** (section 12).

| # | Area | Status |
|---|---|---|
| 1 | [Upstream host allowlist](#1-upstream-host-allowlist) | met; project ids tightened (fixed) |
| 2 | [Request bodies: schemas and size](#2-request-bodies-schemas-and-size) | met; body cap lowered to 64 KiB (fixed) |
| 3 | [Rate limits and the stream cap](#3-rate-limits-and-the-stream-cap) | met; `TRUST_PROXY_HOPS` on Cloud Run not measured (open) |
| 4 | [Timeouts](#4-timeouts) | met for Google; request timeouts, and a stall limit (a minimum rate) for clients that stop reading or read too slowly (fixed) |
| 5 | [Response caps and memory](#5-response-caps-and-memory) | fixed: pages scanned, not parsed; a page budget held until the frame is written out; a stalled client can hold budget for a while (open, O11) |
| 6 | [Browser-facing headers](#6-browser-facing-headers) | CSP narrowed, Permissions-Policy added, demo isolated (fixed) |
| 7 | [Logs: no token at any level](#7-logs-no-token-at-any-level) | met, now tested at `trace` |
| 8 | [Errors, request ids, shutdown, static files](#8-errors-request-ids-shutdown-static-files) | met; dotfiles no longer served (fixed) |
| 9 | [Container and Cloud Run](#9-container-and-cloud-run) | met, documented |
| 10 | [Dependency audit and Dependabot](#10-dependency-audit-and-dependabot) | CI job and allowlist (fixed); Dependabot reviewed |
| 11 | [Licence compliance follow-ups](#11-licence-compliance-follow-ups) | fixed |

## 1. Upstream host allowlist

The backend calls Google only at `cloudasset`, `cloudresourcemanager`, `storage` and `oauth2` on
`googleapis.com` (`backend/src/upstream/allowlist.ts`, `UPSTREAM_ORIGINS`). Every upstream URL is parsed with
the WHATWG URL parser and refused unless its scheme is `https:`, its port the default, it has no user info and
its host is exactly one of the four (after the parser's normalisation: case, percent-encoded dots, the default
port). Redirects are never followed (`redirect: "manual"`: a 3xx is an answer, never retried). URLs are built
only from validated parts: the scope, the quota project and the bucket and object names, each percent-encoded
in its path segment.

- **Met.** `backend/src/upstream/allowlist-attacks.test.ts` refuses 37 URLs: other hosts and look-alikes
  (`cloudresourcemanager.googleapis.com.example.com`, `evilcloudasset…`, a trailing dot, a Cyrillic `а`),
  IPv4, IPv6 (`https://[::1]/`), decimal IPs (`https://2130706433/`), the metadata server, user info that
  names an allowed host (`https://cloudasset.googleapis.com@example.com/…`, `…:443@…`), backslash, `#` and `?`
  tricks, encoded hosts (`cloudasset.googleapis%2Ecom.example.com`, `example.com%2Fcloudasset…`), `http:`,
  `ftp:`, `file:`, `javascript:`, `data:`, `wss:`, other ports, and relative URLs; it checks that a refused
  URL never reaches `fetch`, that a redirect is not followed, and that hostile route bodies (a scope with
  `../`, `@`, `//`, a quota project with a CRLF header injection, extra fields, a crafted page token) answer
  400 with no call made.
- **Fixed in this review: project ids as Google names them.** The scope and quota-project schemas accepted any
  `[a-z0-9.:-]+`, so `projects/evil.com` reached Google (one call that cannot succeed; a finding of the
  self-hosting review of 2026-10-10, assigned to this one). `backend/src/upstream/scope.ts` now accepts a number, an id of 6 to 30
  lower-case letters, digits and hyphens starting with a letter, or a legacy domain-scoped id
  (`example.com:my-project`). New cases in `scope.test.ts` and `allowlist-attacks.test.ts`
  (`projects/evil.com`, `projects/demo`, a trailing hyphen, `example:demo-app`, a quota project `evil.com`, a
  `gcsUri` of `https://…` or with `@`).

Evidence, a probe through Fastify's `inject` (a script outside the repository; the real `buildServer`, real
Google for the call that went out) against the code before the change and after it:

```text
before: POST /api/preflight {"scope":"projects/evil.com","mode":"user"} -> 401 (Google was asked)
after:  POST /api/preflight {"scope":"projects/evil.com","mode":"user"} -> 400 "Invalid request: scope: must be
        organizations/ID, folders/ID or projects/ID_OR_NUMBER."
```

## 2. Request bodies: schemas and size

- **Met.** Every route that calls Google validates its body with a zod `strictObject` (unknown fields refused)
  before anything is sent: `/api/scopes/search` (text without control characters, at most 100 characters, at
  most 3 kinds, page size 1 to 100, page token at most 8 KiB and only one this route wrote), `/api/preflight`
  and `/api/assets/stream` (scope, mode, quota project; `readTime` an RFC 3339 timestamp; at most 100
  asset-type patterns of 256 characters), `/api/export/read` (`gs://BUCKET/OBJECT` by Cloud Storage's naming
  rules, at most 1 100 characters, no control characters or lone surrogates). A refusal names the field, never
  the value (`firstIssue` in `upstream/route-support.ts`).
- **Fixed in this review: 64 KiB per body** (`BODY_LIMIT_BYTES` in `backend/src/server.ts`; it was Fastify's 1 MiB).
  The largest legitimate body, a pull with 100 patterns of 256 characters, is about 27 KiB. Tests:
  `server.test.ts`, "request limits".

The same probe:

```text
POST /api/preflight, a 100 KiB body:  before 400 (the schema read it)   after 413 "Request body is too large"
POST /api/preflight, a 2 MiB body:    before 413                         after 413
POST /api/preflight, an unknown field "url": 400 "Invalid request: Unrecognized key: \"url\"."
POST /api/preflight, Content-Type text/xml:  415 "Unsupported Media Type"
POST /api/preflight, invalid JSON:   400 "Body is not valid JSON but content-type is set to 'application/json'"
```

## 3. Rate limits and the stream cap

- **Met.** Per client address: 600 requests a minute on every route but `/healthz` (`@fastify/rate-limit`, in
  memory), 429 with the JSON error shape. Per token hash (SHA-256 of the token, never the token,
  `upstream/token-limit.ts`): 30 streams a minute per streaming route, 30 preflights and 120 scope searches a
  minute, 429 with `retry-after`. Four streams at once per token hash across both streaming routes
  (`stream/slots.ts`), each slot given back exactly once however the stream ends. Tests: `server.test.ts`
  ("limits API requests per client and answers 429 JSON"), `routes/assets.test.ts` ("runs at most four streams
  at once per token", "rate-limits per token hash"), `routes/preflight.test.ts` ("limits requests per token
  hash (429 with retry-after); another token is not affected"), `stream/stream.test.ts`.
- The limits are per instance and in memory: with deploy.sh's ten instances at most, a client can get up to
  ten times the figures. Anyone with a Google account can use a public instance's capacity within them; the
  controls against exhausting memory are in section 5, and `--iap` closes an instance to everyone else
  (section 12, O2).
- **Open (O3, low): `TRUST_PROXY_HOPS=1` on Cloud Run was not measured in this review.** deploy.sh sets it so
  that the per-address limit keys on the client's address as Cloud Run's front end appends it to
  `X-Forwarded-For` (backend/README.md, "Rate limiting"). No deployed instance was available to agents in
  this review.

## 4. Timeouts

- **Met (Google).** 60 s per upstream attempt (the whole exchange for a JSON answer; the idle time for a
  stream), retries of 429, 5xx, timeouts and transport failures with exponential backoff and jitter (500 ms,
  ×2, at most 8 s, 5 attempts), a client that leaves aborts the request in flight and any backoff wait. The
  identity's own calls (metadata server, token endpoints) have 10 s. Tests: `upstream/request.test.ts` ("times
  an attempt out after 60 s, retries it, …", "ends a stream that stays silent for 60 s with a timeout", "stops
  at once, without a retry, when the client aborts during a backoff"), `routes/assets.test.ts` ("cancels the
  upstream request when the client goes away").
- **Fixed in this review: how long a client may take to send its request.** Fastify leaves Node's `requestTimeout` at
  no limit, so a sender that dribbles a request could hold a connection open indefinitely when the service is
  reached without Cloud Run's front end. Now 30 s for the headers (`requestTimeout`, checked every 15 s) and 30
  s for the body (a `preParsing` hook in `backend/src/server.ts`), each answered with 408 and the connection
  closed. The hook is needed because `requestTimeout` set through Fastify does not give the body 30 s: Fastify
  sets it on the server after creating it, when Node has already taken `headersTimeout` from its own default
  (60 s), and Node's periodic check, given a headers limit above the request limit, swaps the two, so the whole
  request would get 60 s. (An earlier version of this section said Node's timer stops once the headers are in;
  that was wrong, and is corrected here with the measurement below.) A response may stream for as long as Google
  answers. Tests: `server.test.ts`, "gives a client a bounded time to send its headers", "… to send its body,
  and closes the connection", "does not limit how long an answer streams". Measured with a 300 ms limit, and
  Node's swap with both limits scaled down (scripts outside the repository):

```text
headers sent without their end:    408 after 438 ms (Node)
a body of 100 bytes announced, 1 sent: 408 after 321 ms (the hook), with every security header, connection closed

Fastify alone, requestTimeout 1.5 s, headersTimeout 3 s (as Node's default 60 s is to 30 s), checked every 100 ms:
headers sent without their end:    408 after 1 534 ms
a body of 100 bytes announced, 1 sent: 408 after 3 093 ms (the larger limit)
Node's own server, requestTimeout 1.5 s given when it is created: the unfinished body, 408 after 1 616 ms
```

- **Fixed in this review (found by its review): a client that stops reading.** A stream asks its producer for the
  next line only once the response has written the previous one out to the connection
  (`backend/src/stream/ndjson.ts`); a line over 1 MiB goes out in pieces of 1 MiB (copies, so a piece waiting
  on the socket does not keep the whole line alive). A piece that has to wait (the connection's buffers being
  full) must be taken whole within 60 s (`STREAM_STALL_MS`); the timer runs from the start of that wait and is
  not restarted when the client takes part of the piece. The stall limit is therefore a minimum rate, not only
  a cut for a client that stops: a client that stops reading, or reads more slowly than about 17 KiB/s (1 MiB
  a minute) while a large page streams, has its connection closed, even while it is still reading. The stream
  ends as `client-stalled` in its log line, and its slot and its page's memory are given back. A client that
  stops is cut off once the piece waiting for it has waited 60 s, which is not 60 s after it stopped: sooner
  if a piece was already waiting, later if none was, as no timer runs while the stream waits on Google or
  while earlier frames still fit in the connection's buffers. A client faster than about 17 KiB/s may take as
  long as it needs, within Cloud Run's request timeout; behind Cloud Run the container's client is Google's
  front end, not the browser (not measured there). Tests: `stream/page-budget.test.ts`, "closes the connection
  of a client that takes nothing for the stall limit, and gives its page back" (a 300 ms limit), "cuts off a
  client that keeps reading, but slower than a piece per stall limit" (a 1 s limit, a client steadily taking a
  quarter of a piece a second: cut off, although no gap between its reads reached the limit) and "lets a
  client that takes more than a piece per stall limit read for as long as it needs" (eight pieces a second:
  the whole 15.6 MiB page and `finished`, after about twice the limit). Measured with the real 60 s limit (the
  real server, a pretend Cloud Asset Inventory, one page, a client reading steadily at the given rate; a
  script outside the repository):

```text
client reading   page       how the stream ended                        client had   longest gap between reads
8 KiB/s          15.6 MiB   client-stalled after 85 329 ms              0.69 MiB     8 002 ms
14 KiB/s         15.6 MiB   client-stalled after 60 222 ms              0.87 MiB     4 573 ms
34 KiB/s         7.8 MiB    finished: all written out after 155 151 ms  5.19 MiB     1 884 ms
```

  The probe's client takes what the socket hands over, up to 64 KiB at a time, so its gaps are that chunk over
  its rate; none came near the limit. A stream is `finished` once the server has written everything out; the
  last 2.6 MiB were then still in the connection's buffers on the loopback. The time before the first piece
  has to wait varies: the review's own probe (8 KiB/s, data taken every 100 ms) was cut off after 60 190 ms in
  one run and 108 989 ms in another.

- Cloud Run cuts any request at deploy.sh's request timeout: 900 s (60 s for `--demo-only`).

## 5. Response caps and memory

The self-hosting review of 2026-10-10 left "a page is buffered whole (up to 25 MiB), four streams per token and no process-wide
cap, against Cloud Run's 512 MiB" to this review, with a measurement.

- **Met.** 25 MiB per Google answer (`MAX_PAGE_BYTES`, `UPSTREAM_MAX_BYTES`; declared or streamed, never
  retried), 4 MiB for an export's metadata and listings, 1 GiB and 10 000 objects per export read, 64 KiB for
  the identity's answers. Tests: `routes/assets.test.ts` ("refuses a page over 25 MiB, declared or streamed,
  without a retry"), `upstream/request.test.ts` ("the byte cap"), `routes/export.test.ts` ("the export read
  caps").
- **Fixed in this review: a page is no longer parsed.** Each page used to be decoded to a string, parsed and
  serialised again, about three copies on the JavaScript heap; V8 sizes the heap to about a quarter of a
  process's memory by default, so a 512 MiB instance has a heap of about 128 MiB.
  `backend/src/stream/list-page.ts` now scans the page's bytes once and writes the `page` frame into one
  buffer outside the heap (whitespace outside strings removed, the assets counted, `nextPageToken` and
  `readTime` read, the structure checked: UTF-8, a top-level object, balanced brackets, terminated strings,
  valid escapes, `assets` an array). Tests: `stream/list-page.test.ts` (300 generated pages whose frame must
  parse to exactly what `JSON.parse` of the page gives, escapes, repeated keys, 19 malformed bodies refused),
  and every existing stream test, which reads the frames back with `@gcportrait/ingest`.
- **Fixed in this review: a process-wide page budget** (`backend/src/stream/page-budget.ts`): a page's bytes are
  claimed as they arrive and given back once the response has written its frame out to the connection
  (`backend/src/stream/ndjson.ts` asks the stream for its next line only then), at once when the page ends the
  stream with an error frame instead, and when the stream ends, the client leaves or stalls; at most 64 MiB at
  once. A page the budget cannot hold is never waited for: the attempt fails as `busy` and is retried like a
  timeout, then the stream ends with a retryable `INSTANCE_BUSY` frame (503). Nothing of a page but its frame
  is kept while the frame waits for a slow client. Tests: `stream/page-budget.test.ts` (claims, refusal
  without waiting, held while the frame waits, given back for a 200 that is not a page and for a 2xx other
  than 200, on close, on a client that goes away, concurrent pulls leave nothing claimed; over a real
  connection, a client that does not read keeps its page claimed and Google is not asked for the next page
  until it reads on, a stalled client is cut off and its page given back, and so is one that reads more slowly
  than a piece per stall limit, while one faster than that is not).
- **Fixed in this review (found by its review): frames waiting for a slow client were not counted.** The budget gave
  a page back as soon as `Readable.from` asked for the next line, which it does once a line has been queued on
  the socket, read or not; so a client that stopped reading kept its page's frame in memory, uncounted, and
  the stream went on to the next page. Clients with different tokens (cheap to get) could add up past the
  budget. Now the claim lasts until the frame is written out (above), and a client that does not take a 1 MiB
  piece within 60 s (it stopped, or reads more slowly than about 17 KiB/s) is cut off (section 4). The
  review's probe, rerun on the same machine before and after the fix: the real server, a pretend Cloud Asset
  Inventory answering one page of 23.9 MiB, 12 clients with different tokens that read the response's first
  bytes and then stop:

```text
                     budget in use      resident memory above the baseline
before the fix       0 MiB              +49 MiB after 1 client, +312 MiB after 12 (about +24 MiB per client)
after the fix        48 MiB (2 pages)   +49 MiB after 1, +73 after 2, +121 MiB after 12
```

  The same with Google's page arriving in 64 KiB chunks, as over a network (that probe built a new 24 MiB
  answer for every retry), 24 clients and a 20 s stall limit, the array-buffer memory counted once (`external`
  already includes `arrayBuffers`, so their sum counts each buffer twice): +25 MiB after the first client,
  +50 MiB (the budget's two pages) from the second on (+70 MiB in one sample, after the 24th client), resident
  memory +96 MiB after 2 clients and +156 MiB after 24. The other 22 pulls ended with `INSTANCE_BUSY` after
  their retries; the stall limit then cut the 2 stalled clients, after which nothing was claimed and the array
  buffers were back at +0 MiB.
- **Fixed in this review (found by its review): two error paths kept their claim.** A 200 answer the scanner refuses
  (`BAD_UPSTREAM_ANSWER`) and a 2xx other than 200 ended the stream with an error frame but never gave the
  page's bytes back, shrinking the budget for the life of the process. `readPage` in
  `backend/src/stream/asset-list.ts` now gives the claim back on every way out except the one that hands it on
  with the frame. The review's probe (the real server through `inject`), bytes still claimed after the stream
  ended:

```text
                                 before      after
a 200 with an HTML body of 1 MiB 1 048 589   0
a 200 with a JSON array          600 003     0
a 203 with a page                1 048 600   0
a valid 200 page                 0           0
```

- **Fixed in this review: an export prefix of folder placeholders alone could be listed page after page.** Every
  listed object now counts against the 10 000, placeholders included (`routes/export.test.ts`, "counts folder
  placeholders too": 10 001 placeholders stop on the eleventh listing page).

The measurement: the real server (`buildServer`) listening on a local port, its streaming route answered by a
pretend Cloud Asset Inventory that returns one page of 500 assets of the given size, N clients reading at full
speed, the process's resident memory sampled every 5 ms (a script outside the repository, run with tsx, which
adds about 100 MiB to the baseline; the pretend page itself is held once). Peak above the baseline; the last
column was measured again after the review's fixes (frames written out before the next line, in 1 MiB pieces),
as the range of three or four runs, since one peak sample varies by tens of MiB:

| Pages at once | Before this review | After it |
|---|---|---|
| 16 pages of 0.8 MiB | +42 MiB | +35 to +37 MiB |
| 8 pages of 4.8 MiB | +100 MiB | +73 to +77 MiB |
| 1 page of 23.9 MiB | +123 MiB | +66 to +81 MiB |
| 4 pages of 23.9 MiB | +410 MiB | +130 to +166 MiB |
| 8 pages of 23.9 MiB | +661 MiB | +188 to +209 MiB |
| 4 pages of 23.9 MiB, heap limited to 128 MiB (`--max-old-space-size=128`) | **crash: "JavaScript heap out of memory"** | completes, +137 to +147 MiB |
| 8 pages of 23.9 MiB, heap limited to 128 MiB | (crashed at 4) | completes, +133 to +164 MiB |

A page near the cap is rare in practice (typical pages are well under a megabyte) but can be crafted by anyone
who controls a project with large resources; before this review four such pages at once ended a process.

- **The render API (ADR 0033, after this review).** `POST /api/render` draws in a fresh `worker_threads` worker
  per render (`backend/src/render/runner.ts`), with a 1 GiB old-generation heap (running out of it answers
  `503 RENDER_TOO_LARGE`); the WebAssembly rasteriser's memory (about 10 bytes per PNG pixel) goes back when the
  worker is terminated, which happens however the render ends. One render per instance (`RENDER_BUSY`, with
  `Retry-After`), `RENDER_MAX_ASSETS`, `RENDER_MAX_PIXELS`, `RENDER_TIMEOUT_MS` and `RENDER_MAX_BODY_BYTES`
  bound one render; a pull's pages go through the page budget above, one at a time. Once the client is gone or
  the time is up, a page Google answers late is not handed to the stopped job, and the job's refusal of a chunk
  is always handled (it was an unhandled rejection, which ends a Node process, until the route's review of
  2026-10-11); an upload still arriving at the 30 s body deadline answers 408 and a malformed one 400, never
  500. Tests: `backend/src/routes/render.test.ts`, `backend/src/render/bundle.test.ts`. deploy.sh gives an
  instance 2 GiB by default (section 9).

## 6. Browser-facing headers

All set on every response, the SPA's files, the API, errors and 404s alike (`backend/src/security.ts`,
`backend/src/server.ts`; tests: `security.test.ts`, `server.test.ts` "security headers", `demo-only.test.ts`
"the Content Security Policy").

- **CSP** (met; narrowed, fixed in this review). No `unsafe-inline` or `unsafe-eval` anywhere: the one inline script,
  the theme bootstrap in `index.html`, is allowed by its SHA-256, computed from the file served (read once at
  start-up and served from memory). `script-src 'self'` plus, with sign-in only, GIS's client script
  `https://accounts.google.com/gsi/client`; `script-src-attr 'none'`, `style-src 'self'`, `img-src 'self'
  data:`, `font-src 'self'`, `worker-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`
  and `form-action 'self'`, no frame source. **Fixed:** `connect-src` listed the four upstream hosts, although
  the browser only ever calls `oauth2.googleapis.com` (tokeninfo, revoke); the backend calls the other three.
  An injected script could have used `storage.googleapis.com` with the person's own token as a way out of the
  page (to a bucket its author controls). Now `connect-src 'self' https://oauth2.googleapis.com
  https://accounts.google.com/gsi/`, and `'self'` alone in demo-only mode.
- **Permissions-Policy** (fixed in this review; helmet sets none): every device, sensor and media feature Chromium
  knows is off (`camera`, `microphone`, `geolocation`, `usb`, `serial`, `hid`, `bluetooth`, `payment`, `midi`,
  `clipboard-read`, `display-capture` and ten more), `clipboard-write=(self)` for the copy buttons. Only
  features Chromium recognises are listed: the browser probe below saw no console warning.
- **COOP, COEP, CORP.** With sign-in: `Cross-Origin-Opener-Policy: same-origin-allow-popups` (met; GIS's
  window hands the token back to its opener) and no embedder policy: without COOP `same-origin` an
  embedder policy isolates nothing and would only refuse cross-origin subresources without CORP, which the CSP
  refuses already (GIS's script, measured on 2026-10-11, is served with `cross-origin-resource-policy:
  cross-origin`). **Fixed in this review:** a demo-only instance has no sign-in, so it sends `same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`: the page is cross-origin isolated.
  `Cross-Origin-Resource-Policy: same-origin` everywhere (met).
- **HSTS** (met): `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Behind Cloud Run the
  front end terminates TLS and the header reaches the browser; `.app` is a top-level domain on the browsers'
  HSTS preload list, so `gcportrait.app` and every `*.run.app` address are HTTPS-only
  before any header. A self-hoster's own domain gets the header after the first visit.
- **Met:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` (for
  browsers without `frame-ancestors`), `Origin-Agent-Cluster: ?1`, `X-Permitted-Cross-Domain-Policies: none`,
  `X-DNS-Prefetch-Control: off`, `cache-control: no-store` on the API.

The production bundle serving the built SPA (section 13), with sign-in configured, then
`DEMO_ONLY=true` (`date`, `etag`, `content-length` and the like left out):

```text
$ curl -sI http://127.0.0.1:8101/
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self';base-uri 'self';script-src 'self' 'sha256-QdeEcAKDy1BE6DNiGHc1Nmd6Roz7I5brUuGlh1DZbBc=' https://accounts.google.com/gsi/client;script-src-attr 'none';style-src 'self';img-src 'self' data:;font-src 'self';connect-src 'self' https://oauth2.googleapis.com https://accounts.google.com/gsi/;worker-src 'self';manifest-src 'self';object-src 'none';frame-ancestors 'none';form-action 'self'
Cross-Origin-Opener-Policy: same-origin-allow-popups
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Frame-Options: DENY
X-Permitted-Cross-Domain-Policies: none
X-XSS-Protection: 0
permissions-policy: accelerometer=(), autoplay=(), bluetooth=(), camera=(), clipboard-read=(), clipboard-write=(self), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), screen-wake-lock=(), serial=(), usb=(), xr-spatial-tracking=()
x-ratelimit-limit: 600
cache-control: no-cache

$ curl -sI http://127.0.0.1:8102/      # DEMO_ONLY=true
Content-Security-Policy: default-src 'self';base-uri 'self';script-src 'self' 'sha256-QdeEcAKDy1BE6DNiGHc1Nmd6Roz7I5brUuGlh1DZbBc=';script-src-attr 'none';style-src 'self';img-src 'self' data:;font-src 'self';connect-src 'self';worker-src 'self';manifest-src 'self';object-src 'none';frame-ancestors 'none';form-action 'self'
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
… (the rest as above)
```

Browser probe (Playwright's Chromium, a script outside the repository): the same build and bundle, the
Connect page, demo organisation M on the diagram (`/diagram#snapshot=demo:M`) and Settings, light and dark:

| Mode | `crossOriginIsolated` | Diagram drawn | Console errors and warnings | `/licenses/THIRD_PARTY_NOTICES.txt` |
|---|---|---|---|---|
| demo-only, light and dark | `true` | yes | none | 200 `text/plain` |
| sign-in configured, light and dark | `false` | yes | none | 200 |

The sign-in flow itself (Google's window and its `postMessage` back) was not run against Google in this
review; nothing it relies on changed (`script-src`, the GIS endpoints and `oauth2.googleapis.com` in
`connect-src`, COOP `same-origin-allow-popups`).

## 7. Logs: no token at any level

- **Met, now tested at `trace`.** The request serializer logs method, path, host and the request headers, but
  only an allowlist of harmless headers keeps its value (`LOGGED_HEADERS` in `backend/src/logging.ts`); every
  other header, `authorization`, `x-gcportrait-token`, `cookie` and IAP's identity headers among them, is
  logged by name as `[redacted]`. A query string is never logged (`/path?[redacted]`), nor a body, nor the
  client address; pino redacts credential headers in anything logged by hand as a second line. Upstream calls
  log a fixed operation name, the host, the status, the attempts and the time; never a URL path, a header
  value or a body. The service-account gate's audit line carries a SHA-256 of the caller's email, never the
  email.
- **New test** `backend/src/log-secrets.test.ts`: the server at `LOG_LEVEL=trace` against a pretend Google,
  every route driven with the token in `X-Gcportrait-Token`, `Authorization: Bearer`, `Authorization: Basic`,
  a query string, a cookie, a JSON field, an invalid JSON body and a malformed header; Google answering with
  errors whose messages quote the token and the email, failing, refusing; service-account mode with its gate,
  audit line and the account's token, and an account token that cannot be had with a message naming it. No log
  line contains either token, the email or `ya29.`. At `trace` the server writes 49 lines on that run, all at
  `info`: nothing in the server or Fastify logs below `info` on these paths.
- **Live run** of the production bundle at `LOG_LEVEL=trace` with a made-up token through every route, Google
  answering for real (and refusing the token):

```text
$ LOG_LEVEL=trace STATIC_DIR=… PORT=8097 HOST=127.0.0.1 node --enable-source-maps backend/dist/server.mjs > live.log
GET    /api/config?access_token=ya29.PROBE-not-a-real-token-0123456789 -> 200
GET    /diagram (cookie: sid=TOKEN)                -> 200
POST   /api/scopes/search (x-gcportrait-token)     -> 401
POST   /api/preflight (authorization: Bearer)      -> 401
POST   /api/assets/stream (x-gcportrait-token)     -> 200, frames:
{"t":"progress","pages":0,"assets":0}
{"t":"error","message":"Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.","status":401,"code":"UNAUTHENTICATED","reason":"ACCESS_TOKEN_TYPE_UNSUPPORTED"}
POST   /api/export/read (x-gcportrait-token)       -> 200 (an error frame)
… and the token in a body field (400), with junk after it (401)
$ grep -c -e ya29 -e PROBE-not-a-real live.log
0
log: 34 lines (12 incoming request, 12 request completed, 5 upstream call, 2 asset stream ended,
     1 export read ended, 1 listening, 1 shutting down), all "level":30
{"severity":"INFO",…,"req":{"method":"GET","url":"/api/config?[redacted]",…}
{"severity":"INFO",…,"req":{"method":"GET","url":"/diagram",…,"headers":{…,"cookie":"[redacted]"}},"message":"incoming request"}
```

## 8. Errors, request ids, shutdown, static files

- **Error messages (met).** A 5xx answer is always the error shape with the message `Internal error.`, its
  status and the request id; the detail goes to the log only (new test in `server.test.ts`, "error answers": a handler throwing a message with a path answers exactly that body). A stream that fails inside the
  server ends with `{"t":"error","message":"Internal error."}`. A 4xx says what was wrong with the request
  without echoing it (section 2). Google's own message is passed on as the actionable part of a 400, 401, 403
  or 404 (skill cai-ingestion §4), only from Google's JSON error envelope (an HTML page is never forwarded),
  cut at 2 000 characters (`upstream/google-error.ts`, `google-error.test.ts`). Start-up errors name the
  variable, never its value (`config.test.ts`); the identity's errors never carry a credential
  (`identity.test.ts`). Accepted: in service-account mode Google's messages about the account's own calls can
  name the instance's project number, which is no secret (it is in the instance's `run.app` address; the
  self-hosting review of 2026-10-10).
- **Request ids (met).** A well-formed incoming `x-request-id` (`[\w.:-]{1,128}`) is kept, anything else
  replaced by a UUID; it is echoed in the response, on every log line as `requestId`, in every error body and
  sent to Google as `x-request-id` (`server.test.ts`, "request ids"; the 500 test above).
- **Graceful shutdown (met).** On SIGTERM (Cloud Run) or SIGINT the process stops accepting connections,
  closes idle keep-alive connections, lets requests in flight finish and exits; after 8 s it exits non-zero,
  inside Cloud Run's 10 s (`backend/src/main.ts`). The live run of section 7 ended with `shutting down` and
  exit code 0. A stream still running after 8 s is cut (section 12, O4).
- **Static files.** **Fixed in this review:** @fastify/static serves dotfiles by default, so a `.env` or `.git` in
  `STATIC_DIR` would have been public (the build has none; an operator's own directory might). Now
  `dotfiles: 'ignore'`. Paths outside the build are refused however they are spelled. `/api` paths are never
  served from files. Tests: `server.test.ts`, "never serves a dotfile or anything in a dot folder" and
  "never serves a file outside the build, however the path is spelled".

The probe of section 1, with a file `.hidden` in its `STATIC_DIR`:

```text
GET /.hidden (a file in STATIC_DIR):  before 200 "secret"   after 404 JSON
GET /..%2f..%2fetc%2fpasswd:          404 JSON
GET /assets/..%2f..%2f..%2fpackage.json: 404 JSON
```

## 9. Container and Cloud Run

- **Image (met).** Two stages; the runtime is `gcr.io/distroless/nodejs22-debian12:nonroot`, pinned by digest:
  no shell, no package manager, no `node_modules` (the server is one bundled file), the user `65532:65532`,
  nothing in `/app` writable (`infra/Dockerfile`). The release workflow starts both platforms' images with
  `docker run --read-only` and checks `/healthz`, `/api/config` and the SPA before it pushes
  (`.github/workflows/release.yml`); `infra/compose.yaml` runs it with `read_only: true`, `cap_drop: ALL` and
  `no-new-privileges`. Since this review the image build stops when `THIRD_PARTY_NOTICES.txt` is missing. Not run
  locally in this review: the review machine has no Docker.
- **Cloud Run (documented).** Cloud Run has no read-only root filesystem setting; the process writes nothing.
  What `infra/deploy.sh` sets ([configuration.md](configuration.md), "Fixed Cloud Run settings"): ingress
  `all`; public (`--allow-unauthenticated`, people still sign in with Google to read anything) or, with
  `--iap`, `--no-allow-unauthenticated` with Identity-Aware Proxy in front and only the listed principals; the
  service runs as the backend's own service account, created with no role at all; 1 CPU, 2 GiB (`--memory`,
  512 MiB to 4 GiB: the render worker's heap and its PNG take most of it; 256 MiB demo-only, which has no render
  API), concurrency 80, 0 to 10 instances (2 demo-only), request timeout 900 s (60 s demo-only),
  `TRUST_PROXY_HOPS=1`; probes on `/healthz`. A demo-only service registers no route that calls Google and
  holds no account (`DEMO_ONLY=true` refuses `OAUTH_CLIENT_ID` and `SA_MODE_ENABLED=true` at start-up). The
  `run.app` address stays reachable next to a domain mapping.

## 10. Dependency audit and Dependabot

- **Fixed in this review: an audit gate.** `node scripts/check-audit.mjs` runs `pnpm audit --json --prod` and `pnpm
  audit --json`, fails on any high or critical advisory, in production or development dependencies, that
  `scripts/audit-allowlist.json` does not accept, and lists moderate and low ones. An accepted advisory needs
  its id, the package, a reason of at least 20 characters, the day it was added and an expiry at most 90 days
  later; after its expiry it fails the gate again, and an entry that no longer matches is reported for
  removal; an entry whose `added` day is after the day of the run fails too (it would run for more than 90 days
  from that day), and every message names the allowlist file read (`--allowlist`). A registry that cannot be
  reached is exit code 2, never a pass. The CI job `audit` in `.github/workflows/pr.yml` runs it on every pull
  request and push to `main` (it is not part of `pnpm check`, whose result must not depend on the day). Tests:
  `scripts/check-audit.test.ts` (19).
- Results on 2026-10-11 05:23 UTC (433 production and 683 dependencies in all, as pnpm counts them):

```text
$ pnpm audit --prod
No known vulnerabilities found
$ pnpm audit
No known vulnerabilities found
$ node scripts/check-audit.mjs
audit: OK on 2026-10-11. Production: 0 advisories, whole tree: 0; no open high or critical one (0 accepted in scripts/audit-allowlist.json).
```

- **Dependabot (reviewed, `.github/dependabot.yml`).** npm (the whole workspace from the root, weekly, minor
  and patch grouped, at most five open pull requests; TypeScript held to 6.0.x and `@types/node` to Node 22 on
  purpose), GitHub Actions (weekly, the shared setup action included) and the two base images of
  `infra/Dockerfile` (weekly, digests; Node held to 22). Every update passes the same CI gates, the licence
  and audit gates included. What the file cannot do, the repository's settings must: **Dependabot alerts** and
  **Dependabot security updates** (Settings → Code security) are repository settings, not checked here
  (maintainer, section 12, O7). Every action of every workflow and of the composite actions is pinned to a
  commit, with its release as a comment (O6, applied on 2026-10-12). Not applied yet: a minimum package age for
  updates (Dependabot's `cooldown`, pnpm's `minimumReleaseAge`).

## 11. Licence compliance follow-ups

The licence review's three items, all **fixed**:

- **A third-party notices file at build time.** `scripts/third-party-notices.mjs`, called by the frontend
  build (`frontend/vite.config.ts`), writes `frontend/dist/licenses/THIRD_PARTY_NOTICES.txt`: every
  third-party package in the app (the exact set the build inlined) and in the server (the backend's production
  dependencies) with its version, licence, home page and copyright lines; each permissive licence's text
  verbatim; the Apache-2.0 text once and every `NOTICE` file found; for an MPL-2.0 package, where its source
  code form is and the section 3.3 notice; the OFL texts of the fonts; the non-affiliation long form (ADR 0018). Every instance
  serves it at `/licenses/THIRD_PARTY_NOTICES.txt`; the app's Settings page links it ("Licences", next to
  gcportrait's own licence, and its notice until the licence decision of 2026-10-12; checked in both themes, axe: 0
  violations); the dev servers (`pnpm dev`,
  `pnpm dev:demo`) answer the same links, the notices there covering the frontend's whole production dependency
  closure (93 packages; `devLicences` in `frontend/vite.config.ts`); the image cannot be built without it and
  names its path in the label `app.gcportrait.third-party-notices`
  (`/app/frontend/dist/licenses/THIRD_PARTY_NOTICES.txt`). On 2026-10-11 (this review's last build): 184 798
  bytes, 91 packages (18 in the app, 74 in the server, `zod` in both; licences MIT, ISC, BSD-3-Clause,
  BlueOak-1.0.0, OFL-1.1 and one Apache-2.0, `fuse.js`, which has no `NOTICE` file; no MPL-2.0 package is
  conveyed); its size follows the dependencies. Tests: `scripts/third-party-notices.test.ts`,
  `frontend/src/pages/SettingsPage.test.tsx`.
- **THIRD_PARTY.md states the obligations precisely**: a new section, "What the licences ask of a copy", with
  Apache-2.0 section 4 (a) to (d), MPL-2.0 sections 3.2, 3.3 and 3.4, OFL-1.1 section 2 and the permissive
  licences, and where each is met.
- **`scripts/check-licenses.mjs`** no longer crashes when pnpm prints "No licenses in packages found" instead
  of JSON (a tree without a third-party package; it threw a `SyntaxError` with a stack trace), and fails when
  a workspace package's `package.json` declares a licence other than the root's, or none. Tests:
  `scripts/check-licenses.test.ts` (two new cases).

Recorded before the licence decision of 2026-10-12 (ADR 0017); `…` stands for the licence identifier printed then.

```text
before: $ node scripts/check-licenses.mjs --root EMPTY_TREE
        SyntaxError: Unexpected token 'N', "No license"... is not valid JSON   (exit 1, a stack trace)
after:  licenses: OK. 0 installed packages are under allowed licences; the workspace packages (1) declare …; THIRD_PARTY.md is up to date.
$ pnpm run licenses
licenses: OK. 558 installed packages are under allowed licences; the workspace packages (13) declare …; THIRD_PARTY.md is up to date.
```

## 12. Open findings

| # | Finding | Severity | What would close it |
|---|---|---|---|
| O1 | The backend accepts any valid Google token, not only those issued to its own OAuth client (a question of the self-hosting review of 2026-10-10). A public instance can therefore be used with a token from any client, `gcloud`'s included. Reading still needs the caller's own permissions, so no data is exposed beyond what the token already reads. | low | The maintainer's decision: checking the audience (tokeninfo, remembered per token hash) would close it and stop scripts that use `gcloud auth print-access-token`. |
| O2 | Anyone with a Google account can use a public instance's capacity, within the limits of section 3; the limits are per address and per token, in memory, per instance. | medium for a public self-hosted instance; none for the demo (no routes that call Google) | Deploy private instances with `--iap` (self-host-options.md). A shared limit across instances would need state, which the design avoids (ADR 0005). |
| O3 | `TRUST_PROXY_HOPS=1` behind Cloud Run's front end not measured. | low | On a deployed instance, check the address the rate limit keys on (a header-reporting build, or two clients). |
| O4 | A stream still running 8 s after SIGTERM is cut and the process exits 1. | low | Acceptable: the browser reports the pull as failed and it can be repeated; Cloud Run sends SIGTERM to instances it retires. |
| O5 | The build account of `deploy.sh --build` holds Storage Admin on its own bucket, which also allows changing that bucket's IAM policy or deleting it (self-hosting review of 2026-10-10). | low | A custom role (Storage Object Admin plus `storage.buckets.get`); needs a real `--build` run to verify, which agents cannot do. |
| O6 | Supply chain: dependency updates have no minimum age. GitHub Actions were pinned by major tag; since 2026-10-12 every action is pinned by commit. | low | Pin actions by commit (done; Dependabot keeps them current) and add `cooldown` to `.github/dependabot.yml` and `minimumReleaseAge` to `pnpm-workspace.yaml` (open, [backlog.md](backlog.md), section 3). |
| O7 | Dependabot alerts and security updates are repository settings. | maintainer | Turn both on in the new repository at hand-off ([backlog.md](backlog.md), "Before the first release"). |
| O8 | Service-account mode: a scope whose `get` is public passes the gate for everyone signed in unless `SA_MODE_STRICT_EXPOSURE=true` (off by default); the audit line's email hash is a plain SHA-256 (pseudonymous). | decision | The maintainer's ([backlog.md](backlog.md), "Maintainer decisions"). |
| O9 | The page scanner checks a page's structure, not every literal (`tru` would pass); the browser parses each frame. | informational | None needed: Google's answers come over TLS from fixed hosts, and a malformed frame ends the import in the browser with an error. |
| O10 | `HOSTED_BY`'s non-affiliation guard (it may not name Google) does not catch look-alikes such as `G00gle` (self-hosting review of 2026-10-10, kept by its fixes). | informational | None: it catches an honest operator's slip. |
| O11 | A client that stops reading keeps its page's claim until the stall limit cuts it off (60 s without taking a 1 MiB piece), and one that takes a piece a minute keeps it for as long as Cloud Run's request timeout (900 s). Two such pulls with pages near the cap hold most of the 64 MiB budget, so meanwhile other pulls' large pages end with a retryable `INSTANCE_BUSY` (small pages still fit). Memory stays within the budget. | low (availability) | A share of the budget per token or per address, or a higher minimum transfer rate than the stall limit's (about 17 KiB/s); neither applied: tokens are cheap to get, and the per-address key behind Cloud Run is not yet measured (O3). `--iap` closes a private instance to strangers. |

## 13. Re-running the checks

```sh
pnpm --filter @gcportrait/backend test                      # 669 tests on 2026-10-11, the security tests among them
pnpm --filter @gcportrait/backend test src/stream/page-budget.test.ts   # the budget, slow and stalled clients
pnpm --filter @gcportrait/backend test src/log-secrets.test.ts   # the trace-level log check alone
pnpm test --project tooling scripts/check-audit.test.ts scripts/third-party-notices.test.ts scripts/check-licenses.test.ts
node scripts/check-audit.mjs                                # the audit gate (needs the network)
pnpm audit --prod && pnpm audit                             # pnpm's own report
pnpm run licenses                                           # licences, THIRD_PARTY.md, workspace licences
node scripts/third-party-notices.mjs --out /tmp/THIRD_PARTY_NOTICES.txt   # the notices without a build
```

Headers and logs of the production bundle (the commands of sections 6 and 7):

```sh
pnpm --filter @gcportrait/frontend build && pnpm --filter @gcportrait/backend bundle   # the SPA, the bundle
LOG_LEVEL=trace PORT=8097 HOST=127.0.0.1 node --enable-source-maps backend/dist/server.mjs > live.log &
curl -sI http://127.0.0.1:8097/                             # the headers of section 6
curl -s -X POST http://127.0.0.1:8097/api/preflight -H 'x-gcportrait-token: ya29.made-up-token' \
  -H 'content-type: application/json' -d '{"scope":"projects/demo-app-1","mode":"user","quotaProject":"demo-app-1"}'
grep -c ya29 live.log                                       # 0
DEMO_ONLY=true PORT=8098 HOST=127.0.0.1 node backend/dist/server.mjs &   # then curl -sI http://127.0.0.1:8098/
```
