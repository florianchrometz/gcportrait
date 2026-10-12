<!-- SPDX-License-Identifier: MIT -->

# 0020. The graph builder depends on the catalog package

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** ADR [0015](0015-maintainability-catalog-as-data.md), agents.md "Layout", [docs/packages.md](../packages.md), skill `gcp-asset-catalog`

## Context

Catalog rules are data, but data needs one interpreter: JSONPath evaluation, the thirteen normalisers, label
and console templates, IP and domain extraction and `hiddenWhen` predicates. Two places need that interpreter.
The catalog compiler (`pnpm catalog:build`, `pnpm catalog:check`) must prove every rule against its fixture,
and the graph builder (`packages/graph`) must evaluate the same rules on every asset of a snapshot. The planned
package layout drew the dependency direction as `graph → model` only, and `eslint.config.js` allowed `packages/*` to
import nothing but `@gcportrait/model`.

## Decision

- `@gcportrait/catalog` owns rule semantics: its rule engine (`evaluateRelations`, `evaluateContains`,
  `nestsByParent`, `renderLabel`, `renderSubtitle`, `renderConsoleUrl`, `extractIps`, `extractDomains`,
  `isHiddenByDefault`, the normalisers) is the single implementation, and it exports the compiled catalog.
- `@gcportrait/graph` imports `@gcportrait/catalog` (and `@gcportrait/model`); the dependency direction becomes
  `model ← catalog ← graph ← frontend`. No other package under `packages/` may import the catalog without a
  further ADR.
- Two development-only edges come with it, outside the library: the graph package's tests
  (`packages/graph/test/**`) may import `@gcportrait/demo-data`, to build the demo organisations the demo and
  view tests run on, and its `render-scene` command (`packages/graph/scripts/**`) may import
  `@gcportrait/demo-data` and `@gcportrait/ingest`, to feed the committed demo fixtures through ingestion as
  the app will. Both are dev dependencies in `packages/graph/package.json`; nothing under
  `packages/graph/src/` imports either.
- The rule engine stays pure and browser-safe (no Node APIs, no I/O, deterministic), because the graph builder
  runs in a web worker. The catalog's Node tooling lives in `packages/catalog/tooling/`, outside the runtime
  library.
- Types that cross the boundary (the project index, a rule's evaluated relation and its target) are zod schemas
  in `@gcportrait/model` (`ProjectIndexSchema`, `EvaluatedRelationSchema`, `RelationTargetSchema`).

## Consequences

- `eslint.config.js` lets `packages/graph/**` import `@gcportrait/{model,catalog}`, `packages/graph/test/**`
  also `demo-data`, and `packages/graph/scripts/**` also `demo-data` and `ingest`; every other package rule is
  unchanged.
- A change to rule semantics is made once, in `packages/catalog`, with its unit tests; the compiler's fixture
  proofs and the graph builder cannot disagree.
- `packages/catalog/tsconfig.lib.json` type-checks the runtime library without Node's types, which keeps the
  engine usable from the worker; the graph package's tests may rely on it.
- The package map (agents.md "Layout", `docs/packages.md`) has the `graph → catalog` edge and the two
  development-only edges; the graph builder uses this package instead of writing its own normalisers.
- Since the catalog review of 2026-10-09 the graph's demo and view tests run on the real compiled catalog, so a correct catalog rule can
  change their expectations; the catalog README explains how those tests bound what a rule may add.

## Alternatives considered

- **Put the rule engine in `@gcportrait/model`.** Lost: model holds schemas and types only and imports no
  other workspace package; an interpreter with a JSONPath parser and normalisers does not belong at the bottom
  of the graph.
- **A separate `@gcportrait/rules` package used by both.** Lost: one more package with no consumer other than
  catalog and graph, and the rule grammar would still be defined by the catalog's data and schemas.
- **Duplicate the evaluation in `packages/graph`.** Lost: two implementations of the same semantics drift,
  which is exactly the "second map in code" ADR 0015 rules out.
