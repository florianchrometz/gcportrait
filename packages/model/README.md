<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/model

The single definition of every type that crosses a package boundary in gcportrait (AGENTS.md, Data and graph
semantics): Asset and Snapshot, relation kinds, Graph, ViewSpec, Scene, the asset catalog's shapes, the
timeline's Tick and Diff, and the URL-hash codec for views. Every type is inferred from a zod schema
(`z.infer`); nothing is declared twice. The package sits at the bottom of the dependency graph, imports no
other `@gcportrait` package, has no side effects, runs unchanged in the browser, in workers and in Node, and
exposes its public API only through `src/index.ts`.

```ts
import { decodeViewSpec, encodeViewSpec, migrateSnapshot, type ViewSpec } from '@gcportrait/model';

const snapshot = migrateSnapshot(JSON.parse(fileText)); // validated, or a SnapshotFormatError
const spec: ViewSpec = decodeViewSpec(location.hash); // never throws
location.hash = encodeViewSpec({ ...spec, lens: 'networking' });
```

## Conventions

- **Schemas end in `Schema`, types do not.** `GraphSchema` validates; `Graph` is its inferred type.
- **Optional means absent.** Optional fields use zod's `exactOptional()`, so with `exactOptionalPropertyTypes`
  a field is either present with a valid value or left out; `undefined` is never a value.
- **External input is lenient, our own data is strict.** `AssetSchema` and `SnapshotSchema` strip unknown
  keys, so a newer export or snapshot file still parses. Graph, Scene, ViewSpec and catalog schemas are
  strict: an unknown key (a typo in a catalog YAML file, a stray field from a builder) is an error.
- **Schemas check invariants, not just shapes.** A Snapshot's stats must match its assets; a Graph's ids must
  resolve and its containment must be an acyclic forest; a Scene's edges must join nodes of the tree. Builder
  tests in other packages can use `XSchema.parse(output)` as their oracle.
- **Serialisable.** Plain objects, arrays and records only, no `Map`, `Set`, `Date` or class instances, so
  every value survives `structuredClone`, `postMessage` and JSON unchanged.

## Identifiers and timestamps

| Export | Accepts |
|---|---|
| `NonEmptyStringSchema` | any non-empty string |
| `TextSchema` | non-empty text without lone UTF-16 surrogates (so it survives UTF-8 and percent-encoding) |
| `UlidSchema` | a canonical upper-case ULID |
| `ServiceNameSchema` | an API service host: `compute.googleapis.com`, `apps.k8s.io` |
| `AssetTypeSchema` | `<service>/<Kind>`: `compute.googleapis.com/Instance` |
| `AssetTypePatternSchema` | an asset type, `<service>/*`, or `*` |
| `ResourceNameSchema` | a full resource name: `//<service>/<path>` |
| `ProjectRefSchema` | a project id (also legacy `example.com:app`) or project number |
| `NumericIdSchema` | a project, folder or organisation number (no sign, no leading zero) |
| `LocationSchema` | `global`, a region, a zone or a multi-region (`EU`) |
| `IpSchema` | an IPv4 or IPv6 address or CIDR range |
| `DomainSchema` | a lower-case DNS name, possibly `*.`-wildcarded or with `_` labels |
| `IconKeySchema` | an icon key in `packages/icons`: `cloud_run` |
| `TimestampSchema` | an RFC 3339 timestamp with `Z` or an offset and any fractional precision |
| `DateSchema` | a real calendar date `YYYY-MM-DD` (`2026-02-29` is rejected) |
| `CountSchema` | a non-negative integer |

## Asset and Snapshot

| Export | What |
|---|---|
| `AssetSchema`, `Asset` | one CAI asset, flattened: `name`, `assetType`, `parent?`, `ancestors` (closest first), `location?`, `updateTime`, `data: unknown` (untouched; the key must be present, its value may be anything) |
| `AncestorSchema` | one `ancestors` entry: `projects/…`, `folders/…`, `organizations/…` |
| `SnapshotSchema`, `Snapshot` | `id` (ULID), `schemaVersion: 1`, `scope`, `readTime`, `readTimeSource?`, `source`, `contentType: 'RESOURCE'`, `assets`, `stats`; asset names are unique, `stats.count` and `stats.byType` match the assets |
| `SnapshotReadTimeSourceSchema`, `SnapshotReadTimeSource` | where `readTime` came from: `api`, `export-sidecar`, `user`, or `estimated-max-update-time` (the latest asset `updateTime`, an estimate the UI labels; skill cai-ingestion §1); absent when unknown |
| `SnapshotScopeSchema`, `SnapshotScope` | `{ kind, id, displayName? }` |
| `ScopeKindSchema`, `ScopeKind` | `organization` \| `folder` \| `project` |
| `SnapshotSourceSchema`, `SnapshotSource` | `{ kind, detail? }`; `detail` is free text (export URI, file names, fixture), never a token |
| `SnapshotSourceKindSchema`, `SnapshotSourceKind` | `api` \| `export` \| `demo` |
| `SnapshotStatsSchema`, `SnapshotStats` | `{ count, byType, bytes }`; `bytes` is the size of the raw input |
| `SNAPSHOT_SCHEMA_VERSION` | `1`, the format this build reads and writes |
| `migrateSnapshot(input: unknown): Snapshot` | the only way to read a stored or imported snapshot; see the migration policy below |
| `SnapshotFormatError`, `SnapshotFormatProblem` | thrown by `migrateSnapshot`; `problem` is `not-an-object`, `unknown-version`, `newer-version` or `invalid` (then `issues` lists the zod issues) |

### Migration policy

The Snapshot format carries `schemaVersion`. Snapshots live in users' browsers (IndexedDB) and in files they
saved, so a format change must never strand them.

1. Any change to `SnapshotSchema` that an old document would fail, or that changes a field's meaning, bumps
   `SNAPSHOT_SCHEMA_VERSION`. Purely additive optional fields do not.
2. The bump keeps a frozen copy of the previous schema and adds one upgrade step from the previous version in
   `migrateSnapshot`, before the final parse. Older documents are upgraded one version at a time, so each step
   only knows its neighbour.
3. Every step gets a test with a document of the old version, and the old fixtures stay in the test suite.
4. A document from a newer build is refused with `newer-version` ("update gcportrait"), never guessed at.

Version 1 is the first format, so there is no upgrade step yet.

## Relation kinds (skill gcp-asset-catalog §4)

| Export | What |
|---|---|
| `RelationKindSchema`, `RelationKind` | `contains`, `attaches`, `routes`, `uses`, `peers`, `connects`, `memberOf`, `runsAs`, `encryptedBy`, `secures`, `triggers`, `replicates`, `shares` |
| `RELATION_KINDS` | the relation-kind table as data, keyed by kind: `meaning`, `direction`, `defaultStyle`, `drawnByDefault`, `lensOnly?`. The renderer and the legend read it from here (it lives in `schemas/relation-kinds.ts`, which imports no zod) |
| `RelationKindInfoSchema`, `RelationKindInfo` | one row of that table |
| `EdgeStyleIdSchema`, `EdgeStyleId` | the default-style ids: `nesting`, `nesting-or-thin-arrow`, `solid-arrow`, `dashed-double-headed`, `solid-round-caps`, `thin-dotted`, `dashed-overlay-zone`, `solid-hollow-head`, `dashed-arrow`. Their strokes, dashes and heads are theme data (skill gcp-diagram-style §5) |

`runsAs` is drawn only in the `identity` lens; `encryptedBy` and `secures` only in the `security` lens.
`contains` is drawn as nesting, never as an arrow.

## Lenses and detail levels

| Export | What |
|---|---|
| `LensIdSchema`, `LensId` | the eleven lenses ([docs/lenses-and-filters.md](../../docs/lenses-and-filters.md)): `overview`, `networking`, `load-balancing`, `compute`, `serverless`, `kubernetes`, `data`, `security`, `identity`, `operations`, `everything` |
| `DetailLevelSchema`, `DetailLevel` | `auto`, `folders`, `projects`, `networks`, `all` (progressive disclosure, skill gcp-diagram-layout §6) |

### Without zod

The schemas are built from plain tuples in `schemas/vocabulary.ts`, which imports no zod; code that only lists
or tests a value (the app's UI thread, which ships no zod: AGENTS.md, Architecture and code) imports these
instead of a schema's `options` or `safeParse`. `vocabulary.test.ts` proves each guard equal to its schema.

| Export | What |
|---|---|
| `LENS_IDS`, `DETAIL_LEVEL_IDS`, `RELATION_KIND_IDS`, `FOCUS_KIND_IDS`, `DEMO_SIZES` | the option lists of `LensIdSchema`, `DetailLevelSchema`, `RelationKindSchema`, `FocusKindSchema`, `DemoSizeSchema`, in order |
| `isLensId`, `isDetailLevel`, `isRelationKind`, `isFocusKind`, `isDemoSize`, `isSnapshotRef` | type guards that accept exactly what the schemas accept |
| `DEMO_REF_PREFIX` | `demo:`, the prefix of a demo organisation's snapshot ref |
| `LARGE_SNAPSHOT_ASSETS` | 10 000: the app asks before it draws a snapshot of more assets (the large-snapshot guard, `frontend/src/snapshots/LargeSnapshotGuard.tsx`; docs/modes.md, "At a glance") |
| `RELATION_KINDS` | the relation-kind table (`schemas/relation-kinds.ts`, below) |
| `normalizeViewSpec`, `DEFAULT_VIEW_SPEC`, `VIEW_SPEC_MAX_FLIPS`, `VIEW_SPEC_MAX_DEPTH`, `encodeViewSpec`, `decodeViewSpec` | the URL-hash codec and its normaliser (`codec/normalize.ts`, section "URL-hash codec") |

## Graph

The graph builder's output (Snapshot + catalog → Graph). All structure is plain records; the graph package may
build Maps at runtime.

| Export | What |
|---|---|
| `GraphSchema`, `Graph` | `{ nodes, containment, edges, dangling, indexes }` with the invariants below |
| `GraphNodeSchema`, `GraphNode` | `id` (= asset name), `assetType`, `label`, `subtitle?`, `role`, `product`, `projectId?`, `projectNumber?`, `location?`, `ips`, `domains`, `hidden` (a node whose role is `hidden` is always hidden; `hiddenWhen` can hide others), `hiddenWhenMatched?` (the type's `hiddenWhen` matched; implies `hidden`), `sharedVpcHost?` (a project whose Compute settings make it a Shared VPC host) |
| `NodeIdSchema` | a node id: a full resource name |
| `NodeRoleSchema`, `NodeRole` | `container` \| `core` \| `leaf` \| `hidden` (skill gcp-asset-catalog §3) |
| `ContainmentSchema`, `Containment` | `parent` (child → parent) and `children` (parent → children), inverse of each other |
| `RelationEdgeSchema`, `RelationEdge` | `{ from, to, kind, weak?, matchedProject?, dangling? }`; `matchedProject` (`id` or `number`) when the reference matched only with its project segment swapped; `dangling: { raw }` keeps the value as read from the asset |
| `DanglingTargetSchema`, `DanglingTarget` | `{ raw }` |
| `GraphIndexesSchema`, `GraphIndexes` | `byType`, `byProject` (project id, or number when unresolved), `byIp`, `byDomain` (key → node ids) and `aliases` (service-account email, project id or number, … → node id) |

Invariants checked by `GraphSchema`: every node is stored under its own id; containment entries name existing
nodes, `parent` and `children` agree, and there is no cycle; `edges` hold resolved relations only (both ends
are nodes, no `dangling`); `dangling` holds unresolved ones only (`to` is no node, `dangling` is set); every
index value names an existing node.

## Graph builder report

What `@gcportrait/graph`'s builder reports next to the Graph (containment: skill gcp-diagram-layout §2): the UI
reads it for zone badges, the drawer and the cycle error.

| Export | What |
|---|---|
| `GraphReportSchema`, `GraphReport` | `sharedVpc` (pairs), `sharedWith` (host-side target → number of service projects attaching to it, ≥ 1), `cycles`, `danglingByNode` (node → its dangling references, ≥ 1), `unmappedTypes` (asset type → assets drawn as generic cards, ≥ 1), `counts` |
| `SharedVpcPairSchema`, `SharedVpcPair` | `{ service, host, attachments }`: two Resource Manager project nodes and the cross-project `attaches` edges (at least one) behind the pair |
| `SharedVpcAttachmentSchema`, `SharedVpcAttachment` | `{ from, to }`: one cross-project `attaches` edge |
| `ContainmentCycleSchema`, `ContainmentCycle` | `{ ids }`: the nodes of a refused containment cycle, from the smallest id, child → parent |
| `GraphBuildCountsSchema`, `GraphBuildCounts` | `assets`, `duplicateAssets`, `virtualNodes`, `weakYielded`, `peersMerged`, `aliasConflicts`, `crossProjectRefused`; optional: `connectsMerged`, `projectSwaps` (edges matched with the project segment swapped), `nestedByReference` |
| `GraphBuildSchema`, `GraphBuild` | `{ graph, report }`, which must agree: every pair has its `shares` edge service → host and every `shares` edge its pair, attachments are `attaches` edges, `sharedWith` counts the pairs' service projects per target, `danglingByNode` counts `Graph.dangling`, and report ids name nodes |

## Timeline (skill cai-ingestion §5)

| Export | What |
|---|---|
| `TickSchema`, `Tick` | a day tick, a UTC day `YYYY-MM-DD`, or an extra tick (an export or a manual pull of the scope), its read time to the second in UTC, `YYYY-MM-DDTHH:MM:SSZ` |
| `DiffSchema`, `Diff` | `{ added, removed, changed }` asset names between two ticks; a name appears at most once overall |

## ViewSpec

| Export | What |
|---|---|
| `ViewSpecSchema`, `ViewSpec` | `snapshot`, `tick?`, `lens`, `focus?`, `root?`, `filters`, `detail`, `flips` (≤ 48), `selection?`, `highlight?` |
| `ViewFiltersSchema`, `ViewFilters` | `hideEmptyProjects`, `hideEmptyFolders`, `hideDisconnected`, and optionally `regions`, `projects`, `folders`, `includeTypes`, `excludeTypes`, `depth`, `showRegions`, `showIdentities` |
| `SnapshotRefSchema`, `SnapshotRef` | a snapshot ULID, `demo:S` \| `demo:M` \| `demo:L` \| `demo:XL`, or `''` for "no snapshot chosen" |
| `DemoSizeSchema`, `DemoSize` | `S`, `M`, `L`, `XL` |
| `FocusSchema`, `Focus` | `{ kind, params }`; params by convention: `project` → `{ project }`, `shared-vpc` → `{ host }`, `perimeter` → `{ perimeter }`, `application` → `{ application }` |
| `FocusKindSchema`, `FocusKind` | `project`, `shared-vpc`, `standalone-projects`, `perimeter`, `application` |
| `FocusParamNameSchema` | a parameter name: a letter, then letters, digits, `_`, `-` |
| `FlipIdSchema` | an expand/collapse override: an opaque, URL-safe token of 1–32 characters |
| `DepthSchema` | an integer from 1 to `VIEW_SPEC_MAX_DEPTH` |
| `VIEW_SPEC_MAX_FLIPS`, `VIEW_SPEC_MAX_DEPTH` | 48 and 64 |
| `DEFAULT_VIEW_SPEC` | `{ snapshot: '', lens: 'overview', filters: { all three hide switches false }, detail: 'auto', flips: [] }`, deeply frozen |
| `ViewSpecInput` | any subset of a ViewSpec (filters may be partial) |
| `LooseViewSpec` | a ViewSpec-shaped object whose values are `unknown` |
| `normalizeViewSpec(input): ViewSpec` | see below |

`showRegions` and `showIdentities` are tri-state: absent means "follow the user's setting" (regions) or "the
lens decides" (identities); `true` and `false` override.

`normalizeViewSpec` turns any input into a valid ViewSpec in canonical form and never throws for plain data of
any shape. It imports no zod (`codec/normalize.ts`): each field is judged by a plain predicate that
accepts exactly what its schema accepts (`normalize.test.ts` proves each against its schema, and
`view-hash.property.test.ts` the whole normaliser against a zod-based reference on any input, plain objects
with or without a prototype; class instances and arrays are no records). Field by field: a missing or invalid
value takes its default and an invalid optional field is dropped; the filter lists (`regions`, `projects`,
`folders`, `includeTypes`, `excludeTypes`) keep their valid items, de-duplicated and sorted, and an empty list
is dropped; `flips` keeps each id once at its newest position and only the newest 48; a focus keeps its valid
parameters, sorted by name. It is idempotent.

## Scene

What `packages/graph` hands to `packages/layout`. It lives here because layout must not depend on graph. The
organisation is the canvas, not a zone, so the tree starts at its children (or the drill-in root's children).
The layout's own output type belongs to `packages/layout`.

| Export | What |
|---|---|
| `SceneSchema`, `Scene` | `{ children, edges, metadata }`; ids are unique across the tree, edges join two different nodes of the tree, a collapsed zone has no children, `metadata.rectCount` equals the number of zones and cards |
| `SceneNodeSchema`, `SceneNode` | a zone or a card, discriminated by `type` |
| `SceneZoneSchema`, `SceneZone` | `type: 'zone'`, `id`, `kind`, `label`, `subtitle?`, `icon?` (the header icon key), `badges`, `collapsed?`, `children` |
| `SceneCardSchema`, `SceneCard` | `type: 'card'`, `id`, `label`, `subtitle?`, `icon`, `product`, `assetType` |
| `ZoneKindSchema`, `ZoneKind` | `folder`, `project`, `vpc`, `subnet`, `region` (virtual), `product-container`, `group` (synthetic bundle) |
| `ZONE_KIND_RANK` | the sibling order of zone kinds (folder, project, VPC, subnet, region, product container, group), declared once for `packages/graph` (Scene order) and `packages/layout` (sibling order) |
| `ChipCountsSchema`, `ChipCounts` | a collapsed zone's chip counts, e.g. `{ networks: 2, resources: 39 }` |
| `ChipCountKindSchema`, `ChipCountKind` | `folders`, `projects`, `networks`, `subnets`, `containers`, `resources` |
| `SceneEdgeSchema`, `SceneEdge` | `{ from, to, kind, count?, merged? }`: `count` (≥ 2) relations folded into one edge; `merged` when an end was re-targeted to a collapsed zone's chip |
| `SceneMetadataSchema`, `SceneMetadata` | `rootLabel`, `lens`, `readTime`, `rectCount`, `focusError?` and `rootError?` (why a requested focus or drill-in root was refused, as in the scene report) |
| `FocusErrorSchema`, `FocusErrorCodeSchema`, `RootErrorSchema`, `RootErrorCodeSchema` | `{ code, param?, message }` and `{ code, message }`: a refused focus or root |

## Scene builder environment and report

What `@gcportrait/graph`'s scene builder (`buildScene`, `buildSceneWithReport`) reads next to the
Graph and the ViewSpec, and what it reports next to the Scene. The Scene stays the layout's input; the report is
what the UI needs around it. A refused root or focus is reported here, never thrown.

| Export | What |
|---|---|
| `SceneEnvSchema`, `SceneEnv` | `readTime` (into the scene's metadata), `viewportBudget?` (the `auto` rect budget, ≥ 1), `rootLabel?` (canvas title when no organisation node names it), `showRegions?` (the user's setting when the view's filter is absent) |
| `SceneBuildSchema`, `SceneBuild` | `{ scene, report }`, which must agree: the legend lists exactly the zone and edge kinds in the scene and says whether chips, external stubs and overlays are present; overlays, external ids and pointers name scene nodes; the counts of zones, cards, chips, bundles, edges and relations match |
| `SceneReportSchema`, `SceneReport` | `root`, `focus?`, `detail`, `legend`, `overlays`, `external`, `selection?`, `highlight?`, `unknownFlips`, `warnings`, `counts` |
| `SceneRootSchema`, `SceneRoot` | `{ requested?, used?, error? }`: the drill-in root used (absent: the organisation) or why the requested one was refused (`RootErrorCodeSchema`: `unknown-root`, `not-a-container`) |
| `SceneFocusSchema`, `SceneFocus` | `{ status: 'applied', kind, anchor?, projects }` or `{ status: 'error', kind, error }` |
| `FocusErrorSchema`, `FocusError`, `FocusErrorCodeSchema`, `FocusErrorCode` | `{ code, param?, message }`; codes `missing-param`, `unknown-project`, `not-a-host`, `unknown-perimeter`, `not-a-perimeter`, `unknown-application`, `not-an-application`, `ambiguous`, `outside-root` |
| `SceneDetailSchema`, `SceneDetail`, `ConcreteDetailLevelSchema`, `ConcreteDetailLevel` | `{ requested, used, budget, ceiling, rectCounts }`: the level used is never `auto`; `ceiling` is the deepest level `auto` opens the lens at (its `defaultDetail`, `all` for an `auto` lens); `rectCounts` per level without flips |
| `SceneLegendSchema`, `SceneLegend` | `zoneKinds` (in `ZoneKindSchema` order), `edgeKinds` (in `RelationKindSchema` order), `collapsed`, `external`, `overlay` |
| `SceneOverlaySchema`, `SceneOverlay` | `{ zone, kind: 'secures' }`: a zone drawn as a dashed overlay (a perimeter around its projects) |
| `ScenePointerSchema`, `ScenePointer` | `{ value, node?, shownAs? }`: the selection or highlight, the node it names, the scene node that shows it |
| `SceneCountsSchema`, `SceneCounts` | `universe`, `focus`, `visible`, `stubs`, `held`, `zones`, `cards`, `chips`, `bundles`, `edges`, `relations`, `dangling` |

## Asset catalog (skill gcp-asset-catalog)

| Export | What |
|---|---|
| `CatalogEntrySchema`, `CatalogEntry` | one product file `products/<service>[.<suffix>].yaml`: `product`, `service`, `icon`, `types` |
| `CatalogTypeEntrySchema`, `CatalogTypeEntry` | one type: `role`, `label` (default `DEFAULT_LABEL_TEMPLATE`), `subtitle?`, `icon?`, `console?` (an `https://` template), `ips`, `domains`, `relations`, `contains` (all default `[]`), `nestsIn?` (one `NestsInRule` or a list, stored as a list: the containers the asset nests in), `zoneKind?`, `aliases?` (JSONPaths to alternative keys of the asset, at least one), `hiddenWhen?` (predicate or `null`), `notes?`, `deprecated?` (date); only containers have `contains` and `zoneKind` |
| `CatalogZoneKindSchema`, `CatalogZoneKind` | how the scene draws a container: `vpc`, `subnet`, `region`, `product` (the default), `group` |
| `RelationRuleSchema`, `RelationRule` | `{ kind, to, normalize, weak?, reverse?, versionLevel?, service?, pattern?, k8sKind? }`; `reverse` draws the edge from the target to the asset; `versionLevel` only with `kmsKey`; `service` (the target's service) only with `name` and `siblingName`; `pattern` required with `siblingName` and only there; `k8sKind` only with `k8sRef` |
| `NestsInRuleSchema`, `NestsInRule` | `{ to, normalize, service?, pattern?, k8sKind?, kind? }`: a reference to the container the asset nests in, read like a relation rule's; `kind` is the relation drawn when the asset does not nest there |
| `SiblingPatternSchema`, `SIBLING_PATTERN_PLACEHOLDERS` | a `siblingName` pattern: `/`-separated literal segments and placeholders `{id}`, `{parent}`, `{project}`, `{projectId}`, `{projectNumber}`, `{location}`, `{region}`, `{zone}`, `{.key}` |
| `KubernetesKindSchema` | a `k8sRef` kind: `Kind` or `group/Kind` |
| `CatalogRelationKindSchema`, `CatalogRelationKind` | every relation kind except `shares`, which only the graph builder derives |
| `NormaliserNameSchema`, `NormaliserName` | the fifteen normalisers of the skill's §5 |
| `ContainsRuleSchema`, `ContainsRule` | a JSONPath, or `{ byParent: <asset type> }` |
| `JsonPathSchema`, `PredicateSchema` | strings starting with `$.` or `$[` |
| `TemplateSchema` | text with `{{variable \| filter …}}` expressions |
| `TEMPLATE_VARIABLES`, `TEMPLATE_FILTERS` | `name`, `assetType`, `location`, `projectId`, `projectNumber` (plus `data.*`); `lastSegment`, `projectFromName`, `regionFromName`, `short(n)`, `lower`, `parentSegment(collection)`, `first(variables)`, `plural(word)` |
| `DEFAULT_LABEL_TEMPLATE` | `{{name \| lastSegment}}` |
| `LensSchema`, `Lens` | one lens file `lenses/<lens id>.yaml`: `title`, `description`, `types` (types, `<service>/*` or `*`), `relationKinds`, `showHidden` (default `false`), `defaultDetail` (default `auto`) |
| `CatalogSchema`, `Catalog` | the compiled `catalog.json`: `version` (semver), `officialListDate`, `products`, `types`, `lenses` (every lens id) |
| `CatalogProductSchema`, `CatalogProduct` | a compiled product: `product`, `service`, `icon`, `types` (asset type ids) |
| `CatalogTypeSchema`, `CatalogType` | a compiled type: its entry plus `assetType`, `product`, `service` and the effective `icon` |

The compiled catalog must be consistent: each type is listed by exactly one product, under the product named
in its description, and stored under its own `assetType`.

## Catalog rule engine contract

What `@gcportrait/catalog`'s rule engine reads next to an asset, and what it hands to the graph builder (the
catalog owns rule semantics: AGENTS.md, Data and graph semantics).

| Export | What |
|---|---|
| `ProjectIndexSchema`, `ProjectIndex` | `{ numberById, idByNumber }`: the snapshot's projects, id ↔ number, inverse of each other |
| `buildProjectIndex(assets)`, `projectIndexBuilder()`, `projectPairOf(asset)` | the one pairing rule, used by ingest, the catalog compiler and the graph builder: Resource Manager `Project` assets pair the number in their name (else `data.projectNumber`) with `data.projectId`, first claim wins; records sorted (ids by code point, numbers numerically) |
| `RelationTargetSchema`, `RelationTarget` | `{ by: 'name', name }` (a full resource name) or `{ by: 'alias', alias }` (a key of the graph's alias index, e.g. a service-account email) |
| `AliasKeySchema`, `aliasKey(value)` | an alias key: non-empty, no whitespace; `aliasKey` trims and lower-cases a value into one (undefined when it cannot), the key normalisers write and the graph's alias index stores |
| `EvaluatedRelationSchema`, `EvaluatedRelation` | `{ kind, rule, raw, target?, weak?, reverse? }`: one relation a rule produced; `rule` is the rule's position, `raw` the value as read (JSON text when not a string), `target` absent when the normaliser did not understand the value, `reverse` when the edge runs from the target |
| `EvaluatedNestingSchema`, `EvaluatedNesting` | `{ rule, raw, target?, kind? }`: one container a `nestsIn` rule named |

## URL-hash codec

`encodeViewSpec(spec): string` writes a view into a URL hash (without the leading `#`); `decodeViewSpec(hash):
ViewSpec` reads one, with or without the `#`. `decodeViewSpec(encodeViewSpec(spec))` deep-equals
`normalizeViewSpec(spec)` for every input (a fast-check property test). The codec runs on the app's UI thread
for every hash it reads and writes, so neither it nor `normalizeViewSpec` imports zod: a bundler that
keeps only what is imported leaves the schema library out of a bundle that uses the codec alone.

### Grammar

```
hash   = [ "#" ] [ field *( "&" field ) ]
field  = key "=" value
value  = item *( "," item )            ; lists; a scalar's value is one item
item   = *( safe / "%" HEXDIG HEXDIG )   ; percent-encoded UTF-8
safe   = ALPHA / DIGIT / "-" / "." / "_" / "~" / "*" / "/" / ":" / "@"
```

The encoder escapes every other character, upper-case hex, including the separators `& = , #`, `+`, `%`,
spaces and `! ' ( )` (which link detectors tend to cut). It writes the keys in the order of the table below
and leaves out every value that equals its default, so the default view is the empty string. The decoder reads
`+` as a plus sign (not a space, unlike form encoding), accepts lower-case hex, uses the first occurrence of a
repeated key, ignores unknown keys, fields without `=` and empty keys, and never throws: a malformed or
invalid value falls back to its default field by field, and a list keeps only its well-formed items.

### Keys

| Key | Field | Value |
|---|---|---|
| `snapshot` | `snapshot` | ULID or `demo:<size>`; omitted when `''` |
| `tick` | `tick` | `YYYY-MM-DD` (a day), or `YYYY-MM-DDTHH:MM:SSZ` (an extra tick) |
| `lens` | `lens` | lens id; omitted when `overview` |
| `focus` | `focus.kind` | focus kind |
| `focus.<name>` | `focus.params.<name>` | one parameter each, sorted by name |
| `root` | `root` | drill-in container id |
| `detail` | `detail` | detail level; omitted when `auto` |
| `hide` | `filters.hideEmptyProjects`, `hideEmptyFolders`, `hideDisconnected` | list of `empty-projects`, `empty-folders`, `disconnected` |
| `regions` | `filters.regions` | list |
| `projects` | `filters.projects` | list |
| `folders` | `filters.folders` | list |
| `include` | `filters.includeTypes` | list |
| `exclude` | `filters.excludeTypes` | list |
| `depth` | `filters.depth` | integer |
| `show-regions` | `filters.showRegions` | `1` or `0` (`true`/`false` also read) |
| `show-identities` | `filters.showIdentities` | `1` or `0` (`true`/`false` also read) |
| `flips` | `flips` | list, oldest first |
| `selection` | `selection` | node id |
| `highlight` | `highlight` | node id or search text |

### Examples

| View | Hash |
|---|---|
| the default view | (empty) |
| demo org M, networking lens | `snapshot=demo:M&lens=networking` |
| demo org S on 20 September, projects open | `snapshot=demo:S&tick=2026-09-20&detail=projects` |
| a focus with two parameters | `focus=application&focus.location=global&focus.name=shop` |
| escaped text | `highlight=web%20%26%20api%2C%20v2%2B3%20%3D%20100%25%20%231%20%28beta%29%20don%27t%21` is `web & api, v2+3 = 100% #1 (beta) don't!` |

A view that sets every field (one hash, wrapped here for reading):

```
snapshot=01J9Z3K5Q8XW2V4N6P7R8S9T0A&tick=2026-10-01&lens=load-balancing&focus=shared-vpc&focus.host=demo-net
&root=//cloudresourcemanager.googleapis.com/folders/20000000001&detail=networks
&hide=empty-projects,disconnected&regions=europe-west3,us-central1&projects=demo-app,demo-net
&folders=20000000001&include=run.googleapis.com/*&exclude=compute.googleapis.com/Disk&depth=4
&show-regions=1&show-identities=0&flips=k3x9a1,7fz2m0
&selection=//compute.googleapis.com/projects/demo-net/zones/europe-west3-a/instances/web-1&highlight=10.10.0.2
```

All of these are asserted verbatim in `src/codec/view-hash.test.ts`.

## Command variables

The values a reader fills in where the documentation or the app shows a command, one registry for both: a
token is `YOUR_` and capitals as one word (`YOUR_PROJECT`, `YOUR_ORG_ID`; docs/contributing.md, "Data, privacy
and presentation"). Data in `src/schemas/command-variables.ts`, which imports nothing at run time (no zod on
the UI thread; the repository's `.mjs` tooling loads it by Node's type stripping).

| Export | What |
|---|---|
| `COMMAND_VARIABLES`, `CommandVariableName` | every variable: `name` (the token), `label`, `description`, a synthetic `example`, `pattern` (an anchored JavaScript regular expression), `hint` (the format in words), `secret` (never stored) |
| `CommandVariableSchema`, `CommandVariable` | one row; the test checks every row, that each example matches its own pattern and is synthetic |
| `commandVariable(name)`, `isCommandVariableValue(variable, value)` | a row by its name; whether a value has its format (for a hint, never to refuse it) |
| `splitVariableTokens(text)`, `variableTokens(text)`, `VARIABLE_NAME_PATTERN` | a command cut into text and `{ token }` parts (whole words only: `gs://YOUR_BUCKET/x` holds one, `YOUR_Xs` none), its distinct tokens, a name's form |

## Tests

```sh
pnpm --filter @gcportrait/model test                 # example, table-driven and fast-check property tests
pnpm --filter @gcportrait/model test -- --coverage   # plus V8 coverage, 100 % required in schemas and codec
```

The deterministic example tests alone cover every branch of `src/schemas` and `src/codec`; the property tests
(`*.property.test.ts`) add random views, random junk input and random hash strings on top. Test fixtures under
`src/testing/` are synthetic (`example.com`, documentation IP ranges, project numbers below 100000000000) and
are not part of the public API.

## Testing export (`@gcportrait/model/testing`)

Helpers for tests and data tooling that the app must not ship, behind their own subpath export (the one
exception to "import a package through its entry point" in `eslint.config.js`): the "synthetic only" guard,
`findNonSyntheticData(text, options?)` (findings with kind, value and line), `assertSyntheticOnly(text, options?,
label?)` and `formatSyntheticFindings`. It is the only guard in the repository: demo-data, the catalog compiler
(fixtures) and the ingest tests (fixtures, generated exports, sources) all call it with its one allowlist:
`example.com/.org/.net`, platform hosts (`googleapis.com`, `gserviceaccount.com`, `run.app`, `pkg.dev`,
`k8s.io`, `knative.dev`, and the managed services' own hosts `gateway.dev`, `sourcemanager.dev`,
`developerconnect.dev`, `looker.app`, `blockchainnodeengine.com`, `domains.cloudrun.com` and
`ghs.googlehosted.com`, …), the demo organisations 30000000001 to 30000000004 (one per size; also in
`organizationId` and Resource Manager v1 `{ type, id }` parents), project and folder numbers below 100000000000
(also inside Cloud Run hosts), `demo-…` project ids in self-links, full names and `projectId` (and Google's own
image and tenant projects), and private, shared (100.64.0.0/10), link-local, loopback and
documentation address ranges. It runs in one pass over the text.

It also holds the rule for the tests' wall-clock limits, the one every package that times its work applies
(the layout's budgets, the ingest budget, the graph build's budget, the demo organisations' generation):
`measureBatches` measures a case again after a 250 ms pause (`PAUSE_MS`) while it is over its limit, at most
`BATCHES` (5) times and only while another batch fits in 95 % of the test's timeout (`anotherBatchFits`), and
keeps the best batch; `skipIfOverloaded` skips a test whose best figure is still over its limit, with the load
and the figures as the reason and a `skipped:` line on standard error (`noteSkipped`), when `overloadReason`
finds the machine's one-minute load average above 1.5 per core (`OVERLOAD_PER_CORE`), but never on CI
(`onCi`: `CI` set and not `false` or `0`) and never in a strict budget run. This package has no Node types,
so the helpers reach the process, its clock and its timers through `globalThis` and `node:os` through
`process.getBuiltinModule`; loaded anywhere else, they find no load and never skip.
