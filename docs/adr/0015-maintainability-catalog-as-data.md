<!-- SPDX-License-Identifier: MIT -->

# 0015. Maintainability is a design goal: the asset catalog is data

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** skill `gcp-asset-catalog`, [ADR 0020](0020-graph-depends-on-catalog.md), [ADR 0021](0021-catalog-group-authoring.md), [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §3 and §6

## Context

Cloud Asset Inventory listed 633 asset types across 146 products on 2026-10-08, and Google adds types every
month. A tool that knows asset types only through code falls behind and silently drops what it does not know.
gcportrait is also meant to outlive its first author, so contributors need a clear path from fork to merged
change.

## Decision

- The asset catalog is data: asset types, relation rules, lenses, icon mappings, product names, console URL
  templates and relation styles are declarative files under `packages/catalog` and `packages/icons`. Code
  reads them; no second map lives in code.
- Unknown asset types still render (a generic card, nested by `parent`), and the coverage tool reports them.
- CI checks catalog coverage against the official asset-type list, and a weekly job reports drift.
- Contributors have a documented fork, run, test, self-host and pull-request path.

## Consequences

- `pnpm catalog:check` (the validator and coverage report, built on 2026-10-09 together with
  `pnpm catalog:fetch-official`) is part of `pnpm check` and CI.
- `.github/workflows/catalog-drift.yml` runs weekly; it opens or updates one issue when the official list
  changes.
- Adding an asset type is a documented, roughly 20-minute task with a fixture (`gcp-asset-catalog` skill §6).
- The contributor path lives in `docs/contributing.md` and the `contributor-workflow` skill; decisions live in
  these ADRs; release notes come from changesets.
- Unmapped official types must be listed with a reason in the owning group's `known-unmapped/<group>.yaml`
  (ADR 0021).

## Alternatives considered

- **Hard-coded maps in code (type lists, product names, icon lookups).** Rejected: a second hard-coded map
  next to the configuration was one of the previous implementation's recorded pain points (ADR 0035
  §3).
