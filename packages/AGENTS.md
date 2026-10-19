<!-- SPDX-License-Identifier: Apache-2.0 -->

# AGENTS.md: the packages

These rules add to the root AGENTS.md, which applies here too.

## The packages

| Package | What it holds |
|---|---|
| `model` | zod schemas, the URL-hash codec and the synthetic-data guard |
| `demo-data` | synthetic organisations S, M, L and XL with history |
| `ingest` | CAI NDJSON → Snapshot |
| `catalog` | asset types as YAML, the rule engine, compiler and coverage check |
| `graph` | Snapshot → Graph → Scene |
| `layout` | Scene → Layout: packing, gutter routing, invariants and the worker |
| `icons` | Google's product icons, vendored unmodified, and a few own drawings |
| `render` | a snapshot and a view as SVG, PNG and draw.io, with resvg-wasm; behind `pnpm render` and `POST /api/render` |
| `render-cli` | `pnpm render` |

## Catalog and graph semantics

- **An export's read time** comes from an `operation.json` next to it, from the person, or from the newest
  `updateTime`, because an export file carries no read time of its own.
- **Snapshot files carry a `schemaVersion`**, and a format change adds a migration (`migrateSnapshot` in
  `@gcportrait/model`) in the same change, so every file a user saved stays readable.
- **The catalog is authored by groups**, each official type owned by exactly one group and checked as such,
  so groups work in disjoint files; a check scoped to one group or file fails only on that selection's
  problems. Ownership patterns are exact types or `<service>/*`, the most specific pattern wins, and each
  unmapped type has a reason. The gcp-asset-catalog skill (§1, §6) holds the file layout and procedure.
- **The compiled catalog is a build artefact**, git-ignored, built before install, lint, typecheck and test
  use it; it leaves out every type whose own description has a violation, so a half-finished entry never
  reaches the graph builder. `pnpm catalog:check` refuses tracked files under `catalog/src/generated/`;
  the gcp-asset-catalog skill (§1, §6, §8) holds the build commands and checks.
- **Coverage is checked against the official asset-type list** in CI, and the weekly drift workflow opens or
  updates one issue when Google's list changes. The catalog carries its own `version` and `officialListDate`.
- **`@gcportrait/catalog` owns rule semantics.** Its rule engine (relations, containment, labels, subtitles,
  console links, IP and domain extraction, `hiddenWhen`, the normalisers) is the single implementation, used
  by the compiler's fixture proofs and the graph builder alike, so the two cannot disagree. It stays pure and
  browser-safe (no Node APIs, no I/O, deterministic), because the graph builder runs in a web worker; the
  catalog's Node tooling lives in `packages/catalog/tooling/`.
- **References, templates, visibility and merged edges follow the gcp-asset-catalog skill** (§2–§5), which
  specifies reverse rules, child-side containment, sibling and Kubernetes references, missing template
  values, reciprocal edges and `includeTypes` with `hiddenWhen`.
- **Every `hiddenWhen` is proven** by a fixture it matches and one it does not (`hidden-unproven`), so an
  always-true predicate cannot hide a type.
- **Canonical project matching.** Asset names are never rewritten. A reference that matches no node is tried
  once more with its first `projects/<ref>` segment swapped through the snapshot's project index (number to id
  or id to number); an exact match wins, and a reference that matches neither way stays dangling as read.
- **Shared VPC only on evidence.** A cross-project `attaches` edge is a Shared VPC attachment when it goes
  into a subnetwork of another project in the snapshot, or into a network of a project whose Compute settings
  say `xpnProjectStatus: HOST`; other cross-project attachments are drawn but are no Shared VPC.

The [gcp-asset-catalog skill](../.agents/skills/gcp-asset-catalog/SKILL.md) and
[catalog/README.md](catalog/README.md) hold the schema, the normalisers and the authoring procedure;
[graph/README.md](graph/README.md) the builder.

## Layout and drawing rules

- **gcportrait's own layout engine.** `packages/layout` is a pure TypeScript engine of nested-zone grid
  packing and orthogonal gutter routing, not built on ELK, Graphviz or Cytoscape: none of them routes the
  edges that cross zone boundaries the way these diagrams need. The gcp-diagram-layout skill is its
  specification and holds every constant.
- **Typed end to end.** Graph, layout and render never pass through a lossy text format (such as DOT) that is
  parsed back.
- **Pure cores.** `packages/ingest`, `packages/graph` and `packages/layout` have no side effects, no DOM and
  no randomness (text widths come from a generated Roboto metrics table), so they run anywhere, in a worker
  included, and test exactly. Everything in them is unit-tested; graph and layout also have property tests
  (fast-check).
- **Deterministic.** The same Scene gives a byte-identical Layout, report included (warnings sorted in
  code-point order), whatever order its children or edges came in. The invariants of the gcp-diagram-layout
  skill (§5) are held by tests, with golden layouts per demo fixture and lens. The render library reports
  structural violations, and `pnpm render --strict` fails on them; the app's workers do not run these checks.
- **Packing** keeps sibling order, a card grid above full rows of zones, wider than tall, by the smallest
  frame, held to the packing criterion (gcp-diagram-layout skill §4). Tidy grids read as a picture, and
  sibling order keeps a folder's projects in the order a reader expects.
- **Routing.** Routes run through the gutters between boxes, never across a card or a zone header, and leave
  a port in a straight run; the gcp-diagram-layout skill (§5) specifies the cost model, lanes, bundles,
  self-edges, widening passes and thresholds.
- **Progressive disclosure** follows the gcp-diagram-layout skill (§6): budgeted `auto`, the lens's ceiling
  and the small-view exception, with explicit levels uncapped.
- **The layout runs in a worker per request**, memoised by Scene hash, superseded requests cancelled, never
  behind a global lock and never on the UI thread.

## The render library

- **`pnpm render` draws byte for byte what the app's renderer draws**, through the frontend's headless
  entry (`frontend/src/headless.ts`), for tests, screenshots and agents' self-checks.
- **One render library**, `@gcportrait/render`, between a snapshot and the bytes, used by the CLI and the
  backend alike, so a view renders the same from either.
- **One rasteriser**, `@resvg/resvg-wasm`, pinned to an exact version, which computes the same pixels on
  every platform, so the API, the CLI and the render golden agree by construction.

## Performance budgets

The budgets in the [gcp-diagram-layout skill](../.agents/skills/gcp-diagram-layout/SKILL.md) (§7) run in the
unit tests at twice their value on any machine and strictly in `pnpm --filter @gcportrait/<pkg> test:budget`.
A local unit run skips a missed one with the load as its reason while the machine is overloaded, which CI
never does. The same section holds the app's performance targets.

## Commands

| Goal | Command |
|---|---|
| Validate the asset catalog and report coverage (exit 1 on any violation) | `pnpm catalog:check` (`--group <group>` / `--file <path>` for one group's or file's problems, `--verbose` for rule traces, `pnpm -s catalog:check --json` for JSON) |
| Per-group catalog coverage (owned official types, mapped by role, unmapped, missing) | `pnpm catalog:coverage` (`--group <group>`, `--json`) |
| Compile the catalog into its git-ignored module (also run by install, lint, typecheck and test) | `pnpm catalog:build` |
| Fetch the official asset-type list into a new dated snapshot and print the drift | `pnpm catalog:fetch-official` |
| Print the Scene summary of a demo organisation for a view (ingest → graph → scene) | `pnpm render-scene --fixture M --lens networking` (`--help` for focus, root, filters, detail, `--json`) |
| Generate a demo organisation / regenerate the committed demo fixtures | `pnpm --filter @gcportrait/demo-data generate --size L --out /tmp/l.ndjson` / `... fixtures` |
| Performance budgets on their own (XL ingest 1.5 s, M graph build 150 ms, layout S 20 ms / M 100 ms / L 800 ms / XL 3 s through a worker; the app's targets are in the layout skill §7) | `pnpm --filter @gcportrait/ingest test:budget` / `pnpm --filter @gcportrait/graph test:budget` / `pnpm --filter @gcportrait/layout test:budget` |
| The layout's benchmark table (medians, memo, cancellation, memory; exit 1 on a missed budget) | `pnpm --filter @gcportrait/layout bench` |
| How a layout's routes read per view (length, bends, border hugging, crossings, detours, canvas margin, overshoots; lane holders, the first pass's search work and the mode), or with `--packing` the packing rules side by side | `pnpm --filter @gcportrait/layout measure` (`--view L:overview:projects`, `--packing`, `--json`; default: M at `auto` × three lenses and L overview at `projects`) |
| Look at a layout's packing and routing (debug SVG + PNG of rects, labels and routed edges, not the renderer) | `pnpm --filter @gcportrait/layout debug-svg --fixture M --lens overview --theme both --aspects` (writes `out/layout/`) |
| Regenerate the layout's golden JSON / its Roboto metrics table (deliberately; review the diff) | `pnpm --filter @gcportrait/layout test:golden:update` / `pnpm --filter @gcportrait/layout metrics` |
| Regenerate the render goldens, PNG and draw.io (deliberately; look at the changed files) | `pnpm --filter @gcportrait/render-cli test:golden:update` |
| Re-vendor Google's icons / rebuild the icon module / the contact sheet (both themes, 16 px legibility) | `pnpm --filter @gcportrait/icons vendor --verify-render` / `... build` / `... contact-sheet` (writes `out/`) |
| Compare the vendored icons with what Google Cloud provides now (new, changed, renamed and removed icons; needs the network; the weekly `icon-drift.yml` runs it) | `pnpm --filter @gcportrait/icons drift` (`--markdown FILE`, `--json FILE`, `--offline --zips DIR`) |
