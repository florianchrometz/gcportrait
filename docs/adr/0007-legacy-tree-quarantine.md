<!-- SPDX-License-Identifier: MIT -->

# 0007. The previous implementation moves to `legacy/knoyog/` and is quarantined

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0001](0001-no-go-and-no-reuse-of-previous-code.md), [ADR 0017](0017-licence-chosen-by-maintainer.md), [docs/handoff.md](../handoff.md)

## Context

This repository is gcportrait's build site, and it started out as knoyog's repository. The old tree is useful
as a reference for what was built and what went wrong, but it must not leak into gcportrait (ADR 0001), and
the public gcportrait repository must start without it (ADR 0017).

## Decision

- The knoyog tree moves to `legacy/knoyog/` with `git mv` (moved on 2026-10-08), so `git log --follow` still
  works in the build repository. gcportrait owns the repository root with `frontend/`, `backend/`, `packages/`, `website/`, `infra/`,
  `docs/` and `e2e/`.
- `legacy/` is reference-only and frozen: nothing in it is built, tested, linted, formatted or deployed, and
  nothing outside it imports from it. `legacy/README.md` (build repository only) states this.
- `legacy/` is excluded from the hand-off: the hand-off script leaves it out, so `legacy/` exists only in the
  build repository.

## Consequences

- The pnpm workspace, `tsc -b`, ESLint, Prettier, EditorConfig and the provenance walker all skip `legacy/`.
  ESLint and `scripts/check-provenance.mjs` reject any import of a `legacy/` path.
- The old CI workflow is kept, disabled, as `legacy/knoyog/.github-ci.yml.disabled`.
- agents.md hard rule 11: `legacy/` exists only in the build repository; never touch it, never import from it,
  never copy from it.
- At hand-off, `scripts/handoff.sh` exports the working tree without `legacy/`, `.git/` and build
  output into a fresh repository with a single commit and no history from this one.
