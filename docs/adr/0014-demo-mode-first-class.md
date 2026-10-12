<!-- SPDX-License-Identifier: MIT -->

# 0014. Demo mode is a first-class feature; no real organisation data, ever

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** skill `cai-ingestion` §7, [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §4 (principle 6), [ADR 0034](0034-static-demo-on-pages.md)

## Context

Tests, screenshots, the website and agents' self-checks all need realistic organisations to draw, and
newcomers want to try gcportrait without a Google account. Real inventories cannot be used for any of this:
they belong to someone, and they would leak names, addresses and structure into a public repository.

## Decision

Demo mode is a first-class feature: deterministic synthetic organisations in four sizes (S, M, L, XL), each
with 35 days of history, used by the tests, the screenshots, the website and a "Try the demo" entry in the
app. No real organisation data is ever committed.

## Consequences

- `pnpm dev:demo` runs the app in demo mode: no backend, no `/api` calls, no Google
  account. The e2e suite runs against it.
- `packages/demo-data` generates the organisations from a seed, in the same NDJSON shape as CAI.
- Synthetic data uses `example.com` / `example.org` names, project numbers below 100000000000 and
  documentation or private IP ranges; the test suite fails on anything that looks real (ADR 0035 §4, principle 6;
  agents.md hard rule 6).
- Pull requests never name a real scope, even when a contributor tested against one.
