<!-- SPDX-License-Identifier: MIT -->

# Packages and data flow

How gcportrait's workspace packages divide the work, what each one exposes, and how data travels from a Cloud
Asset Inventory (CAI) source to a diagram, with the real package, function and type names. Each package's
`README.md` is the detailed reference; this page is the map, and [section 6](#6-terms) defines the words the
other pages use (Snapshot, Graph, Scene, Layout, Lens, Focus, Tick, dangling reference).

## 1. The pipeline

Every step below is a pure function, and what passes between steps is a `@gcportrait/model` type
(`Snapshot`, `Graph`, `ViewSpec`, `Scene`), except the NDJSON text the sources produce. Only reading a file
or the backend stream touches I/O. The whole chain runs without a browser: `pnpm render-scene`
(section 4) prints a demo view's Scene, and `pnpm render` and the backend's `POST /api/render` (through the
render library, `@gcportrait/render`) lay it out and draw it as SVG and PNG with the app's own
components, and as a draw.io file translated from that SVG.

```
 sources      @gcportrait/demo-data              CAI export files              CAI API pull
              generateOrganization({ size })     exportAssets NDJSON,          backend /api/assets/stream
              → toCaiNdjson(assets, style?)      snake_case envelope keys      NDJSON frames, camelCase
                    │ NDJSON                            │ NDJSON                       │ NDJSON
                    ▼                                   ▼                              ▼
 ingest       @gcportrait/ingest   ingest(input, { scope, source, readTime?, clock, entropy })
              (in the app's workers: ingest for a dropped export and the demo, createIngestSession for
              the backend's streams)
              → { snapshot: Snapshot, report: IngestReport }        (report.projects is a ProjectIndex)
                    │ Snapshot  (the frontend keeps it in IndexedDB: src/snapshots/)
                    ▼
 graph build  @gcportrait/graph    buildGraphWithReport(snapshot, catalog, { showRegions? })
              reads @gcportrait/catalog: catalog, evaluateRelations, evaluateContains, evaluateAliases,
              nestsByParent, renderLabel, renderSubtitle, extractIps, extractDomains, isHiddenByDefault
              → GraphBuild { graph: Graph, report: GraphReport }
                    │ Graph
                    ▼
 view         ViewSpec from the URL hash: decodeViewSpec(location.hash) in @gcportrait/model
              @gcportrait/graph    buildSceneWithReport(graph, viewSpec, catalog, env: SceneEnv)
              root → focus → lens → filters → detail → pointers
              → SceneBuild { scene: Scene, report: SceneReport }
                    │ Scene
                    ▼
 layout       @gcportrait/layout   layoutScene(scene, options?)   (layoutSteps: the same, as a generator)
              (a web worker in the app: createLayoutWorkerHandler / layoutClient; memo of 8 by layoutKey)
              normalise → size (Roboto metrics table) → pack → gutters + route (≤ 4 passes) → invariants
              → Layout { rects, edges, chips, bounds, arrangements, gutters, report }
                    │ Layout  (+ the Scene's icons, resolved through @gcportrait/icons in the data worker)
                    ▼
 render       frontend src/diagram/: DiagramSvg / DiagramCanvas: Scene + Layout + theme → SVG
              (zones, cards, chips, icons, edges, secures overlays, legend, title block); pan and zoom, LOD,
              hover, selection, the selection trace and the console action painted by attributes only
              frontend src/export/: the export flow behind the top bar's Export menu
              (src/shell/topbar/ExportMenu.tsx): standalone SVG, PNG at 2×/3×, clipboard
              frontend src/export/drawio/: that SVG → draw.io cells → .drawio (a lazy chunk)
              @gcportrait/render: the same components → SVG → PNG (resvg-wasm) or .drawio,
              behind `pnpm render` (@gcportrait/render-cli) and the backend's POST /api/render

 timeline     @gcportrait/graph    diffSnapshots(before, after) → Diff { added, removed, changed }
```

`toSnapshot(org)` in `@gcportrait/demo-data` skips the NDJSON step and returns a valid Snapshot directly;
tests use it. The app's demo entry ("Try the demo", in a demo worker), `pnpm render-scene`, the diagram page's
data worker and `pnpm render` all take the NDJSON path, feeding the demo organisation through `ingest` as CAI
NDJSON like an export file; the demo entry then stores the Snapshot and its history in IndexedDB.

## 2. Dependency direction

Imports go strictly downward and always through a package's name and its `src/index.ts`, never a deep or
relative path. `eslint.config.js` (`WORKSPACE_DEPENDENCIES`) enforces this table; `pnpm lint` fails on
anything else.

| Files | May import |
|---|---|
| `packages/model/**` | no other `@gcportrait` package |
| `packages/*/**` (demo-data, ingest, catalog, layout, icons) | `model` (`icons` imports none) |
| `packages/graph/**` | `model`, `catalog` (the catalog owns rule semantics; packages/AGENTS.md, "Catalog and graph semantics") |
| `packages/graph/test/**` | `model`, `catalog`, `demo-data` (a dev dependency: the demo and view tests build the demo organisations) |
| `packages/graph/scripts/**` | `model`, `catalog`, `demo-data`, `ingest` (the `render-scene` command) |
| `packages/layout/test/**`, `packages/layout/scripts/**` | `model`, `graph`, `catalog`, `demo-data` (dev dependencies: the golden, performance and debug-render Scenes are built from the demo organisations) |
| `packages/ingest/test/**` | `model`, `demo-data` (a dev dependency: the budget test reads the demo organisation XL, written as an export) |
| `packages/render/**` | `model`, `catalog`, `graph`, `layout`, `demo-data`, `frontend` (the render library: Node code on top of the app that reads data and draws with the frontend's own readers and components through `@gcportrait/frontend`, the headless entry point `frontend/src/headless.ts`; the one package that may import the frontend, which may not import it) |
| `packages/render-cli/**` | `model`, `demo-data`, `render` (`pnpm render`, the command line around the render library; nothing imports it) |
| `packages/render-cli/test/**` | `model`, `graph`, `demo-data`, `render` (a dev dependency: the tests check the `auto` budget against the graph's) |
| `frontend/**` | `model`, `catalog`, `graph`, `layout`, `icons`, `ingest`, `demo-data` |
| `backend/**` | `model`, `catalog`, `ingest`, `render` (the render library only in the render job, `src/render/job.ts` and `worker.ts`, which the bundle turns into `dist/render-worker.mjs`; `dist/server.mjs` never holds it, `src/render/bundle.test.ts`) |
| `website/**` | `model`, `catalog`, `demo-data` |
| `e2e/**` | `model`, `demo-data` |

```
            frontend ──► graph ──► catalog ──► model
               │  └────► layout ────────────► model
               ├───────► ingest ────────────► model
               ├───────► demo-data ─────────► model
               └───────► icons                (imports nothing)
            backend ───► ingest, catalog, model; render (its render worker only)
            render ────► frontend (headless entry), graph, layout, catalog, demo-data, model   on top of the app
            render-cli ► render, demo-data, model; graph (tests)                            tooling
            graph ┄┄┄┄► demo-data (tests, scripts), ingest (scripts)   development only
            layout ┄┄┄► graph, catalog, demo-data (tests, scripts)    development only
            ingest ┄┄┄► demo-data (tests)                            development only
```

The sketch leaves out direct imports that the table allows anyway (the frontend may also import `catalog` and
`model` itself). The dotted edges are development dependencies: nothing under `packages/graph/src/` imports
`demo-data` or `ingest`, and nothing under `packages/layout/src/` or `packages/ingest/src/` imports anything
but `model`. `render` is the one edge that points up, from `packages/` to the app: it exists so the picture
`pnpm render` and the render API draw is the app's picture, read by the app's own code, and it is recorded in
`eslint.config.js` ([AGENTS.md](../AGENTS.md), "Architecture and code"); moving the pure SVG components into a
package of their own would turn it downward (section 5).

Types that cross a boundary are zod schemas in `@gcportrait/model`, declared once; a package that needs a new
one adds it there (additively) instead of declaring its own.

## 3. The packages

### `@gcportrait/model` — shared types

**Responsibility.** The single definition of every type that crosses a package boundary, as zod schemas with
inferred types, plus the URL-hash codec for views. Imports no other workspace package; no side effects.

**Entry point.** `packages/model/src/index.ts`. Main exports:

| Area | Exports |
|---|---|
| Input data | `AssetSchema`/`Asset`, `SnapshotSchema`/`Snapshot`, `migrateSnapshot` (the only way to read a stored snapshot) |
| Graph | `GraphSchema`/`Graph`, `GraphNode`, `RelationEdge`, `Containment`, `GraphIndexes`, `RELATION_KINDS` |
| Graph builder report | `GraphBuildSchema`/`GraphBuild`, `GraphReport`, `SharedVpcPair`, `ContainmentCycle` |
| Views | `ViewSpecSchema`/`ViewSpec`, `normalizeViewSpec`, `encodeViewSpec`, `decodeViewSpec`, `DEFAULT_VIEW_SPEC` (the codec and its normaliser import no zod, so the UI thread loads none) |
| Vocabularies without zod | `LENS_IDS`, `DETAIL_LEVEL_IDS`, `RELATION_KIND_IDS`, `FOCUS_KIND_IDS`, `DEMO_SIZES` and the guards `isLensId`, `isDetailLevel`, `isRelationKind`, `isFocusKind`, `isDemoSize`, `isSnapshotRef`: what the app's UI thread lists and tests values with |
| Locations without zod | `isRegion`, `isZone`, `zoneRegion`, `regionOfZone`: the one rule of what a region and a zone are and which region holds a zone (`europe-west3-b`, AI zones such as `us-central1-ai1a`, a sovereign cloud's `u-france-east1-a`), read by the catalog's templates and `siblingName`, the graph's region zones and regions filter, and the app's filter choices; `LOCATION_PATTERN`, the shape of any location name |
| Render options | `RenderOptionsSchema`/`RenderOptions`, `RenderViewSchema`/`RenderView`, `checkRenderOptions`: what the render library and `POST /api/render` take; `readRenderFlags`, `FILTER_FLAG_KEYS`: the command lines' flags (`pnpm render`, `pnpm render-scene`) read into those options and checked by the same schema |
| Scene | `SceneSchema`/`Scene`, `SceneZone`, `SceneCard`, `SceneEdge`; `SceneEnvSchema`/`SceneEnv`, `SceneBuildSchema`/`SceneBuild`, `SceneReport` |
| Catalog | `CatalogSchema`/`Catalog`, `CatalogEntrySchema`, `CatalogZoneKindSchema`, `LensSchema`, `RelationRuleSchema`; `ProjectIndexSchema`/`ProjectIndex`, `buildProjectIndex`, `projectIndexBuilder` (the one number↔id pairing rule), `aliasKey`, `EvaluatedRelation`, `RelationTarget` |
| Testing (`@gcportrait/model/testing`) | `findNonSyntheticData`, `assertSyntheticOnly`: the one "synthetic only" guard for fixtures and generated data; `measureBatches`, `measureRuns`, `skipIfOverloaded`: the one rule for the tests' wall-clock limits (measured again while over, each batch stopped at the deadline, skipped on an overloaded machine but never on CI) |
| Timeline | `TickSchema`/`Tick` (a day, or an extra tick's read time to the second in UTC), `DiffSchema`/`Diff` |

The builder schemas check invariants as well as shapes (`GraphBuildSchema`: report and graph agree;
`SceneBuildSchema`: report and scene agree), so other packages' tests use `XSchema.parse(output)` as their
oracle. Reference: [packages/model/README.md](../packages/model/README.md).

### `@gcportrait/demo-data` — synthetic organisations

**Responsibility.** Deterministic synthetic Google Cloud organisations in four sizes (S, M, L, XL;
[current counts](modes.md#4-the-demo)) with a 35-day history, emitted as CAI records or as model Snapshots;
checked by the "synthetic only" guard of `@gcportrait/model/testing`. Pure core: a seed and a `today` date
determine the output byte for byte. M and larger also carry a generator case per catalog group
(`features` in `src/topology/profiles.ts`), so the demo draws the prominent Tier-1 types of every group with
their references resolved.

**Entry point.** `packages/demo-data/src/index.ts`:

| Export | What |
|---|---|
| `generateOrganization({ size, seed?, today? })` | the organisation as it is on `today` (`DemoOrganization`, with `assets`) |
| `historyFor(size, seed?, today?)`, `snapshotAt(history, tick)` | the 35 daily ticks of mutations, and the organisation at any tick (`snapshotAt` in `history/replay.ts`, which imports none of the generator, so the snapshot worker loads no generator) |
| `toCaiNdjson(assets, style?)`, `toCaiAsset(asset)` | CAI NDJSON: `'api'` (`assets.list`, camelCase, default) or `'export'` (`exportAssets`, snake_case keys) |
| `toSnapshot(org)`, `computeStats(assets)` | a model Snapshot that passes `migrateSnapshot` |
| `realismChecklist`, `checklistMarkdown` | the realism checklist, computed from the data |
| `DEMO_SIZES`, `DEFAULT_SEED`, `DEMO_TODAY`, `DEMO_ORGANIZATION_IDS` (one per size), `HISTORY_TICKS`, … | constants |

**Data.** `fixtures/S.ndjson`, `fixtures/M.ndjson` (committed) and `fixtures/stats.json` (golden counts for
all four sizes). **Commands.** `pnpm --filter @gcportrait/demo-data generate --size L --out /tmp/l.ndjson`
and `… fixtures` (regenerate the committed fixtures). Reference:
[packages/demo-data/README.md](../packages/demo-data/README.md).

### `@gcportrait/ingest` — CAI NDJSON to a Snapshot

**Responsibility.** A streaming NDJSON line reader (strings, bytes, Blobs and Files, `fetch` bodies, async
iterables; BOM, CRLF, concatenated files, lines up to 64 MiB), a normaliser from the CAI asset shape (both
key styles) to the model `Asset`, project number ↔ id resolution, and snapshot assembly with stats and
duplicate handling. Pure and worker-safe; the caller supplies the clock and the entropy for the snapshot id,
and the app's workers run it (`ingest` in the snapshot and data workers, `createIngestSession` in the
import worker).

**Entry point.** `packages/ingest/src/index.ts`:

| Export | What |
|---|---|
| `ingest(input, options)` | `{ snapshot, report }`; the report counts malformed lines (first 20 kept), duplicates, says where `readTime` came from (`readTimeSource`), and holds `projects` (a model `ProjectIndex`) and `unresolvedProjects` |
| `createIngestSession(options)` | the synchronous core: `push(chunk)`, `endPart()`, `finish()` |
| `readLines`, `normaliseAsset`, `projectNumberOf`, `ulid`, `IngestError` | the building blocks |

**Commands.** `pnpm --filter @gcportrait/ingest test:budget` runs the strict 1.5 s budget on its own: the
demo organisation XL, written as an export, read in a worker (the normal test run only asserts a 3 s
regression ceiling, twice the budget). Reference:
[packages/ingest/README.md](../packages/ingest/README.md).

### `@gcportrait/catalog` — the asset catalog and its rule engine

**Responsibility.** What gcportrait knows about each asset type, kept as data
(`products/<service>[.<suffix>].yaml`, `lenses/<lens>.yaml`, `fixtures/<service>/<Type>.json`,
`known-unmapped/<group>.yaml`, `icon-keys.json`), and the one engine that interprets it: a JSONPath subset,
`hiddenWhen` predicates, label and console templates, alias paths, and the fifteen normalisers (among them
`siblingName` and `k8sRef`). The
compiler validates the data against the model schemas, the newest official asset-type list and the fixtures,
and writes the git-ignored module `src/generated/compiled-catalog.ts`. The runtime library (`src/`)
is browser- and worker-safe; the Node tooling lives in `tooling/`.

**Entry point.** `packages/catalog/src/index.ts`:

| Export | What |
|---|---|
| `catalog` | the compiled catalog (`Catalog`): the generated module's constant as it is, which passed `CatalogSchema` when `pnpm catalog:build` wrote it (not parsed again on import; the catalog's staleness test holds it to the schema) |
| `evaluateRelations`, `evaluateContains`, `nestsByParent`, `evaluateAliases` | a type's relation, containment and alias rules on one asset (`EvaluatedRelation[]`) |
| `renderLabel`, `renderSubtitle`, `renderConsoleUrl`, `extractIps`, `extractDomains`, `isHiddenByDefault` | the per-asset presentation rules |
| `consoleUrlFor`, `consoleLinkFor`, `projectConsoleUrl`, `typesWithoutConsole`, `ConsoleLink` | the one place a Cloud Console URL is built: a type's `console` template for an asset, or the project's console home as the fallback the app offers; the types still without a template |
| `assetProject`, `resolveProject` | project lookups through the snapshot's project index (`buildProjectIndex` of `@gcportrait/model`) |
| `normalise`, `NORMALISERS`, `evaluateJsonPath`, `evaluatePredicate`, `renderTemplate`, … | the engine's parts |

**Coverage.** `pnpm catalog:coverage` and the generated [coverage page](https://gcportrait.app/coverage/)
report current totals by group and role. Unmapped types and their reasons live in each group's
`known-unmapped/<group>.yaml`. `catalog:check` validates rule fixtures and also reports types still without a
console template; `tooling/plurals.test.ts`
keeps bare counts out of counting subtitles (the `plural(…)` filter). The open questions are in
[catalog-followups.md](catalog-followups.md). **Commands.** `pnpm catalog:check` (`--group`, `--file`,
`--verbose`), `pnpm catalog:coverage`, `pnpm catalog:build`, `pnpm catalog:fetch-official` (section 4).
Reference: [packages/catalog/README.md](../packages/catalog/README.md) and the [gcp-asset-catalog
skill](../.agents/skills/gcp-asset-catalog/SKILL.md).

### `@gcportrait/graph` — the graph core

**Responsibility.** Two pure steps. The *builder* turns a Snapshot and the catalog into a `Graph`: one node
per asset (unmapped types become generic cards, never dropped), the containment forest by the rules of the
gcp-diagram-layout skill §2 (and a type's own `nestsIn` claims), relation edges through the catalog's engine
(reverse rules drawn from the target's side; a name that matches nothing is retried once with its project id
and number swapped), aliases (service-account e-mails, project ids and numbers), dangling references, indexes
(type, project, IP, domain), weak-edge precedence, merged peerings and reciprocal `connects`, the derived
Shared VPC `shares` edges (attachments into another project's subnet or a Shared VPC host's network,
packages/AGENTS.md, "Catalog and graph semantics"), optional virtual region containers, and the timeline diff.
The *views* turn a Graph and a `ViewSpec` into the `Scene` the layout consumes: drill-in root, focus view,
lens, filters (applied under every drill-in and focus), detail level with chips, bundles and flips, and
selection pointers.

**Entry point.** `packages/graph/src/index.ts`:

| Export | What |
|---|---|
| `buildGraph(snapshot, catalog, options?)`, `buildGraphWithReport(…)` | `Graph`, or `GraphBuild` with the report (Shared VPC pairs, "shared with N" counts, cycles, dangling references per node, unmapped types, counts) |
| `BuildMemo` (`options.memo`) | the builder's memo: what a build worked out per asset object (node, relations, `nestsIn`, `contains`), reused by a later build with the same catalog and project index; it changes no result |
| `buildScene(graph, viewSpec, catalog, env)`, `buildSceneWithReport(…)` | `Scene`, or `SceneBuild` with the report (root and focus outcome, detail levels and rect counts, legend, overlays, external stubs, warnings, counts) |
| `prepareView(…)`, `buildPreparedScene(…)`, `preparedViewKey(…)` | the same Scene build in two parts: a view prepared once, then finished for every view with the same key (another detail level, flips, `depth` filter, selection or highlight) |
| `diffSnapshots(before, after)`, `compareTimestamps(a, b)` | the timeline diff (cai-ingestion skill §5) |
| `viewportBudget(width, height)`, `flipIdOf(zoneId)`, `DETAIL_LEVELS`, `BUNDLE_THRESHOLD`, `GENERIC_ICON`, … | what the UI needs to drive the views |
| `viewSpecOf(renderView, snapshot)` | the ViewSpec of a render's view (`RenderView`): a hash decoded as the app decodes it, or explicit fields normalised with the flips' zone ids as flip tokens; `POST /api/render` (through the render library, which re-exports it), `pnpm render` and `pnpm render-scene` resolve a view with it |
| `ZONE_OPENS_AT`, `zoneOpensAt`, `autoDetailLevel`, `autoCeiling`, `BUNDLE_ID_PREFIX` | the level table of step (e), the `auto` rule with the lens's `defaultDetail` as its ceiling, and the bundle id prefix, so the app's disclosure controls read them instead of restating them |
| `PROJECT_TYPE`, `NETWORK_TYPE`, `projectNodeId`, `isVirtualNode`, … | the few structural types the builder knows by identity |

**Commands.** `pnpm render-scene` (section 4); `pnpm --filter @gcportrait/graph test:budget` (M builds in
< 150 ms, strictly; the normal test run asserts a 300 ms regression ceiling, twice the budget). Reference:
[packages/graph/README.md](../packages/graph/README.md).

### `@gcportrait/layout` — the layout engine

**Responsibility.** Pure and deterministic, gcportrait's own engine, specified by the [gcp-diagram-layout
skill](../.agents/skills/gcp-diagram-layout/SKILL.md): a `Scene` becomes absolute rectangles for every zone,
chip and card and an orthogonal path for every edge. Stage 1 validates the Scene (typed `LayoutInputError`s
naming the ids: duplicates, unknown edge ends, cycles, chips with children, nesting deeper than 256 levels),
drops the organisation zone (the canvas is the organisation), computes depths and sorts siblings; stage 2
sizes cards, chips and headers from a generated Roboto metrics table (`metrics/roboto.json`; text is never
measured from the DOM); stage 3 packs each zone bottom-up into a card grid above zone rows by the rules of the
layout skill §4 (full rows, wider than tall, smallest target-shaped frame, short siblings stacked beside a
tall one, near ties). Stages 4–5 (the layout skill §5) route every edge over the gutters between the boxes: a
shortest path with bend, lane-pressure, border-hugging (capped per side) and canvas-margin costs, port lines
that leave a nested rect in one straight run, lanes 8 px apart, ports 12 px apart on the side facing the other
end and never on a header, reciprocal `peers` merged into one double-headed edge, duplicates collapsed with a
count, edges of one kind meeting one rect bundled into one trunk (from 3 edges), edges into a collapsed zone
ending at its chip; busy gutters are widened and the zones re-packed, at most four routing passes, one once
the first pass's search work reaches its budget. Stage 6 is the invariants (`checkLayout`). A worker protocol
runs the layout in steps off the UI thread, cancels superseded requests between steps and memoises the last 8
Layouts by a structural hash of the Scene and options.

**Entry point.** `packages/layout/src/index.ts`:

| Export | What |
|---|---|
| `layoutScene(scene, options?)`, `layoutSteps(…)` | `Layout`: `rects`, `edges` (one routed `EdgePath` per drawn edge: ports, points, heads, bundle), `chips`, `bounds`, `arrangements`, `gutters`, `report` (counts, routing, warnings, timings with a clock); `layoutSteps` is the same as a generator yielding progress |
| `LayoutOptions` | sizing overrides, aspect targets and tolerance, a font metrics table, `routing` overrides, `route: false`, gutter widening and pinned arrangements |
| `createLayoutWorkerHandler`, `layoutClient`, `createLayoutClient`, `layoutKey`, `LayoutMemo` | the worker side of the protocol (progress, cancellation, memo), its page side (promises with `AbortSignal`), and the memo key |
| `checkLayout`, `assertLayout`, `checkEdges`, `checkDeterminism`, `packingAspects` | the invariants and the packing measurements the tests, the dev worker and `pnpm render --strict` use |
| `measureText`, `subtitleRuns`, `cardWidth`, `DEFAULT_SIZING`, `DEFAULT_ROUTING`, `TEXT_WEIGHTS`, … | the sizing and routing rules the renderer shares, so text fits its box and heads fit their edges |

**Budgets** (gcp-diagram-layout skill §7, through a worker with `test:budget`): S 10 ms, M 60 ms (the slowest
view M overview at `all`), L 400 ms (L overview at `projects`, in three passes), XL at `folders` 2 s. `pnpm
test` asserts 2 × the budgets; CI runs the strict figures in a non-blocking `layout-budget` job. **Commands.**
`pnpm --filter @gcportrait/layout test:budget`, `bench`, `debug-svg` (section 4), `test:golden:update` and
`metrics` (deliberate regeneration; review the diff). Reference:
[packages/layout/README.md](../packages/layout/README.md).

### `@gcportrait/icons` — Google's product icons behind the catalog's icon keys

**Responsibility.** Google's official Google Cloud product icons (core colour marks, legacy two-tone console
icons, category marks), vendored unmodified from the ZIPs linked on cloud.google.com/icons with mechanical
transforms only, plus gcportrait's own drawings for the organisation, folder, service account and generic
resource, behind the icon keys the catalog uses; the fallback chain type → product → category mark → generic
cloud mark. Data and lookups only: no DOM, no Node APIs, and it imports no other workspace package. It holds
110 vendored files (14 core, 74 legacy two-tone, 22 category) and 4 own drawings behind 158 keys; every
key the catalog uses resolves, none is over 8 kB, and the generated module `src/generated/icons.ts` is
committed (a test fails when it is stale). The icons are Google's trademarks, used under Google's icon usage
terms; the package README carries the long-form non-affiliation statement and the per-file provenance
(`manifest.json`).

**Entry point.** `packages/icons/src/index.ts`: `iconFor(key)`, `resolveIcon(productKey?, typeKey?,
categoryKey?)`, `ICON_KEYS`, `GENERIC_ICON_KEY`, `isOwnDrawing`, `categoryOf`, `placeIcon(icon, size, x?, y?)`
and the `Icon` types. The app resolves a Scene's icons in its data worker and sends them with the Scene, so
the icon table never loads on the UI thread. **Commands.** `pnpm --filter @gcportrait/icons vendor`
(`--check`, `--verify-render`), `build`, `contact-sheet`, `drift` (what Google Cloud provides now against what
is vendored), `test`. Reference:
[packages/icons/README.md](../packages/icons/README.md).

### `@gcportrait/render` — the render library

**Responsibility.** Everything between a snapshot and the bytes of a drawing, so that `pnpm render` and the
backend's `POST /api/render` draw a view byte for byte the same: snapshots read by the app's own code (a demo
size, a `.gcportrait.json` bundle, or NDJSON chunks of an export, a saved stream or a live pull's frames), the
app's path to a view (`buildGraph` → `buildSceneWithReport` at the viewport's rect budget → `layoutScene` →
the page's diagram input), the frontend's own SVG components rendered with `react-dom/server` through
`@gcportrait/frontend` (`frontend/src/headless.ts`, which the app itself never imports), and a PNG rasterised
by resvg's WebAssembly build, `@resvg/resvg-wasm` (MPL-2.0, used unmodified, pinned exactly: the pixels
depend on its version), with only the self-hosted Roboto and Roboto Mono faces: 2× by default (3× at most), on
the theme's canvas colour, with a 24 px margin and an optional pixel cap, or a draw.io file translated from
the SVG by the frontend's translator. The same pixels (and draw.io bytes) on every platform, and no native
addon, so the backend's image can carry it: its render worker reads the wasm module and the faces from
`backend/dist/render-assets/`, which `writeAssetDir` writes. Drawings carry no affiliation line
([AGENTS.md](../AGENTS.md), "Non-affiliation, brand and legal").

**Entry point.** `packages/render/src/index.ts`: `renderView`, `snapshotFromDemo`, `snapshotFromBundle`,
`createSnapshotReader`, `createDemoViews`, `drawSvg`, `drawPng`, `drawDrawio`, `initRasteriser`,
`writeAssetDir`, `readAssetDir`. Internal view, raster and font helpers stay in their modules. **Tests.**
`test/render.test.ts` holds `renderView` to the renderer's SVG baselines and the render golden PNG, byte for
byte. Reference: [packages/render/README.md](../packages/render/README.md).

### `@gcportrait/render-cli` — the headless renderer's command line

**Responsibility.** `pnpm render` draws a view of a demo organisation exactly as the app's renderer draws it,
through the render library above, byte-stable for the same arguments; it adds the command line, the
comparisons and the golden check. The first line on standard error names the command, `gcportrait render`;
neither it, its `index.json` nor the drawing carries an affiliation line. It is Node tooling, not a library.

**Entry point.** `packages/render-cli/src/index.ts` (for tests and scripts): `run`, `parseCommand`,
`comparePng`, `samePixels`, `checkGolden`, `checkTextGolden`. **Goldens.**
`e2e/baselines/render/S-overview-auto-light.png`, compared tolerance-free, and its `.drawio` twin, compared
byte for byte; `pnpm --filter @gcportrait/render-cli test:golden:update` rewrites them. **Commands.** `pnpm
render` (section 4). Reference: [packages/render-cli/README.md](../packages/render-cli/README.md).

### Applications and test suites

| Workspace | Responsibility | Uses today |
|---|---|---|
| `frontend/` (`@gcportrait/frontend`) | the React 19 single-page app: shell, themes, routes, IndexedDB wrapper, demo mode; the diagram (`src/diagram/`: a data worker and a layout worker, the SVG renderer, the painter for hover, selection, the selection trace (`trace.ts`) and focus, the console action and node menu (`actions.ts`, `ui/Menu`), the legend and title block, the diagram tokens with their contrast tests and the SVG baselines) and the export flow (`src/export/`); the application features (section "The app's modules" below); `src/headless.ts` is its one entry point for another workspace (the headless renderer) | `model`, `catalog`, `graph`, `layout`, `icons`, `ingest`, `demo-data` |
| `backend/` (`@gcportrait/backend`) | the stateless Fastify service for Cloud Run: `/healthz`, `/api/config` (with the OAuth client id and the `hostedBy` line), static serving, security headers (the CSP and COOP open for Google sign-in); the live pull `/api/assets/stream` and the export read `/api/export/read` (NDJSON streams through the allowlisted upstream client, with retries and caps; backend/README.md); the scope search, the preflight and service-account mode; demo-only mode; the render API `POST /api/render` with its render worker ([api.md](api.md)) | `model`, `render` (in the render worker only), and `ingest` in its tests |
| `e2e/` (`@gcportrait/e2e`) | Playwright functional, export and axe tests against demo mode; holds the renderer's SVG baselines (`baselines/diagram/`, written by the frontend's tests) and the render golden PNG (`baselines/render/`, written by `render-cli`) | none imported (`model` and `demo-data` are allowed); the export spec runs `pnpm render` as a separate process |

`infra/` is not a workspace package: it holds the production image (`infra/Dockerfile`: the SPA build plus the
backend bundled into one ESM file by `backend/bundle.ts`, on a distroless Node base), `infra/deploy.sh` and
`infra/uninstall.sh` for Cloud Run, and `infra/compose.yaml` for local runs of the image
([self-host.md](self-host.md), [configuration.md](configuration.md)); also `infra/cloud-run-button.sh`,
the Cloud Run Button's hook for `app.json` at the root, and [infra/README.md](../infra/README.md), which lists
every file.

### The app's modules

The frontend is not a library, but its modules have the same kind of boundaries. One rule holds them together:
**the URL hash is the view**. The app store (`src/state/`) mirrors the hash on `/diagram` as a `ViewSpec`
(`decodeViewSpec`), and every control changes the view only through the store's actions, which write it back
with `encodeViewSpec` through the router; nothing else keeps a copy of the view. Whenever the view's scene key
changes, the store's pipeline asks the **data worker** for the Scene and the **layout worker** for its Layout;
the UI thread only renders. Snapshots and saved views live in IndexedDB through `src/storage/db.ts`; the token
never touches disk.

| Module (`frontend/src/`) | Responsibility |
 |
| `state/` | the store: seven slices (view, snapshot, pipeline, selection, ui, connect and timeline), the hash binding (`AppStateProvider`), the actions (`useDiagramActions`: lens, focus, detail, filters, drill-in, flips, expand/collapse all, snapshot, select, highlight, `jumpTo`, `stepTick`), the pipeline controller and `auto` against the measured canvas |
| `shell/topbar/` | the top bar, one file per control group: breadcrumb, Lens, Focus, Filters, Detail and search box (the view row, on the diagram page only), Theme menu, Export menu, Snapshot menu |
| `ui/` | headless accessible primitives: Menu, MenuButton, Select, Combobox, Listbox, Popover, Dialog, SegmentedControl, Slider, Tooltip |
| `views/` | the view controls' support: the snapshot's choices (projects, hosts, perimeters, applications, folders, regions, types; computed in the data worker), the filter and focus forms, the lens/detail rule, the breadcrumb trail, saved views, Copy link |
| `search/` | the Fuse.js index and the locator (data worker), ranking, the reveal decision table and dialog |
| `drawer/` | the details drawer: a node's facts, relations by kind, dangling references, console link, raw JSON; jump links that open the collapsed zones around their targets (a `locate` request without offers); on a timeline day compared with the day before it, "What changed" (both update times, the fields of `resource.data` that differ, what changed inside a container) |
| `snapshots/` | the snapshot library: "Try the demo", the IndexedDB records, the `.gcportrait.json` bundle, imports of bundles and CAI exports, export, delete, storage usage, and the snapshot worker; "Timelines by scope" (each scope's snapshots, extra ticks and cached days, their sizes, deleting them) |
| `diagram/` | the renderer, its data and layout worker roles (`pipeline/`), the camera (`camera.ts`), progressive disclosure (`disclosure/`: flips, the collapse button, "N of M shown"), the keyboard model inside the drawing (`keyboard/`) and the timeline's diff overlay (`diff/`: added outlines, ghosts of what is gone, changed dots, their legend rows) |
| `keyboard/` | the app-wide keys: "Skip to the diagram", `[` and `]` for the timeline, shortcut matching across keyboard layouts |
| `timeline/` | the timeline bar's logic: 35 daily ticks (`today` passed in, labels in local dates), the tick in the ViewSpec, a stored history's days replayed in the data worker, a live scope's days read on demand through `/api/assets/stream` with `readTime` into IndexedDB's tick cache (keyed per scope and read time), the debounced read and idle prefetch with two in flight, playback; the extra ticks (the scope's stored exports and manual pulls among the days, `extraTicks.ts`) |
| `export/` | the export flow: standalone SVG, PNG at 2×/3×, draw.io (`drawio/`, a lazy chunk), clipboard, file delivery |
| `auth/` | Google sign-in: the GIS token client loaded on demand, the token held in memory only, silent renewal, expiry, sign-out with revocation; the store's `connect` slice (backend config, session, mode); the Connect page's sign-in card and mode selector; `fetchWithToken` for the backend calls (the token in `X-Gcportrait-Token`; AGENTS.md, "Security and privacy") |
| `import/` | the live pull and the export load: "Pull now" (scope, mode and quota project from the permission check), the Connect page's export card (dropped files through the Snapshots page's import, with the export's `operation.json`; a `gs://` URI read by the backend), the import worker (a fourth role of the worker script: the backend's stream read by `@gcportrait/ingest` as it arrives), the progress reducer and the error advice; a read time typed for an export without its `operation.json` |
| `storage/`, `theme/`, `pages/` | the IndexedDB wrapper, the page's one connection (`connection.ts`), preferences and the tick cache (`tickCache.ts`); the theme; the routes' pages |

The data worker answers `lenses`, `scene` (with its progress stages), `choices`, `search` and `locate` (the
drawer's jump links ask it too, without offers), and `details` (`diagram/pipeline/protocol.ts`); a demo worker
started for one "Try the demo" job answers `demo`. A view's timeline `tick` draws that day of the snapshot, or
the stored export or pull an extra tick names, and each Scene carries the snapshot's timeline; a Scene request
may name the day on screen before it (`diffFrom`): the answer then carries the diff of the two days and its
Scene the ghosts of what is gone and of what the view no longer draws where it stood (a moved node is marked
where it is now), and `changes` answers what changed about one node between two days; before it reuses the
Graph it keeps for a stored snapshot it asks IndexedDB whether the record is unchanged. One worker script
serves five roles (data, layout, snapshots, imports and demo), so the model, zod and ingest are bundled once
for the workers; the demo generator runs in workers only (AGENTS.md, "Architecture and code"): the data role
loads it on first use to draw a demo organisation, and the demo role, started for one "Try the demo" job and
ended with it, to prepare one. [frontend/README.md](../frontend/README.md) is the reference for each module.

### The website

| Package | Responsibility |
|---|---|
| `website/` (`@gcportrait/website`) | the Astro site at `gcportrait.app`: the landing page, the guides of `docs/` rendered at build time, a coverage page from `@gcportrait/catalog`, the sample exports, and the static demo at `/demo/` (`pnpm demo:static`); its screenshots and demos come from `docs/media/` (`pnpm media`, `scripts/media.mjs`). [website/README.md](../website/README.md), [website.md](website.md) |

## 4. Command-line entry points

| Command | Package | What it does |
|---|---|---|
| `pnpm render-scene --fixture M --lens networking` | graph | ingests a demo fixture (S, M or L), builds the graph and the scene with the real catalog, and prints a summary; `--focus`, `--root`, `--detail`, `--filter`, `--json`, `--help` |
| `pnpm catalog:check` | catalog | validates the catalog and prints the coverage report; exit 1 on any violation (`--group <group>`, `--file <path>`, `--verbose`; `pnpm -s catalog:check --json` for JSON) |
| `pnpm catalog:coverage` | catalog | per-group coverage: owned official types, mapped by role, unmapped by reason, missing (`--group`, `--json`) |
| `pnpm catalog:build` | catalog | compiles the YAML into `src/generated/compiled-catalog.ts` and `dist/catalog.json` (both git-ignored; also run by install, lint, typecheck and test) |
| `pnpm catalog:fetch-official` | repository script | fetches the official supported-types page into a dated snapshot under `.agents/skills/gcp-asset-catalog/references/` and prints the drift |
| `pnpm --filter @gcportrait/demo-data generate` | demo-data | writes an organisation as CAI NDJSON (`cai`, `cai-export`), a Snapshot, its history, stats or checklist |
| `pnpm --filter @gcportrait/demo-data fixtures` | demo-data | regenerates `fixtures/S.ndjson`, `M.ndjson` and `stats.json` |
| `pnpm --filter @gcportrait/ingest test:budget` | ingest | the strict XL ingest budget (1.5 s in a worker), alone |
| `pnpm --filter @gcportrait/graph test:budget` | graph | the M build budget (150 ms), alone, printing its figures |
| `pnpm render --fixture M --lens networking --png out.png` | render-cli | draws a demo view as the app's renderer draws it, as PNG, SVG and/or draw.io (`--theme`, `--detail`, `--focus`, `--root`, `--filter`, `--flip`, `--hash`, `--viewport`, `--scale`/`--width`, `--svg`, `--drawio`, `--strict`, `--compare`, `--all`, `--list-fixtures`, `--help`); without `--png`/`--svg`/`--drawio` it writes `out/render/<fixture>-<lens>-<detail>-<theme>.png` |
| `pnpm --filter @gcportrait/render-cli test:golden:update` | render-cli | rewrites the render golden `e2e/baselines/render/S-overview-auto-light.png`; look at it and say why in the pull request |
| `pnpm --filter @gcportrait/frontend test src/diagram/baselines.test.tsx -u` | frontend | rewrites the SVG baselines under `e2e/baselines/diagram/` (the file before `-u`) |
| `pnpm --filter @gcportrait/layout test:budget` | layout | the strict layout budgets through a worker (S 10 ms, M 60 ms, L 400 ms, XL at `folders` 2 s), the memo hit, cancellation and memory, alone, printing their figures |
| `pnpm --filter @gcportrait/layout bench` | layout | the whole benchmark table (medians of 10 runs per view, memo, cancellation, memory); exit 1 on a missed budget |
| `pnpm --filter @gcportrait/layout debug-svg --fixture M --lens overview` | layout | writes an SVG and a PNG of a demo layout's rects, labels and routed edges to `out/layout/` to look at the packing and the routing (`--detail`, `--theme light\|dark\|both`, `--aspects`, `--no-png`, `--out`); not the renderer: no icons, legend or dim mode |
| `pnpm --filter @gcportrait/layout test:golden:update` | layout | rewrites the golden layout JSON under `packages/layout/test/golden/`; review the diff |
| `pnpm --filter @gcportrait/layout metrics` | layout | regenerates `packages/layout/metrics/roboto.json` from the self-hosted font files (`--check` only reports) |
| `pnpm --filter @gcportrait/icons vendor` | icons | downloads Google's three icon ZIPs and re-vendors `vendored/` and `manifest.json` (`--check`, `--verify-render` compares the pixels in headless Chromium) |
| `pnpm --filter @gcportrait/icons build` / `contact-sheet` | icons | regenerates `src/generated/icons.ts` / writes the contact sheet and the 16 px legibility sheet to `out/` |

`pnpm render-scene --fixture M --lens networking` prints the summary of a view: the fixture and its read time,
the lens and the detail level `auto` chose with its rect budget, the rects drawn and the count per level, the
root and the focus, the zones, chips and cards, the edges by relation kind, external stubs, overlays and
hidden nodes held back, dangling references and warnings. Detail level `auto` collapses M to folders at the
1280×800 budget; `--detail networks` or `--detail all` shows the VPC and subnet zones the networking lens is
about. `pnpm render --fixture M --lens networking --png out.png` lays the same view out and draws it, and
prints the rects and edges routed, whether the invariants hold, and the size and path of each file it wrote.
The first line of each names its command (`gcportrait render-scene`, `gcportrait render`). To review a render,
walk it through the style skill's fact-check list (§11) and the layout skill's checklist (§8).

## 5. Known seams

These are deliberate, documented in the package READMEs or in [catalog-followups.md](catalog-followups.md),
and waiting for an item of [backlog.md](backlog.md) or a maintainer decision:

- **Demo tests on the real catalog.** The graph package's demo, view and property tests run on the real
  compiled catalog, so a correct catalog rule can change what they expect; the catalog README explains how
  they bound what a rule may add.
- **Catalog follow-ups.** What the catalog cannot express or settle from public documentation is listed in
  [catalog-followups.md](catalog-followups.md): above all project ids versus numbers in resource names (the
  largest source of dangling references on real data), rules drawn from the target's side and child-side
  containment, missing normalisers and template filters, and Shared VPC derivation for producer-network
  peering.
- **Lens default detail.** The app's Lens picker applies the new lens's `defaultDetail`
  while the detail level follows the current lens's default, and keeps a level the person chose
  (`frontend/src/views/lensDetail.ts`). `render-scene`, `pnpm render` and the scene builder still take the
  view's detail as given (`auto` unless asked).
- **One rule, one place.** The project number↔id pairing is one function in `@gcportrait/model`
  (`buildProjectIndex`, `projectIndexBuilder`) that ingest, the catalog and the graph share, and so is the
  zone→region rule (`zoneRegion`, `regionOfZone`) that the catalog, the graph and the app share; the three
  synthetic-data guards are one, `@gcportrait/model/testing`; the read-time source travels with the Snapshot
  (`readTimeSource`) and a refused focus or root with the Scene (`metadata.focusError`, `metadata.rootError`);
  `cloudSqlConnectionName` writes the `//cloudsql.googleapis.com/…` names CAI uses; the graph takes zone kinds
  and aliases from the catalog (`zoneKind`, `aliases`) instead of its own lists.
- **Facts that live only in a report.** The "shared with N projects" count is only in
  `GraphReport.sharedWith`; a caller that keeps only the Graph loses it.
- **The render library imports the app.** `render` reaches the
  frontend's SVG components and data readers through `frontend/src/headless.ts`, the one dependency edge from
  `packages/` up to the app. Moving the pure
  SVG drawing (`frontend/src/diagram/Drawing.tsx`, `DiagramSvg.tsx`, `static.tsx`, the theme tokens and
  geometry) into a package of its own would turn it downward; it waits for a maintainer decision.
- **The view assembly exists three times.** "Demo snapshot → graph → Scene → layout → diagram input" is
  written in the app (`frontend/src/diagram/pipeline/dataHandler.ts` with `pages/DiagramPage.tsx`), in the
  renderer's test helper (`frontend/src/diagram/testing/demoScenes.ts`, which writes the SVG baselines) and in
  `packages/render/src/view.ts`. Tests prove the CLI's SVG equals the baselines, not the live app path, so
  a later change to the app's path can drift unnoticed. The PNG geometry likewise exists twice
  (`frontend/src/export/raster.ts` and `render`'s `raster.ts`; their size rounding already differs by an
  epsilon).
- **Second maps and second declarations in frontend code.** `ZONE_MARKS` (zone kind → icon key) lives in
  `frontend/src/diagram/theme/styles.ts`; a product container carries its catalog type's icon in
  the Scene, so the map is only the fallback for folders, projects, networks and zones without one, but
  AGENTS.md, "Data and graph semantics", still wants it in the icons data. `ZONE_KIND_RANK` is declared once
  (`@gcportrait/model`, shared by the graph and the layout), and so is the `ConsoleLink` type (the
  frontend imports the catalog engine's, `packages/catalog/src/engine/console.ts`).
- **Rules the app restates.** The scene builder's level table, its `auto` rule (with the lens ceiling) and its
  `group:` bundle prefix are exported by `@gcportrait/graph` (`ZONE_OPENS_AT`, `zoneOpensAt`,
  `autoDetailLevel`, `autoCeiling`, `BUNDLE_ID_PREFIX`), and `frontend/src/diagram/autoDetail.ts` and
  `frontend/src/diagram/disclosure/flips.ts` read them. Still restated: `frontend/src/snapshots/labels.ts`
  restates demo-data's size profiles, and `frontend/src/drawer/details.ts` reads labels and tags from fixed
  data paths rather than catalog JSONPaths; each has a test against the package it restates.
- **One chip-opening loop.** Search's `locate`, which the drawer's jump links ask too (without offers), uses
  `frontend/src/diagram/disclosure/openAround.ts`: toggle the flip of the chip that shows a node and rebuild
  the Scene, one level deeper each time, in the data worker.
- **The bundle budgets** ([frontend/AGENTS.md, "Bundle budgets"](../frontend/AGENTS.md#bundle-budgets)).
  `pnpm size` measures the UI thread and workers separately and prints the gzipped sizes per chunk. The UI
  thread ships no zod: the URL-hash codec and the vocabularies it reads come from `@gcportrait/model` modules
  without it, so a UI-thread import of a schema would bring it back, and `pnpm size` fails on it. The demo
  generator runs in workers only (the data worker draws demo organisations, a demo worker per job prepares
  them).

## 6. Terms

The words the docs, the skills and the code use with one meaning each:

| Term | Meaning |
|---|---|
| **Snapshot** | a normalised set of assets for one scope (an organisation, a folder or a project) at one `readTime` (`SnapshotSchema`) |
| **Graph** | the nodes, the containment forest and the relation edges built from a Snapshot and the catalog (`GraphSchema`) |
| **Scene** | the part of the Graph a `ViewSpec` selects, with its collapse state (chips, bundles, flips) and selection pointers (`SceneSchema`) |
| **Layout** | the geometry of a Scene: a rectangle per zone, chip and card and a routed path per edge (`packages/layout`) |
| **Lens** | a named bundle of asset types and relation kinds, with a default detail level (`lenses/<lens>.yaml`) |
| **Focus** | a structural view with parameters: one project, a Shared VPC host with its service projects, standalone projects, a perimeter, an application |
| **Tick** | one day on the timeline, or the read time of a stored export or pull (an extra tick) |
| **Dangling reference** | a rule's result that names an asset not present in the Snapshot: counted and listed in the details drawer, never drawn |
