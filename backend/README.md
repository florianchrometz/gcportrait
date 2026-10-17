<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/backend

The stateless Fastify 5 service that runs on Cloud Run (Node 22, ESM). It serves the built SPA, and forwards
Cloud Asset Inventory requests with the user's token or, behind a gate, the service account, without storing
anything (AGENTS.md, Security and privacy). It may import `@gcportrait/model`, `@gcportrait/ingest`,
`@gcportrait/catalog` and `@gcportrait/render`; it reaches the frontend only through the render library, and
only in its render worker (`src/render/`), never in `dist/server.mjs` (AGENTS.md, Architecture and code).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` (root) | This service with `tsx watch` on <http://localhost:8080> (pretty logs), plus the Vite dev server. tsx runs with the frontend's tsconfig, so the render worker (which inherits tsx's loader) compiles the frontend's components with their JSX settings. |
| `pnpm --filter @gcportrait/backend dev` | This service alone. Loads `backend/.env` if it exists. |
| `pnpm --filter @gcportrait/backend build` | The same as `bundle`, for `pnpm build`. The type check is `pnpm typecheck`'s: `tsc -b` covers every file under `src/`, the tests and the render job included. |
| `pnpm --filter @gcportrait/backend bundle` | Bundles the service into `dist/server.mjs` and the render worker into `dist/render-worker.mjs` with esbuild, and writes the worker's assets to `dist/render-assets/` (`bundle.ts`, below); what the image runs. |
| `pnpm --filter @gcportrait/backend start` | Runs `dist/server.mjs` with source maps (after `bundle`), serving `../frontend/dist` if it is built. |
| `pnpm --filter @gcportrait/backend test` | Unit and HTTP tests (Vitest with `fastify.inject`, no network). |

## Development vs production serving

- **Development.** Vite serves the SPA on :5173 and proxies `/api` to this service on :8080. There is no
  `frontend/dist`, so this service answers only the API. Any other path gets a 404 JSON body that points to
  the Vite dev server.
- **Production image.** `frontend/dist` (or `STATIC_DIR`) holds the build and is served from here. Hashed
  files under `assets/` get `cache-control: public, max-age=31536000, immutable`; other files revalidate
  (`no-cache`). A GET or HEAD for a client-side route (a path whose last segment has no dot, such as
  `/diagram`) gets `index.html` (the SPA fallback); a missing file such as `/assets/missing.js` gets a 404.
  `index.html` is read once at start-up and served from memory, so the CSP hash of its inline theme script
  always matches what is sent.
- **API paths are never shadowed.** Routes under `/api` are matched first. Static files are refused for `/api`
  paths even if the build contains an `api/` folder. An unknown `/api/*` path always gets the 404 of the error
  shape (below, "Errors") with the `code` `ROUTE_NOT_FOUND`.

## Routes

| Route | Response |
|---|---|
| `GET /healthz` | `{ status: "ok", version }`. Not rate limited, logged at warn level only. On Cloud Run only the container's probes reach it: from outside, Cloud Run's front end answers `/healthz` itself with a 404 (it keeps paths ending in `z`), so check `/api/healthz` there. |
| `GET /api/healthz` | The same answer, for checks from outside a Cloud Run service (deploy.sh's readiness wait, the docs). Rate limited like every `/api` route, logged at warn level only. |
| `GET /api/config` | `{ oauthClientId, saMode, saStrictExposure, backendServiceAccount, version, sourceUrl, hostedBy, demo: false, demoOnly, legal: { impressum, privacy, impressumUrl, privacyUrl }, render }` (`src/routes/config.ts`; `render` is the render API's limits, or null where it is off). `demoOnly` is `DEMO_ONLY` (then no client, no service-account mode, no account). `legal.impressum` and `legal.privacy` say which legal pages the instance serves as texts (`/api/legal`); `legal.impressumUrl` and `legal.privacyUrl` are the addresses of those it links instead (`LEGAL_IMPRESSUM_URL`, `LEGAL_PRIVACY_URL`; https, or null), for the app's footer. Public by design: nothing in it is a secret. `oauthClientId` is the OAuth web client the SPA's Google sign-in uses (null: sign-in is not offered); with service-account mode on, `backendServiceAccount` is the account Application Default Credentials resolved to and `saStrictExposure` says whether the gate runs its exposure check (section "Service-account mode"); `sourceUrl` is where the source of the running version is published (`SOURCE_URL`); the app's footer links to it as "Source (MIT)". `hostedBy` is one line the Connect page shows next to "Sign in with Google", so a person knows who runs the instance before granting it access: "Hosted by NAME." (`HOSTED_BY`), or null when none is set; the non-affiliation statement is the footer's. |
| `GET /api/legal` | `{ impressum, privacy }`: the Markdown of each legal page from `LEGAL_DIR` or `LEGAL_BUNDLE` (`src/legal.ts`, `src/routes/legal.ts`), or null for a page the instance does not publish. Public; registered in every mode. |
| `POST /api/scopes/search` | `{ scopes: [{ kind, scope, id, displayName, parent?, projectNumber? }], nextPageToken?, problems }` for `{ query, kinds?, pageSize?, pageToken? }`: the organisations, folders and projects the caller can see (`src/routes/scopes.ts`, section "Scope search and preflight"). Needs the caller's token. |
| `POST /api/preflight` | The permission checklist for `{ scope, mode: "user" \| "sa", quotaProject? }` (`src/routes/preflight.ts`, `src/preflight/`): status per item, copy-ready `gcloud` commands. In service-account mode a refusal of the gate is a 403 (or 401, 503) whose body carries the checklist as `preflight`. Needs the caller's token. |
| `POST /api/assets/stream` | NDJSON frames of a live pull for `{ scope, readTime?, contentType: "RESOURCE", assetTypes?, mode: "user" \| "sa", quotaProject? }` (`src/routes/assets.ts`, section "Live pull and export read"). Needs the caller's token. |
| `POST /api/export/read` | The NDJSON lines of a Cloud Asset Inventory export in Cloud Storage, for `{ gcsUri }` (`src/routes/export.ts`). Needs the caller's token. |
| `POST /api/render` | An SVG, PNG or draw.io file of a view of a scope (a live pull), an uploaded export or bundle, or a demo organisation (`src/routes/render.ts`, section "Render API"). Needs the caller's token; absent with `RENDER_API=false`. |
| `GET /*` | SPA files and the SPA fallback (production image only), as above. |

**Demo-only mode** (`DEMO_ONLY=true`; AGENTS.md, Modes and hosting): the routes that need the caller's token,
the render API among them, are not registered, so they answer the JSON 404 of an unknown route (with a
sentence saying why); everything else above stays, rate limits included, and the CSP allows no Google host.
`src/demo-only.test.ts` holds the route matrix; `src/demo-only-harness.testing.ts` runs this mode for
`e2e/tests/demo-only.spec.ts`.

**The caller's token** (`src/stream/caller.ts`; AGENTS.md, Security and privacy, Tokens) comes in
`X-Gcportrait-Token: TOKEN`, the header the app sends, which Identity-Aware Proxy in front of an instance
leaves alone. Only a request without that header may send `Authorization: Bearer TOKEN` instead (scripts
against a public instance; the scheme in any letter case); a malformed `X-Gcportrait-Token` is a 401, never
replaced by `Authorization`. Neither value is ever logged (below). Upstream the token always goes to Google
as `Authorization: Bearer`.

API responses carry `cache-control: no-store` and `x-request-id`.

## Configuration

`src/config.ts` parses the environment once with zod into a frozen, typed `ServerConfig`. An invalid value
stops start-up with a message that names the variable but not its value. `backend/.env.example` documents
every variable: `PORT`, `HOST`, `LOG_LEVEL`, `LOG_FORMAT`, `OAUTH_CLIENT_ID`, `SA_MODE_ENABLED` (only the
exact string `true` enables it; every other value leaves it off, and a value other than `true`/`false` is
logged as a start-up warning), `SA_MODE_STRICT_EXPOSURE` (`true` or `false`, off when unset; any other value
stops start-up), `DEMO_ONLY` (the same rule; with it, `OAUTH_CLIENT_ID` and `SA_MODE_ENABLED=true` stop
start-up), `LEGAL_DIR` or `LEGAL_BUNDLE` (legal pages served as texts, read and checked once at start-up,
`src/legal.ts`), `LEGAL_IMPRESSUM_URL` and `LEGAL_PRIVACY_URL` (legal pages linked instead: https URLs; a page
linked and served at once stops start-up), `BACKEND_SA_EMAIL` (with service-account mode on, optional and
checked against the account Application Default Credentials resolve to; section "Service-account mode"),
`HOSTED_BY` (who runs the instance: plain text on one line, at most 80 characters, and never naming Google),
`STATIC_DIR`, `TRUST_PROXY_HOPS`, `APP_VERSION`, `SOURCE_URL`, and the render API's `RENDER_API`,
`RENDER_MAX_ASSETS`, `RENDER_MAX_PIXELS`, `RENDER_TIMEOUT_MS` and `RENDER_MAX_BODY_BYTES` (section "Render
API"). Nothing in it is a secret, and no credential is ever configured through the environment: the OAuth
client's secret is never used (the browser's token client needs only the id; see
[docs/self-host-options.md](../docs/self-host-options.md), "The OAuth client in detail"). The service
account's own credentials are found the way Application Default Credentials are
(`GOOGLE_APPLICATION_CREDENTIALS`, gcloud's file, the metadata server), never through a variable of this
service.

`SOURCE_URL` (an `http://` or `https://` URL; anything else stops start-up) is where the source of the running
version is published. The app links to it in its footer, "Source (MIT)" on every route, linking to `sourceUrl`
from `/api/config`: a courtesy to the people who use the instance, since gcportrait is licensed under the MIT
License, which does not ask for it. The default, `https://github.com/florianchrometz/gcportrait`
(`DEFAULT_SOURCE_URL` in `src/config.ts`), is the project's repository, the right target for an unmodified
deployment; a fork changes it (docs/contributing.md, Releases). Whoever runs a modified version and publishes
its source can point `SOURCE_URL` there.

## Security and logging

- **Headers** (`@fastify/helmet`): a CSP with no `unsafe-*` source. It allows `'self'` for scripts, styles,
  fonts, workers and connections, `data:` images, and connections to `oauth2.googleapis.com`, the one Google
  API host the browser itself calls (tokeninfo, and revoking a token on sign-out); `cloudasset`,
  `cloudresourcemanager` and `storage` stay out, since only the backend calls them. The SPA's inline theme
  script is allowed by its SHA-256 hash, computed from the served `index.html` (`src/security.ts`). Google
  Identity Services adds exactly two sources: `script-src https://accounts.google.com/gsi/client` (its client
  script, which the SPA loads only when someone presses "Sign in with Google") and
  `connect-src https://accounts.google.com/gsi/` (its own endpoints). Sign-in happens in a window of Google's,
  not a frame, so `frame-src` stays closed. The script also tries to add a stylesheet for Google's sign-in
  button; the CSP refuses it on purpose (one console message per page load of the script), because the token
  client draws nothing on the page. Demo-only mode allows no Google source at all. Also set: HSTS, `nosniff`,
  `frame-ancestors 'none'` plus the matching `X-Frame-Options: DENY` for browsers without CSP framing support,
  `Referrer-Policy: no-referrer`, same-origin CORP, and a `Permissions-Policy` that switches off every device,
  sensor and media feature Chromium knows except `clipboard-write` for the page itself (the copy buttons).
  [docs/security.md](../docs/security.md) lists each control with the tests that hold it.
- **Cross-origin isolation in demo-only mode**: `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`, so the page is cross-origin isolated; it loads nothing from
  another origin there. With sign-in the opener policy stays as below and no embedder policy is sent
  (`crossOriginPolicies` in `src/security.ts` says why).
- **Static files**: dotfiles and dot folders are never served (`dotfiles: 'ignore'`; @fastify/static serves
  them by default), nor anything outside the build directory.
- **Request limits**: bodies up to 64 KiB (`BODY_LIMIT_BYTES`; the largest legitimate one, a pull with
  100 asset-type patterns, is about 27 KiB); 30 s to send a request's headers (Node's `requestTimeout`, which
  Fastify leaves unlimited) and, separately, 30 s for its body (a `preParsing` hook), each answered with 408.
  The hook is needed because Fastify sets `requestTimeout` after creating the server, when Node has already
  taken `headersTimeout` from its 60 s default, and Node's check then swaps the two: the whole request would
  get 60 s (`REQUEST_TIMEOUT_MS` in `src/server.ts` says how). A response may stream for as long as Google
  answers and the client keeps up: a client that does not take a 1 MiB piece within 60 s, about 17 KiB/s, is
  disconnected (below).
- **Cross-Origin-Opener-Policy: `same-origin-allow-popups`** (not `same-origin`). The GIS token client opens
  Google's sign-in in a window of its own; that window hands the token back to the page through `postMessage`
  to its opener, and GIS watches whether the person closed it. Under `same-origin` the browser puts a
  cross-origin window this page opens into another browsing context group: the window has no opener and the
  page's handle reads as closed at once, so sign-in could never finish. In Chromium, under
  `same-origin-allow-popups` a window the page opens to `accounts.google.com` keeps `window.opener` and the
  page sees `closed === false`; under `same-origin` the window has no opener and the page sees `closed ===
  true`. `same-origin-allow-popups` keeps that link only for windows the page opens itself and still isolates
  the page from any cross-origin page that opens it. Google's own error page (an unknown client id, an origin
  that is not authorised) sends `same-origin` itself, so then the link breaks anyway and the app says the
  window closed or showed an error.
- **Rate limiting** (`@fastify/rate-limit`): 600 requests per minute per client address on every route except
  `/healthz`, unknown paths included. A 429 has the JSON error shape. The routes that call Google add a limit
  per token hash (below). Behind Cloud Run set `TRUST_PROXY_HOPS=1` so the limit keys on the real client
  address. Fastify 5 accepts a bare hop count for `trustProxy` but deliberately fails closed with it (it
  trusts no address, because a hop count cannot tell a proxy from a client that connects directly and sends
  its own `X-Forwarded-For`). `src/server.ts` therefore passes a trust function, `(address, hop) => hop < n`,
  which restores hop-count trust on purpose. That is only safe where clients cannot reach the container
  directly, as on Cloud Run; leave `TRUST_PROXY_HOPS` at 0 anywhere else.
- **Request ids**: a well-formed incoming `x-request-id` is kept, otherwise a UUID is minted. It is echoed in
  the response and logged as `requestId`.
- **Logs** (pino, JSON on stdout): `message` and `severity` fields so Cloud Logging classifies lines without a
  router rule. No credential, session or user identity ever reaches a log line (AGENTS.md, Security and
  privacy, The backend). The request serializer logs method, path, host and the request headers, but only an
  **allowlist** of harmless headers keeps its value (`LOGGED_HEADERS` in `src/logging.ts`: `accept*`,
  `content-length`, `content-type`, `host`, `origin`, `traceparent`, `user-agent`, `x-cloud-trace-context`,
  `x-forwarded-proto`). Every other header is logged by name with the value `[redacted]`. An allowlist,
  because behind Cloud Run and IAP credentials and identity arrive in headers whose names give no hint of it:
  `x-goog-iap-jwt-assertion`, `x-goog-authenticated-user-email`/`-id`, `x-serverless-authorization`,
  `x-api-key`. A query string is never logged (`/path?[redacted]`): the API takes JSON bodies and the SPA
  keeps its view in the URL hash, which never reaches the server. Request and response bodies are never
  logged. Nor is the client address (direct or forwarded): it identifies a person, so rate limiting keys on it
  in memory only. As a second line of defence pino redacts those credential headers, `x-gcportrait-token` (the
  caller's token) included, in any object logged by hand with a `headers` field. `LOG_LEVEL` sets the level;
  `LOG_FORMAT=pretty` (used by `pnpm dev`) routes through pino-pretty.
- **Errors**: every error answer of every route, of the error handler, of unknown paths and of the rate
  limiter is built by `src/errors.ts` in one shape, `{ statusCode, error, message, requestId, code,
  retryable?, reason?, upstream? }` (`ErrorResponseSchema` in `src/schemas.ts`; [docs/api.md](../docs/api.md),
  "Errors", lists the codes): `code` is the one the caller names, else its status's (`DEFAULT_CODES`: 400
  `INVALID_REQUEST`, 401 `UNAUTHENTICATED`, 404 `NOT_FOUND`, 408 `REQUEST_TIMEOUT`, 413 `BODY_TOO_LARGE`, 415
  `UNSUPPORTED_MEDIA_TYPE`, 429 `RATE_LIMITED`, 500 `INTERNAL`; `ERROR` for any other), every 401 carries
  `WWW-Authenticate: Bearer`, and an answer with a delay or `retryable: true` carries `Retry-After`. 5xx
  responses never carry internal messages, only `Internal error.` plus the request id; the details go to the
  log.

## Scope search and preflight

Both routes call Google with the caller's own token, through the allowlisted client
(`src/upstream/request.ts`: the four hosts of `src/upstream/allowlist.ts` only, matched exactly on the parsed
URL, https on the default port, no redirect followed (`redirect: "manual"`: a 3xx is an answer like any other
status, never retried), 60 s, 25 MiB (`UPSTREAM_MAX_BYTES`, the live pull's pages included), retries of 429
and 5xx by skill cai-ingestion §4: `isRetryableStatus` in `src/upstream/retry.ts`, which also decides what the
checks count as transient and when the error frame of a page, export metadata lookup, listing or object is
`retryable`).
`src/upstream/google.ts` makes the calls: it forwards the bearer token verbatim, sends the incoming request id
upstream as `x-request-id`, and logs one line per call with a fixed operation name, the host, the status, the
attempts and the time (never a URL path, which carries the scope, a header value or a body). Its
`assetsListRequest` is the one `assets.list` request, of the preflight's probe and of every page of the live
pull, and the one place that sends `x-goog-user-project`: in user mode only. Every JSON answer is read by
`src/upstream/json.ts` (a body that is not UTF-8 or not JSON reads as nothing, never as an exception). Answers
are classified by HTTP status and the `ErrorInfo` reason, never by message text; Google's message is passed on
only from a JSON error body, never from an HTML page, cut at 2 000 characters. One parser reads Google's error
envelope for every route (`src/upstream/google-error.ts`), and one reading of it is what every route reports:
a preflight item's, a gate refusal's or a search problem's `upstream` and a stream's error frame carry the
same status, canonical code (the one the HTTP status implies when Google names none) and reason for the same
answer. Each route has its own rate limit per token hash (`src/upstream/token-limit.ts`, in memory, keyed by
the token's SHA-256), in addition to the server-wide limit per client address; a request without a token
(above, "The caller's token") is refused with 401 before anything is sent upstream.

**`POST /api/scopes/search`.** Resource Manager v3 `organizations:search`, `folders:search` and
`projects:search` side by side. The text becomes at most five terms of `[A-Za-z0-9._-]`; folders are queried
as `state:ACTIVE AND displayName:*TERM*`, projects as `state:ACTIVE AND (name:*TERM* OR id:*TERM*)`
(case-insensitive substrings; quotes, `'` and non-ASCII letters are refused by the query
syntax). Organisations accept only `domain:` and `directoryCustomerId:` queries, so they are listed and
matched here, as is text the terms do not cover. `nextPageToken` carries the three kinds' own page tokens; one
kind failing is listed in `problems`, every kind failing is a 403 (the token lacks the OAuth scope) or 502.

**`POST /api/preflight`.** The permission check of user mode and the service-account gate (AGENTS.md, Security
and privacy, Quota project and the permission check, and The service-account gate), in `src/preflight/run.ts`:

| Mode | Item | Checked by | `missing` gives |
|---|---|---|---|
| user | `scope-details` (a warning, not blocking) | Resource Manager `GET {scope}` | the `roles/browser` binding |
| user | `quota-project` | CAI `assets.list` `pageSize: 1` with `x-goog-user-project`: the scope itself (a project), then the picked project; `candidates` says why each failed | `gcloud services enable …` and the `serviceUsageConsumer` binding |
| user | `cai-access` | the same probe: a 403 without `ErrorInfo` once a quota project works | the `roles/cloudasset.viewer` binding for the scope's kind |
| sa | `sa-caller` (gate step 1) | Resource Manager `testIamPermissions` on the scope with the caller's token: the scope's `get` permission returned | the `roles/browser` binding for the caller |
| sa | `sa-exposure` (gate step 2; only with `SA_MODE_STRICT_EXPOSURE=true`, otherwise the item is left out) | `GET {scope}` with the account's token: exactly Resource Manager's IAM denial | none: a 200 (`exposed`) refuses the mode |
| sa | `sa-access` | the account's own probe, without a quota header, only after the gate passed | the binding for `serviceAccount:BACKEND_SA_EMAIL` |

Each item's `status` is `ok`, `missing` or `unknown`, with a `finding` the Permissions page words (`denied`,
`exposed`, `no-candidate`, `unusable`, `not-checked`, `no-credentials`, `sign-in`, `transient`, `unexpected`),
and `outcome` is `ready`, `blocked`, `sign-in` or `retry`. An answer the table does not know stops the checks
and fails closed with Google's status, reason and message. Google's tokeninfo (a POST, the token in the form
body) runs next to the first check: its email fills `--member` (`YOUR_EMAIL` when the token carries none, or
when the address could carry shell syntax), and a token it calls invalid ends the preflight with 401. In
service-account mode the checks are the gate's own (section "Service-account mode"), run afresh: when it does
not pass, the route answers its 403 (or 401, 503) with the checklist as `preflight`, never a 200; the
account's items are `no-credentials` when its token cannot be had. Service-account mode off
(`SA_MODE_ENABLED`) answers 403, and a build without the instance's identity 501.

Tests: `src/preflight/run.test.ts` (every checklist row × 200/403/404/429/5xx, the answer table, the 15
synthetic answers to the gate's caller check plus a 404, the commands, the email),
`src/routes/preflight.test.ts` and `src/routes/scopes.test.ts` (over HTTP with `inject`: bodies, tokens, rate
limits, logs, request ids, the search's queries and pages), `src/upstream/allowlist-attacks.test.ts`
(look-alike hosts, user info, ports, schemes, encodings, redirects, and route bodies that try to steer a call
elsewhere), against a pretend Google (`src/preflight/google.testing.ts`, bodies shaped like Google's: skill
cai-ingestion §9).

## Live pull and export read

Both routes stream: the answer is `application/x-ndjson`, one JSON object per line, written as Google's pages
or objects arrive and pulled only as fast as the client reads (`src/stream/ndjson.ts`, `Readable.from` over an
async generator). Nothing is kept: the backend forwards the caller's token and forgets each page once written.
Request problems answer before the stream starts, with the JSON error shape: 400 (the body, schema-validated
with zod, unknown fields refused; a scope or quota project must name a project, folder or organisation the way
Google does, `src/upstream/scope.ts`, so `projects/evil.com` never reaches Google), 401 (no token), 403
(`SA_MODE_OFF`, or refused by its gate), 429 (`RATE_LIMITED`, the rate limit per token hash,
`src/upstream/token-limit.ts`, 30 a minute per route; or `STREAMS_BUSY`, four streams already running for the
token, `src/stream/slots.ts`, across both routes and the render route's pulls: `takeStreamSlot` in
`src/upstream/route-support.ts`), 501 (`SA_MODE_UNAVAILABLE`, service-account mode not in this build; both
service-account checks are `refuseUnavailableMode` in `src/stream/pull.ts`, which the preflight asks too).
Everything Google answers after that arrives in the stream as an `error` frame (`src/stream/frames.ts`), whose
fields `@gcportrait/ingest` reads in the browser: `message` (Google's, verbatim; an HTML error page is never
forwarded), `status` (the HTTP status Google answered), `code` (Google's canonical status, from the HTTP
status when Cloud Storage leaves it out), `reason` (the one `ErrorInfo` reason, if any) and `retryable`.

**`POST /api/assets/stream`** (`src/stream/asset-list.ts`):

- calls `POST https://cloudasset.googleapis.com/v1/{scope}/assets` with `X-HTTP-Method-Override: GET` and the
  body `{ contentType: "RESOURCE", pageSize: 500, readTime?, assetTypes?, pageToken? }`, following
  `nextPageToken` until a page has none (a repeated token ends the stream with an error frame);
- user mode: `quotaProject` is required and sent as `x-goog-user-project`; service-account mode: never a quota
  header, and the gate (section "Service-account mode") runs before every page, a pass remembered for up to
  five minutes; without the instance's identity (the `serviceAccount` option of `buildServer`) the mode
  answers 501, so the gate is never skipped, and a gate that closes in the middle of a stream ends it with an
  `error` frame;
- frames: `{"t":"progress","pages":0,"assets":0}` at once, then per page `{"t":"page","assets":[…]}` (the
  assets as Google sent them; a page without an `assets` key is an empty page) and
  `{"t":"progress","pages":n,"assets":m}`, and at the end `{"t":"done","assets":m,"readTime":"…"}` with the
  first page's `readTime`, or one `error` frame;
- retries 429, 5xx, timeouts and transport failures with exponential backoff and jitter (500 ms, ×2, at most
  8 s, 5 attempts: `src/upstream/retry.ts`, `src/upstream/request.ts`); 400, 401, 403 and 404 end the stream
  at once (a `readTime` before the scope existed is `status: 404, code: "NOT_FOUND"`);
- caps: 60 s per page attempt, 25 MiB per page (`RESPONSE_TOO_LARGE`, never retried), and a process-wide
  budget of 64 MiB of page bytes held at once (`src/stream/page-budget.ts`): a page is claimed as its bytes
  arrive and given back once the response has written its frame out to the connection (or at once when the
  page ends the stream with an error frame); a page the budget cannot hold is retried like a timeout, then
  ends the stream with a retryable `INSTANCE_BUSY` frame (503);
- slow clients (`src/stream/ndjson.ts`): both streaming routes ask for their next line only once the
  previous one has been written out to the connection, and a line over 1 MiB goes out in 1 MiB pieces. A piece
  that has to wait (the connection's buffers being full) must be taken whole within 60 s (`STREAM_STALL_MS`),
  or the connection is closed: the limit is a minimum rate, so a client that reads more slowly than about
  17 KiB/s while a large page streams is cut off even while it reads. A client that stops reading is cut off
  once the piece waiting for it has waited 60 s: sooner than a minute after it stopped if a piece was already
  waiting, later if none was (no timer runs while the stream waits on Google or while earlier frames still fit
  in the buffers); until then it holds its page's claim, its slot and its connection;
- a page is never parsed: `src/stream/list-page.ts` scans its bytes once and writes the `page` frame into one
  buffer outside the JavaScript heap (whitespace outside strings removed, the assets counted, `nextPageToken`
  and `readTime` read, the structure checked). Parsing a page at the cap and serialising it again would cost
  about 120 MiB, and four at once would end a process with a 128 MiB heap (docs/security.md, "Response caps
  and memory").

**`POST /api/export/read`** (`src/stream/export-read.ts`): `gs://BUCKET/OBJECT` reads that object
(`…/storage/v1/b/BUCKET/o/OBJECT?alt=media`, after a metadata lookup for its size); a URI ending in `/`, or
one that names no object, reads every object under that prefix in name order (`?prefix=`, folder placeholders
skipped), as `--output-path-prefix` writes them. The export's own lines are streamed as they arrive, a line
break added between objects that need one, and a failure ends the stream with an `error` frame on a line of
its own. The headers `x-gcportrait-export-objects` and `x-gcportrait-export-bytes` announce what the read
covers. Caps: 60 s without a byte (an idle timeout), 1 GiB, 10 000 objects listed under a prefix (folder
placeholders included); nothing under the prefix is a 404 frame.

Cloud Storage 429 and 5xx answers are retried and, if the attempts are exhausted, carry `retryable: true`
in the error frame, whether they come from the metadata lookup, any listing page or the object download.
Other statuses end that request without a retry; a metadata lookup's 404 starts the prefix lookup above.

Each stream logs one line when it ends (`asset stream ended`, `export read ended`): the mode, pages, assets or
objects and bytes, retries, how it ended (`done` or the error code), `finished`, `client-gone` or
`client-stalled` (cut off by the stall limit), and the time.
Never the scope, the bucket, an object name, an asset or the token; each retry logs the upstream host, the
attempt, the status and the delay. When the client goes away, the stream's signal aborts the upstream request
in flight and any backoff wait, and the stream slot is given back.

Tests (`src/routes/assets.test.ts`, `src/routes/export.test.ts`, `src/stream/stream.test.ts`,
`src/upstream/request.test.ts`, `src/upstream/retry.test.ts`, `src/upstream/google-error.test.ts`,
`src/upstream/google.test.ts`, `src/upstream/json.test.ts`) run against a pretend Google
(`src/stream/google.testing.ts`, synthetic data, checked by the synthetic-data guard): pagination, the request
Google receives, every error answer as a frame (read back with `@gcportrait/ingest`, a dev dependency for
this), retries and their delays (recorded, and on fake timers), timeouts, the 25 MiB cap declared and
streamed, the stream cap and the rate limit, the gate before every page, logs without secrets, cancellation
when a real client disconnects, and a 5 000-asset organisation streamed over a real connection into
`@gcportrait/ingest` (ten pages answered after 50 ms each, within a budget of 10 s; the test prints its time).

## Service-account mode

The backend may read a scope with its own identity, after proving that the caller may see that scope
(AGENTS.md, Security and privacy, principle 4 and The service-account gate; the user guide is
[docs/permissions.md](../docs/permissions.md)). `SA_MODE_ENABLED=true` turns it on.

**The identity** (`src/auth/identity.ts`). At start-up `src/main.ts` resolves Application Default Credentials
in ADC's own order: the file `GOOGLE_APPLICATION_CREDENTIALS` names, gcloud's well-known file, the metadata
server (`http://metadata.google.internal`, which is what runs on Cloud Run: the service's own account). Files
of type `impersonated_service_account` (from `gcloud auth application-default login
--impersonate-service-account=EMAIL`, the way to run the mode on a laptop; its source credentials mint a token
at `oauth2.googleapis.com/token`, which IAM Credentials exchanges for the account's) and `service_account` (a
key file, signed RS256 with `node:crypto`) are read; a person's own `authorized_user` credentials,
`external_account` and other universes are refused. The first token is minted at start-up, so broken
credentials stop the process with a message (never a credential in it) rather than failing the first request.
Tokens live in the process's memory only, refreshed five minutes before they expire, one refresh shared by
concurrent callers. `/api/config` publishes the identity's email (`src/auth/mode.ts`); a `BACKEND_SA_EMAIL`
that names another account stops start-up, because customers would grant the wrong one.

*Why no client library.* `google-auth-library` (Apache-2.0) would do the same, with more credential types
(workload identity federation, other clouds) that a Cloud Run service does not need. Its version 11 brings
about twenty packages (`gaxios` with `node-fetch` and a proxy agent, `gcp-metadata`, `jws` and `jwa`,
`json-bigint`, `google-logging-utils`, whose debug logging environment variables switch on) into the one
process that holds tokens, outside the logging rules above. On Cloud Run the whole of ADC is one GET to the
metadata server; the local forms are one or two POSTs. So the module calls exactly three fixed endpoints, each
checked before it is called (`checkIdentityUrl`: the metadata server over HTTP on its own host,
`https://oauth2.googleapis.com/token`, and IAM Credentials' `generateAccessToken` for a service account), with
a 10 s timeout, no redirect followed, answers capped at 64 KiB, and nothing logged. These are not the upstream
allowlist (`src/upstream/allowlist.ts`, still exactly its four hosts): nothing a request carries
can reach them, and the token they hand out is the backend's own. Workload identity federation is not
supported, and the module needs no dependency.

**The gate** (`src/auth/gate.ts`, `ServiceAccountGate`), built by `buildServer` from the identity and the
config, and asked by every route that takes `mode: "sa"` (`/api/preflight`, `/api/assets/stream`) before each
CAI call as the account, each page of a stream included:

1. the caller's own Resource Manager v3 `testIamPermissions` on the scope, for
   `resourcemanager.{organizations,folders,projects}.get` of its kind, next to tokeninfo; it passes only when
   the returned set holds that permission (`{}`, Google's answer for a scope the caller may not see or that
   does not exist, is a denial; any other answer refuses, fail closed). Nothing is asked as the account before
   it passes;
2. the account's token from the identity;
3. with `SA_MODE_STRICT_EXPOSURE=true` only: the account's own `GET` of the scope must be exactly Resource
   Manager's IAM denial (a 200, a public `get` or more than `roles/cloudasset.viewer`, refuses). Off by
   default, because it refuses every scope where a customer granted the account more than
   `roles/cloudasset.viewer`; with it off, a scope whose `get` is public passes step 1 for everyone signed in
   (docs/permissions.md says so).

A pass is remembered in memory for at most five minutes, keyed by the SHA-256 of the caller's token and the
scope, never past the token's own expiry (tokeninfo's `expires_in`), never a refusal (a refusal at the caller
or exposure step forgets a pass for that token and scope at once), at most 10 000 entries; the preflight
always checks afresh. Refusals (`src/auth/refusal.ts`) are 403 (`SA_GATE_CALLER_DENIED`, `SA_GATE_EXPOSED`,
`SA_GATE_UNEXPECTED`, `SA_GATE_EXPOSURE_UNEXPECTED`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`), 401
(`UNAUTHENTICATED`) or 503 (`SA_GATE_UNAVAILABLE`, `SA_CREDENTIALS_UNAVAILABLE`, `retryable`), in the server's
error shape (`src/errors.ts`) with that `code`; in the middle of a stream, an `error` frame. The quota project
in this mode is the account's own project: no `x-goog-user-project` is sent, and the body may not name one
(400).

**The audit line.** Each decision of the gate logs one line, `service-account gate`, with the request id and
`audit: { event: "sa-gate", route, scope, callerEmailHash, decision: "allowed" | "denied", step?, finding,
cached, strictExposure }`. `callerEmailHash` is the SHA-256 (hex) of the caller's email in lower case, from
tokeninfo, or null without one. It is the one log line that names a scope and stands for a person, on purpose:
an operator can find a person's lines by hashing their address. Never the token, never the email. It is
written at `info` whatever `LOG_LEVEL` says (a child logger at `info` when the level is `warn`, `error` or
`fatal`), so quieting the request lines keeps the audit trail; only `silent` drops it.

Tests: `src/auth/gate.test.ts` (allowed, denied for every answer the caller check can get, the memo:
remembered, expired, capped at five minutes and at the token's expiry, bounded, never across tokens or scopes,
never a refusal; the strict check's answers; the account's token; the audit line; an abort),
`src/auth/identity.test.ts` (the metadata server, an impersonation file, a key file with a key made for the
run, every refused kind, the endpoints, the token cache, no credential in a message),
`src/auth/sa-mode.test.ts` (over HTTP: every route that takes `mode: "sa"` answers 403 without a passing gate,
401, 503, 501 without the identity, 403 with the mode off, never a call as the account; the routes that take
no mode refuse one; `/api/config`), the service-account sections of `src/preflight/run.test.ts` and
`src/routes/assets.test.ts`, and `e2e/tests/sa-mode.spec.ts`, which runs this backend through
`src/auth/sa-harness.testing.ts` (the real routes, gate and ADC code, with a pretend Google and metadata
server; in neither bundle).

## Why response schemas are zod converted to JSON Schema

Responses are validated through Fastify's own JSON Schema support. Each contract is written once as a zod
schema in `src/schemas.ts`, the TypeScript type is `z.infer` of it, and Fastify gets `z.toJSONSchema(...)`
(built into zod 4). Fastify's serializer (fast-json-stringify) then emits only the declared fields, fails
loudly when a required field is missing, and keeps the fast serialization path. This is used rather than
`fastify-type-provider-zod` for three reasons. It keeps zod as the single definition of every contract (types
that cross a package boundary are zod schemas, declared once; AGENTS.md, Data and graph semantics). It adds no
dependency (the provider's current major also pulls in `@fastify/swagger` and `openapi-types` as required
peers). And request bodies are validated with zod schemas too, some of them from `@gcportrait/model`, either
the same way or with an explicit `schema.parse`.

## Render API

`POST /api/render` draws a view as SVG, PNG or a draw.io file (`"format": "drawio"`, compressed unless
`"compressed": false`, with or without `fontSource`) with the render library (`@gcportrait/render`), the code
`pnpm render` runs, so a demo view comes out byte for byte as the command line writes it.
[docs/api.md](../docs/api.md) is the user's reference (request, sources, headers, errors, limits); here is how
it is built.

- **Registration** (`src/server.ts`): with the routes that call Google, so never in demo-only mode, and only
  while `RENDER_API` is not `false`. Its own Fastify context registers `@fastify/multipart`, so no other route
  accepts multipart. Its errors are the server's (section "Security and logging", "Errors"), each with the
  code the route names for it (its own failures in `src/render/errors.ts`).
- **Order of checks** (`src/routes/render.ts`): the token and its limit (10 renders a minute per token hash) →
  the schema (`RenderOptionsSchema` of `@gcportrait/model` plus `source`) → the source's authority: a pull's
  mode and gate exactly as on the stream (`src/stream/pull.ts`, shared with `src/routes/assets.ts`),
  tokeninfo's `valid` for a demo or an upload → one render per instance (`createRenderLock`, the stream slots
  of `src/stream/slots.ts` with one slot under one key; `429 RENDER_BUSY`) → a stream slot for a pull → the
  job. `RENDER_TIMEOUT_MS` runs from the lock; the lock,
  the slot and the job are given back however the answer ends.
- **A pull** iterates `assetListFrames` with the stream's client, credentials, page budget and slots, hands
  each frame to the job and asks for the next only once the job has read it, which gives the page's budget
  claim back; it stops once its `progress` passes `RENDER_MAX_ASSETS`, and an `error` frame becomes the HTTP
  error with Google's status, code and `ErrorInfo` reason (a server error of Google's as 502). **An upload**
  streams the multipart `file` part (busboy, at most `RENDER_MAX_BODY_BYTES`) to the job the same way.
- **The job** (`src/render/job.ts`, messages in `src/render/protocol.ts`) runs in a fresh `worker_threads`
  worker per render (`src/render/runner.ts`, `src/render/worker.ts`) with a 1 GiB heap, terminated when the
  render ends, times out or loses its client: rasterising would otherwise stall `/healthz` and the streams,
  and the WebAssembly rasteriser's memory (about 10 bytes per PNG pixel) is only freed with its thread. The
  library reads the data with the app's own code (the import handler for NDJSON and frames, `parseBundle`, the
  demo loader), so the API draws what the app would. The tests run the same job in process
  (`src/render/in-process.ts`).
- **The answer** goes out through `sendPieces` (`src/stream/ndjson.ts`, the streams' writer and stall rule)
  with the export's file name, the view's hash, and the detail level and scale used; no non-affiliation line
  travels with it (AGENTS.md, Non-affiliation, brand and legal). One log line per render, counts only: source
  kind, format, theme, assets, bytes, ms, outcome.
- **A draw.io file** (`application/vnd.jgraph.mxfile`, `.drawio`) is the SVG's drawing translated into
  draw.io's cells by the frontend's translator (`frontend/src/export/drawio/`, through the render library's
  `drawDrawio`); the job passes the instance's version (`APP_VERSION`, else the package's) for the file's
  `agent`. The body limit applies to its uploads as to any render's; `RENDER_MAX_PIXELS` is a PNG's only.

## Graceful shutdown

`src/main.ts` handles SIGTERM (Cloud Run) and SIGINT. It stops accepting connections, lets in-flight requests
finish (`fastify.close()`), and exits. If that has not happened within 8 s it exits non-zero, inside Cloud
Run's 10 s grace period.

## Build output and workspace packages

Workspace packages export their TypeScript sources, which Node cannot run from an image, so the production
image runs a bundle: `bundle` (`bundle.ts`, esbuild) writes `dist/server.mjs`, one ESM file with
every npm dependency and workspace package inlined, its source map (`node --enable-source-maps` maps stack
traces back to `src/`), and `dist/licenses/server-dependencies.txt`, the licence of every npm package inlined,
since a bundle drops the licence files `node_modules` would carry. The image then needs no `node_modules`, no
pnpm and no compiler (`infra/Dockerfile`,
[docs/self-host-options.md](../docs/self-host-options.md#run-the-image-locally)). The bundle keeps the package
layout: `src/config.ts` finds `package.json` and `../frontend/dist` relative to `dist/`, so the image copies
`backend/package.json` next to it. `build` is the bundle step alone and writes no other JavaScript; the type
check is `pnpm typecheck`'s `tsc -b`, which covers every file under `src/`, the tests and the render job
included (the render job reaches the frontend's components through the render library's project reference).
zod is imported as a namespace everywhere the bundles reach (`import * as z from 'zod'`; `eslint.config.js`
refuses a named or default `z`), so esbuild keeps only the parts of zod the code uses and, of its locales,
only the English one its messages come from; a named `z` would bring in every locale.

The render API adds a second bundle, `dist/render-worker.mjs` (the render library, the frontend's headless
closure with the draw.io translator and its compressor, fflate, `react-dom/server` and resvg-wasm's glue code,
with React's production build), which `server.mjs` never imports: its runner only starts it, by a path esbuild
defines at build time. `dist/render-assets/`, written by the library's `writeAssetDir`, holds what the worker
reads at run time without `node_modules`: resvg's WebAssembly module, unmodified, and the Roboto faces in
their loading order with their licences. The bundle step fails on any native addon (`.node`), and the licence
report covers both bundles and the copied packages (`src/render/bundle.test.ts` builds into a temporary
directory, draws the golden PNG with the bundled worker, finds in neither bundle a file of the tests or a zod
locale but English, and finds resvg-wasm, fflate and `@fastify/multipart` in the report at the versions
installed, which the declaring `package.json` files pin exactly, read by the repository's one lookup,
`scripts/lib/dependency-versions.mjs`).
