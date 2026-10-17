<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/graph

The graph core (the data flow in [docs/packages.md](../../docs/packages.md)). The builder (containment: skill
gcp-diagram-layout §2): a Snapshot and the asset catalog become a `Graph` (`@gcportrait/model`) — one node per
asset, the containment forest, relation edges, dangling references, aliases and lookup indexes — plus the
Shared VPC derivation and the timeline diff (skill cai-ingestion §5). The views
([docs/lenses-and-filters.md](../../docs/lenses-and-filters.md); progressive disclosure: skill
gcp-diagram-layout §6): a Graph and a `ViewSpec` become the `Scene` that `packages/layout` lays out —
drill-in, focus views, lenses, filters and detail levels, composed in a fixed order (see
[Views](#views-graph--viewspec--scene)).

The package is a pure core: no I/O, no clock, no randomness, no DOM; `src/` compiles without Node types. The
same snapshot and catalog always give a deep-equal graph, whatever the order of the assets. It imports
`@gcportrait/model` and `@gcportrait/catalog` only (AGENTS.md, Architecture and code): every rule semantic
(JSONPaths, normalisers, templates, `hiddenWhen`) is evaluated by the catalog's engine, never re-implemented
here.

```ts
import { catalog } from '@gcportrait/catalog';
import { buildGraph, buildGraphWithReport, diffSnapshots } from '@gcportrait/graph';

const graph = buildGraph(snapshot, catalog); // GraphSchema-valid
const { graph: g, report } = buildGraphWithReport(snapshot, catalog, { showRegions: true });
report.sharedVpc; // [{ service, host, attachments }] behind the derived `shares` edges
report.cycles; // containment cycles refused (normally none)
const diff = diffSnapshots(previousTick, displayedTick); // { added, removed, changed }

const scene = buildScene(graph, viewSpec, catalog, { readTime: snapshot.readTime }); // SceneSchema-valid
const { scene: s, report } = buildSceneWithReport(graph, viewSpec, catalog, {
  readTime: snapshot.readTime,
  viewportBudget: viewportBudget(window.innerWidth, window.innerHeight),
});
report.focus; // { status: 'applied', … } or { status: 'error', error: { code, param, message } }
```

## Public API

| Export | What |
|---|---|
| `buildGraph(snapshot, catalog, options?)` | `Graph`: `nodes`, `containment`, `edges`, `dangling`, `indexes` |
| `buildGraphWithReport(snapshot, catalog, options?)` | `GraphBuild` (`{ graph, report }`, `GraphBuildSchema` in the model): the graph and the report below |
| `BuildOptions` | `{ showRegions?: boolean, memo?: BuildMemo }`: virtual region and zone containers (skill gcp-diagram-layout §2, rule 3), off by default; the builder's memo (below) |
| `BuildMemo` | the builder's memo: what a build worked out for each asset object (its node, and what its relation, `nestsIn` and `contains` rules produce), reused by a later build with the same catalog object and the same project index; it changes no result (see "Performance") |
| `SnapshotAssets` | what the builder reads of a snapshot: `{ assets }` (a `Snapshot` fits) |
| `diffSnapshots(before, after)` | `Diff`: names added, removed, and changed (`updateTime` differs as an instant), each sorted |
| `compareTimestamps(a, b)` | RFC 3339 comparison by instant (`…41.5Z` equals `…43:41.500+02:00`) |
| `PROJECT_TYPE`, `FOLDER_TYPE`, `ORGANIZATION_TYPE`, `SERVICE_ACCOUNT_TYPE` | the asset types the builder knows by identity (see "Structure in code") |
| `REGION_TYPE`, `ZONE_TYPE`, `VIRTUAL_SERVICE`, `isVirtualNode(id)` | the builder's own virtual containers, `//gcportrait.virtual/projects/<project>/locations/<region>[/zones/<zone>]` |
| `projectNodeId(number)` | `//cloudresourcemanager.googleapis.com/projects/<number>`, the node of a project |
| `buildScene(graph, viewSpec, catalog, env)` | `Scene` (`SceneSchema` in the model): what `packages/layout` lays out |
| `buildSceneWithReport(graph, viewSpec, catalog, env)` | `SceneBuild` (`{ scene, report }`, `SceneBuildSchema` in the model): the scene and the report below |
| `prepareView(graph, viewSpec, catalog, env)`, `buildPreparedScene(prepared, viewSpec, env)`, `preparedViewKey(viewSpec, env)`, `PreparedView` | the same build in two parts: steps (a)–(d), the scene tree and its badges once, then step (e) and the report for any view with the same `preparedViewKey` (see "Performance" under "Views") |
| `flipIdOf(zoneId)` | the URL-hash token of a zone for `ViewSpec.flips` (64-bit FNV-1a, base 36, ≤ 13 characters) |
| `viewSpecOf(renderView, snapshot)` | the `ViewSpec` of a render's view (`RenderView` in the model, the view of `POST /api/render`, `pnpm render` and `pnpm render-scene`): a `hash` decoded by `decodeViewSpec` with its `snapshot` replaced, or the explicit fields normalised (lens `overview` and detail `auto` by default) with each flip's zone id turned into its `flipIdOf` token. The render library re-exports it |
| `viewportBudget(width, height)`, `DEFAULT_VIEWPORT_BUDGET` | the `auto` rect budget: `width × height / 14000`, clamped to 24–250; 73 for 1280×800 |
| `NEVER_COLLAPSE_RECTS`, `BUNDLE_THRESHOLD`, `BUNDLE_SIZE` | 100, 120 and 24 (skill gcp-diagram-layout §6) |
| `BUNDLE_ID_PREFIX` | `group:`, the prefix of a bundle zone's id (the rest is its first member's id) |
| `DETAIL_LEVELS` | `folders`, `projects`, `networks`, `all`, shallowest first |
| `ZONE_OPENS_AT`, `zoneOpensAt(kind, overlay)` | the level table of step (e): the shallowest level each zone kind is open at by default (folders and bundles `folders`, projects and region zones `projects`, VPCs and subnets `networks`, product containers `all`; an overlay always open). The app's disclosure controls read it rather than restating it |
| `CHIP_COUNT_OF_KIND` | what a chip counts a zone it holds as, by its kind (`folders`, `projects`, `networks`, `subnets`, `containers`; a card is one of its `resources`, a region zone or a bundle is not counted). The app counts what a timeline day's ghost of a chip holds by it |
| `autoDetailLevel(rectCounts, budget, ceiling?)`, `autoCeiling(defaultDetail)` | the rule `auto` follows (step (e)) and the ceiling a lens's `defaultDetail` sets it (`all` for an `auto` lens), for the app's resize hysteresis and "Collapse all" |
| `GENERIC_ICON` | `cloud_generic`, the icon of a card whose type and service the catalog does not know |

The report (`GraphReportSchema` in `@gcportrait/model`) is the data the UI needs next to the
graph: `sharedVpc` (pairs with their attachments), `sharedWith` (host-side target → number of service
projects: the subnet's "shared with N projects" badge), `cycles`, `danglingByNode`, `unmappedTypes` (types
drawn as generic cards, with counts) and `counts` (assets, duplicate names dropped, virtual nodes, weak edges
that yielded, peerings and reciprocal `connects` merged, alias conflicts, nodes kept out of a container in
another project, edges that matched only with their project segment swapped, nodes nested by their own
`nestsIn`). `GraphBuildSchema` checks that report and graph agree, so tests use it as their oracle.

## Pipeline

1. **Assets.** One per name, sorted by name (a repeated name keeps the latest `updateTime`, then the smaller
   data text; counted). The project index comes from the model's `buildProjectIndex` (the one pairing rule
   ingest uses too).
2. **Nodes.** For a mapped type: the catalog's label, subtitle, role, product, `ips`, `domains` and default
   visibility (`hidden` for role `hidden` or a matching `hiddenWhen`; `hiddenWhenMatched` marks the latter).
   For a type the catalog does not map (unknown types still render: AGENTS.md, Product rules): a generic card
   labelled `data.displayName`, else the last segment of `data.name`, else of the asset name; product = the
   service host; no addresses; visible; role `core` when another asset's rule points at it and `leaf`
   otherwise (it has no rules, hence no outgoing edges; it is never a container, because only the catalog can
   declare what nests in a type). `projectId`/`projectNumber` come from the catalog's `assetProject`. A
   Resource Manager project whose Compute settings (`compute.googleapis.com/Project`) say
   `xpnProjectStatus: HOST` is marked `sharedVpcHost`.
3. **Aliases** (below).
4. **Relations.** Each asset's rules through `evaluateRelations`; each target is resolved against the nodes
   (with canonical project matching, below) and the aliases. A `reverse` rule's relation is drawn from the
   node it names to the asset. Unresolved targets become dangling references of the asset (below).
   Self-references are dropped; a relation produced twice is kept once, weak only if every copy is weak. Each
   type's `nestsIn` rules (`evaluateNestsIn`) name the containers the asset nests in, resolved the same way.
5. **Containment** (decision table below), a forest by construction. Then a `nestsIn` rule's `kind` is drawn
   to every named container the asset did not nest in, and copies of one (from, kind, to) edge merge,
   whichever asset drew them (a reverse rule and the target's own rule), strong if any copy is.
6. **Weak edges and reciprocal links.** A weak edge yields to a stronger edge of the same kind from the same
   asset whose target lies inside the weak edge's target: a NIC's network yields to its subnet. A weak edge
   with nothing stronger inside its target stays in `edges` with `weak: true`. Reciprocal `peers` edges (both
   networks list the peering) and reciprocal `connects` edges (a tunnel and its router naming each other)
   merge into one edge from the smaller id; a one-sided edge stays as it is.
7. **Shared VPC.** A resolved `attaches` edge from one project into another project's **subnetwork**, or into
   a **network** of a project marked `sharedVpcHost`, is evidence for a pair: one `shares` edge from the
   service project's node to the host project's node, the attachment listed in `report.sharedVpc`, and the
   target's `sharedWith` count. Subnets and networks are the catalog's `zoneKind` `subnet` and `vpc`. Other
   cross-project attachments (a producer's network peered into a project that is no host, a connector in
   another project) are drawn but are no Shared VPC.
8. **Virtual regions** when `showRegions` is set (skill gcp-diagram-layout §2, rule 3).
9. **Output.** Records with sorted keys, children lists, edges and dangling references sorted, indexes.

## Containment decisions

A node's parent is the first acceptable candidate, tier by tier:

| Tier | Candidate | Example |
|---|---|---|
| 1. Declared by a container | a catalog `contains` JSONPath naming the node; a `byParent` rule for its type whose container is its `parent` or a prefix of its name; for a Kubernetes object (name holds `/k8s/`), every container its name continues. Several: the innermost (longest name). Decided for every node first, so a container's own declaration beats any other node's preference. | subnet in the network that lists it; table in its dataset; pod, ConfigMap or deployment in its namespace; namespace, node and node pool in the cluster |
| 1b. Declared by the node | none of the above: the first target of its type's `nestsIn` rules that is a container. Decided with tier 1, before any attachment. | a managed VM in its instance group (from `created-by`), a disk in its storage pool, a NetApp volume in its pool, an enrollment in its message bus |
| 2. Attachment (skill gcp-diagram-layout §2, rule 1) | the node's resolved `attaches` targets, reduced to the innermost ones (a target that contains another target drops out). Exactly one left, and it is a container → nest there. Several or none → no nesting from attachments; the edges are drawn. | VM with one subnet → subnet; only a network → VPC; two subnets → project; a connector (not a container) → project |
| 3. `parent` field | the parent asset if it is a container; a parent that is not a container passes its own placement on | node pool in its cluster; a key version where its key nests |
| 4. `ancestors` | the closest ancestor (project, folder, organisation) present in the snapshot | everything else lands in its project |
| 5. none | the node is a root | the organisation; assets whose ancestors are all outside the snapshot |

A candidate is refused, and the next one tried, when it is the node itself, when a resource-hierarchy node
(organisation, folder, project) would nest in anything but the hierarchy, when it lies in another project
(rule 2: never nest across projects, so a Shared VPC resource stays in its service project and is counted in
`counts.crossProjectRefused`), or when it would close a cycle (rule 5: the cycle's ids are recorded in
`report.cycles`, starting at the smallest id, in child → parent order). Cycles cannot come from correct
catalog data; the guard exists so that a wrong rule degrades into a reported warning instead of a broken
diagram.

**Virtual regions (rule 3).** With `showRegions`, each project's *direct* children that have a non-global
location move into a region container (`europe-west3`, or a multi-region such as `eu`, lower-cased) and, for a
zone (`europe-west3-b`, an AI zone such as `us-central1-ai1a`, a sovereign cloud's `u-france-east1-a`), a zone
container inside it. What is a location, what is a zone and which region holds it is the model's one rule
(`LOCATION_PATTERN`, `isZone`, `regionOfZone`, `isRegion`), which the regions filter, the catalog's templates
and the app's filter choices follow too. VPCs are global and stay under the project; subnets and everything
nested in them stay where they are. Virtual nodes are `container`s of type `gcportrait.virtual/Region` or
`…/Zone`, carry the project's id and number, and are in `byType` and `byProject` like any node.

## Aliases and dangling references

**Canonical project matching.** Cloud Asset Inventory names some services' assets with the project id and
others with the number, and references use either. A name that matches no node is tried once more with its
first `projects/<ref>` segment swapped through the project index (number → id, or id → number, `names.ts`);
the edge then records the form it matched (`matchedProject: 'id' | 'number'`, counted in
`counts.projectSwaps`). Exact names win, asset names are never rewritten, and a name that matches neither way
dangles with the value as read. `contains` names and `nestsIn` targets resolve the same way.

Some references name no asset by themselves. The alias index (`indexes.aliases`) maps them to node ids:

- **Catalog aliases** → the asset: every value a type's `aliases` paths read (an IAM service account's
  `$.data.email`, in the catalog's entry for the type), keyed by the model's `aliasKey` (trimmed,
  lower-cased), which is exactly how normalisers such as `serviceAccountEmail` write their alias requests. The
  builder keeps no list of aliased types of its own: a type without `aliases` in the catalog is known by its
  name only.
- **Project ids and numbers** → the Resource Manager project node (named by number); the id comes from the
  snapshot's project index. Compute names use ids, most newer APIs numbers; normalisers translate through the
  index, so both resolve.

The first claim of a key (in name order) wins; later claims by other nodes are counted in
`counts.aliasConflicts`.

A relation whose target matches no node is a **dangling reference**: it goes to `graph.dangling` (never to
`edges`, never drawn) with `from`, `kind`, `to` (the normalised name, the alias, or — when the normaliser did
not understand the value — the raw text) and `dangling.raw` (the value as read from the asset).
`danglingByNode` counts them per node for the drawer. A `reverse` reference that dangles stays with the asset
that holds it, and so does a `nestsIn` target with a `kind`. In the demo organisation M they are 49, all
outside what the demo models: public images (Google's image projects), Google-managed tenant projects (private
services access peerings, Private Service Connect producers, Cloud IDS, Apigee), Google-managed logging writer
identities, `gke.gcr.io` images, the `all-apis` bundle of a Private Service Connect endpoint for Google APIs,
and the partner VMs' Compute default service account, which the demo does not generate as an IAM asset. S also
names Artifact Registry repositories and GKE nodes it does not generate (catalog follow-ups §2); otherwise no
reference into the organisation dangles.

## Indexes

| Index | Key → node ids |
|---|---|
| `byType` | asset type → every node of that type (virtual containers included) |
| `byProject` | project id (the number when the id is unknown) → every node in the project, the project node included |
| `byIp` | every address or range the catalog's `ips` paths extracted |
| `byDomain` | every host name the catalog's `domains` paths extracted |
| `aliases` | e-mail, project id or number → one node id |
| `containment.parent` / `containment.children` | child → parent, parent → children (sorted); inverse of each other |

All lists are in node-id order and all keys sorted, so the graph serialises identically every time.

## Structure in code

The builder knows five asset types by identity, because they are the spine of the containment rules rather
than catalog data: the Resource Manager organisation, folder and project (where `ancestors` point, the only
parents of a hierarchy node, the ends of `shares` edges) and its own two virtual container types. The views
also show or hide IAM service accounts with `showIdentities`. Everything else comes from the catalog: roles,
labels, relations, what a container contains, which types a lens shows, which values are aliases of an asset
(`aliases`), and how a container is drawn (`zoneKind`: the VPC network and subnetwork are `vpc` and `subnet`,
the network layers of the nesting order that the `networks` detail level opens). One more type is known by
identity: a project's Compute settings (`compute.googleapis.com/Project`), whose `xpnProjectStatus: HOST`
marks the Resource Manager project a Shared VPC host. `structure.ts` holds these constants.

## Timeline diff

`diffSnapshots(before, after)` compares by asset name (skill cai-ingestion §5): `added` are in `after`
only, `removed` in `before` only, `changed` in both with a different `updateTime`. Timestamps are compared as
instants (`compareTimestamps`), so a different spelling of the same instant is no change. The result does not
depend on the order of either snapshot's assets; a name repeated inside one snapshot counts once, with its
latest `updateTime`. Tested against every tick of the S and M demo histories: each tick's diff is exactly what
that tick's mutations did. Only times that differ as text are parsed and compared as instants (the same
text is the same instant), and only the three result lists are sorted, so a step of demo L's timeline compares
its 6 400 names in 1.3–4.5 ms instead of 5.8–11.6 ms (Node, two runs of four steps).

## Views: Graph + ViewSpec → Scene

`buildScene(graph, viewSpec, catalog, env)` is pure and deterministic like the builder. `env`
(`SceneEnvSchema` in the model) carries what neither the graph nor the view knows: `readTime` (into the
scene's metadata), `viewportBudget` (the `auto` rect budget the caller computes), `rootLabel` (the canvas
title when no organisation node names it, e.g. the snapshot scope's name) and `showRegions` (the user's
setting, used when the view's `filters.showRegions` is absent). Nothing in a view throws: a root or a focus
parameter that names nothing usable falls back and is reported.

### Composition order

The steps compose in this order; each works on what the previous one left, so every filter applies under a
drill-in and under every focus view (filters compose with focus views and drill-in: AGENTS.md, Product rules).

| Step | What it does |
|---|---|
| (a) root | The organisation is the canvas: its zone is dropped and its children are the top level. `root` re-roots the view at a container: it becomes the canvas, its children the top level, and nothing above or beside it is drawn. A root that is no node (`unknown-root`) or no container (`not-a-container`) falls back to the organisation; `report.root.error` says why, and so does `scene.metadata.rootError`. |
| (b) focus | Picks a part of what the root left (table below). Parameters come from `viewSpec.focus.params` and are checked against the graph; an error (`report.focus.error`: `missing-param`, `unknown-project`, `not-a-host`, `unknown-perimeter`, `not-a-perimeter`, `unknown-application`, `not-an-application`, `ambiguous`, `outside-root`; also in `scene.metadata.focusError`) leaves the view at its root. When the root lies inside the focus's project (or application), the focus keeps the whole canvas. Focus views show their projects at the top level, without folders. |
| (c) lens | A node is a candidate when the catalog lens's `types` (asset types, `<service>/*`, `*`) or `filters.includeTypes` name its type, and `filters.excludeTypes` does not (exclude wins). A hidden-by-default node (role `hidden` or `hiddenWhen`) only with the lens's `showHidden` or a matching `includeTypes`, except that `includeTypes` never reveals a hidden type's `hiddenWhen` matches (the predicate marks the noise of a type the user switched on; only `showHidden` draws them); otherwise it is "held back" and counted in its zone's `N hidden` badge. `showIdentities: true` shows service-account cards and `runsAs` edges in any lens, `false` hides them in every lens, absent lets the lens decide. Edges: the lens's `relationKinds` (`contains` is nesting, never an arrow). |
| (d) filters | `regions` keeps nodes whose location is listed (a zone matches its region, by the model's `zoneRegion`; case-insensitive); folders and projects, nodes without a location and global containers (VPCs) are structure and stay. `projects` keeps nodes of the listed projects (id or number), `folders` the subtrees of the listed folders; with either, folders above a kept node stay as structure. `showRegions` adds virtual region and zone zones under each project (whatever the graph was built with: the builder's region containers are added or removed to match the view). Then, repeated until nothing changes: `hideDisconnected` removes cards without a drawn edge, then containers left with neither a visible child nor a drawn edge; `hideEmptyProjects` / `hideEmptyFolders` remove projects / folders without a visible child, recursively; region zones always go when empty. "Empty" and "disconnected" therefore mean empty and disconnected in this view, and the filters are idempotent. |
| (e) detail | Each zone starts collapsed by the level (table below) or when it is an asset zone deeper than `filters.depth` below the root (bundles, region zones and overlays are no level). A flip (`flipIdOf(zone id)` in `viewSpec.flips`) XORs that default, so a click opens a chip or closes an open zone whatever collapsed it. `auto` picks the deepest level whose rect count (zones + cards, a chip counts once, without flips) is at most `env.viewportBudget` (default 73) and falls back to `folders`, but never opens deeper than the lens's `defaultDetail` (its ceiling, reported as `detail.ceiling`: Networking and Compute open at most at `networks`, Security, Data and the others at `projects`; an explicit level is not capped); a view of at most 100 rects is never collapsed, whatever the ceiling (demo S's Networking opens at `all`); flips apply after the choice, so opening a chip never changes the level. A zone with nothing inside never becomes a chip. A collapsed zone carries chip counts (`{ networks: 2, resources: 39 }`: folders, projects, networks, subnets, containers, resources inside it at any depth; the renderer writes "2 networks · 39 resources"). Every edge end inside a chip is re-targeted to the outermost chip; edges that then join the same two nodes with the same kind merge with a `count` and `merged: true`, edges inside one chip are dropped, and merged peerings order their ends. More than 120 visible siblings (in a zone or at the top level) are bundled into alphabetical `group` zones of 20–24, labelled with the shortest prefixes that tell their ends from the neighbouring bundles (`demo-a – demo-f`) and identified as `group:<first member id>`. |
| (f) pointers | `selection` and `highlight` pass through to `report.selection` / `report.highlight` with the graph node they name and the scene node that shows it (`shownAs`: the node, or the chip it is collapsed into). |

| Focus | Parameter | Shows |
|---|---|---|
| `project` | `project`: id, number, `projects/<…>` or node id | the project; every drawn edge from inside it to anything outside it, with its target as an external stub card grouped in that target's project zone (badge `external`; `report.external` lists them; stubs pass the lens rules only) |
| `shared-vpc` | `host` | the host project and every project with a `shares` edge to it (`not-a-host` when none) |
| `standalone-projects` | — | projects without a `shares` edge and without a `peers` or `connects` relation inside them (dangling ones count: a peering into a producer's tenant project is a peering) |
| `perimeter` | `perimeter`: node id, label or last name segment | the projects the node `secures`, inside the node drawn as an overlay zone (`report.overlays`); the `secures` edges are that nesting, not arrows |
| `application` | `application`: node id, label or last name segment | the container (an App Hub application), what it contains, and what those reference, each in its project with the containers between |

Perimeters and applications are recognised by structure, not by asset type: a perimeter is any node whose
`secures` edges reach projects, an application any container; the catalog's rules decide what that covers. The
focus's anchor (the perimeter overlay, the application zone) is always drawn, whatever the lens and the
filters.

| Level | Collapsed by default |
|---|---|
| `folders` | everything but folders, bundles and overlays: projects (and region zones and anything the canvas holds below projects) are chips |
| `projects` | VPCs, subnets and product containers |
| `networks` | product containers |
| `all` | nothing |

Zone kinds: Resource Manager folders and projects are `folder` and `project` zones, virtual region and zone
containers `region`, bundles `group`; every other container takes its catalog type's `zoneKind` (`vpc` and
`subnet` for the VPC network and subnetwork; `product`, or none, is a `product-container`), and so does a node
that holds visible children. A drawn `attaches` edge to a node's own container is nesting and never an arrow
(skill gcp-asset-catalog §4); neither are the edges a builder weak-edge yielded. The "shared with N projects"
badge comes from the graph's cross-project `attaches` edges by the builder's own Shared VPC rule
(`deriveSharedVpc`, reused with the catalog's zone kinds and the projects' `sharedVpcHost`). Cards take the
catalog's icon for their type, else their service's product icon, else `cloud_generic`. A product container's
zone carries the same icon as its header icon (`SceneZone.icon`), so a GKE cluster, a dataset or an instance
group shows its product's mark; folders, projects, networks, subnets, regions and bundles leave it out and
draw their zone kind's own mark.

**Order.** Every list is sorted in code-point order: zones before cards; zones by kind (folder, project, VPC,
subnet, region, product container, bundle); then by label; then by id. Edges by (from, to, kind). The output
does not depend on the order of the graph's records (property-tested), so the layout never jiggles.

**The report** (`SceneReportSchema` in the model; `SceneBuildSchema` checks it agrees with the scene): `root`
and `focus` outcomes, `detail` (requested, used, budget, rect counts at every level: "N of M shown"), `legend`
(zone and edge kinds on screen, whether chips, external stubs or an overlay are present: skill
gcp-diagram-style §7), `overlays`, `external`, `selection`, `highlight`, `unknownFlips` (flips that match no
zone of this view), `warnings`, and `counts` (universe, focus, visible, stubs, held back, zones, cards, chips,
bundles, edges, the relations they stand for, dangling references of visible nodes).

**Not done here, on purpose.** The lens's `defaultDetail` is the UI's to apply when the user switches lenses;
the scene builder takes `viewSpec.detail` as given. Search (`highlight` as text) is the UI's; the builder only
resolves a highlight that is a node id.

### The composition table

`test/views/composition.test.ts`, on the demo organisations S and M with the real compiled catalog, plus a
test-only App Hub application added in `test/views/fixtures.ts` (`shop` in demo-svc-1, registering the
`orders-api` Cloud Run service, the `orders-db` Cloud SQL instance and demo-web-1's `web-mig` group; the
demo's own `storefront` application could replace it, catalog follow-ups §2). Access Context Manager
perimeters `secure` their projects through the catalog's own rules:

1. **Every lens × every focus view (and none) × the standard filter set**, on S and M: 2 × 11 × 6 × 13 = 1 716
   cases (filters: none, hide empty projects, hide empty folders, both, hide disconnected, all three, include
   types, exclude types, depth 1, depth 2, regions, projects, show regions with regions). Each is checked by
   an independent oracle (`test/views/oracle.ts`) that re-derives the semantics from the graph, the view and
   the catalog lens: nothing at or above the root, focus membership, lens and type filters, location, project
   and folder filters, edge kinds and that every edge stands for a relation, hide filters, depth, the detail
   level (`auto`'s choice included), `attaches` never drawn to its own container, and sibling order.
2. **Drill-in on a folder (Workloads), a project (demo-web-1) and a VPC (vpc-shared-prod)** × the filter set ×
   three lenses, on S and M (234 cases, same oracle).
3. **Filters under drill-in and focus**: in each of those three drill-ins and five focus views, each filter
   (exclude types, include types, regions, depth 1 and 2, hide empty projects, hide empty folders, hide empty
   both, hide disconnected) changes the view *exactly when* the unfiltered view holds something it must
   change, and the filtered view passes the oracle (144 cases). The matrix of where each filter bites is
   pinned per size, and every filter bites under at least one drill-in and at least one focus view.
4. **Named rows** with specific expectations (top-level ids in order, ids present and absent, chips and open
   zones, children, badges, edge and zone kinds, detail level, rect count, stubs, overlays, focus outcome,
   selection): every lens and every focus view at least once, and the three drill-ins. Where a correct catalog
   entry may add to a zone (the load-balancing focus's external host project, which a backend service
   attaching to the host VPC also reaches), the row checks its children and stubs as lower bounds; the
   networking view of the whole organisation asks for folder detail rather than `auto`, whose choice depends
   on how many cards the catalog draws. Rows about the edges (security, identity, App Hub) pin the legend's
   edge kinds exactly; the others list the kinds they need at least, so a catalog entry that adds a relation
   kind leaves them be. Where S and M differ only in what their data holds, one row carries both, with the
   size's own expectations.
5. **A zone with a longer suffix**: a disk added to demo-web-1 in the AI zone `us-central1-ai1a` (the demo's
   zones all end in one letter), in the whole organisation, two drill-ins and two focus views × the regions
   filter (its region, the zone itself, another region) and the region zones (alone and with either region),
   on S and M (60 cases, same oracle): the filter keeps it under its region, and the region zones draw it in
   project › `us-central1` (region) › `us-central1-ai1a` (zone).

Unit tests next to the code (`src/views/*.test.ts`, on the synthetic organisation of `src/testing/views.ts`)
cover each step's rules and errors, and `test/views/scene.property.test.ts` checks with fast-check over random
views (any lens, valid and junk focus parameters and roots, any filter combination drawn from the
organisation's own ids, types and locations, any detail level, budget, flips and selection) on S and M that
the scene is deterministic and independent of record order, valid with a consistent report (every edge joins
two scene nodes; a chip holds nothing and nothing it contains is drawn elsewhere), accepted by the oracle, and
that the filter stage is idempotent. Planted faults (filters skipped under a focus or a drill-in, no fixpoint,
depth off by one, unmerged chip edges, sibling order by id, no 100-rect floor, hidden nodes always shown,
stubs ignoring the lens, wrong chip counts, nesting drawn as arrows, zones not matching their region) each
fail tests.

### `pnpm render-scene`

```sh
pnpm render-scene --fixture M --lens networking
pnpm render-scene --fixture S --lens overview --focus kind=project,project=demo-web-1 --detail all
pnpm render-scene --fixture M --lens everything --root //cloudresourcemanager.googleapis.com/folders/20000000005 \
  --filter hideEmptyProjects=true --filter regions=us-central1 --filter depth=2
pnpm render-scene --fixture L --lens networking --json > scene.json   # { scene, report }
pnpm render-scene --help
```

`scripts/render-scene.ts` (run with tsx) loads the demo organisation — S and M from demo-data's committed
NDJSON fixtures, L generated and serialised to NDJSON — ingests it with `@gcportrait/ingest` (fixed clock and
entropy), builds the graph and the scene with the real catalog, and prints a summary: the level used and the
rect count at every level, root and focus, zones by kind, chips by kind, cards, edges by kind and the
relations they stand for, stubs, overlays, held-back nodes, dangling references and warnings. Options:
`--lens`, `--focus kind=…,name=value`, `--root`, `--detail`, `--filter key=value` (repeatable), `--flip
zone-id` (repeatable), `--budget N` or `--viewport WxH` (`--budget` wins when both are given),
`--selection`, `--highlight`, `--json`. The view flags and `--viewport` are `pnpm render`'s, read by the
model's `readRenderFlags` and checked by `RenderOptionsSchema` as `POST /api/render` checks its fields, and
the view is resolved by `viewSpecOf`: a focus parameter's name starts with a letter, a boolean filter takes
`true` or `false` (the key alone is `true`), a list filter comma-separated items, `depth` a whole number from
1 to 64, and the viewport is at most 16 384 px a side. Invalid input exits with code 2 and the usage.

### Performance

`buildSceneWithReport` medians with the real catalog: S (96 assets) 0.5–1.5 ms; M (952) 3.2 ms for a Shared
VPC focus with hide filters, 5.3 ms for the overview at `auto`, 6.9 ms for everything at `all` (951 rects); L
(6 382) 14 ms, 25 ms and 39 ms (6 394 rects).

Most of a build does not depend on the view's detail level: `prepareView` does steps (a)–(d), the scene tree,
the held-back counts and the zone badges, and `buildPreparedScene` finishes a view from that preparation (step
(e), the emitted nodes and edges, the report). Two views share a preparation when their `preparedViewKey` is
the same: they differ only in detail level, flips, `depth` filter, selection, highlight, snapshot ref,
timeline tick, read time or `auto` budget. `buildSceneWithReport` is the two parts in a row, and a property
test (`test/views/scene.property.test.ts`) checks that a view finished from another view's preparation is the
view built from scratch. The app's data worker keeps the last preparation
(`frontend/src/diagram/pipeline/sceneMemo.ts`), so a timeline step's open view and a chip expanded cost only
the finish. The overview at `auto` on each demo organisation's own day, medians of nine in Node 22:

| Organisation | From scratch | Prepare | Finish at `auto` | Finish with every zone open |
|---|---|---|---|---|
| M | 3.3 ms | 2.7 ms | 0.7 ms | 0.9 ms |
| L | 17.4 ms | 14.1 ms | 3.3 ms | 5.1 ms |
| XL | 171.8 ms | 141.6 ms | 15.5 ms | 25.5 ms |

## Tests

```sh
pnpm --filter @gcportrait/graph test                 # unit, property and demo tests (the M budget at 2 ×)
pnpm --filter @gcportrait/graph test -- --coverage   # with V8 coverage (thresholds 99/95/100/100)
FC_SEED=42 pnpm --filter @gcportrait/graph test -- --coverage   # the same random inputs on every run
pnpm --filter @gcportrait/graph test:budget          # the strict 150 ms budget alone, with the L figures
pnpm --filter @gcportrait/graph test test/views      # the scene composition table and properties
```

The property tests draw a fresh seed on every run except on CI, where they run under the fixed
`CI_PROPERTY_SEED` of `@gcportrait/model/testing`, and under `FC_SEED=<n>`, which replays the seed
fast-check prints with a failure (`test/fast-check-seed.ts`).

- `src/*.test.ts` — example tests on a small synthetic organisation (`src/testing/scenario.ts`: a Shared VPC
  host and service project, a local VPC, VMs with one subnet, only a network, two subnets, a host subnet, a
  service account, a connector, Cloud Run, an unmapped type) and on test containers whose rules disagree;
  unit tests of each step (canonical project matching, reverse relations and merged copies, reciprocal
  `connects`, the Shared VPC rule with and without a host, `nestsIn` nesting with its fallback kind).
- `src/build.property.test.ts` — fast-check over random organisations (some projects Shared VPC hosts) and
  random catalog rules (random roles and network zone kinds): the result is always `GraphBuildSchema`-valid
  (an acyclic, consistent forest; resolved edges vs. dangling; report agrees); idempotent and
  order-independent; every asset has exactly one parent except the organisation; never nested across projects,
  and a cross-project attachment is listed in a Shared VPC pair exactly when it goes into a subnet or into a
  host's network; weak edges yield exactly when a stronger edge points inside their target; rings of
  containers declaring each other are always broken and reported once; and random NIC topologies over two
  projects (the second a host or not) match an independent oracle for rules 1 and 2 and weak precedence; and a
  build with the builder's memo, after other days of the organisation, equals a build without one.
- `src/memo.test.ts` — the builder's memo reuses an unchanged asset object's work only, and starts afresh for
  another catalog object or project index.
- `src/names.property.test.ts` — fast-check over random boxes named with project ids or numbers and references
  spelling the project either way (or naming an unknown project): a reference resolves exactly, else with its
  project swapped once (recording the form), else dangles with the raw value; asset names are never rewritten;
  a reverse rule's edge runs from the target.
- `test/demo.test.ts` — the demo organisations S and M from `@gcportrait/demo-data` (a dev dependency; the
  generator's output equals the committed `S.ndjson`/`M.ndjson`). Shared VPC pairs (listed below, and compared
  with pairs read straight from the data), the external HTTPS load-balancer chains, the managed groups behind
  them, the internal load balancer, private services access, Cloud SQL on the host network, Kubernetes nesting
  and ownership, dangling references (outside the organisation only, except S's two demo-data gaps: Artifact
  Registry repositories and GKE nodes it does not generate), no cycles, virtual regions, and the history diff.
  Where a correct catalog entry may add something (Shared VPC pairs, references outside the organisation,
  external stubs in the views), the tests check lower bounds.
- `test/performance.test.ts` — the budget below; under `test:budget` also L and the builder's memo on a day of
  the L history (for information).
- `src/views/*.test.ts`, `test/views/*` and `scripts/render-scene.test.ts` — the views (see
  [The composition table](#the-composition-table)) and the `render-scene` command.

**Shared VPC pairs found in the demo.** S: `demo-gke-1`, `demo-svc-1`, `demo-web-1` → `demo-net-1`. M: the
twelve service projects the demo README counts — `demo-gke-1..3`, `demo-web-1..3`, `demo-svc-1`, `demo-svc-3`,
`demo-svc-5` → `demo-net-1` (prod) and `demo-svc-2`, `demo-svc-4`, `demo-svc-6` → `demo-net-2` (nonprod). With
the real catalog M finds 16 pairs: those twelve and `demo-mgmt-1`, `demo-data-1`, `demo-vm-1` and `demo-ml-1`
→ `demo-net-1`, whose catalog generator cases attach to the prod host's subnets; both host projects are marked
Shared VPC hosts by their Compute settings.

Every graph test runs on the real compiled catalog; there are no test-only stand-in rules. A test that needs
types the catalog lacks adds product entries with `catalogWith` (`src/testing/fixtures.ts`), which validates
only those and takes the compiled catalog as it is, without parsing it again: its types and lenses are one
frozen copy shared by every catalog built on it, so that no test can change the next one's catalog
(`src/testing/fixtures.test.ts` holds the result to `CatalogSchema`).

## Performance

`test/performance.test.ts` builds the M organisation ten times after two warm-up builds and checks the median.
**Two limits, as in `@gcportrait/ingest` and `@gcportrait/layout`**: `pnpm test` (and the blocking CI `unit`
job) runs it in parallel with every other test file and asserts a regression ceiling of 2 × 150 ms, as every
budget does there (AGENTS.md, "Quality gates, testing and CI"); `pnpm --filter @gcportrait/graph test:budget`
(`GCPORTRAIT_GRAPH_BUDGET=strict`) runs this file alone and asserts the 150 ms budget itself. Both measure by
the rule of `@gcportrait/model/testing` that every package timing its work applies: a batch whose median is
over the limit is measured again after a 250 ms pause, at most five batches and only while another fits in
95 % of the test's timeout, and the best batch's median counts (`measureBatches`); a batch that would run past
that 95 % stops there and counts as a miss (`measureRuns`), so that a build on a machine getting busier
reports its figures instead of timing out. Under a local `pnpm test` a median still over the ceiling while the
machine's one-minute load average is above 1.5 per core is skipped, with the load and the figures as the
reason and a `skipped:` line on standard error (`skipIfOverloaded`); on CI (`CI` set) the ceiling is the check
that blocks, so it never skips, and neither does `test:budget`. L (generated in the test) is measured for
information, under `test:budget` only. Typical figures with the real catalog
(`pnpm --filter @gcportrait/graph test:budget`):

| Organisation | Assets | Median build | Notes |
|---|---|---|---|
| M | 952 | 21.6 ms (min 19.6, max 25.6) | budget 150 ms; 1 235 edges, 49 dangling, 16 Shared VPC pairs |
| L | 6 382 | 138 ms (min 134, max 144) | 9 489 edges, 472 dangling, 103 Shared VPC pairs |

Containment is resolved with memoised placement (each node is placed once; chains are walked only to check
cycles and innermost attachment targets), so the build grows roughly linearly with the number of assets.

**The builder's memo** (`BuildMemo`, `src/memo.ts`). Most of a build is per asset: its node (label, subtitle,
project, addresses, host names, visibility) and what its type's relation, `nestsIn` and `contains` rules
produce through the catalog's engine. That depends on the asset, its catalog entry and the snapshot's project
index only, so a memo passed as `options.memo` keeps it by asset object and reuses it in a later build whose
catalog is the same object and whose project index has the same content (another catalog or index starts it
afresh); the rest of the build (resolution, containment, edges, records, indexes) runs in full. The app's data
worker builds every Graph with one memo, and the days of a history share their unchanged asset objects
(`frontend/src/diagram/pipeline/historyRead.ts`), so a timeline step evaluates the rules only for the assets
the day changed. `test/performance.test.ts` builds a day of the L history after the next day as that step
does: about 53 ms with the memo against about 119 ms without (median of five). A property test
(`src/build.property.test.ts`) checks that a build with a memo that saw other days of the organisation (assets
kept, changed, removed, projects given another id) is deep-equal to a build without one; `src/memo.test.ts`
checks that only an unchanged asset object's work is reused.
