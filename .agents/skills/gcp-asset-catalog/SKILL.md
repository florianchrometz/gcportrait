---
name: gcp-asset-catalog
description: How gcportrait's asset catalog works and how to extend it — entry schema, tiers, relation kinds, normalisers, label/console templates, fixtures, the coverage tool and the official-list drift workflow. Includes the official Cloud Asset Inventory type list snapshot and a per-product relation seed.
---
<!-- SPDX-License-Identifier: MIT -->

# gcportrait asset catalog

The rules this handbook applies are in [agents.md](../../../agents.md) ("Data and graph semantics" and
"Quality gates, testing and CI"); this file is the procedure for extending the catalog.

Load this before adding or changing an asset type, a relation rule, a lens, an icon mapping or a console URL,
and before running or fixing `pnpm catalog:check`. The catalog is *data*; code reads it.

References in this directory:
- `references/cai-supported-asset-types.<YYYY-MM-DD>.txt` — every identifier on Google's supported-types page
  at that date (one per line), with a `.products.json` companion that names each type's product section and
  links its API reference. `pnpm catalog:fetch-official` (`scripts/catalog-fetch-official.mjs`) writes the next
  dated pair into this directory; the compiler checks against the newest one, and the weekly
  `catalog-drift.yml` workflow compares it with a fresh fetch, so keep that name and place.
- `references/catalog-seed.md` — per-product relation hints (fields to read, targets, normalisers) for the
  Tier 0/1 types. It was the starting point of every catalog group; verify every path against a fixture. Its
  Compute Engine sections (networking fabric, hybrid connectivity, load balancing, compute) are how the
  compute types are split between groups, except Cross-Site Interconnect (CrossSiteNetwork, WireGroup), which
  the hybrid-connectivity group's `owns` lists; the group files' `owns` are what counts.

## 1. Structure

`packages/catalog` (its README is the reference, the group layout included):

```
packages/catalog/
  products/<service>.yaml           a product file, e.g. bigquery.googleapis.com.yaml
  products/<service>.<group>.yaml   a service several groups share: one file per group (merged by `service`),
                                    e.g. compute.googleapis.com.networking-fabric.yaml
  lenses/<lens>.yaml                type lists + relation kinds per lens
  fixtures/<service>/<Type>.json    realistic CAI assets of one type (synthetic names), used by rule tests
  known-unmapped/<group>.yaml       per authoring group: `owns` (its official types) and `types` (not mapped yet, with a reason)
  icon-keys.json                    the icon keys in use, each resolved by packages/icons (a key not listed warns; --strict-icons fails)
  src/engine/                       the rule engine (JSONPath, predicates, templates, normalisers)
  src/compiler/                     YAML → catalog.json, validated with @gcportrait/model; groups, scoped reports, traces
  src/generated/compiled-catalog.ts the compiled catalog: git-ignored, written by `pnpm catalog:build`
  tooling/                          build.ts, check.ts, coverage.ts (`pnpm catalog:build|check|coverage`), file loading
scripts/catalog-fetch-official.mjs  official list → dated snapshot (`pnpm catalog:fetch-official`)
```

The groups are the twelve product groups (`networking-fabric`, `hybrid-connectivity`, `load-balancing-edge`,
`dns-domains`, `compute`, `containers-serverless`, `data-stores`, `data-processing-messaging`, `ai`,
`security-identity`, `developer-tooling-delivery`, `operations-platform`), plus `hierarchy` and
`policy-and-runtime`. Each file of the catalog belongs to one group, so parallel authors never edit the same
file: a shared service (Compute Engine, Network Security, IAP) has no plain `products/<service>.yaml`, only
`products/<service>.<group>.yaml` files, `<group>` being the group's name (`networking-fabric`,
`hybrid-connectivity`, `load-balancing-edge`, `compute`, `security-identity`; `…<group>-<more>.yaml` for a
second file). A file whose suffix names a group is that
group's file, whatever its service, and holds only that group's types. Problems are blamed on the file that
has to change: a type mapped in another group's file fails that file, while the owner's line stays until the
owner maps it. The catalog README's "Authoring a group" lists the files.

## 2. Entry schema (per type)

```yaml
product: Cloud Run                    # official product name as on the supported-types page
service: run.googleapis.com
icon: cloud_run                       # product icon key (packages/icons); category fallback is automatic
types:
  run.googleapis.com/Service:
    role: core                        # container | core | leaf | hidden
    label: "{{data.name | lastSegment}}"
    subtitle: "{{location}}"
    icon: cloud_run                   # optional override
    console: "https://console.cloud.google.com/run/detail/{{location}}/{{data.name | lastSegment}}?project={{projectId}}"
    ips: []                           # JSONPaths yielding IPv4/IPv6/CIDR strings
    domains: [ "$.data.urls[*]" ]     # JSONPaths yielding hostnames/URLs (host is extracted)
    relations:
      - { kind: runsAs,   to: "$.data.template.serviceAccount",            normalize: serviceAccountEmail }
      - { kind: attaches, to: "$.data.template.vpcAccess.connector",        normalize: name }
      - { kind: attaches, to: "$.data.template.vpcAccess.networkInterfaces[*].subnetwork", normalize: computeRelative }
      - { kind: uses,     to: "$.data.template.volumes[*].cloudSqlInstance.instances[*]", normalize: cloudSqlConnectionName }
      - { kind: uses,     to: "$.data.template.volumes[*].secret.secret",   normalize: name }
      - { kind: uses,     to: "$.data.template.containers[*].image",        normalize: artifactImage }
      - { kind: encryptedBy, to: "$.data.template.encryptionKey",           normalize: kmsKey }
    contains: []                      # for containers: JSONPaths or `byParent: <child type>` entries
    hiddenWhen: null                  # JSONPath predicate; matching assets start hidden
    notes: "v2 API shape; v1 Knative shape is handled by the same rules via alias paths"
```

More optional fields: `zoneKind` (containers: `vpc | subnet | region | product | group`, how the scene draws
the zone; `product` by default; the VPC network and subnetwork are `vpc` and `subnet`), `aliases` (JSONPaths
whose values are other keys of the asset, e.g. `[ "$.data.email" ]` on `iam.googleapis.com/ServiceAccount`; the
graph's alias index maps each value's `aliasKey` to the asset, which is what `serviceAccountEmail` targets), and
`nestsIn` (one rule or a list, `{ to, normalize, …, kind? }`, the container the asset nests in, such
as a VM's managed instance group; `kind` is drawn instead when it cannot nest there). A relation rule
may say `reverse: true` to draw the edge from the target to the asset (a replica's `masterInstanceName` draws
primary `replicates` replica).

Template filters: `lastSegment`, `projectFromName`, `regionFromName`, `short(n)`, `lower`,
`parentSegment(<collection>)` (the segment after `<collection>/` in the value: `{{name | parentSegment(clusters)}}`
names a Kubernetes namespace's cluster, `parentSegment(lakes)` a Dataplex zone's lake), `first(<variables>)`
(the first present of the listed variables when the value is missing), and `plural(<word>)` /
`plural(<word>, <words>)` (a count with its noun: `{{data.size | plural(instance)}}` → `1 instance`,
`4 instances`; use it wherever a subtitle counts). Console URLs are built in one place, `consoleUrlFor` of the
engine (the app's card action, menu and drawer all use it); a type without a `console` template gets its
project's console home in the app, and `catalog:check` counts such types. Labels and subtitles drop a ` · `
segment whose expressions are all missing, unit words included. Available
variables: `name`, `assetType`, `location`, `projectId`, `projectNumber`, `data.*` (with `.key` and `[n]`
steps). The entry, lens and compiled-catalog schemas live in `@gcportrait/model` (`CatalogEntrySchema`,
`LensSchema`, `CatalogSchema`); the template grammar is enforced there (`TEMPLATE_VARIABLES`,
`TEMPLATE_FILTERS`), so a new variable or filter is a change to `packages/model` as well.

## 3. Roles (tiers) — decision guide

| Role | Pick when | Effect |
|---|---|---|
| `container` | other assets nest inside it (VPC, subnet, cluster, dataset, keyring) | drawn as a zone; may have `contains` |
| `core` | the asset references other assets or is referenced by them (instance, forwarding rule, bucket) | card with edges |
| `leaf` | worth seeing but no cross-references beyond its parent (health check, SSL policy, dashboard) | card, no edges |
| `hidden` | high cardinality or operational record (builds, job runs, versions, record sets, reports, settings singletons) | imported, not drawn by default; counted in the parent's badge; `includeTypes` reveals |

Rule of thumb: if an org of 50 projects would produce more than ~20 of these per project and a reader would not
put them on a whiteboard, it is `hidden`.

A type the catalog does not map still renders: a generic card nested by `parent`, with the product or category
icon and no edges (gcp-diagram-layout skill §2, rule 6). `pnpm catalog:check` reports every official type that
is neither mapped nor listed with a reason, so unknown types are visible, never silently dropped.

## 4. Relation kinds

Thirteen kinds (`RELATION_KINDS` in `@gcportrait/model`). Each has a meaning, a direction and a default
visibility; its line style is the gcp-diagram-style skill's §5, and `docs/lenses-and-filters.md` §3 explains the
kinds to users. A lens draws the kinds its `relationKinds` lists; "general lenses" below means every lens that is
not about identities or security.

| Kind | Meaning | Direction | Drawn |
|---|---|---|---|
| `contains` | hierarchy and containment (org › folder › project › VPC › subnet; cluster › namespace › workload; dataset › table) | parent → child | always, as nesting, never as an arrow |
| `attaches` | a resource sits on a network or subnet (an instance's NIC, a Cloud SQL private IP, a connector, a PSA range) | resource → network or subnet | as nesting when unambiguous (layout skill §2, rule 1), else a thin arrow; general lenses |
| `routes` | a traffic path (forwarding rule → proxy → URL map → backend service → NEG or instance group → instances or services) | upstream → downstream | general lenses |
| `uses` | any other reference (an instance's disk or image, a function's topic, a sink's bucket) | user → used | general lenses |
| `peers` | a symmetric peering (VPC peering, VMware Engine network peering) | both ways | general lenses |
| `connects` | hybrid connectivity (VPN tunnels and gateways, interconnect attachments and routers, NCC spokes and hubs) | end → end | general lenses |
| `memberOf` | group membership (an instance in its instance group via `created-by`; a cluster in its fleet) | member → group | general lenses |
| `runsAs` | the identity a workload runs as (a service account) | workload → identity | not by default: the Identity and Everything lenses only |
| `encryptedBy` | a customer-managed key (any `kmsKeyName`) | resource → key | not by default: the Security and Everything lenses only |
| `secures` | a policy or perimeter applies to its targets (a service perimeter to projects, a firewall policy to a network or folder, a Cloud Armor policy to backends) | policy → target | as an overlay on the target, in the lenses that list it |
| `triggers` | eventing (Eventarc, Pub/Sub push → service, function or workflow) | source → target | general lenses |
| `replicates` | replicas and cross-region copies (a Cloud SQL replica, an AlloyDB secondary) | primary → replica | general lenses |
| `shares` | Shared VPC: a service project uses a host project's network (derived from cross-project `attaches` on evidence, agents.md, "Data and graph semantics") | service project → host project | general lenses; derived by the graph builder, never written in YAML |

Choose the most specific kind; `uses` is the fallback. A rule whose data sits on the other side writes
`reverse: true`. `weak: true` makes an edge yield to a stronger one from the same asset (NIC network
vs. subnet).

## 5. Normalisers (turn a field value into a full resource name)

| Name | Input example | Output |
|---|---|---|
| `name` | `projects/p/locations/l/connectors/c` or already full | `//<service>/projects/p/...` using the rule's target service when the input is relative |
| `computeSelfLink` | `https://www.googleapis.com/compute/v1/projects/p/global/networks/n` | `//compute.googleapis.com/projects/p/global/networks/n` |
| `computeRelative` | `projects/p/regions/r/subnetworks/s` | `//compute.googleapis.com/projects/p/regions/r/subnetworks/s` |
| `serviceAccountEmail` | `sa@p.iam.gserviceaccount.com` | an alias (`aliasKey` of the email), matched against assets whose type lists the path in `aliases` (`iam.googleapis.com/ServiceAccount`: `$.data.email`) |
| `gcsUri` | `gs://bucket/path` or `bucket` | `//storage.googleapis.com/bucket` |
| `bigqueryUri` | `bigquery.googleapis.com/projects/p/datasets/d` or `projects/p/datasets/d/tables/t` | `//bigquery.googleapis.com/projects/p/datasets/d[/tables/t]` |
| `pubsubUri` | `pubsub.googleapis.com/projects/p/topics/t` or `projects/p/topics/t` | `//pubsub.googleapis.com/projects/p/topics/t` |
| `kmsKey` | `projects/p/locations/l/keyRings/k/cryptoKeys/c[/cryptoKeyVersions/1]` | key level by default (`versionLevel: true` keeps the version) |
| `cloudSqlConnectionName` | `p:region:instance` | `//cloudsql.googleapis.com/projects/p/instances/instance` (CAI names `sqladmin.googleapis.com/Instance` assets in the `cloudsql` family) |
| `artifactImage` | `region-docker.pkg.dev/p/repo/image:tag` | `//artifactregistry.googleapis.com/projects/p/locations/region/repositories/repo` (repository level) |
| `projectNumberOrId` | `123456`, `projects/123456`, `my-project` | `//cloudresourcemanager.googleapis.com/projects/<number>` via the snapshot's project index |
| `k8sOwner` | `ownerReferences[*]` object | the owner's full k8s asset name within the same cluster/namespace |
| `logSinkDestination` | `storage.googleapis.com/b`, `bigquery.googleapis.com/projects/p/datasets/d`, `pubsub.googleapis.com/projects/p/topics/t`, `logging.googleapis.com/projects/p/locations/l/buckets/b` | the corresponding full name |
| `siblingName` | a bare id (`staging`), a path, or an object (`{ service, region }`), with the rule's `pattern` (`{parent}/targets/{id}`, `projects/{project}/locations/{region}/services/{.service}`) | the pattern filled from the reference, then from the asset, in the rule's `service` (catalog README: "siblingName resolution") |
| `k8sRef` | a bare name with the rule's `k8sKind` (`Node`), or `{ name, kind?, group?/apiGroup?/apiVersion?, namespace? }` | the object in the asset's cluster and namespace (catalog README: "k8sRef resolution") |

Values that resolve to no asset are *dangling* (kept in the drawer, counted, not drawn). Project numbers vs.
ids: Compute uses ids in self-links, most v2 APIs use numbers in `name`; the snapshot's project index maps
both ways, and the graph matches a name with its project segment swapped when the written form names no asset.
Never hard-code either.

## 6. Adding a type (20 minutes)

1. Confirm the identifier exists in the latest official snapshot (`references/…txt`; the `.products.json`
   companion links its API reference). If it is new, run `pnpm catalog:fetch-official` and commit the new
   dated pair.
2. Find the group that owns it: the `known-unmapped/<group>.yaml` whose `owns` matches it (exact type, or
   `<service>/*`). Work only in that group's files. A type another group owns does not go into your files,
   even when your relations point at it: mapped in a file named after your group it fails your check
   (`product-file-group`, "remove it from this file"). If your group should own it, say so in your report.
3. Pick the role (§3). If `container`, decide what nests in it (`contains`) and its `zoneKind` if it is not a
   plain product container.
4. Find the resource's JSON shape in its API reference; the fixture must follow it.
5. Write the entry in `products/<service>.yaml`, or, when your group shares the service with another group, in
   your own `products/<service>.<group>.yaml` (create it with `product`/`service`/`icon`; files of one service
   merge, the same product name keeps the icon of its first file, e.g. `compute_engine` for Compute Engine, a
   type may appear in one file only). A file whose suffix names a group belongs to that group, whatever its
   service.
6. Add `fixtures/<service>/<Type>.json`: a realistic asset (synthetic names, `example.com`, project numbers
   below 100000000000, `demo-…` project ids, IPs from 10.0.0.0/8, 172.16.0.0/12 or 203.0.113.0/24) that
   exercises **every** relation, `nestsIn`, `ips`, `domains`, `contains` and `aliases` path at least once,
   and, when the type has a `hiddenWhen`, one asset it matches and one it does not (`hidden-unproven`). The
   graph's demo and view tests run on the real catalog: a rule that adds an edge or zone kind to a lens's view
   of the demo can change a pinned composition row there, which the change then updates with its reason.
7. Delete the type's line under `types` in the group file (`owns` stays). A new icon key goes into
   `icon-keys.json`, and its artwork into `packages/icons/mapping.json`, in the same change (a key missing from
   `icon-keys.json` is a warning, a failure with `--strict-icons`; the icons package's tests fail on a key that
   does not resolve); never modify Google artwork.
8. `pnpm catalog:check --group <group>` → `OK for group <group>` (`--verbose` shows rule → fixture value →
   normalised name for every rule; notes are other groups' problems and do not fail it);
   `pnpm --filter @gcportrait/catalog test` → green, except that its one whole-catalog test ("compiles without a
   single violation") fails while another group is mid-edit and names that group. Both build the compiled
   catalog first (a type with a violation of its own is left out of it); it is git-ignored, never commit it.
9. If the type is Tier 0/1 and common, the demo should show it. While several groups work at once, do not edit
   `packages/demo-data` (its generator files are shared by every group); name the type and the fields a
   generator case needs in your report, and add the case in a change of its own.
10. PR with label `catalog`; the description lists the type, the role, and the relations with their targets.

## 7. Adding a lens

`lenses/<lens>.yaml`: `title`, `description`, `types` (identifiers, `service/*` globs, or `*` for every
type), `relationKinds`, `showHidden: false`, `defaultDetail` (the deepest level `auto` opens the lens at, its
ceiling: choose the level the lens reads well at, not the deepest it can draw). The compiled catalog must
contain all 11 lens ids of `LensId` (`@gcportrait/model`), so every lens file has to exist before
`catalog.json` validates. Add a table-driven test case in `packages/graph` for the lens combined with every
focus view and the standard filter set (filters compose with focus views and drill-in;
agents.md, Product rules).

## 8. Coverage and drift

- Coverage stays at or above 95 % of the official list, and no rule exists without a fixture that proves it.
- `pnpm catalog:check` reports: total official types, mapped by role, unmapped (each listed with a reason in
  the group file that owns it), catalog types missing from the official list (deprecated → remove or keep with
  `deprecated: <date>`), unused and pending icon keys, rules without fixtures, fixtures without rules, and one
  line per group. `--group <group>` / `--file <path>` list only the problems blamed on those files (the right
  signal while other groups are mid-edit; every problem is blamed on the file that has to change, so problems
  blamed on another group's file that name yours are notes and do not fail it), `--json` prints everything as
  JSON, `--verbose` adds rule traces, `--strict-icons` fails on pending icon keys. `pnpm catalog:build` writes
  the compiled catalog without the types whose description (the owner's, for a type described twice) has a
  violation of its own and names them.
- `pnpm catalog:coverage [--group <group>] [--json]`: per group, the official types it owns, mapped by role,
  unmapped by reason, and missing (neither mapped nor listed).
- `catalog-drift.yml` (weekly) runs `pnpm catalog:fetch-official` and opens or updates one issue listing
  additions and removals; a new type goes into the owning group's `owns` and `types`, or straight into the
  catalog.
- Icon maintenance: the Google Cloud product icons are Google Cloud's, provided at
  <https://cloud.google.com/icons> (which still offers the older symbols, the legacy console icons, for the
  products not updated yet) and used as provided under the terms stated there; gcportrait does not license
  them. `pnpm --filter @gcportrait/icons drift` compares the archives that page links with what
  `packages/icons` vendored (`archive-index.json`, `mapping.json`) and reports new icons (with the catalog
  product each probably shows), changed, renamed and removed ones, mapped entries gone upstream, and products
  still on an older symbol although a newer icon exists; `icon-drift.yml` (weekly, Thursdays) opens or
  updates one issue with that report. A new product mark goes into `packages/icons/mapping.json` as the key's
  `core` candidate ahead of its `legacy` one (or into `keepOlderSymbol` with a reason), then `pnpm --filter
  @gcportrait/icons vendor --verify-render`, `... build` and `... contact-sheet`; never edit the artwork
  (`packages/icons/README.md`, "Keeping the icons current"). A new catalog icon key still needs its
  `mapping.json` entry and `icon-keys.json` line first.
- The website's coverage page is generated from the compiled catalog.

## 9. Pitfalls

- Compute `Address`, `BackendService`, `Disk`, `ForwardingRule`: the list/export APIs return only the regional
  (or zonal) variant under the plain type; global ones come as `GlobalAddress`, `GlobalForwardingRule`,
  `RegionDisk` is separate. Write rules for all variants.
- k8s objects (`k8s.io/*`, `apps.k8s.io/*`, …) exist only for GKE clusters with the inventory enabled; their
  `name` embeds the cluster path (`.../clusters/C/k8s/namespaces/N/...`): containment comes from the name, not
  from `parent`.
- Some products' change history is incomplete or synchronised every ~7 hours (Cloud SQL, Secret Manager,
  Dataflow, Logging, Vertex AI, Workflows, …); IAM data can be stale by days. Do not promise minute accuracy.
- `location` can be empty (API keys, App Engine); templates must tolerate missing variables.
- `compute.googleapis.com/Project` is the Compute *metadata* object (Shared VPC host flag
  `xpnProjectStatus: HOST`), not the Resource Manager project; both exist.
- Keep rules additive; removing a relation kind from a type is a breaking change for saved views.
