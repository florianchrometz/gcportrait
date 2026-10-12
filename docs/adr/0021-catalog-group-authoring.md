<!-- SPDX-License-Identifier: MIT -->

# 0021. Catalog authoring by groups: group-owned files and a generated, uncommitted compiled catalog

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** ADR [0015](0015-maintainability-catalog-as-data.md), skill `gcp-asset-catalog` §1, `packages/catalog/README.md`

## Context

On 2026-10-09 the official asset types were to be mapped by up to twelve authors at once, one per product group
of the implementation plan of October 2026. With the catalog tooling as first built, every one of them would have
edited the same three files: `known-unmapped.yaml` (one list of every
unmapped type), the one product file of a shared service (Compute Engine spans four groups, Network Security
two), and the committed compiled module `src/generated/catalog-data.ts`, which every catalog change
regenerated. `icon-keys.json` had to grow with every new product icon, and `pnpm catalog:check` failed for the
whole catalog as soon as any one author's files were half done, so nobody could get a clean signal for their
own work.

## Decision

- **Groups own types.** `packages/catalog/known-unmapped/<group>.yaml`, one per group (the twelve product groups
  from `networking-fabric` to `operations-platform`, plus `hierarchy` and `policy-and-runtime`), lists the official types the group owns (`owns`: exact types or
  `<service>/*`, the most specific pattern wins) and those it has not mapped yet (`types`, with reasons).
  Every official type has exactly one owner; the checker enforces it (`group-overlap`, `unmapped`,
  `known-unmapped-wrong-group`, `known-unmapped-but-mapped`). The split follows the planned product
  groups; Compute Engine's types follow the catalog seed's sections, except Cross-Site Interconnect
  (CrossSiteNetwork, WireGroup), which the hybrid-connectivity group owns. The group files' `owns` are the
  record.
- **Several product files per service, each one group's.** `products/<service>[.<suffix>].yaml`, merged by
  `service` (and, within a service, by product name); a product file holds one group's types only. A service
  several groups own (Compute Engine, Network Security, IAP) has no plain `<service>.yaml`: each group's file
  is `products/<service>.<group>[-<more>].yaml`, `<group>` the group's name (`product-file-group`),
  so two authors in one working tree can never create the same file. The Compute Engine seed was renamed to
  `compute.googleapis.com.networking-fabric.yaml` accordingly. A file whose suffix names a group belongs to
  that group whatever its service; any other file belongs to the owner of the types it describes.
- **Blame lands on the file that has to change.** A type described twice is an error naming both files, blamed
  on the file that is not its owner's (the owner's entry is the one compiled); files of one product
  disagreeing on its icon blame the later file in a fixed order (plain file, then group order), which
  documents whose icon wins. A type in a file named after another group is `product-file-group` on that type
  in that file ("remove it from this file"), and the owner's unmapped line is stale
  (`known-unmapped-but-mapped`) only once the type is mapped in one of the owner's own files: one group
  mapping another's type never fails the owner's check.
- **Scoped checks.** `pnpm catalog:check --group <group>` and `--file <path>` compile everything but fail only on
  the problems blamed on the selection; a problem blamed on another file that names a selected one is a
  non-failing note. A product file that does not parse still belongs to one group: the one its name names,
  else the owner of the type keys in its text, else (no types) every group of its service. `--verbose` traces
  every rule through its fixtures; `pnpm catalog:coverage` reports per group.
- **Pending icon keys warn.** An icon key missing from `icon-keys.json` is a warning; `--strict-icons` restores
  the failure. Since `packages/icons` exists (2026-10-09), its tests fail when a key does not resolve to an icon.
- **The compiled catalog is a build artefact.** `src/generated/compiled-catalog.ts` is git-ignored and written
  by `pnpm catalog:build`, which `pnpm install` (root `prepare`) and the root, catalog and graph `lint`,
  `typecheck` and `test` scripts run first. It leaves out every type whose description (the owner's, for a
  type described twice) has a violation of its own, and what does not validate, so a half-finished entry never
  reaches the graph builder or breaks another package's typecheck, and a broken copy in another group's file
  never takes the owner's entry out; `pnpm catalog:check` is the gate and fails (`generated-committed`) if a
  file under `src/generated/` is ever tracked again. CI gets the artefact from every job's install and builds
  it once more as a step of the `install` job.
- **Tests that survive the fan-out.** The catalog package's tests of the real data assert invariants (the seed
  is a subset, values contain what they must, ownership comes from `owns`), so a correct mapping by any group
  keeps them green and no group has to edit them; the command-line tests run on a synthetic catalog with its
  own official list (`--root`, `--official`). One test, like `pnpm catalog:check` itself, is a whole-catalog
  gate. The graph's demo and view tests use a type's real entry in place of their stand-in once it is clean
  (`packages/graph/test/demo-rules.ts` lists the relations each stand-in covers, which a real entry should
  cover too) and check lower bounds wherever a correct rule may add something: Shared VPC pairs from the real
  catalog alone, external stubs, dangling references (none into the organisation except the Compute default
  service accounts the demo does not generate; any number outside it, such as public images). The networking
  acceptance view pins its detail level instead of relying on `auto`, whose choice depends on how many cards
  the catalog draws. A rehearsal that maps every graph stand-in and every other demo type as the seed
  describes, each in its group's file, keeps the whole tree green.

## Consequences

- Groups work in disjoint files; the only shared catalog files left are the lenses, `icon-keys.json` and the
  tests, none of which group authors need to edit.
- In one shared working tree the whole-catalog gates (`pnpm catalog:check` without `--group`, and the test
  "compiles without a single violation", which lists the violations by group) fail while any group is
  mid-edit; an author's own signal is the scoped check. The graph's demo tests keep their stand-in rules for a
  type until its real entry is clean; a seed-faithful entry keeps them green, but an entry with fewer
  relations than the stand-in, or a role the seed does not give (a Tier-1 type hidden), can still change what
  they see: the author reports it, and the catalog review ran them for every wave.
- A fresh clone needs `pnpm install` (or `pnpm catalog:build`) before an editor or a bare `vitest` run can
  resolve the catalog module; every documented command does it on its own.
- Adding a type to the official list now means adding it to a group's `owns` and `types`; the drift workflow's
  issue says so.
- The first tooling's committed compiled module is replaced. The icon check stays a warning by default; the
  icons package's tests catch a key that does not resolve.

## Alternatives considered

- Keep the committed module and regenerate it after each merge: every group's branch would still conflict on
  it, and a merge would need a rebuild to be correct.
- One product file per group instead of per service: breaks the service-to-file naming that the checker and
  readers rely on, and still leaves the shared unmapped list.
- Derive group ownership from a table in code: a second, hard-coded copy of data the YAML already holds.
