<!-- SPDX-License-Identifier: Apache-2.0 -->

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

[docs/api.md](../docs/api.md#routes) describes the requests and answers; `src/schemas.ts` owns the public
response contracts. The route modules are under `src/routes/`:

| Route | Module and purpose |
|---|---|
| `GET /healthz` | `src/server.ts`: container probe; not rate limited. |
| `GET /api/healthz` | `src/server.ts`: the same health answer, reachable through Cloud Run's front end. |
| `GET /api/config` | `config.ts`: public settings for the SPA, including the resolved service-account email and render limits. |
| `GET /api/legal` | `legal.ts`: legal-page Markdown loaded by `src/legal.ts`. |
| `POST /api/scopes/search` | `scopes.ts`: Resource Manager search across organisations, folders and projects. |
| `POST /api/preflight` | `preflight.ts`: the permission checklist and copy-ready commands. |
| `POST /api/assets/stream` | `assets.ts`: a live pull as NDJSON frames. |
| `POST /api/export/read` | `export.ts`: Cloud Storage export objects as NDJSON. |
| `POST /api/render` | `render.ts`: a view as SVG, PNG or draw.io ([API reference](../docs/api.md#post-apirender)). |
| `GET /*` | `src/server.ts`: production SPA files and fallback, as above. |

Cloud Run's front end answers `/healthz` with its own 404; external checks use `/api/healthz`. Both health
routes are logged at warn level only.

**Demo-only mode** follows backend/AGENTS.md, "Demo-only mode and legal pages". `src/demo-only.test.ts`
holds the route matrix, including JSON refusals of unavailable routes and retained rate limits;
`src/demo-only-harness.testing.ts` runs this mode for `e2e/tests/demo-only.spec.ts`.

**The caller's token** is extracted by `src/stream/caller.ts`; header precedence and IAP usage follow
[API authentication](../docs/api.md#authentication) and AGENTS.md, "Tokens". A malformed preferred header
never falls back to `Authorization`. API responses carry `cache-control: no-store` and `x-request-id`.

## Configuration

`src/config.ts` parses the environment once with zod into a frozen, typed `ServerConfig`. Invalid values
stop start-up with the variable's name, never its value. [docs/configuration.md](../docs/configuration.md)
is the checked reference for every setting; `backend/.env.example` is the local template. Source-link
settings follow AGENTS.md, "Product rules"; service-account credentials are resolved separately through ADC
(see "Service-account mode"). The browser's OAuth token client uses no client secret
([the OAuth client](../docs/self-host-options.md#the-oauth-client-in-detail)).

## Security and logging

The policy is in backend/AGENTS.md, "Hardening"; [docs/security.md](../docs/security.md) describes each
control, its limits and the tests that hold it. Implementation owners:

- **Headers**: `src/security.ts`, set by `src/server.ts` in an `onRequest` hook
  ([browser-facing headers](../docs/security.md#6-browser-facing-headers)); this includes the served
  `index.html`'s theme-script hash and the sign-in versus demo-only cross-origin policies.
- **Static files**: `src/spa.ts` pre-loads the SPA bundle into memory, excludes dotfiles and `/api` paths,
  and answers GET/HEAD with ETags; `src/server.ts` falls back to `index.html` on SPA client routes
  ([static files](../docs/security.md#8-errors-request-ids-shutdown-static-files)).
- **Request limits**: `src/server.ts` owns body size and the separate header/body deadlines; the comments
  beside `REQUEST_TIMEOUT_MS` explain the Node/Fastify interaction
  ([bodies](../docs/security.md#2-request-bodies-schemas-and-size),
  [timeouts](../docs/security.md#4-timeouts)).
- **Rate limiting**: `src/server.ts` owns per-address limits and `trustProxyFor`; its hop-count trust is
  safe only where clients cannot reach the process directly. `src/upstream/token-limit.ts` owns per-token
  limits and `src/stream/slots.ts` concurrent-stream slots
  ([limits and deployment caveat](../docs/security.md#3-rate-limits-and-the-stream-cap)).
- **Request ids**: `src/server.ts` validates incoming ids or mints a UUID; `src/errors.ts` carries the id
  into refusals ([request ids](../docs/security.md#8-errors-request-ids-shutdown-static-files)).
- **Logs**: `src/logging.ts` owns Cloud Logging's `message`/`severity` shape, `LOGGED_HEADERS`, query
  masking and defensive redaction ([logging policy](../docs/security.md#7-logs-no-token-at-any-level)).
  `LOG_FORMAT=pretty` uses pino-pretty locally; the gate's audit line is described below.
- **Errors**: `src/errors.ts` builds the one error shape from `ErrorResponseSchema` in
  `src/schemas.ts`, for routes, unknown paths, the error handler and rate limits alike
  ([codes and headers](../docs/api.md#errors),
  [internal-message handling](../docs/security.md#8-errors-request-ids-shutdown-static-files)).

## Scope search and preflight

The upstream modules are shared by search, preflight and the streaming routes:

| Module | Responsibility |
|---|---|
| `src/upstream/request.ts`, `allowlist.ts`, `retry.ts` | Allowlisted exchanges, byte caps and retries; [host policy](../docs/security.md#1-upstream-host-allowlist), [timeouts](../docs/security.md#4-timeouts) and [caps](../docs/security.md#5-response-caps-and-memory). |
| `src/upstream/google.ts` | Fixed Google operations and count-only call logs; `assetsListRequest` is shared by preflight and each pull page, and owns the quota header. |
| `src/upstream/json.ts`, `google-error.ts` | UTF-8/JSON decoding and one Google error-envelope interpretation for preflight, gates, search problems and stream frames. |
| `src/upstream/route-support.ts` | Authentication, per-token limiting and stream-slot admission shared by routes. |

Error classification and quota behavior follow backend/AGENTS.md, "Quota project and the permission check",
and cai-ingestion skill §3/§9. Unreadable JSON is no answer, not an exception; HTML is never forwarded.

**`POST /api/scopes/search`.** Resource Manager v3 `organizations:search`, `folders:search` and
`projects:search` side by side. The text becomes at most five terms of `[A-Za-z0-9._-]`; folders are queried
as `state:ACTIVE AND displayName:*TERM*`, projects as `state:ACTIVE AND (name:*TERM* OR id:*TERM*)`
(case-insensitive substrings; quotes, `'` and non-ASCII letters are refused by the query
syntax). Organisations accept only `domain:` and `directoryCustomerId:` queries, so they are listed and
matched here, as is text the terms do not cover. `nextPageToken` carries the three kinds' own page tokens; one
kind failing is listed in `problems`, every kind failing is a 403 (the token lacks the OAuth scope) or 502.
The answer's schema, `ScopeSearchResponseSchema`, is in `@gcportrait/model`, which the app reads too.

**`POST /api/preflight`** delegates to `src/preflight/run.ts`; `src/preflight/schemas.ts` holds the request
and re-exports the checklist's answer from `@gcportrait/model`, which the app reads too. [Checking a
scope](../docs/permissions.md#6-checking-a-scope) describes the items and commands; backend/AGENTS.md, "Quota
project and the permission check" and "The service-account gate", defines the checks. Service-account
preflight runs the gate afresh and includes the checklist in a refusal, rather than returning a successful
HTTP answer for a failed gate.

Tokeninfo runs beside the first check: its email fills `--member` (`YOUR_EMAIL` if absent or unsafe for a
shell command), and an invalid token ends preflight with 401. Account items are `no-credentials` when its
token cannot be obtained. The status/finding/outcome vocabulary is in `@gcportrait/model`
(`src/schemas/api-vocabulary.ts`, zod-free so the app can list it).

Tests: `src/preflight/run.test.ts` (every checklist row × 200/403/404/429/5xx, the answer table, the 15
synthetic answers to the gate's caller check plus a 404, the commands, the email),
`src/routes/preflight.test.ts` and `src/routes/scopes.test.ts` (over HTTP with `inject`: bodies, tokens, rate
limits, logs, request ids, the search's queries and pages), `src/upstream/allowlist-attacks.test.ts`
(look-alike hosts, user info, ports, schemes, encodings, redirects, and route bodies that try to steer a call
elsewhere), against a pretend Google (`src/preflight/google.testing.ts`, bodies shaped like Google's: skill
cai-ingestion §9).

## Live pull and export read

The streaming routes use `src/stream/pull.ts` for the shared pull fields, mode checks and credentials;
`src/upstream/route-support.ts` admits the request before streaming. The wire contract is in
[API routes](../docs/api.md#routes) and `src/stream/frames.ts`: request refusals use the JSON error shape,
whereas a failure after streaming starts is an `error` frame that `@gcportrait/ingest` reads.

| Module | Responsibility |
|---|---|
| `src/stream/asset-list.ts` | CAI pagination and NDJSON frames; credentials are requested before every page. |
| `src/stream/list-page.ts` | Scan page bytes into a frame without parsing assets onto the JavaScript heap. |
| `src/stream/page-budget.ts` | Claim page bytes while held; [response caps and memory](../docs/security.md#5-response-caps-and-memory). |
| `src/stream/ndjson.ts` | Backpressure, copied write pieces, response lifetime and the [stall deadline](../docs/security.md#4-timeouts). |
| `src/stream/export-read.ts` | Plan and stream Cloud Storage objects; [export caps](../docs/security.md#5-response-caps-and-memory). |

**`POST /api/assets/stream`** sends the one `assetsListRequest` from `src/upstream/google.ts`
(cai-ingestion skill §1/§4). It follows `nextPageToken` until absent and refuses a repeated token. An empty
page is valid. It sends initial progress, then each page and its progress, and finishes with the total and
the first page's `readTime`, or one error frame. A gate that closes between pages ends the stream too.

The producer keeps a page's budget claim until its frame has been written out, or releases it immediately
when the page becomes an error. The writer asks for the next frame only after writing the previous one;
its copied pieces prevent a pending socket write from retaining a whole page. A budget refusal is retried
like a timeout, then becomes `INSTANCE_BUSY`. These mechanisms and their limits are described in the
linked security sections, not separate route policies.

**`POST /api/export/read`** treats `gs://BUCKET/OBJECT` as one object, first looking up its size. A trailing
slash or an absent object selects a prefix: list objects in name order, skip folder placeholders, and stream
their own lines with a line break between objects when needed. The headers `x-gcportrait-export-objects`
and `x-gcportrait-export-bytes` announce the plan; an empty prefix gives a 404 frame. A failure gets an error
frame on its own line.

`src/upstream/retry.ts` supplies the shared retryability rule: exhausted Cloud Storage 429/5xx answers carry
`retryable: true` from metadata, any listing page or object download. Other statuses are not retried; a
metadata 404 instead starts prefix lookup.

`watchResponse` in `src/stream/ndjson.ts` aborts upstream work and backoff on disconnect or stall and
finishes the stream once, releasing its slot. Route end logs contain counts and outcome, never scope, bucket,
object names, assets or tokens (backend/AGENTS.md, "Hardening").

Tests: `src/routes/assets.test.ts`, `src/routes/export.test.ts`, `src/stream/stream.test.ts`,
`src/stream/page-budget.test.ts`, `src/stream/list-page.test.ts` and the `src/upstream/` tests cover
pagination, caps, retries, gate checks, synthetic error frames, cancellation and real-connection backpressure.
`src/stream/google.testing.ts` is the pretend Google; the streaming tests read the result with
`@gcportrait/ingest` and include a 5 000-asset pull over a real connection (ten pages after 50 ms each,
within 10 s).

## Service-account mode

The backend may read a scope with its own identity, after proving that the caller may see that scope
(AGENTS.md, Security and privacy, principle 4; backend/AGENTS.md, The service-account gate; the user guide is
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
bounded, non-redirecting exchanges and nothing logged ([timeouts](../docs/security.md#4-timeouts),
[response caps](../docs/security.md#5-response-caps-and-memory)). These are not the upstream allowlist
(`src/upstream/allowlist.ts`, still exactly its four hosts): nothing a request carries
can reach them, and the token they hand out is the backend's own. Workload identity federation is not
supported, and the module needs no dependency.

**The gate** (`src/auth/gate.ts`, `ServiceAccountGate`) is built by `buildServer` from the identity and
configuration. The caller/credentials/exposure checks, per-call enforcement and memo bounds follow
[backend/AGENTS.md, The service-account gate](AGENTS.md#the-service-account-gate);
[permissions](../docs/permissions.md#the-gate) explains them to the operator. A refusal at the caller or
exposure step immediately invalidates a remembered pass for that token and scope. `src/auth/refusal.ts`
maps failures to the common error response or a stream frame; `src/auth/mode.ts` publishes the resolved
identity and checks the configured email.

**The audit line** is owned by `ServiceAccountGate`: the fields and privacy exception follow the same rule.
The line stays at `info` even when `LOG_LEVEL` is `warn`, `error` or `fatal` (a child logger preserves
it); only `silent` drops it. An absent tokeninfo email is represented by a null hash, never a guessed
identity.

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

[docs/api.md](../docs/api.md#post-apirender) is the request, source, answer and limit reference;
backend/AGENTS.md, "The render API", holds the policy. The implementation is split as follows:

| Module | Responsibility |
|---|---|
| `src/routes/render.ts` | Source admission, render lock, pull slot, deadline and answer; its header documents the check order. |
| `src/stream/pull.ts`, `asset-list.ts` | The same credentials, gate and paginated input as a live pull. |
| `src/render/runner.ts`, `worker.ts`, `protocol.ts` | Fresh worker, message acknowledgements, failure propagation and termination. |
| `src/render/job.ts` | Read inputs through the app's readers and call `@gcportrait/render`; `in-process.ts` runs the same job in tests. |
| `src/render/errors.ts` | Map source, upload and job failures to the common error response. |
| `src/stream/ndjson.ts` | `sendPieces` writes the export using the streams' backpressure and stall handling. |

`src/server.ts` registers the route's isolated Fastify context; only that context installs
`@fastify/multipart`. The route starts its deadline when it acquires the render lock, and gives the lock,
pull slot and worker back however the answer ends. A pull sends each frame to the job and waits for its
acknowledgement before asking for another, returning the page claim then; uploads stream their file part
through the same job interface. The worker's lifetime releases the rasteriser's WebAssembly memory
([response caps and memory](../docs/security.md#5-response-caps-and-memory)).

The draw.io translator is the frontend's, through the library's `drawDrawio`; the job passes the instance's
version for the file's `agent`. The route records one counts-only outcome line. Tests are
`src/routes/render.test.ts`, `src/render/job.test.ts` and `src/render/bundle.test.ts` (the bundled
worker and its assets, below).

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
