<!-- SPDX-License-Identifier: MIT -->

# Security controls

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

The security controls of the backend and the image, as a checklist: each control, where it lives, and the
tests that hold it. They carry out the security and privacy principles of [agents.md](../agents.md), "Security
and privacy"; [threat-model.md](threat-model.md) says what is protected from whom and why these are the
controls that matter. The commands that check them are in [section 13](#13-checking-the-controls), and
[section 12](#12-open-findings) lists what is still open, with a severity.

Status: **in place** (the control holds and a test keeps it), **open** (section 12).

| # | Area | Status |
|---|---|---|
| 1 | [Upstream host allowlist](#1-upstream-host-allowlist) | in place |
| 2 | [Request bodies: schemas and size](#2-request-bodies-schemas-and-size) | in place |
| 3 | [Rate limits and the stream cap](#3-rate-limits-and-the-stream-cap) | in place; `TRUST_PROXY_HOPS` behind Cloud Run open (O3) |
| 4 | [Timeouts](#4-timeouts) | in place |
| 5 | [Response caps and memory](#5-response-caps-and-memory) | in place; a stalled client can hold budget for a while (open, O11) |
| 6 | [Browser-facing headers](#6-browser-facing-headers) | in place |
| 7 | [Logs: no token at any level](#7-logs-no-token-at-any-level) | in place |
| 8 | [Errors, request ids, shutdown, static files](#8-errors-request-ids-shutdown-static-files) | in place |
| 9 | [Container and Cloud Run](#9-container-and-cloud-run) | in place |
| 10 | [Dependency audit and Dependabot](#10-dependency-audit-and-dependabot) | in place; repository settings and a dependency cooldown open (O6, O7) |
| 11 | [Licence compliance](#11-licence-compliance) | in place |

## 1. Upstream host allowlist

The backend calls Google only at `cloudasset`, `cloudresourcemanager`, `storage` and `oauth2` on
`googleapis.com` (`backend/src/upstream/allowlist.ts`, `UPSTREAM_ORIGINS`). Every upstream URL is parsed with
the WHATWG URL parser and refused unless its scheme is `https:`, its port the default, it has no user info and
its host is exactly one of the four (after the parser's normalisation: case, percent-encoded dots, the default
port). Redirects are never followed (`redirect: "manual"`: a 3xx is an answer, never retried). URLs are built
only from validated parts: the scope, the quota project and the bucket and object names, each percent-encoded
in its path segment.

- `backend/src/upstream/allowlist-attacks.test.ts` refuses 37 URLs: other hosts and look-alikes
  (`cloudresourcemanager.googleapis.com.example.com`, `evilcloudasset…`, a trailing dot, a Cyrillic `а`),
  IPv4, IPv6 (`https://[::1]/`), decimal IPs (`https://2130706433/`), the metadata server, user info that
  names an allowed host (`https://cloudasset.googleapis.com@example.com/…`, `…:443@…`), backslash, `#` and `?`
  tricks, encoded hosts (`cloudasset.googleapis%2Ecom.example.com`, `example.com%2Fcloudasset…`), `http:`,
  `ftp:`, `file:`, `javascript:`, `data:`, `wss:`, other ports, and relative URLs; it checks that a refused
  URL never reaches `fetch`, that a redirect is not followed, and that hostile route bodies (a scope with
  `../`, `@`, `//`, a quota project with a CRLF header injection, extra fields, a crafted page token) answer
  400 with no call made.
- **Project ids as Google names them.** `backend/src/upstream/scope.ts` accepts a project number, an id of 6
  to 30 lower-case letters, digits and hyphens starting with a letter, or a legacy domain-scoped id
  (`example.com:my-project`), so a scope such as `projects/evil.com` is refused with 400 before Google is
  asked. Tests: `scope.test.ts` and `allowlist-attacks.test.ts` (`projects/evil.com`, `projects/demo`, a
  trailing hyphen, `example:demo-app`, a quota project `evil.com`, a `gcsUri` of `https://…` or with `@`).

## 2. Request bodies: schemas and size

- Every route that calls Google validates its body with a zod `strictObject` (unknown fields refused) before
  anything is sent: `/api/scopes/search` (text without control characters, at most 100 characters, at most 3
  kinds, page size 1 to 100, page token at most 8 KiB and only one this route wrote), `/api/preflight` and
  `/api/assets/stream` (scope, mode, quota project; `readTime` an RFC 3339 timestamp; at most 100 asset-type
  patterns of 256 characters), `/api/export/read` (`gs://BUCKET/OBJECT` by Cloud Storage's naming rules, at
  most 1 100 characters, no control characters or lone surrogates). A refusal names the field, never the value
  (`firstIssue` in `upstream/route-support.ts`).
- **64 KiB per body** (`BODY_LIMIT_BYTES` in `backend/src/server.ts`); the largest legitimate body, a pull
  with 100 patterns of 256 characters, is about 27 KiB. A larger body is 413, an unknown field 400, another
  content type 415 and invalid JSON 400. Tests: `server.test.ts`, "request limits".

## 3. Rate limits and the stream cap

- Per client address: 600 requests a minute on every route but `/healthz` (`@fastify/rate-limit`, in memory),
  429 with the JSON error shape. Per token hash (SHA-256 of the token, never the token,
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
- deploy.sh sets `TRUST_PROXY_HOPS=1`, so that the per-address limit keys on the client's address as Cloud
  Run's front end appends it to `X-Forwarded-For` (backend/README.md, "Rate limiting"); checking it on a
  deployed instance is open (O3).

## 4. Timeouts

- **Google.** 60 s per upstream attempt (the whole exchange for a JSON answer; the idle time for a stream),
  retries of 429, 5xx, timeouts and transport failures with exponential backoff and jitter (500 ms, ×2, at
  most 8 s, 5 attempts); a client that leaves aborts the request in flight and any backoff wait. The
  identity's own calls (metadata server, token endpoints) have 10 s. Tests: `upstream/request.test.ts` ("times
  an attempt out after 60 s, retries it, …", "ends a stream that stays silent for 60 s with a timeout", "stops
  at once, without a retry, when the client aborts during a backoff"), `routes/assets.test.ts` ("cancels the
  upstream request when the client goes away").
- **Sending a request.** 30 s for the headers (`requestTimeout`, checked every 15 s) and 30 s for the body (a
  `preParsing` hook in `backend/src/server.ts`), each answered with 408 and the connection closed, so a sender
  that dribbles a request cannot hold a connection open when the service is reached without Cloud Run's front
  end. The hook is needed because Node takes `headersTimeout` from its own default (60 s) before Fastify sets
  `requestTimeout`, and its periodic check, given a headers limit above the request limit, swaps the two, so
  the whole request would otherwise get 60 s. A response may stream for as long as Google answers. Tests:
  `server.test.ts`, "gives a client a bounded time to send its headers", "… to send its body, and closes the
  connection", "does not limit how long an answer streams".
- **A client that stops reading.** A stream asks its producer for the next line only once the response has
  written the previous one out to the connection (`backend/src/stream/ndjson.ts`); a line over 1 MiB goes out
  in pieces of 1 MiB (copies, so a piece waiting on the socket does not keep the whole line alive). A piece
  that has to wait (the connection's buffers being full) must be taken whole within 60 s (`STREAM_STALL_MS`);
  the timer runs from the start of that wait and is not restarted when the client takes part of the piece. The
  stall limit is therefore a minimum rate: a client that stops reading, or reads more slowly than about
  17 KiB/s (1 MiB a minute) while a large page streams, has its connection closed, even while it is still
  reading. The stream ends as `client-stalled` in its log line, and its slot and its page's memory are given
  back. No timer runs while the stream waits on Google or while earlier frames still fit in the connection's
  buffers, so a client that stops is cut off once the piece waiting for it has waited 60 s. A client faster
  than about 17 KiB/s may take as long as it needs, within Cloud Run's request timeout; behind Cloud Run the
  container's client is Google's front end, not the browser. Tests: `stream/page-budget.test.ts`, "closes the
  connection of a client that takes nothing for the stall limit, and gives its page back", "cuts off a client
  that keeps reading, but slower than a piece per stall limit" and "lets a client that takes more than a piece
  per stall limit read for as long as it needs".
- Cloud Run cuts any request at deploy.sh's request timeout: 900 s (60 s for `--demo-only`).

## 5. Response caps and memory

- **Caps.** 25 MiB per Google answer (`MAX_PAGE_BYTES`, `UPSTREAM_MAX_BYTES`; declared or streamed, never
  retried), 4 MiB for an export's metadata and listings, 1 GiB and 10 000 objects per export read (every
  listed object counts, folder placeholders included), 64 KiB for the identity's answers. Tests:
  `routes/assets.test.ts` ("refuses a page over 25 MiB, declared or streamed, without a retry"),
  `upstream/request.test.ts` ("the byte cap"), `routes/export.test.ts` ("the export read caps", "counts folder
  placeholders too").
- **A page is scanned, never parsed.** V8 sizes the heap to about a quarter of a process's memory by default,
  and decoding, parsing and serialising a page would hold about three copies of it there.
  `backend/src/stream/list-page.ts` scans the page's bytes once and writes the `page` frame into one buffer
  outside the heap (whitespace outside strings removed, the assets counted, `nextPageToken` and `readTime`
  read, the structure checked: UTF-8, a top-level object, balanced brackets, terminated strings, valid
  escapes, `assets` an array). Tests: `stream/list-page.test.ts` (300 generated pages whose frame must parse
  to exactly what `JSON.parse` of the page gives, escapes, repeated keys, 19 malformed bodies refused), and
  every stream test, which reads the frames back with `@gcportrait/ingest`.
- **A process-wide page budget** (`backend/src/stream/page-budget.ts`): a page's bytes are claimed as they
  arrive and given back once the response has written its frame out to the connection, at once when the page
  ends the stream with an error frame instead (a 200 the scanner refuses, a 2xx other than 200), and when the
  stream ends, the client leaves or stalls; at most 64 MiB at once. A page the budget cannot hold is never
  waited for: the attempt fails as `busy` and is retried like a timeout, then the stream ends with a retryable
  `INSTANCE_BUSY` frame (503). Nothing of a page but its frame is kept while the frame waits for a slow
  client, and the claim lasts until the frame is written out, so clients that stop reading cannot add up past
  the budget. Tests: `stream/page-budget.test.ts` (claims, refusal without waiting, held while the frame
  waits, given back for a 200 that is not a page and for a 2xx other than 200, on close, on a client that goes
  away, concurrent pulls leave nothing claimed; over a real connection, a client that does not read keeps its
  page claimed and Google is not asked for the next page until it reads on, a stalled client is cut off and
  its page given back, and so is one that reads more slowly than a piece per stall limit, while one faster is
  not).
- A page near the cap is rare in practice (typical pages are well under a megabyte) but can be crafted by
  anyone who controls a project with large resources; the scan and the budget keep several such pages at once
  within a 512 MiB instance's heap.
- **The render API.** `POST /api/render` draws in a fresh `worker_threads` worker per render
  (`backend/src/render/runner.ts`), with a 1 GiB old-generation heap (running out of it answers `503
  RENDER_TOO_LARGE`); the WebAssembly rasteriser's memory (about 10 bytes per PNG pixel) goes back when the
  worker is terminated, which happens however the render ends. One render per instance (`RENDER_BUSY`, with
  `Retry-After`), `RENDER_MAX_ASSETS`, `RENDER_MAX_PIXELS`, `RENDER_TIMEOUT_MS` and `RENDER_MAX_BODY_BYTES`
  bound one render; a pull's pages go through the page budget above, one at a time. Once the client is gone or
  the time is up, a page Google answers late is not handed to the stopped job, and the job's refusal of a
  chunk is always handled; an upload still arriving at the 30 s body deadline answers 408 and a malformed one
  400, never 500. Tests: `backend/src/routes/render.test.ts`, `backend/src/render/bundle.test.ts`. deploy.sh
  gives an instance 2 GiB by default (section 9).

## 6. Browser-facing headers

All set on every response, the SPA's files, the API, errors and 404s alike (`backend/src/security.ts`,
`backend/src/server.ts`; tests: `security.test.ts`, `server.test.ts` "security headers", `demo-only.test.ts`
"the Content Security Policy").

- **CSP.** No `unsafe-inline` or `unsafe-eval` anywhere: the one inline script, the theme bootstrap in
  `index.html`, is allowed by its SHA-256, computed from the file served (read once at start-up and served
  from memory). `script-src 'self'` plus, with sign-in only, GIS's client script
  `https://accounts.google.com/gsi/client`; `script-src-attr 'none'`, `style-src 'self'`, `img-src 'self'
  data:`, `font-src 'self'`, `worker-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`
  and `form-action 'self'`, no frame source. `connect-src 'self' https://oauth2.googleapis.com
  https://accounts.google.com/gsi/`, and `'self'` alone in demo-only mode: the browser only ever calls
  `oauth2.googleapis.com` (tokeninfo, revoke) itself, so an injected script cannot use the other Google hosts,
  such as a bucket of its author's on `storage.googleapis.com`, as a way out of the page.
- **Permissions-Policy**: every device, sensor and media feature Chromium knows is off (`camera`,
  `microphone`, `geolocation`, `usb`, `serial`, `hid`, `bluetooth`, `payment`, `midi`, `clipboard-read`,
  `display-capture` and ten more), `clipboard-write=(self)` for the copy buttons. Only features Chromium
  recognises are listed, so the browser logs no warning.
- **COOP, COEP, CORP.** With sign-in: `Cross-Origin-Opener-Policy: same-origin-allow-popups` (GIS's window
  hands the token back to its opener) and no embedder policy: without COOP `same-origin` an embedder policy
  isolates nothing and would only refuse cross-origin subresources without CORP, which the CSP refuses
  already. A demo-only instance has no sign-in, so it sends `same-origin` and `Cross-Origin-Embedder-Policy:
  require-corp`: the page is cross-origin isolated. `Cross-Origin-Resource-Policy: same-origin` everywhere.
- **HSTS**: `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Behind Cloud Run the front end
  terminates TLS and the header reaches the browser; `.app` is a top-level domain on the browsers' HSTS
  preload list, so `gcportrait.app` and every `*.run.app` address are HTTPS-only before any header. A
  self-hoster's own domain gets the header after the first visit.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` (for browsers
  without `frame-ancestors`), `Origin-Agent-Cluster: ?1`, `X-Permitted-Cross-Domain-Policies: none`,
  `X-DNS-Prefetch-Control: off`, `cache-control: no-store` on the API.

What the production bundle sends for the SPA with sign-in configured (`date`, `etag`, `content-length` and the
like left out; the script hash follows `index.html`):

```text
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self';base-uri 'self';script-src 'self' 'sha256-…' https://accounts.google.com/gsi/client;script-src-attr 'none';style-src 'self';img-src 'self' data:;font-src 'self';connect-src 'self' https://oauth2.googleapis.com https://accounts.google.com/gsi/;worker-src 'self';manifest-src 'self';object-src 'none';frame-ancestors 'none';form-action 'self'
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
```

With `DEMO_ONLY=true` the policy names no Google host (`script-src 'self' 'sha256-…'`, `connect-src 'self'`),
and the page is isolated (`Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Opener-Policy:
same-origin`); the rest is the same. A demo-only page is `crossOriginIsolated` in the browser, a page with
sign-in is not; both draw the diagram without console errors or warnings, and both serve
`/licenses/THIRD_PARTY_NOTICES.txt`.

## 7. Logs: no token at any level

- The request serializer logs method, path, host and the request headers, but only an allowlist of harmless
  headers keeps its value (`LOGGED_HEADERS` in `backend/src/logging.ts`); every other header, `authorization`,
  `x-gcportrait-token`, `cookie` and IAP's identity headers among them, is logged by name as `[redacted]`. A
  query string is never logged (`/path?[redacted]`), nor a body, nor the client address; pino redacts
  credential headers in anything logged by hand as a second line. Upstream calls log a fixed operation name,
  the host, the status, the attempts and the time; never a URL path, a header value or a body. The
  service-account gate's audit line carries a SHA-256 of the caller's email, never the email.
- `backend/src/log-secrets.test.ts` runs the server at `LOG_LEVEL=trace` against a pretend Google, every route
  driven with the token in `X-Gcportrait-Token`, `Authorization: Bearer`, `Authorization: Basic`, a query
  string, a cookie, a JSON field, an invalid JSON body and a malformed header; Google answering with errors
  whose messages quote the token and the email, failing, refusing; service-account mode with its gate, audit
  line and the account's token, and an account token that cannot be had with a message naming it. No log line
  may contain either token, the email or `ya29.`, and nothing in the server or Fastify logs below `info` on
  these paths. Section 13 has the same check against the production bundle.

## 8. Errors, request ids, shutdown, static files

- **Error messages.** A 5xx answer is always the error shape with the message `Internal error.`, its status
  and the request id; the detail goes to the log only (`server.test.ts`, "error answers": a handler throwing a
  message with a path answers exactly that body). A stream that fails inside the server ends with
  `{"t":"error","message":"Internal error."}`. A 4xx says what was wrong with the request without echoing it
  (section 2). Google's own message is passed on as the actionable part of a 400, 401, 403 or 404 (the
  cai-ingestion skill, §4), only from Google's JSON error envelope (an HTML page is never forwarded), cut at
  2 000 characters (`upstream/google-error.ts`, `google-error.test.ts`). Start-up errors name the variable,
  never its value (`config.test.ts`); the identity's errors never carry a credential (`identity.test.ts`).
  Accepted: in service-account mode Google's messages about the account's own calls can name the instance's
  project number, which is no secret (it is in the instance's `run.app` address).
- **Request ids.** A well-formed incoming `x-request-id` (`[\w.:-]{1,128}`) is kept, anything else replaced by
  a UUID; it is echoed in the response, on every log line as `requestId`, in every error body and sent to
  Google as `x-request-id` (`server.test.ts`, "request ids"; the 500 test above).
- **Graceful shutdown.** On SIGTERM (Cloud Run) or SIGINT the process stops accepting connections, closes idle
  keep-alive connections, lets requests in flight finish and exits; after 8 s it exits non-zero, inside Cloud
  Run's 10 s (`backend/src/main.ts`). A stream still running after 8 s is cut (section 12, O4).
- **Static files.** `dotfiles: 'ignore'`: a `.env` or `.git` in `STATIC_DIR` is never served (the build has
  none; an operator's own directory might). Paths outside the build are refused however they are spelled
  (`/..%2f..%2fetc%2fpasswd`, `/assets/..%2f..%2f..%2fpackage.json`: 404 JSON). `/api` paths are never served
  from files. Tests: `server.test.ts`, "never serves a dotfile or anything in a dot folder" and "never serves
  a file outside the build, however the path is spelled".

## 9. Container and Cloud Run

- **Image.** Two stages; the runtime is `gcr.io/distroless/nodejs22-debian12:nonroot`, pinned by digest: no
  shell, no package manager, no `node_modules` (the server is one bundled file), the user `65532:65532`,
  nothing in `/app` writable (`infra/Dockerfile`). The image build stops when `THIRD_PARTY_NOTICES.txt` is
  missing. The release workflow starts both platforms' images with `docker run --read-only` and checks
  `/healthz`, `/api/config` and the SPA before it pushes (`.github/workflows/release.yml`);
  `infra/compose.yaml` runs it with `read_only: true`, `cap_drop: ALL` and `no-new-privileges`.
- **Cloud Run.** Cloud Run has no read-only root filesystem setting; the process writes nothing. What
  `infra/deploy.sh` sets ([configuration.md](configuration.md), "Fixed Cloud Run settings"): ingress `all`;
  public (`--allow-unauthenticated`, people still sign in with Google to read anything) or, with `--iap`,
  `--no-allow-unauthenticated` with Identity-Aware Proxy in front and only the listed principals; the service
  runs as the backend's own service account, created with no role at all; 1 CPU, 2 GiB (`--memory`, 512 MiB to
  4 GiB: the render worker's heap and its PNG take most of it; 256 MiB demo-only, which has no render API),
  concurrency 80, 0 to 10 instances (2 demo-only), request timeout 900 s (60 s demo-only),
  `TRUST_PROXY_HOPS=1`; probes on `/healthz`. A demo-only service registers no route that calls Google and
  holds no account (`DEMO_ONLY=true` refuses `OAUTH_CLIENT_ID` and `SA_MODE_ENABLED=true` at start-up). The
  `run.app` address stays reachable next to a domain mapping.

## 10. Dependency audit and Dependabot

- **The audit gate.** `node scripts/check-audit.mjs` runs `pnpm audit --json --prod` and `pnpm audit --json`,
  fails on any high or critical advisory, in production or development dependencies, that
  `scripts/audit-allowlist.json` does not accept, and lists moderate and low ones. An accepted advisory needs
  its id, the package, a reason of at least 20 characters, the day it was added and an expiry at most 90 days
  later; after its expiry it fails the gate again, and an entry that no longer matches is reported for
  removal; an entry whose `added` day is after the day of the run fails too (it would run for more than 90
  days from that day), and every message names the allowlist file read (`--allowlist`). A registry that cannot
  be reached is exit code 2, never a pass. The CI job `audit` in `.github/workflows/pr.yml` runs it on every
  pull request and push to `main` (it is not part of `pnpm check`, whose result must not depend on the day).
  Tests: `scripts/check-audit.test.ts`.
- **Dependabot** (`.github/dependabot.yml`): npm (the whole workspace from the root, weekly, minor and patch
  grouped, at most five open pull requests; TypeScript held to 6.0.x and `@types/node` to Node 22 on purpose),
  GitHub Actions (weekly, the shared setup action included) and the two base images of `infra/Dockerfile`
  (weekly, digests; Node held to 22). Every update passes the same CI gates, the licence and audit gates
  included, and is adopted on `main` or declined with its reason ([agents.md](../agents.md), "Quality gates,
  testing and CI"). Every action of every workflow and of the composite actions is pinned to a commit, with
  its release as a comment. **Dependabot alerts** and **Dependabot security updates** (Settings → Code
  security) are repository settings, not files (O7). Not in place yet: a minimum package age for updates
  (Dependabot's `cooldown`, pnpm's `minimumReleaseAge`; O6).

## 11. Licence compliance

- **A third-party notices file at build time.** `scripts/third-party-notices.mjs`, called by the frontend
  build (`frontend/vite.config.ts`), writes `frontend/dist/licenses/THIRD_PARTY_NOTICES.txt`: every
  third-party package in the app (the exact set the build inlined) and in the server (the backend's production
  dependencies) with its version, licence, home page and copyright lines; each permissive licence's text
  verbatim; the Apache-2.0 text once and every `NOTICE` file found; for an MPL-2.0 package, where its source
  code form is and the section 3.3 notice; the OFL texts of the fonts; the non-affiliation long form. Every
  instance serves it at `/licenses/THIRD_PARTY_NOTICES.txt`; the app's Settings page links it ("Licences",
  next to gcportrait's own licence); the dev servers (`pnpm dev`, `pnpm dev:demo`) answer the same links, the
  notices there covering the frontend's whole production dependency closure (`devLicences` in
  `frontend/vite.config.ts`); the image cannot be built without it and names its path in the label
  `app.gcportrait.third-party-notices` (`/app/frontend/dist/licenses/THIRD_PARTY_NOTICES.txt`). Its size
  follows the dependencies. Tests: `scripts/third-party-notices.test.ts`,
  `frontend/src/pages/SettingsPage.test.tsx`.
- **THIRD_PARTY.md states the obligations precisely**: its section "What the licences ask of a copy" covers
  Apache-2.0 section 4 (a) to (d), MPL-2.0 sections 3.2, 3.3 and 3.4, OFL-1.1 section 2 and the permissive
  licences, and where each is met.
- **`scripts/check-licenses.mjs`** handles a tree without a third-party package (pnpm then prints "No licenses
  in packages found" instead of JSON), and fails when a workspace package's `package.json` declares a licence
  other than the root's, or none. Tests: `scripts/check-licenses.test.ts`.

## 12. Open findings

| # | Finding | Severity | What would close it |
|---|---|---|---|
| O1 | The backend accepts any valid Google token, not only those issued to its own OAuth client. A public instance can therefore be used with a token from any client, `gcloud`'s included. Reading still needs the caller's own permissions, so no data is exposed beyond what the token already reads. | low | The maintainer's decision: checking the audience (tokeninfo, remembered per token hash) would close it and stop scripts that use `gcloud auth print-access-token`. |
| O2 | Anyone with a Google account can use a public instance's capacity, within the limits of section 3; the limits are per address and per token, in memory, per instance. | medium for a public self-hosted instance; none for a demo-only one (no routes that call Google) | Deploy private instances with `--iap` (self-host-options.md). A shared limit across instances would need state, which the stateless backend avoids ([agents.md](../agents.md), "Security and privacy"). |
| O3 | `TRUST_PROXY_HOPS=1` behind Cloud Run's front end is not checked on a deployed instance. | low | On a deployed instance, check the address the rate limit keys on (a header-reporting build, or two clients). |
| O4 | A stream still running 8 s after SIGTERM is cut and the process exits 1. | low | Acceptable: the browser reports the pull as failed and it can be repeated; Cloud Run sends SIGTERM to instances it retires. |
| O5 | The build account of `deploy.sh --build` holds Storage Admin on its own bucket, which also allows changing that bucket's IAM policy or deleting it. | low | A custom role (Storage Object Admin plus `storage.buckets.get`); needs a real `--build` run to verify. |
| O6 | Supply chain: dependency updates have no minimum age. | low | Add `cooldown` to `.github/dependabot.yml` and `minimumReleaseAge` to `pnpm-workspace.yaml` ([backlog.md](backlog.md), section 3). |
| O7 | Dependabot alerts and security updates are repository settings. | maintainer | Turn both on in the repository settings ([backlog.md](backlog.md), "Before the first release"). |
| O8 | Service-account mode: a scope whose `get` is public passes the gate for everyone signed in unless `SA_MODE_STRICT_EXPOSURE=true` (off by default); the audit line's email hash is a plain SHA-256 (pseudonymous). | decision | The maintainer's ([backlog.md](backlog.md), "Maintainer decisions"). |
| O9 | The page scanner checks a page's structure, not every literal (`tru` would pass); the browser parses each frame. | informational | None needed: Google's answers come over TLS from fixed hosts, and a malformed frame ends the import in the browser with an error. |
| O10 | `HOSTED_BY`'s non-affiliation guard (it may not name Google) does not catch look-alikes such as `G00gle`. | informational | None: it catches an honest operator's slip. |
| O11 | A client that stops reading keeps its page's claim until the stall limit cuts it off (60 s without taking a 1 MiB piece), and one that takes a piece a minute keeps it for as long as Cloud Run's request timeout (900 s). Two such pulls with pages near the cap hold most of the 64 MiB budget, so meanwhile other pulls' large pages end with a retryable `INSTANCE_BUSY` (small pages still fit). Memory stays within the budget. | low (availability) | A share of the budget per token or per address, or a higher minimum transfer rate than the stall limit's (about 17 KiB/s); neither is applied: tokens are cheap to get, and the per-address key behind Cloud Run is not yet checked (O3). `--iap` closes a private instance to strangers. |

## 13. Checking the controls

```sh
pnpm --filter @gcportrait/backend test                      # the backend's tests, the security tests among them
pnpm --filter @gcportrait/backend test src/stream/page-budget.test.ts   # the budget, slow and stalled clients
pnpm --filter @gcportrait/backend test src/log-secrets.test.ts   # the trace-level log check alone
pnpm test --project tooling scripts/check-audit.test.ts scripts/third-party-notices.test.ts scripts/check-licenses.test.ts
node scripts/check-audit.mjs                                # the audit gate (needs the network)
pnpm audit --prod && pnpm audit                             # pnpm's own report
pnpm run licenses                                           # licences, THIRD_PARTY.md, workspace licences
node scripts/third-party-notices.mjs --out /tmp/THIRD_PARTY_NOTICES.txt   # the notices without a build
```

The headers and logs of the production bundle (sections 6 and 7): a made-up token sent through a route must
appear in no log line, and the demo-only instance's headers name no Google host.

```sh
pnpm --filter @gcportrait/frontend build && pnpm --filter @gcportrait/backend bundle   # the SPA, the bundle
LOG_LEVEL=trace PORT=8097 HOST=127.0.0.1 node --enable-source-maps backend/dist/server.mjs > live.log &
curl -sI http://127.0.0.1:8097/                             # the headers of section 6
curl -s -X POST http://127.0.0.1:8097/api/preflight -H 'x-gcportrait-token: ya29.made-up-token' \
  -H 'content-type: application/json' -d '{"scope":"projects/demo-app-1","mode":"user","quotaProject":"demo-app-1"}'
grep -c ya29 live.log                                       # 0
DEMO_ONLY=true PORT=8098 HOST=127.0.0.1 node backend/dist/server.mjs &   # then curl -sI http://127.0.0.1:8098/
```
