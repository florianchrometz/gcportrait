<!-- SPDX-License-Identifier: MIT -->

# 0002. TypeScript everywhere

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0001](0001-no-go-and-no-reuse-of-previous-code.md), agents.md hard rules 3 and 4, [docs/packages.md](../packages.md)

## Context

gcportrait has a browser app, a backend, pure computational packages (ingest, graph, layout), build tooling
and shared domain types. With Go ruled out (ADR 0001), one language can cover all of it, and shared types can
be defined once and used on both sides of the network boundary.

## Decision

TypeScript for all code, on Node 22 LTS, in a pnpm workspace, with strict type checking. Shell scripts are
allowed only under `infra/` and `scripts/`, for deployment and repository tooling.

## Consequences

- The root `package.json` pins pnpm through `packageManager` and requires Node `^22.22.2`; `.npmrc` sets
  `engine-strict`, so a wrong Node version fails at install time. `.nvmrc` holds `22`.
- `tsconfig.base.json` turns on `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax` and `erasableSyntaxOnly` (no enums, namespaces or constructor parameter properties).
  The frontend uses bundler resolution; the backend, e2e, tooling and every shared package extend
  `tsconfig.node.json` (NodeNext), so relative imports carry an explicit `.js` extension.
- `pnpm typecheck` runs `tsc -b` over every project listed in the root `tsconfig.json`; a new package must be
  added there.
- ESLint uses typescript-eslint's `strictTypeChecked` set and forbids `any`.
- Shared types are zod schemas in `@gcportrait/model`, with every type inferred through `z.infer`; nothing is
  declared twice (agents.md hard rule 4).
- TypeScript is held at 6.0.x for as long as typescript-eslint supports nothing newer.
