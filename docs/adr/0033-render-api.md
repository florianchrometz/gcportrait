<!-- SPDX-License-Identifier: MIT -->

# 0033. Render API: `POST /api/render` draws SVG and PNG on the server with the code `pnpm render` runs

- **Status:** accepted (2026-10-11, when it was built; three details changed while building it, marked "As built");
  amended 2026-10-12 (the `x-gcportrait-notice` header is gone, see "Amended 2026-10-12")
- **Date:** 2026-10-11
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0013](0013-png-and-svg-export.md) (PNG and SVG export), skill `gcp-diagram-style` §8 (the
  export rules `pnpm render` follows), [docs/api.md](../api.md); the maintainer's request of 2026-10-11; builds on
  ADRs [0005](0005-stateless-backend-browser-snapshots.md),
  [0018](0018-non-affiliation-statement.md), [0019](0019-font-licence-exception.md),
  [0028](0028-quota-project-and-sa-gate.md), [0029](0029-bundle-budgets.md),
  [0031](0031-token-header-behind-iap.md) and [0032](0032-hosted-surfaces-and-domains.md)

## Context

The maintainer asked on 2026-10-11 that the users of a self-hosted instance can create SVG and PNG exports
through the backend's API alone, reusing the existing endpoints and code. Today a diagram is drawn in the
browser (the data and layout workers and the SVG painter in `frontend/src/diagram/`) and by `pnpm render`
(`packages/render-cli`: the frontend's headless entry `frontend/src/headless.ts`, rasterised by the native
`@resvg/resvg-js`), which draws demo organisations only. The production image is a distroless runtime without
`node_modules` that runs one esbuild bundle, `backend/dist/server.mjs`; a native `.node` binary cannot be
bundled. The backend is stateless (ADR 0005), does not import the frontend, and runs on Cloud Run with 1 CPU
and 512 MiB (`infra/deploy.sh`). Drawings carry no affiliation line (ADR 0018 as amended on 2026-10-11), and
the SPA's budgets (ADR 0029) stay as they are.

Measured while planning (2026-10-11, macOS arm64, Node 22.23, in a scratch directory):

- `@resvg/resvg-wasm` 2.6.2 (MPL-2.0, the same upstream release as the native 2.6.2) turned the CLI's SVGs
  into PNGs byte for byte equal to the native binding's in 6 of 6 views (demo S overview light and dark at 2×,
  M networking light at 2× and dark at 1×, M security dark at 3×, L overview light at 3×). It was 1.2 to 1.9
  times slower (S at 2×: 396 ms against 273 ms; L at 3×, 96.6 Mpx: 3.3 s against 1.7 s).
- While it draws, wasm takes about 9 to 10 bytes per PNG pixel and keeps that memory until its thread ends:
  +210 MiB at 11.4 Mpx, +870 MiB at 96.6 Mpx, +1.2 GiB at 133 Mpx (the 2^27 px cap of the app's export).
- esbuild bundles `frontend/src/headless.ts` and the CLI's demo-view path for Node without changes (52
  frontend files; from npm: react, react-dom, fuse.js, zod), and the bundle draws the same SVG bytes as
  `pnpm render`.
- Demo XL (51 242 assets), overview, through `pnpm render`: about 6 s and 640 MB at the peak; at detail `all`,
  10 s, 1 GB and an 11 MB SVG.

## Decision

1. **One render library, `@gcportrait/render` (`packages/render`).** It holds everything between a snapshot
   and the bytes. The CLI and the backend both call it, so a view renders byte for byte the same from either.
   - Moved from `packages/render-cli/src`, with their tests: `view.ts` (generalised from the demo fixtures to
     any `Snapshot`: `prepareView(snapshot, spec, viewport)`, with `createDemoViews` on top), `render.ts` as
     `draw.ts` (`drawSvg`, `drawPng`, `THEMES`), `raster.ts` (the export geometry unchanged, plus a
     `maxPixels` cap), and `fonts.ts` and `woff.ts` (the faces now unwrapped in memory, so there is no cache
     directory).
   - New: `snapshot.ts`, which makes a snapshot from a demo size, a `.gcportrait.json` bundle or NDJSON
     chunks; `assets.ts`, which loads the wasm module and the font files in their loading order, either from
     the packages or from a directory the backend's bundle step writes with the same function; and
     `render.ts`, where `renderView(snapshot, options)` returns the bytes, the content type, the app's export
     file name, the view drawn, and the detail level and scale it used.
   - The CLI keeps its command line (`args.ts`, `run.ts`, `cli.ts`) and its comparisons and golden check
     (`compare.ts`, `golden.ts`, pixelmatch, pngjs). It drops `@resvg/resvg-js` and the font packages.
   - The frontend's headless entry, which the app still never imports, adds functions the app already uses to
     read data: `parseBundle`, `SnapshotFileError`, `isBundle` and `exportFileName`. It also adds
     `createSnapshotReader`, extracted from the import worker's handler into
     `frontend/src/import/worker/read.ts` (the ingest session, the cut-short and empty checks, the scope
     inferred from the assets' ancestors). The handler keeps its message protocol and storage encoding around
     it, so the app's import and the API read the same NDJSON into the same snapshot.
     **As built:** the headless entry exports the import worker's handler itself (`createImportHandler`) and the
     stored-document decoder (`decodeJson`), unchanged, and the library's `createSnapshotReader` drives the
     handler in process with the settings the app gives a pull or an export, then reads the snapshot back from the
     document the handler prepared for storage, as the app reads a stored snapshot. No app code moved; the cost
     is one gzip round trip of the snapshot (demo XL as an export: about 2 s, 410 MiB of heap, measured).
   - Import boundaries (`WORKSPACE_DEPENDENCIES` in `eslint.config.js`):
     - `packages/render` may import `model`, `catalog`, `graph`, `layout`, `demo-data` and `frontend`. The one
       upward exception moves here from the CLI.
     - `packages/render-cli` may import `model`, `graph`, `demo-data` and `render`.
     - `backend` adds `render` and reaches the frontend only through it.
     - The frontend may not import `render`. A new rule allows `react-dom/server` only in
       `frontend/src/diagram/static.tsx`, and no file under `frontend/src` may import `headless.ts`.
       **As built:** only `WORKSPACE_DEPENDENCIES` changed; the two frontend rules are left to a follow-up.
       `pnpm size` guards the SPA's budgets meanwhile.
   - The render options are one zod schema in `@gcportrait/model`, `RenderOptionsSchema` in
     `schemas/render.ts` (agents.md rule 4).
2. **One rasteriser: `@resvg/resvg-wasm` 2.6.2, pinned exactly**, for the CLI and the server alike. A wasm
   build computes the same pixels on every platform. The API, the CLI and the committed golden
   (`e2e/baselines/render/S-overview-auto-light.png`, drawn natively and reproduced exactly above) therefore
   agree by construction, and the golden no longer depends on the machine. The native binding stays a dev
   dependency of `packages/render` for one parity test, and of `packages/layout` (debug renders) and `e2e` as
   before.
3. **`POST /api/render`** is registered with the other routes that call Google. It never exists on a demo-only
   instance (ADR 0032), nor with `RENDER_API=false`. There is no GET form (see the alternatives). The request
   is one JSON document: the source plus `RenderOptionsSchema`. For an upload it is the `request` part of a
   `multipart/form-data` body (`@fastify/multipart`, MIT, the Fastify 5 generation), and the file is the
   `file` part.

   ```json
   { "source": { "kind": "demo", "size": "M" }, "view": { "hash": "lens=networking&detail=networks" },
     "theme": "dark", "format": "png", "scale": 2 }
   ```

   | Source `kind` | Fields | Where the data comes from | Body |
   |---|---|---|---|
   | `scope` | the live pull's own fields and rules: `scope`, `mode` (`user` or `sa`), `quotaProject` (required in user mode, refused in service-account mode), `readTime?`, `assetTypes?` | `assetListFrames` (`backend/src/stream/asset-list.ts`): the same credentials (the caller's token and quota project, or the gate before every page), the same page budget and the same stream slots; no second fetch path | JSON |
   | `ndjson` | `scope?`, `readTime?` | the `file` part: a Cloud Asset Inventory export, or a saved `/api/assets/stream` response; read by `createSnapshotReader` as the app imports it | multipart |
   | `bundle` | none | the `file` part: a `.gcportrait.json`, read by `parseBundle`; the snapshot's own day is drawn | multipart |
   | `demo` | `size` (`S`, `M`, `L`, `XL`) | `loadDemoSnapshot`, as `pnpm render --fixture` | JSON |

   - The pull's fields and mode rule move out of `backend/src/routes/assets.ts` into
     `backend/src/stream/pull.ts` (`PullFieldsSchema`, `checkPullMode`, and the credentials with the gate's
     first check), and both routes use them. The render route hands each frame to the render worker and asks
     the pull for the next only after the worker has read it. The page's budget claim is released then, as
     `stream/ndjson.ts` releases it after a write. The route stops the pull as soon as its `progress` frames
     pass `RENDER_MAX_ASSETS`.
   - **View:** either `{ "hash": "…" }` or explicit fields. A hash is the part of an app link after `#`,
     decoded by the model's `decodeViewSpec` as the app decodes it: `snapshot` is ignored because the source
     names the data, `tick` is refused because the API draws a snapshot's own day, and `selection` and
     `highlight` are ignored because they are not drawn. The explicit fields are checked strictly with the
     model's schemas: `lens`, `detail`, `focus`, `root`, `filters` (a partial `ViewFilters`) and `flips` (zone
     ids, as `--flip` takes them). `viewport` (default 1280×800) is what `detail: auto` fits. Unlike the CLI,
     which only reports them, the API answers a refused root or a focus that does not apply with an error.
   - **Output:** `theme` is `light` (default) or `dark`. `format` is `png` (default) or `svg`. A PNG takes
     `scale` (above 0 and up to 3, default 2) or `width` in pixels, not both. The read time is written in UTC,
     as the CLI writes it.
4. **Response.** A 200 response carries the following headers:
   - `content-type`: `image/png` or `image/svg+xml; charset=utf-8`.
   - `content-disposition`: `attachment; filename="gcportrait_<scope>_<lens>_<readTime>.<ext>"`, the app's
     export name.
   - `content-length`, and `cache-control: no-store` like every `/api` answer.
   - `x-gcportrait-view`: the canonical hash of the view drawn (`encodeViewSpec`). For a demo source it
     names `snapshot=demo:SIZE`, so `pnpm render --hash` redraws the same bytes.
   - `x-gcportrait-detail`: the detail level used.
   - `x-gcportrait-scale`: the PNG scale used, which is lower than asked when the pixel cap applied.
   - `x-gcportrait-notice`: the non-affiliation statement's short line, as on the other surfaces that have no
     footer and are not drawings (ADR 0018). The image itself never carries the line. Removed on 2026-10-12
     (see "Amended 2026-10-12").

   The bytes go out through the streams' piece writer and stall rule, generalised from `sendNdjson` in
   `stream/ndjson.ts` as `sendPieces`, so a client that stops reading is cut off.
5. **Errors** use the server's shape plus the fields the gate's refusal body already has: `{ statusCode,
   error, message, requestId, code, retryable?, reason?, upstream? }`. `reason` is Google's `ErrorInfo` reason
   when a pull's error frame carried one. Every error is sent before any byte of the image.

   | Status | `code` | When |
   |---|---|---|
   | 400 | `INVALID_REQUEST` | the body fails the schema (the first issue as `field: message`, never the value), a hash names `tick`, or a multipart body cannot be read (no boundary, a part cut short) |
   | 408 | `REQUEST_TIMEOUT` | an upload that is still arriving when the server's body deadline (30 s) passes; the log line's outcome says so |
   | 401 | `UNAUTHENTICATED` | no token, a malformed one, or Google refuses it (tokeninfo, the gate, the pull); with `WWW-Authenticate: Bearer` |
   | 403 | the gate's code, or Google's (`PERMISSION_DENIED`, …) | service-account mode off or refused (ADR 0028), or the pull refused |
   | 404 | `NOT_FOUND` | Google: no such scope, or a `readTime` before it existed |
   | 413 | `BODY_TOO_LARGE` | an upload above `RENDER_MAX_BODY_BYTES` |
   | 415 | `UNSUPPORTED_MEDIA_TYPE` | JSON for an upload source, multipart for `scope` or `demo`, or no `file` part |
   | 422 | `INVALID_FILE`, `EMPTY_SNAPSHOT`, `TOO_MANY_ASSETS`, `VIEW_REFUSED` | an unreadable bundle or export (the app's own message), no assets, more than `RENDER_MAX_ASSETS`, a refused root or focus |
   | 429 | `RATE_LIMITED`, `STREAMS_BUSY`, `RENDER_BUSY` | 10 renders a minute per token, four streams already running for the token, or another render on this instance; each with `Retry-After` (`STREAMS_BUSY`: 30 s, the others 10 s) |
   | 501 | `SA_MODE_UNAVAILABLE` | service-account mode not in this build, as on the stream route |
   | 502, 503, 504 | the pull's frame code (`UPSTREAM_UNREACHABLE`, `INSTANCE_BUSY` with `Retry-After`, `UPSTREAM_TIMEOUT`, `BAD_UPSTREAM_ANSWER`) | the pull failed after its retries |
   | 503 | `RENDER_TIMEOUT`, `RENDER_TOO_LARGE`, `TOKEN_CHECK_UNAVAILABLE`, the gate's `SA_GATE_UNAVAILABLE` and `SA_CREDENTIALS_UNAVAILABLE` | `RENDER_TIMEOUT_MS` passed; the render worker ran out of its heap; tokeninfo did not answer; the gate could not be evaluated (every retryable answer carries `Retry-After`, 10 s) |
   | 500 | `INTERNAL` | a bug: `Internal error.` and the request id, with the details in the log |
6. **Authentication: the existing mechanisms, unchanged.** The token comes in `X-Gcportrait-Token`, or in
   `Authorization: Bearer` when that header is absent (ADR 0031), through `authenticate()` with a per-token
   limiter of its own.
   - `scope` in user mode: the pull itself proves the token with Google.
   - `scope` in service-account mode: the gate runs before the first page and before every page after it,
     exactly as on `/api/assets/stream` (ADR 0028).
   - `demo` and the upload sources: `tokenFacts` (tokeninfo) must call the token valid before any work starts.
     The most expensive route of an instance must not be open to anyone with a well-formed string.
   - Nothing about the token, the scope or the view is logged. The route logs one line of counts: the source
     kind, the format, the assets, the bytes, the time in ms and the outcome.
7. **Limits.** Configured in `backend/src/config.ts` with zod, like every other setting; an invalid value
   stops start-up:

   | Setting | Default | Range and meaning |
   |---|---|---|
   | `RENDER_API` | `true` | `true` or `false` (anything else stops start-up); `false` leaves the route out; `true` with `DEMO_ONLY=true` stops start-up |
   | `RENDER_MAX_ASSETS` | `60000` | 1 to 1 000 000; per render, for every source (demo XL fits) |
   | `RENDER_MAX_PIXELS` | `67108864` (2^26) | 1 000 000 to 134 217 728 (2^27, the app's export cap); a larger PNG is drawn at the largest two-decimal scale that fits, as the export does; `x-gcportrait-scale` says which, and `pnpm render --scale` with that value draws the same bytes |
   | `RENDER_TIMEOUT_MS` | `300000` | 10 000 to 3 600 000; from the moment the render starts (the pull or the upload included) to the first byte of the answer |
   | `RENDER_MAX_BODY_BYTES` | `26214400` (25 MiB) | 1 MiB to 1 GiB; the upload, under Cloud Run's 32 MiB HTTP/1 request limit |

   - Fixed limits:
     - a scale of at most 3 and 16 384 px a side;
     - one render at a time per instance (`RENDER_BUSY`);
     - 10 renders a minute per token;
     - the four stream slots per token, shared with the pulls;
     - the 64 MiB page budget;
     - a 1 GiB heap for the render worker;
     - the 30 s body deadline;
     - the 60 s stall rule.
   - `/api/config` publishes the values as `render: { maxAssets, maxPixels, maxBodyBytes, timeoutMs }`, or
     `null` where the route is off. The SPA's lenient parser ignores the new field.
   - Memory: about 300 MiB for the server with its page budget full, plus the worker heap (at most 1 GiB),
     plus 10 bytes per pixel up to `RENDER_MAX_PIXELS`. With the defaults that fits 2 GiB.
   - `infra/deploy.sh`:
     - gives a full instance 2 GiB instead of 512 MiB; a demo-only instance keeps 256 MiB;
     - takes `--memory SIZE` (512Mi to 4Gi with 1 CPU);
     - takes `--render-env NAME=VALUE` (repeatable, `RENDER_*` names only, checked against the backend's rules
       before deploying, so the setting survives a redeploy);
     - takes `--no-render-api`;
     - keeps the 900 s request timeout and refuses a `RENDER_TIMEOUT_MS` above 840 000.
   - `app.json` (the Cloud Run Button) asks for 2Gi. For `RENDER_MAX_PIXELS=134217728`, use `--memory 4Gi`.
8. **Execution: a fresh `worker_threads` worker per render.** In the bundle the worker is
   `dist/render-worker.mjs`; under tsx it is `src/render/worker.ts`. It runs a plain job handler (start,
   chunks, end, cancel, then a result or an error), and the same handler runs in-process in the tests. The
   worker is terminated when the render ends, when it times out, or when the client goes away. That frees the
   wasm memory, which never shrinks otherwise, and caps the heap through `resourceLimits`. The main thread
   keeps answering `/healthz` and the app's streams while a render runs, and it moves the PNG out of the
   worker by transfer, without a copy.
9. **Image and bundling.**
   - `backend/bundle.ts` gets a second entry, `src/render/worker.ts`, written as `dist/render-worker.mjs`. It
     holds the render library, the frontend's components, `react-dom/server` and the resvg-wasm glue code.
   - `server.mjs` never imports the library: its default runner only starts the worker, and the tests inject
     the in-process runner.
   - The library's `writeAssetDir` writes `dist/render-assets/` (**as built**: not `dist/render/`, where the
     compile check's `tsc` writes `src/render/*.js`), so the font order has one source: `resvg.wasm` from
     `@resvg/resvg-wasm`, unmodified, and the Roboto WOFF faces with their `LICENSE` files and a manifest.
   - The licence report lists `@resvg/resvg-wasm` (MPL-2.0, used unmodified in a Larger Work) and the
     `@fontsource` packages (OFL-1.1, ADR 0019), which are now copied into the image a second time.
     `THIRD_PARTY_NOTICES.txt` follows from the backend's production dependency closure.
   - The bundle step fails on any `.node` input.
   - `infra/Dockerfile` copies `render-worker.mjs`, its map and `dist/render-assets/`. The image still has no
     `node_modules`.
   - The SPA gains nothing: its budgets and `pnpm size` are unchanged.
10. **Not in this change:**
    - a `gs://` source (`/api/export/read`'s code would serve it);
    - timeline days or the diff overlay (a `tick`);
    - SVGs with embedded fonts;
    - the export's "current viewport";
    - several views in one request;
    - file sources for `pnpm render`.

## Consequences

**Users and docs.** An instance's users can script exports with curl, using the scopes their own token or the
service account may read. The answers are byte for byte what `pnpm render` writes for a demo view, and what
the app's import would draw for the same file. The documentation changes:

- `docs/api.md` (new, a user guide): the long form of the statement, authentication, every route (the health
  checks, `/api/config`, `/api/legal`, the scope search, the preflight, the pull, the export read and the
  render) with its request and response, curl examples with `YOUR_` placeholders, the errors and the limits.
- The guide is registered in `scripts/user-docs.mjs`, `docs/README.md` and the website's docs menu
  (`website/src/data/docs.ts`, "Run your own").
- `docs/configuration.md`, `docs/self-host.md`, `docs/export.md`, `backend/README.md`, `docs/packages.md`,
  `agents.md`, `THIRD_PARTY.md`, the README and this ADR's index row change with it.
- ADR 0018's table gains the response header and `docs/api.md`.

**Cost.** The default memory of a full instance rises to 2 GiB, and a render keeps the instance's only CPU
busy for its duration. A busy instance answers further renders with `429 RENDER_BUSY` until Cloud Run adds
another instance (up to `--max-instances`). The CLI's rasterising gets 1.2 to 1.9 times slower.

**Tests:**

- `packages/render`:
  - `parity.test.ts`: wasm against the native binding on the six views above plus a capped one, which must be
    byte-identical;
  - `renderView` against the renderer's SVG baselines and the golden PNG;
  - the asset directory against the packages;
  - snapshots from NDJSON, frames and bundles against the app's import.
- `packages/render-cli`: the golden and CLI tests, unchanged.
- `frontend`: `read.test.ts`; the import handler's tests stay green.
- `packages/model`: the options schema.
- `backend`:
  - `routes/render.test.ts`, with the in-process runner:
    - every source and both formats, with the bytes equal to the library's and to the golden;
    - auth: 401 without a token, the tokeninfo outcomes, the gate before every page;
    - the page budget back to 0, the slots and the lock released;
    - every error code, the lock and the timeout;
  - the demo-only and `RENDER_API=false` 404s;
  - `log-secrets` for the new route;
  - the extracted pull, under the stream tests that already exist;
  - `render/bundle.test.ts`: it bundles into a temporary directory, runs a demo job through the real worker
    and gets the golden's bytes, and checks that no react, resvg or `.node` code reached `server.mjs`.
- Repository tooling: `scripts/exports.mjs` names `@resvg/resvg-wasm` in `packages/render` as the tool that
  fixes the bytes, and its manifest is redrawn (same files).

## Amended 2026-10-12

The answer no longer carries `x-gcportrait-notice`. The maintainer placed the non-affiliation statement in footers
and long-form texts only (ADR 0018, amendment of 2026-10-12, footers and long-form texts), and the header travelled
with every exported file. The other headers are unchanged; `backend/src/routes/render.test.ts` asserts that the
header is absent and `docs/api.md` no longer lists it.

## Amended 2026-10-12: the draw.io format

`format` takes `drawio` as well ([ADR 0036](0036-drawio-export-from-the-svg-drawing.md)): the SVG the
library draws, translated into a `.drawio` file (`application/vnd.jgraph.mxfile`), compressed unless `compressed`
is `false`, its labels naming Google Fonts' stylesheet unless `fontSource` is `false`; the render library has
`drawDrawio` and `pnpm render` `--drawio` and `--drawio-plain`. `RENDER_MAX_PIXELS` stays a PNG's limit only.

## Alternatives considered

- **Keep the native `@resvg/resvg-js` for the CLI and use wasm only in the server.** It lost: two rasterisers
  whose equality depends on the platform's SIMD paths (only darwin-arm64 was measured), and the CLI's golden
  stays machine-bound.
- **Ship `node_modules` with the native binary in the image.** It lost: it ends the bundle-only distroless
  image, and it needs a binary per architecture.
- **Headless Chromium, or a separate render service.** They lost: a far larger image, or a second deployment,
  for what resvg already does.
- **Render on the main thread.** It lost: seconds of synchronous layout and rasterising would stall `/healthz`
  and every stream, and wasm memory would never be returned.
- **A library entry inside `packages/render-cli`.** It lost: nothing may import the CLI, and packages expose
  one entry point.
- **A GET form with query parameters, for curl.** It lost: every source needs the token in a header anyway.
  Scope ids, quota projects and focus or filter values would land in URLs, which Cloud Run's request log
  records in full (the backend keeps all inputs in bodies). A GET can be prefetched and cached. `curl --json`
  makes the POST a one-liner.
- **The upload as a raw body, with the options in the query string or a header.** It lost: the query string
  has the URL problem above, and JSON in a header is awkward to write. Multipart is what every HTTP client
  sends for "a file plus parameters".
