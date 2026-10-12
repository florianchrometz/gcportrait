<!-- SPDX-License-Identifier: MIT -->

# 0031. The person's token travels in `X-Gcportrait-Token`, so user mode works behind Identity-Aware Proxy

- **Status:** accepted (2026-10-12) on the maintainer's behalf by the build orchestrator, who decided on
  2026-10-11 to accept ADRs 0030 to 0032; [docs/api.md](../api.md) and the render API
  ([ADR 0033](0033-render-api.md)) depend on the header. The maintainer may reopen it.
- **Date:** 2026-10-10 (accepted 2026-10-12)
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0004](0004-user-sign-in-and-service-account-mode.md) (user mode),
  [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §4 (principle 2),
  [docs/self-host.md](../self-host.md) ("Private instance"), [docs/api.md](../api.md)

## Context

The self-hosted private topology is Identity-Aware Proxy (IAP) in front of the Cloud Run service (`deploy.sh
--iap`) with user mode inside ([docs/self-host.md](../self-host.md)). Until 2026-10-10 the app sent the signed-in person's Google access token to every
`/api/*` route as `Authorization: Bearer`. IAP treats `Authorization` (and `Proxy-Authorization`) as the place
for its own credential: Google's IAP documentation ("Programmatic authentication") says IAP passes
`Authorization` on untouched only when a valid IAP token came in `Proxy-Authorization`, and otherwise processes
it itself. A browser has IAP's session cookie, not an IAP token, so behind `--iap` every call of the app except
demo mode would be refused by IAP ("Invalid IAP credentials") or reach the backend without the person's token.
The self-hosting review of 2026-10-10 had to choose: a header IAP leaves alone, or `--iap` only for service-account mode and the
demo.

## Decision

- The app sends the token in **`X-Gcportrait-Token: TOKEN`** (the bare token, no scheme) on every `/api/*`
  call, through the one function that adds it (`fetchWithToken`, `frontend/src/auth/fetch.ts`), and never in
  `Authorization`: a caller's own `Authorization` header is dropped there.
- The backend (`backend/src/stream/caller.ts`) reads `X-Gcportrait-Token` first. Only when a request carries no
  such header does it accept `Authorization: Bearer TOKEN`, the documented **non-IAP path** for scripts and
  `curl` against a public instance. A malformed `X-Gcportrait-Token` is refused (401); it is never replaced by
  what `Authorization` holds. Both headers use the same RFC 6750 token syntax and 4 KiB bound; the `Bearer`
  scheme is matched in any letter case (RFC 7235).
- **Neither header is ever logged**: the request serializer logs header values only from an allowlist, and both
  names are also on pino's redaction list for objects logged by hand (`backend/src/logging.ts`).
- **It is not a cookie**: the browser never stores it and never sends it on its own; only `fetchWithToken`
  adds it, only to same-origin `/api/` paths. A page of another origin cannot send it either: a custom header
  makes the browser ask first (a CORS preflight), and the backend answers no CORS request.
- **It is not cached**: the app's API requests are `cache: "no-store"`, and every `/api/*` answer carries
  `cache-control: no-store`.
- Upstream nothing changes: the backend still forwards the token to Google as `Authorization: Bearer`, which is
  what Google's APIs take, and IAP never sees that hop.

Behind IAP, then, IAP decides who may open the instance (its own cookie, the principals of `--iap-members`),
and the person's own token and IAM roles decide what they may read, in user mode and in service-account mode
alike.

## Consequences

`deploy.sh --iap` is a usable private topology for user mode, as intended; docs/self-host.md
("Private instance") and docs/permissions.md say so. Unit tests cover both extraction paths, the precedence, the
refusal of a malformed header and the redaction (`backend/src/stream/stream.test.ts`,
`backend/src/routes/scopes.test.ts`, `backend/src/logging.test.ts`, `backend/src/server.test.ts`); the client
(`frontend/src/auth/fetch.test.ts`, with a backend test that keeps the two header names equal); and the live e2e
specs check that the token reaches the backend in `X-Gcportrait-Token` only, never in `Authorization`
(`e2e/tests/preflight.spec.ts`, `live-pull.spec.ts`, `sa-mode.spec.ts`). Not yet verified: a real run behind
IAP (deploy with `--iap`, sign in, pull); the first real `--iap` deployment records it in docs/self-host.md
([docs/backlog.md](../backlog.md), "Self-hosting and backend").

Tools that recognise credentials by header name (proxies, log scrubbers outside this backend) do not know
`X-Gcportrait-Token`; anyone who adds a proxy in front of an instance must treat it as a credential. A client
written against the old contract (`Authorization: Bearer`) keeps working on a public instance, and only there.

## Alternatives considered

- **`--iap` only with service-account mode and the demo:** loses user mode, the default (ADR 0004), for every
  private instance, the topology meant for companies.
- **IAP's own token in `Proxy-Authorization`, the person's in `Authorization`:** the browser holds no IAP token;
  getting one needs an OAuth client for IAP's programmatic access and a second sign-in for every person.
- **A cookie:** the browser would store the token and send it with every request on its own, which ADR 0035 §4
  (principle 2) rules out and which would need CSRF protection.
- **The token in the request body:** every route would carry it in its schema, and a body is far easier to log
  by mistake than a header the logger already redacts.
