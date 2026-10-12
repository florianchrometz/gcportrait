<!-- SPDX-License-Identifier: MIT -->

# 0003. Fastify backend on Cloud Run

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0004](0004-user-sign-in-and-service-account-mode.md), [ADR 0005](0005-stateless-backend-browser-snapshots.md), [docs/api.md](../api.md), [docs/self-host.md](../self-host.md)

## Context

The backend has a narrow job: authenticate the caller, call Google APIs on their behalf, stream the results,
run the permission preflight and serve the built single-page app. It must start quickly on a
scale-to-zero platform, validate every request body (it must not become an open proxy), log in a form Cloud
Logging understands, and be easy for contributors to pick up.

## Decision

The backend is a Fastify service, deployed as one Cloud Run service per installation. Fastify was chosen for
schema-validated routes, pino logging, a fast cold start, and an Express-like programming model that
contributors already know.

## Consequences

- `backend/` is a Fastify 5 service with `/healthz`, `/api/config` and static serving of the SPA,
  security headers with a strict CSP (`@fastify/helmet`), rate limiting, request ids and pino JSON logs with a
  header allowlist. Its README documents every route and setting.
- Response contracts are written once as zod schemas and handed to Fastify as JSON Schema, so zod stays the
  single definition (agents.md hard rule 4).
- The CAI, scope-search, preflight and export-read routes, the container image, `infra/deploy.sh` and
  `infra/uninstall.sh` followed on 2026-10-10 ([docs/api.md](../api.md), [docs/self-host.md](../self-host.md)).
- One production image serves both the API and the SPA, which keeps self-hosting to a single service.
