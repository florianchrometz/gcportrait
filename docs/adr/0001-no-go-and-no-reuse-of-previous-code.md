<!-- SPDX-License-Identifier: MIT -->

# 0001. No Go code and no reuse of the previous implementation or its upstream

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0007](0007-legacy-tree-quarantine.md), [ADR 0017](0017-licence-chosen-by-maintainer.md), [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §3

## Context

gcportrait replaces knoyog, a Go service that wrapped Google's Apache-2.0 tool gcpviz: it vendored the
upstream Go code, its `relations.yaml`, Gizmo queries, DOT templates and styles, all carrying Google copyright
headers. The maintainer wants to choose gcportrait's licence freely (ADR 0017). Anything copied, paraphrased or
ported from that code would bring an existing licence and its attribution obligations into the new project.

## Decision

- No Go code anywhere outside `legacy/`.
- No reuse of gcpviz or knoyog source, configuration, queries, templates or styles. Concepts may be re-derived
  (ADR 0035 §3 keeps the lessons worth keeping); text, code, YAML, JavaScript queries and DOT templates may not be
  copied, paraphrased line by line, or ported.
- Contributors may read `legacy/` to learn *what* was done, then design *how* from scratch. A solution that
  reads like a translation is rejected.
- The tree handed off to the public repository contains no old code and no old git history.

## Consequences

- `scripts/check-provenance.mjs` (`pnpm provenance`, part of `pnpm check`, CI job `provenance`) fails on any
  import of a `legacy/` path, on the names gcpviz, knoyog and forseti and on Google copyright notices outside
  the exempt documents (`docs/adr/**`, `packages/icons/README.md`), on `.go`, `.dot` and `.gv` files
  and Gizmo queries, and on symbolic links. The CI job plants a legacy import on every run to prove the guard
  still fails.
- ESLint (`eslint.config.js`) also rejects static and dynamic imports of `legacy/` paths.
- Every pull request carries the provenance statement from the PR template; reviewers check for translations
  (contributor-workflow skill §6).
- The rewrite keeps the old tool's lessons as ideas only, for example: graph, layout and render stay typed end
  to end instead of passing through DOT and being parsed back (ADR 0035 §3).
- These ADRs are the one place where the old names may be written down.

## Alternatives considered

- **Keep wrapping the upstream tool, as knoyog did.** Rejected: it keeps the Apache-2.0 obligations and the
  Google copyright headers in the product, and its DOT round trip was lossy (ADR 0035 §3).
- **Port the useful parts to TypeScript.** Rejected: a port is a derivative work, which is exactly what this
  decision exists to avoid.
