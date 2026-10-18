<!-- SPDX-License-Identifier: Apache-2.0 -->

# AGENTS.md: the backend

These rules add to the root AGENTS.md, which applies here too.

## Hardening

- Stateless: no database and no storage bucket. Self-hosting stays one service with nothing to provision for
  data.
- Upstream calls go to four hosts only: `cloudasset.googleapis.com`, `cloudresourcemanager.googleapis.com`,
  `storage.googleapis.com` and `oauth2.googleapis.com`.
- A strict Content Security Policy and the other security headers (`src/security.ts`), rate limits, request
  ids, timeouts, response caps and a process-wide page budget ([docs/security.md](../docs/security.md)).
- Logs never carry query strings, bodies, client addresses or tokens. The service-account gate's audit line is
  the one log line that names a scope, on purpose.
- Secrets never touch disk; `.env` files are git-ignored and the provenance check never reads them.

## Quota project and the permission check

- In user mode every CAI call sends `x-goog-user-project` with the quota project the permission check found:
  the request contract and candidate selection are in [AGENTS.md](../AGENTS.md), "Quota project and the
  permission check". The backend never falls back to sending no header, because that would charge every
  person's pulls to the instance's project and share its rate quota among them.
- Service-account mode and every Resource Manager call send no quota header: the account's own project, the
  instance's, pays for the account's calls, and a person's quota project then needs only the Cloud Asset API.
- The permission check reads the scope's metadata first; a Resource Manager IAM denial there is a warning, not
  a stop, because `roles/cloudasset.viewer` alone cannot `get` a scope it may list. It then probes each
  candidate with `assets.list` (`pageSize: 1`).
- Google's errors are classified by HTTP status and the `ErrorInfo` reason together, never by message text. An
  answer that is not understood fails closed and is shown with its status, reason and message; HTML is never
  forwarded. The table of answers and messages is in [docs/permissions.md](../docs/permissions.md) and the
  cai-ingestion skill (§3, §9).

## The service-account gate

Before every CAI call made as the instance's account, the backend checks the caller:

1. **The caller's permission.** Resource Manager `testIamPermissions` on the scope, with the caller's own
   token and no quota header, must return exactly `resourcemanager.organizations.get`,
   `resourcemanager.folders.get` or `resourcemanager.projects.get`, as the scope's kind says. Every other
   answer refuses (fail closed). Nothing is asked as the account, and no account token is requested, before
   this step passes.
2. **The exposure check, optional** (`SA_MODE_STRICT_EXPOSURE=true`, off by default): the account's own `GET`
   of the scope must be exactly Resource Manager's IAM denial of that `get`. A permission granted publicly
   counts as the caller's in step 1, so on a scope whose `get` is public step 1 no longer tells a member from
   anyone; operators who cannot rule that out turn the check on. It is off by default because it refuses
   every scope where a customer granted the account more than `roles/cloudasset.viewer`.
3. **The list**, as the account, without a quota header.

- A pass is remembered in memory for at most five minutes, keyed by the SHA-256 of the caller's token and the
  scope, never past the token's own expiry and never for a refusal, at most 10 000 passes. The permission
  check (`/api/preflight`) always checks afresh.
- Every route that takes `mode: "sa"` runs the gate, before every CAI call as the account, each page of a
  stream included; routes that take no mode refuse a `mode` field. Refusals are 403, 401 or 503 with a `code`.
- Every decision writes one audit log line (`service-account gate`): the route, the scope, the SHA-256 of the
  caller's lower-cased email, the outcome with its step, whether the memo answered and whether strict mode is
  on; never the token, never the email.
- The account's identity comes from Application Default Credentials (the metadata server on Cloud Run;
  locally an impersonation or key file); a person's own credentials (`authorized_user`) are refused.
- `SA_MODE_ENABLED` switches service-account mode off, never the gate.

## The render API

- **The render API**, `POST /api/render`, draws SVG, PNG and draw.io on the server with the code `pnpm render`
  runs, so an instance's users can script exports:
  - **POST only**: no GET form, because scope ids, quota projects and view values would land in URLs that
    request logs record in full;
  - **four sources**: a live `scope` (the pull's own fields, credentials and rules), an uploaded `ndjson`
    export or `bundle` snapshot (multipart), or a `demo` size; the view as an app link's hash (a `tick` is
    refused; `snapshot`, `selection` and `highlight` are ignored) or as explicit fields; `theme`, `format`
    (`png`, `svg`, `drawio`), `scale` or `width`;
  - **authentication as everywhere else**: the token in `X-Gcportrait-Token` (or `Authorization: Bearer`
    without it); a live scope proves the token through the pull, or in service-account mode through the gate
    before every page; a demo or an upload needs Google's tokeninfo to accept the token before any work,
    because the most expensive route of an instance is not open to anyone with a well-formed string;
  - **limits**: one render at a time per instance, 10 renders a minute per token, the four stream slots per
    token shared with the pulls, the `RENDER_*` settings (assets, pixels, timeout, body size; an invalid value
    stops start-up) and the fixed limits (a scale of at most 3, 16 384 px a side, a 1 GiB worker heap, the 30
    s body deadline, the 60 s stall rule);
  - **a fresh `worker_threads` worker per render**, terminated when the render ends, times out or the client
    goes away, which returns the WebAssembly memory and caps the heap; `server.mjs` never imports the library,
    and the bundle step fails on any `.node` input;
  - **errors before any byte** of the image, in the server's error shape with a `code`; the route logs one
    line of counts and nothing about the token, the scope or the view; the answer carries no affiliation
    header;
  - **absent** on a demo-only instance and with `RENDER_API=false` (`RENDER_API=true` next to `DEMO_ONLY=true`
    stops start-up).

  [docs/api.md](../docs/api.md) is the reference for every field, header, error and limit;
  [docs/export.md](../docs/export.md) the user guide; the gcp-diagram-style skill (§7, §8) the export rules.

## Demo-only mode and legal pages

- **Demo-only mode** accepts `DEMO_ONLY` as exactly `true` or `false`; anything else stops start-up. With
  `DEMO_ONLY=true`, the backend refuses `OAUTH_CLIENT_ID`, `SA_MODE_ENABLED=true` and `RENDER_API=true`;
  the routes that call Google are not registered, and the Content Security Policy names no Google host.
- **An instance either links a legal page or serves its own text**, never both for one page: a link is
  `LEGAL_IMPRESSUM_URL` or `LEGAL_PRIVACY_URL` (https only); text comes from `LEGAL_DIR` or `LEGAL_BUNDLE`,
  checked and rendered by a Markdown reader that never emits HTML.

## Code

- **The backend** is Fastify 5: response contracts written once as zod schemas and handed to Fastify as JSON
  Schema; strict CSP and security headers (`src/security.ts`), rate limits, request ids and pino JSON logs
  with a header allowlist; two esbuild bundles (`server.mjs` and `render-worker.mjs`); a distroless image
  without `node_modules`. zod is imported as a namespace everywhere (`import * as z from 'zod'`), which lets
  esbuild leave zod's locales out of both bundles; ESLint refuses the named form, and the bundle test checks
  that no locale but the English one is bundled.

## Commands

| Goal | Command |
|---|---|
| Smoke-test the render API on a local build (`POST /api/render`, docs/api.md; your own token, which Google's tokeninfo must accept) | `pnpm build`, then `node backend/dist/server.mjs` and `curl -s -OJ -H "X-Gcportrait-Token: $(gcloud auth print-access-token)" --json '{"source":{"kind":"demo","size":"S"}}' http://localhost:8080/api/render` (draws the render golden's bytes) |
| Re-check what Google's APIs answer, which the backend's error classification rests on (your own tokens on standard input; cai-ingestion skill §9) | `gcloud auth print-access-token \| scripts/probe-google-apis.sh --project YOUR_PROJECT` (`--sa`, `--only`, `--json`, `--help`) |
| Run the production build without Docker (the backend bundle serves the built SPA, as in the image) | `pnpm build`, then `pnpm --filter @gcportrait/backend start` (<http://localhost:8080>; `backend/.env` is not read, so pass `OAUTH_CLIENT_ID=…` for sign-in) |
