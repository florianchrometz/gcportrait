<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/catalog

The asset catalog: what gcportrait knows about each Cloud Asset Inventory asset type, kept as data
(AGENTS.md, Data and graph semantics; the entry schema and the roles in skill gcp-asset-catalog §2–§3), plus
the one rule engine that reads it. The graph builder (`@gcportrait/graph`) evaluates relations, labels,
addresses, aliases and default visibility through this package, so rule semantics live here only. The skill
[gcp-asset-catalog](../../.agents/skills/gcp-asset-catalog/SKILL.md) is the contributor guide; this file
describes the package. How several groups author it at once is "Authoring a group" below.

```ts
import { buildProjectIndex } from '@gcportrait/model';
import { catalog, evaluateRelations, renderLabel } from '@gcportrait/catalog';

const ctx = { projects: buildProjectIndex(snapshot.assets) };
const type = catalog.types[asset.assetType]; // undefined for a type the catalog does not map yet
const label = renderLabel(asset, type, ctx); // never empty, also for unknown types
const relations = evaluateRelations(asset, type, ctx); // EvaluatedRelation[] (@gcportrait/model)
```

## Layout

```
products/<service>.yaml           a product file: product name, icon, and types (CatalogEntrySchema)
products/<service>.<group>.yaml   a service several groups share: one file per group, named after it (below)
lenses/<lens id>.yaml             the 11 lenses (LensSchema; docs/lenses-and-filters.md)
fixtures/<service>/<Type>.json    synthetic assets of that type: one Asset, or an array of Assets
known-unmapped/<group>.yaml       one per authoring group: the official types it owns, and those not mapped yet
icon-keys.json                    the icon keys the catalog declares (packages/icons resolves every key)
src/                              the runtime library (browser-, worker- and Node-safe; no Node types)
  index.ts                        the only public surface
  catalog.ts                      `catalog`: the compiled catalog as it is, not parsed again on import (below)
  generated/compiled-catalog.ts   the compiled catalog, typed `Catalog`: a build artefact, git-ignored (below)
  engine/                         the rule engine: JSONPath subset, predicates, templates, normalisers
  compiler/                       the compiler, groups, scoped reports, rule traces (pure; tooling feeds it files)
tooling/                          Node command-line tools and the tests that read the data files
  build.ts, check.ts, coverage.ts `pnpm catalog:build`, `pnpm catalog:check`, `pnpm catalog:coverage`
  files.ts, generate.ts           file loading (YAML with line numbers), the official snapshot, the outputs
```

The official asset-type list is not in this package: the dated snapshots live with the skill, under
`.agents/skills/gcp-asset-catalog/references/` (each `.txt` list with its `.products.json` companion, which
names every type's product section and API reference), and `scripts/catalog-fetch-official.mjs` (`pnpm
catalog:fetch-official`) writes them. The compiler always checks against the newest snapshot there.

Two TypeScript projects keep the runtime honest: `tsconfig.lib.json` checks `src/` without Node's types, so
the engine cannot reach for Node APIs by accident; `tsconfig.tooling.json` checks `tooling/` with them.

## Commands

| Goal | Command |
|---|---|
| Validate everything and print the coverage report, per group too (exit 1 on any violation) | `pnpm catalog:check` |
| The same report as JSON (`-s` keeps pnpm's own lines off stdout) | `pnpm -s catalog:check --json` |
| Only one group's problems: its group file, product files and fixtures (repeatable) | `pnpm catalog:check --group compute` |
| Only one file's problems (an existing file, catalog- or repository-relative, repeatable, combines with `--group`) | `pnpm catalog:check --file products/k8s.io.yaml` |
| Every rule's fixture resolution, rule → fixture value → normalised name (and every warning) | `pnpm catalog:check --group compute --verbose` |
| Fail on icon keys missing from `icon-keys.json` | `pnpm catalog:check --strict-icons` |
| Per-group coverage: owned official types, mapped by role, unmapped by reason, missing | `pnpm catalog:coverage` (`--group <group>`, `--json`; or `pnpm --filter @gcportrait/catalog coverage`) |
| Compile: write `src/generated/compiled-catalog.ts` and `dist/catalog.json` (both git-ignored) | `pnpm catalog:build` (`--strict`: write nothing while any violation exists) |
| Fetch the official list into a new dated snapshot and print the drift | `pnpm catalog:fetch-official` |
| Tests, lint, types (each builds the catalog first) | `pnpm --filter @gcportrait/catalog test` (also `lint`, `typecheck`) |

The rule engine's property tests (`src/engine/rules.property.test.ts`, fast-check) run under the seed rule of
`@gcportrait/model/testing` (`src/testing/fast-check-seed.ts`): a fresh seed on every local run, the fixed
`CI_PROPERTY_SEED` on CI, and `FC_SEED=<n>` replays the seed fast-check prints with a failure.

**The compiled catalog is a build artefact.** The package is consumed from source (`exports` points at
`src/index.ts`) by Vite, Vitest, tsc and ESLint, so `src/generated/compiled-catalog.ts` must exist before any
of them runs, but it is never committed: every catalog change would regenerate that one file, and groups
authoring in parallel would all conflict on it. It is written by `pnpm catalog:build`, which runs on its own:

- in `pnpm install` (the root `prepare` script), so a fresh clone and every CI job have it;
- before `lint`, `typecheck` and `test`, at the root and in this package and `@gcportrait/graph` (`pre…`
  scripts, with `--quiet`), so a test run never sees a stale catalog;
- and from `pnpm build` (this package's `build` script).

The build writes the catalog even while some file has violations, but leaves out every type whose description
has a violation of its own (a malformed path, an unproven rule, a missing fixture, a type in another group's
file, …) along with entries and files that do not validate, and names the left-out types on stderr. A type
described twice compiles from its owner's file, so a broken copy in another group's file never takes the
owner's entry out. So the compiled catalog only ever holds types that pass the check: one group's
half-finished YAML never stops another group's typecheck, and never reaches the graph builder (whose demo
and view tests run on the compiled catalog alone). `pnpm catalog:check` is the check that counts.
The build fails only when no catalog can be assembled at all (a lens file missing or invalid). A file under
`src/generated/` that git tracks is a `generated-committed` violation. When you run Vitest directly (an
editor, `vitest watch`), run `pnpm catalog:build` after editing YAML; a unit test says "stale" otherwise.

The module holds the catalog as one constant typed `Catalog`, written only once the whole compiled catalog
has passed `CatalogSchema`, so `catalog` is that constant as it is: nothing parses it again on import, where
the app's data worker, every render job and every test file that loads the catalog would pay for a parse of
the whole catalog that returns a deep-equal copy. tsc holds the constant to the type, and
`tooling/catalog.test.ts` holds the module to a fresh compile and the exported `catalog` to the schema.

## Authoring a group

The official types are mapped group by group, by as many authors at once as there are groups. Every file
belongs to one group, so no two authors edit the same file.

**Your group file.** `known-unmapped/<group>.yaml` is yours: `networking-fabric`, `hybrid-connectivity`,
`load-balancing-edge`, `dns-domains`, `compute`, `containers-serverless`, `data-stores`,
`data-processing-messaging`, `ai`, `security-identity`, `developer-tooling-delivery`, `operations-platform`,
plus `hierarchy` (the Resource Manager types) and `policy-and-runtime` (IAM-policy-only
types that are no RESOURCE content and stay unmapped). It has three keys:

```yaml
title: Compute
owns: # the official types the group owns, mapped or not: exact types, or <service>/* for a whole service
  - compute.googleapis.com/Instance # services shared by several groups are listed type by type
  - 'batch.googleapis.com/*'
types: # the owned types not mapped yet, each with its reason
  compute.googleapis.com/Instance: pending (compute)
```

The most specific `owns` pattern wins (an exact type over `<service>/*`), and two groups owning one type
equally is an error. `owns` never changes while you map; `types` shrinks.

**Your product files.** Write each type into `products/<service>.yaml`. A service that several groups share
has no such plain file: each group writes into `products/<service>.<group>.yaml`, `<group>` being the group
file's stem, or `products/<service>.<group>-<more>.yaml` for a second file
(`product-file-group` otherwise). A file whose suffix names a group in this way is that group's file, whatever
its service, and holds that group's types only. The shared services and their files:

| Service | Files |
|---|---|
| `compute.googleapis.com` (split by the catalog seed's sections; Cross-Site Interconnect goes with hybrid connectivity) | `.networking-fabric.yaml` (holds the network and subnetwork), `.hybrid-connectivity.yaml`, `.load-balancing-edge.yaml`, `.compute.yaml` |
| `networksecurity.googleapis.com` (split by product) | `.networking-fabric.yaml`, `.load-balancing-edge.yaml` |
| `iap.googleapis.com` | `.security-identity.yaml` (the policy-only IAP types stay unmapped in `policy-and-runtime`) |

So no two groups ever create the same file, also in one shared working tree. Files of one service merge by
their `service` field: their types join, entries with the same `product` name become one compiled product,
different product names stay separate products of the service. Files of one product must agree on its `icon`;
the first file sets it (the plain `<service>.yaml`, else the first group's file in group file order, e.g.
Compute Engine's `compute_engine` in the compute file), and a later file that differs is the one blamed
(`product-mismatch`): use the same product icon and override single types with their own `icon`. A product
file holds the types of one group only, and a type described in two files is an error naming both
(`duplicate-type`), blamed on the file that is not its owner's. A type another group owns in a file named
after your group is `product-file-group` on that type ("… is owned by networking-fabric, but this file
is load-balancing-edge's: remove … from this file"); the owner's line under `types` stays until the
owner maps the type in its own file. If you think your group should own a type, say so in your report: never
edit another group's group file. (A file whose name names no group and mixes several groups' types is
`group-mixed-file`.)

**The loop, per type:**

1. Write the entry (skill §6) and its fixture `fixtures/<service>/<Type>.json`.
2. Delete the type's line under `types` in your group file (it is then owned and mapped).
3. `pnpm catalog:check --group <group>`: the problems blamed on your files only, so other groups'
   half-finished files do not get in the way; `--verbose` prints what every rule read from your fixtures and
   what it resolved to. It ends with `catalog:check: OK for group <group>.` when your files are clean.
4. `pnpm --filter @gcportrait/catalog test`, and `pnpm catalog:coverage --group <group>` for your numbers.

**Working next to other groups.** Your scoped check is the one that counts for your work. Every problem is
blamed on the file that has to change, so its *notes* are problems blamed on another group's file that name
one of yours (that group copied or mapped one of your types, or gave a shared product another icon): they do
not fail your check, and that group fixes them. A file of yours that does not even parse yet still counts as
yours (by its name, or by the type keys in its text), never as another group's. In the catalog package's tests
only one test reads the whole catalog as one check, "compiles without a single violation": while any group is
mid-edit in a shared working tree it fails and lists the violations by group, so you can see whether they are
yours. Every other test there is an invariant that holds whatever a group maps correctly, and the command-line
tests run on a synthetic catalog of their own. The same holds for `pnpm catalog:check` without `--group`. The
graph tests (`pnpm --filter @gcportrait/graph test`) see a type only once its entry is clean. They use no
test-only stand-in rules, so the demo tests (Shared VPC pairs, the load-balancer chain, private services
access, Kubernetes ownership, dangling references) and the view tests (every lens, focus and filter on the
demo organisations) check the real entries. They check lower bounds wherever a correct rule may add something
(more Shared VPC pairs, another external stub, a reference to a public image outside the organisation); the
named composition rows pin exact edge and zone kinds per lens, so a rule that adds a new kind to a lens's view
changes a row there, deliberately and with its reason. If one fails because of a correct rule of yours, report
it rather than editing `packages/graph`.

New icon keys need no edit of the shared `icon-keys.json`: a key it does not list is a *pending* key, reported
as a warning (and listed in the report; `--strict-icons` makes it fail). `packages/icons` must resolve every
key a product file uses: its tests fail otherwise (`mapping.json` there). Never edit another group's group
file, product files or fixtures, the lenses, the tests, `packages/demo-data` or the compiler; if one of them
is wrong, say so in your report (a demo-data generator case for a common Tier 0/1 type, too). Before the
hand-in, `pnpm catalog:check` without `--group` must be clean too, unless what fails belongs to a group still
at work.

## The entry schema

Each product file is a `CatalogEntrySchema` from `@gcportrait/model` (strict: a misspelt key is an error):
`product` (the official product section name on the supported-types page), `service`, `icon`, and `types`
keyed by asset type, each a `CatalogTypeEntrySchema` with `role` (`container | core | leaf | hidden`),
`label`, `subtitle`, `icon`, `console`, `ips`, `domains`, `relations`, `contains`, `nestsIn`, `zoneKind`,
`aliases`, `hiddenWhen`, `notes` and `deprecated`. A relation rule is
`{ kind, to, normalize, weak?, reverse?, versionLevel?, service?, pattern?, k8sKind? }`; `service` names the
service of the target for the `name` and `siblingName` normalisers, which otherwise use the asset's own
service; `pattern` is `siblingName`'s (required there), `k8sKind` is `k8sRef`'s, `versionLevel` is `kmsKey`'s.

- `reverse: true`: the edge is drawn from the referenced node to the asset (a Cloud SQL replica's
  `masterInstanceName` draws primary `replicates` replica; a backend service's `securityPolicy` draws the
  policy `secures` the backend). A dangling reverse reference stays with the asset that holds it. With `weak`,
  the edge is a fallback the target's own rule usually draws (the copies merge, strong wins).
- `nestsIn`: one rule or a list, `{ to, normalize, service?, pattern?, k8sKind?, kind? }`,
  naming the container the asset nests in (an instance's managed group, a disk's storage pool). The graph
  builder tries it right after the containers' own claims and before the attachment heuristics; it nests the
  asset in the first target that is a `container` node of the same project without closing a cycle, and
  draws the rule's `kind` (when given) to every target it did not nest in, also as a dangling reference.

- `zoneKind` (containers only): how the scene draws the zone, `vpc | subnet | region | product | group`
  (default `product`). The VPC network and subnetwork are `vpc` and `subnet`; the graph builder reads this
  instead of knowing those types.
- `aliases`: JSONPaths whose values are alternative keys for the asset (an IAM service account's
  `$.data.email`). The graph builder indexes each value by the model's `aliasKey` (trimmed, lower-cased),
  which is also how normalisers such as `serviceAccountEmail` write alias targets, so such a relation resolves
  to the asset. Each path must yield a key on some fixture.

### JSONPath (`to`, `ips`, `domains`, `contains`, `aliases`)

A subset implemented in `src/engine/jsonpath.ts` rather than taken from a library, so that every path is
validated at compile time and evaluation never runs script: `$` then any of `.name`, `.*`, `[*]`, `[n]`
(negative counts from the end), `['any key']`, unions `['a','b']` and `[0,1]`, and filters `[?(…)]` whose body
is a predicate (below) with `@` for the current item, e.g.
`$.data.metadata.items[?(@.key=='created-by')].value`. Recursive descent (`..`), slices and script expressions
are rejected. A path selects values in document order; a missing member selects nothing, `null` is a value.
Paths are not flattened: use `[*]` to step into a list.

### Predicates (`hiddenWhen`, filters)

`path` alone (some value is truthy), `path exists | missing`, `path == | != | < | <= | > | >= value`,
`path in [v, …]`, `path not in [v, …]`, `path startsWith | endsWith | contains 'text'`, combined with `!`,
`&&` (binds tighter), `||` and parentheses. Values are `'…'` or `"…"` strings, numbers, `true`, `false`,
`null`. A path may select several values, so `==`, `in` and the string tests hold when *some* value matches,
while `!=` and `not in` need at least one value and *no* match: a missing field never satisfies them
(`$.data.lifecycleState not in ['ACTIVE']` does not hide a project whose state is unknown). Numbers compare
with numeric strings by value.

### Templates (`label`, `subtitle`, `console`)

`{{variable | filter | …}}` in literal text. Variables: `name`, `assetType`, `location`, `projectId`,
`projectNumber` (from the asset's project and the project index), `data.*` with `.key` and `[n]` steps.
Filters: `lastSegment` (trailing slashes ignored), `projectFromName`, `regionFromName` (also turns a zone into
its region, by `regionOfZone` of `@gcportrait/model`), `short(n)` (counts user-perceived characters, ends with
`…`), `lower`, `parentSegment(<collection>)`, the segment after the first `<collection>/` in the value, so a
nested resource can name its parents (`{{name | parentSegment(clusters)}}` is a Kubernetes namespace's
cluster), and `first(<variable>, …)`: when the value is missing, the first of the listed variables that has
one (`{{data.gke.cluster | first(data.anthosCluster.membership, data.run.location) | lastSegment}}`), filters
after it applying to the chosen value, and `plural(<word>)` or `plural(<word>, <words>)`: the count with its
noun, `{{data.size | plural(instance)}}` → `1 instance`, `4 instances` (a value of exactly 1 takes the
singular; the plural is `<word>s` unless given; a missing count stays missing, so its segment is dropped). A
subtitle that counts uses it: the `… instances`, `… nodes`, `… replicas`, `… slots`, `… shards`, `… bytes`,
`… days`, `… cores`, `… backups`, `… workers` and `… VMs` subtitles of 21 types do (ranges such as
`2–5 replicas` keep the plural). A missing variable renders as nothing. Labels and subtitles render by
` · `-separated segment: a segment whose expressions are all missing is dropped with its literal text
(`{{data.sizeGb}} GB · {{location}}` renders `europe-west3` when the size is missing), and a label that
renders empty falls back to `data.displayName`, the last segment of `data.name`, then the last segment of the
asset name (also the label of a type the catalog does not know). A console URL with any missing variable is
dropped rather than linked broken; its values are percent-encoded (`/` kept).

**Console links.** `consoleUrlFor(asset, catalog, ctx?)` (`src/engine/console.ts`) is the one place a
Cloud Console URL is built: the type's `console` template rendered for the asset, or `undefined` when the type
has no entry or no template or a variable the template needs is missing. `consoleLinkFor` adds the fallback
the app offers for those: `{ kind: 'project', url, projectId }` with `projectConsoleUrl(projectId)` (the
project's console home), or nothing for an asset outside any project. The app's data worker calls it for every
asset-backed node it draws; the selected card's "Open in Cloud Console ↗" action, the card's menu and the
details drawer all show its result. `typesWithoutConsole(catalog)` lists the types still without a
template. `tooling/console.test.ts` checks 15 types' links against their fixtures (a Kubernetes namespace's
cluster through `parentSegment(clusters)`), the encoding and the fallback; `ConsoleLink` is declared here once
and the app imports it. Kubernetes `PersistentVolume`, `PersistentVolumeClaim` and `StorageClass` link the GKE
object pages, like the other Kubernetes types. App Hub `Service`, `Workload` and `ServiceProjectAttachment`
and the Hub `Membership` have no template: their only pages are list pages (the App Hub applications page, the
Kubernetes clusters page), so they fall back to their project (`docs/catalog-followups.md` §1.4).

**Counting subtitles.** A count before a noun goes through `plural(word)` ("1 shard", "3 shards");
`tooling/plurals.test.ts` fails on a label or subtitle that writes a value straight before a plural noun
(ranges such as `{{min}}–{{max}} replicas` and units such as `GB` aside).

### Normalisers

Each turns one value into a `RelationTarget` (`@gcportrait/model`): a full resource name, an alias the graph
builder looks up (service-account emails), or nothing (then the value is kept as a dangling reference). All of
them trim, ignore trailing slashes and decode a value that is a wholly URL-encoded full name
(`%2F%2F…`); encoded segments inside a name stay verbatim.

| Normaliser | Accepts | Yields |
|---|---|---|
| `name` | full names; `https://<x>.googleapis.com/<version>/<path>`; `<x>.googleapis.com/<path>`; relative names | the full name; relative names get the rule's `service` (default: the asset's) |
| `computeSelfLink`, `computeRelative` | self-links (`v1`, `beta`, `alpha`, with or without scheme), Compute full names, `projects/…`, and `global/…`, `regions/…`, `zones/…` (in the asset's project) | `//compute.googleapis.com/projects/<id>/…`; a project number becomes its id through the index |
| `serviceAccountEmail` | `sa@…`, `serviceAccount:sa@…`, `…/serviceAccounts/sa@…`; `default` (the project's Compute default account) | alias: the email's `aliasKey` (lower case); a full name with a numeric id is kept as a name |
| `gcsUri` | `gs://b/…`, `b`, `projects/_/buckets/b/…`, storage URLs | `//storage.googleapis.com/b` |
| `bigqueryUri` | resource paths, `bq://p.d[.t]`, `p.d[.t]`, `p:d[.t]`, domain-scoped projects, `{ projectId?, datasetId, tableId? }` | `//bigquery.googleapis.com/projects/p/datasets/d[/tables/t]` |
| `pubsubUri` | topics, subscriptions, schemas, snapshots, with or without the service | `//pubsub.googleapis.com/projects/p/…` |
| `kmsKey` | key or key-version paths, full names, `//cloudkms.googleapis.com/v1/…` | the key; the version with `versionLevel: true` |
| `cloudSqlConnectionName` | `p:region:i`, `p:i`, domain-scoped projects, `projects/p/instances/i`, `cloudsql` or `sqladmin` full names | `//cloudsql.googleapis.com/projects/p/instances/i`, the name CAI gives `sqladmin.googleapis.com/Instance` assets |
| `artifactImage` | `<loc>-<format>.pkg.dev/<p>/<repo>/…` (tags, digests), `[us.\|eu.\|asia.]gcr.io/<p>/…` | the Artifact Registry repository; other registries yield nothing |
| `projectNumberOrId` | numbers (also as JSON numbers), ids, `projects/…`, Resource Manager full names | `//cloudresourcemanager.googleapis.com/projects/<number>`; an id the index does not know stays an id |
| `k8sOwner` | an `ownerReferences[*]` object `{ apiVersion, kind, name }` | the owner in the same cluster (and namespace unless cluster-scoped): `…/k8s/namespaces/n/<group>/<plural>/<name>`; a group Kubernetes does not serve itself is `apis/<group>` (Gateway API) |
| `logSinkDestination` | `storage…/b`, `bigquery…/projects/p/datasets/d`, `pubsub…/projects/p/topics/t`, `logging…/<parent>/locations/l/buckets/b`, `logging…/projects/p` | the bucket, dataset, topic, log bucket or project |
| `siblingName` | a bare id (`staging`), a path (`projects/…/instanceGroupManagers/m`, full names and self-links too), or an object (`{ service, region }`, `{ name, projectId }`) | the rule's `pattern` filled in, in the rule's `service`: placeholders `{id}`, `{parent}`, `{project}`, `{projectId}`, `{projectNumber}`, `{location}`, `{region}`, `{zone}`, `{.key}` (below) |
| `k8sRef` | a bare name of the rule's `k8sKind`, or `{ name, kind?, group? \| apiGroup? \| apiVersion?, namespace? }` | the object in the asset's cluster, in its namespace unless named or cluster-scoped, group as for `k8sOwner` |

**`siblingName` resolution.** Each placeholder takes its value from the reference first, then from the asset
that holds it: `{id}` is a bare value, a path's last segment or an object's `name`; `{parent}` is a path
value's segments above its last `<collection>/<id>` pair, else the asset's own (so `{parent}/targets/{id}` on
a Cloud Deploy pipeline is a target beside it); `{project}` is an object's `project` or `projectId`, else the
path's `projects/<p>`, else the asset name's project segment, else its project's id (or number);
`{projectId}` and `{projectNumber}` translate that through the project index; `{location}` is an object's
`location`, `region` or `zone`, else the path's `locations|regions|zones/<l>`, else the asset's location;
`{region}` is that location with a zone turned into its region, `{zone}` a zone only (`regionOfZone` and
`isZone` of `@gcportrait/model`, so `us-central1-ai1a` is a zone of `us-central1`); `{.key}` is the object's
string property. A placeholder without a value yields no name, and the value dangles as read. Which spelling
of the project a pattern writes does not matter: the graph matches either (packages/graph/README.md).

**`k8sRef` resolution.** The kind is the object's `kind`, else the rule's `k8sKind`; the group is the object's
`group` or `apiGroup` (`''` is the core group), else its `apiVersion`'s group, else the rule's group when the
kinds agree, else the core group; the namespace is the object's `namespace`, else the asset's own; nodes,
persistent volumes, cluster roles and the other cluster-scoped kinds have none. The name is
`…/k8s[/namespaces/<ns>][/<group> | /apis/<group>]/<plural>/<name>`.

### Containment

`contains` lists a container's children: a JSONPath into its own data (values normalised like `name` in the
container's service, e.g. a network's `$.data.subnetworks[*]`), or `{ byParent: <type> }`, which nests every
asset of that type whose `parent` is the container or whose name continues the container's name
(`…/instances/i` → `…/instances/i/databases/d`); the graph builder picks the innermost match. The child's side
is `nestsIn` (above): a VM names its managed group, a volume its pool. Most nesting
needs no rule: assets nest in their project by `parent`, and in a subnetwork or network through their own
`attaches` relations (skill gcp-diagram-layout §2, rule 1).

### Fixtures and the project index

A fixture is a synthetic asset in the `Asset` shape of `@gcportrait/model` (name, assetType, parent,
ancestors, location, updateTime, data), or an array of them when one shape cannot show every rule (an older
API version, say). The compiler builds one project index (`buildProjectIndex` of `@gcportrait/model`) from all
fixtures' Resource Manager projects (`fixtures/cloudresourcemanager.googleapis.com/Project.json` lists
demo-net-1 … demo-old-1), so fixtures may refer to projects by id or number as the real APIs do. Fixtures pass
the one "synthetic only" guard of `@gcportrait/model/testing` (`findNonSyntheticData`: `example.com`-style
domains and platform hosts, the demo organisations 30000000001 to 30000000004, project and folder numbers
below 100000000000, `demo-…` project ids in self-links and `projectId`, addresses from 10.0.0.0/8,
172.16.0.0/12, 203.0.113.0/24 and the other private and documentation ranges), which the compiler runs on each
file's text and reports with its line.

## What `pnpm catalog:check` enforces

Coverage report (skill §8): the official total, mapped types by role, unmapped types (each must be listed in
the group file that owns it), catalog types missing from the official list (deprecated or not), unused and
pending icon keys, rules without fixtures, fixtures without rules, "types without a console template: N (list
in --verbose)" (`typesWithoutConsole` in the JSON report; never a violation: the app falls back to the
project's console home), and one line per group. Every violation
fails the check; warnings do not:

| Code | Meaning |
|---|---|
| `load`, `schema`, `file-name` | unreadable or invalid YAML/JSON, a schema error (with its line), a file in the wrong place or misnamed (`products/<service>[.<suffix>].yaml`, `known-unmapped/<group>.yaml`) |
| `syntax` | a malformed JSONPath, predicate or template |
| `duplicate-type` | a type described in two product files (both named); blamed on the one that is not its owner's file, whose entry stays |
| `product-mismatch` | two files of one product (same service and name) with different product icons; blamed on the later file |
| `not-official`, `deprecated-but-official` | a type missing from the newest official list without `deprecated: <date>`, or marked deprecated while still listed |
| `unmapped` | an official type neither mapped nor listed in the group file that owns it (or owned by no group) |
| `known-unmapped-but-mapped`, `known-unmapped-not-official` | a stale group-file line: the type is mapped in one of its owner's files now (both files named), or no longer official |
| `known-unmapped-duplicate`, `known-unmapped-wrong-group` | a type listed by two groups, or listed by a group that does not own it |
| `group-owns`, `group-overlap`, `group-mixed-file` | an `owns` pattern that matches nothing; two groups owning a type equally; a product file whose name names no group with types of several groups |
| `product-file-group` | a product file of a service several groups share that is not named `products/<service>.<group>[-<more>].yaml` after the group whose types it holds; or, in a file named after a group, a type another group owns (blamed on that type in that file, the owner's group file named: a note for the owner) |
| `unknown-icon` | **a warning:** an icon key `icon-keys.json` does not list yet (a violation with `--strict-icons`) |
| `unused-icon` | a listed icon key nothing uses |
| `rule-without-fixture`, `rule-unproven` | a type with rules but no fixture; a relation or `nestsIn` rule that yields no well-formed full resource name (or, for `serviceAccountEmail`, alias) on any fixture, or an `ips`, `domains`, `contains` or `aliases` path that yields no valid address, host, child name or key |
| `template-unproven` | a label, subtitle or console template with a variable missing on every fixture |
| `hidden-unproven` | a `hiddenWhen` predicate that no fixture matches, or that every fixture matches (both outcomes need a fixture) |
| `fixture-invalid`, `fixture-without-rules`, `fixture-not-synthetic` | a fixture that is no valid Asset of its type, that has no catalog entry, or that holds real-looking data |
| `container-child` | a `byParent` child that is not an asset type, two types containing each other, or fixtures that do not nest |
| `lens-missing`, `lens-pattern` | one of the 11 lens files missing; a lens type pattern that matches nothing |
| `product-name` | a product name that is not the official product section of any of its types |
| `generated-committed` | a file under `src/generated/` is tracked by git (it is a build artefact) |

With `--group` or `--file` the whole catalog is still compiled (rules prove themselves against fixtures of
other types, and duplicates only show across files), but only the problems blamed on the selected files are
listed and decide the exit code; problems blamed elsewhere that name a selected file are listed as notes, and
the rest are counted. A group's files are its group file, its fixtures (by type), and its product files: the
files named after the group, other product files holding its types, and product files without types of one of
its services. A product file belongs to the group its name names, else to the owner of the types it describes
(for a file that does not parse, the type keys found in its text), else to every group of its service.

## Adding a type

The skill's §6 is the full recipe, and "Authoring a group" above the loop. In short: check the
identifier in the newest snapshot (its `.products.json` companion links the type's API reference); write the
entry in your group's product file; add `fixtures/<service>/<Type>.json` exercising every rule; delete the
type's line under `types` in `known-unmapped/<group>.yaml`; run `pnpm catalog:check --group <group>` and the
tests; commit the YAML and the fixture (the compiled catalog is not committed).

## Coverage and drift

`pnpm catalog:fetch-official` downloads the official page, writes
`cai-supported-asset-types.<UTC date>.txt` (sorted identifiers after a `#` header) and
`cai-supported-asset-types.<UTC date>.products.json` (product sections with each type's API reference link),
and prints the identifiers added and removed since the newest earlier snapshot; a snapshot of the same date is
compared as it was, then replaced. It requests the English original (`hl=en`) and refuses anything else: the
site sometimes redirects to a machine-translated copy whose list is months behind. `--from <saved.html>`
parses a saved page; the weekly `catalog-drift.yml` workflow runs the script and opens an issue when the list
changed. Commit a new snapshot together with the catalog changes it requires: the compiler then checks against
it, and every new type must be mapped, or owned and listed by a group file (`owns` plus a `types` line).

### Coverage

Against the official list of 2026-10-09 (641 types): **632 mapped (98.6 %)**, of which 69 containers, 258
core, 71 leaf and 234 hidden by default; **9 unmapped**, each listed with its reason in the group file that
owns it: the 7 IAP types of `policy-and-runtime` (IAM policy content only, no RESOURCE data, outside v1
ingestion) and the 2 BeyondCorp client-connector types of `security-identity` (`ClientConnectorService`,
`ClientGateway`: shut down on 2023-12-31, the API reference documents no fields any more). 156 products in 159
product files; 1 387 rules (relation, address, domain, containment and alias paths), every one proven by a
fixture; 632 fixture files, one per mapped type; 11 lenses; 134 icon keys, none pending; 0 violations.
Coverage stays at or above 95 % of the official list, with no rule without a fixture (skill gcp-asset-catalog
§8).

| Group | Official | Mapped | Container | Core | Leaf | Hidden | Unmapped | Product files |
|---|---|---|---|---|---|---|---|---|
| `hierarchy` | 7 | 7 | 3 | 0 | 0 | 4 | 0 | 1 |
| `networking-fabric` | 31 | 31 | 2 | 18 | 1 | 10 | 0 | 5 |
| `hybrid-connectivity` | 18 | 18 | 2 | 13 | 0 | 3 | 0 | 4 |
| `load-balancing-edge` | 54 | 54 | 5 | 36 | 11 | 2 | 0 | 8 |
| `dns-domains` | 5 | 5 | 2 | 1 | 0 | 2 | 0 | 1 |
| `compute` | 45 | 45 | 7 | 19 | 5 | 14 | 0 | 8 |
| `containers-serverless` | 85 | 85 | 11 | 38 | 7 | 29 | 0 | 23 |
| `data-stores` | 58 | 58 | 9 | 23 | 7 | 19 | 0 | 19 |
| `data-processing-messaging` | 58 | 58 | 5 | 25 | 12 | 16 | 0 | 17 |
| `ai` | 53 | 53 | 4 | 17 | 3 | 29 | 0 | 10 |
| `security-identity` | 84 | 82 | 5 | 30 | 9 | 38 | 2 | 27 |
| `developer-tooling-delivery` | 43 | 43 | 4 | 9 | 4 | 26 | 0 | 9 |
| `operations-platform` | 93 | 93 | 10 | 29 | 12 | 42 | 0 | 27 |
| `policy-and-runtime` | 7 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| **Total** | **641** | **632** | **69** | **258** | **71** | **234** | **9** | **159** |

`pnpm catalog:coverage` (per group) and `pnpm catalog:check` (overall) print these numbers for the tree as it
is; update the table when they change.

## Shared product files

Compute Engine's types are split by the sections of the catalog seed (the skill's
`references/catalog-seed.md`): networking fabric (`compute.googleapis.com.networking-fabric.yaml`, with the
VPC network and subnetwork), hybrid connectivity (Cross-Site Interconnect's CrossSiteNetwork and WireGroup
included), load balancing and compute. The seven IAM-policy-only IAP types belong to `policy-and-runtime` and
stay unmapped. Console URL templates are best-effort links to the matching Cloud Console page; correct one
when a page moves.

## Conventions

What public documentation does not settle, and what needs a change outside the catalog's data files (project
id versus number in names, template filters, demo-data cases), is the open work in
[docs/catalog-followups.md](../../docs/catalog-followups.md).

### Relation conventions

- Relation kinds and directions are the same across groups: every notification topic a resource publishes to
  is `triggers`.
- One edge per link, not one from each side: a cluster's fleet membership, an Eventarc trigger's function.
- A Private Service Connect interface NIC `connects`, so it never reads as Shared VPC.

### Lens conventions

- Each lens file's header says what the lens takes and why.
- A lens lists types, not "everything of a service", where a service mixes architecture with records:
  `compute.googleapis.com`, `networksecurity.googleapis.com`, `networkservices.googleapis.com`, BigQuery and
  Bigtable are listed type by type in the overview. Lenses cannot exclude types, so a glob is only used where
  every type of the service belongs (hidden types of a glob only add to the "N hidden" badges).
- `runsAs` is drawn by the identity lens only and `encryptedBy` by the security lens only (skill
  gcp-asset-catalog §4), so those lenses list every visible type that has such a rule. When a type gains a
  `runsAs` or `encryptedBy` rule, add it to the identity or security lens in the same change.
- A lens lists the targets its relation kinds need: a `uses` edge whose target type is not in the lens is not
  drawn there.
