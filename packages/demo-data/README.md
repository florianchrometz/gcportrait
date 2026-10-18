<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/demo-data

Deterministic synthetic Google Cloud organisations for gcportrait's demo mode, tests, screenshots and website
(demo mode is first-class: AGENTS.md, Product rules). Four sizes, each with a 35-day history, emitted either
as Cloud Asset Inventory records (the shape `assets.list` and `exportAssets` produce) or as the normalised
`Asset` / `Snapshot` of `@gcportrait/model`. Everything is synthetic: `example.com` / `example.org` names,
project numbers below 100000000000, one organisation per size (`30000000001` to `30000000004`), and addresses
from private and documentation ranges, checked by the "synthetic only" guard of `@gcportrait/model/testing`
that every package runs over its fixtures.

The generator is a pure core: no I/O, no clock, no `Math.random`. A seed and a `today` date fully determine
the output, byte for byte. The only Node code is the `generate` command in `scripts/`.

```ts
import {
  generateOrganization,
  historyFor,
  snapshotAt,
  toCaiNdjson,
  toSnapshot,
} from '@gcportrait/demo-data';
import { assertSyntheticOnly } from '@gcportrait/model/testing';

const org = generateOrganization({ size: 'M' }); // today's state (DEMO_TODAY unless `today` is given)
const ndjson = toCaiNdjson(org.assets); // one assets.list record per line
const snapshot = toSnapshot(org); // a valid @gcportrait/model Snapshot

const history = historyFor('M', 1, '2026-10-08'); // 35 ticks of mutations
const threeWeeksAgo = toSnapshot(snapshotAt(history, '2026-09-17'));

assertSyntheticOnly(myFixtureText, {}, 'my-fixture.json'); // throws when something looks real
```

## Sizes

Real counts with the default seed (`1`) and `today = 2026-10-08`, pinned in `fixtures/stats.json` and checked
by the tests. History columns count the mutations of all 35 ticks.

| Size | Assets | Asset types | Adds | Removes | Changes |
|---|---|---|---|---|---|
| S | 96 | 59 | 27 | 31 | 33 |
| M | 952 | 208 | 144 | 155 | 140 |
| L | 6382 | 219 | 1254 | 1274 | 1067 |
| XL | 51242 | 219 | 9304 | 9407 | 6632 |

The size targets are ≈80 / ≈600 / ≈6 000 / ≈50 000. S is a little larger than 80 on purpose: it is the
smallest organisation that still contains one of everything listed under "What is modelled", so the demo's
first screen and the fastest tests exercise every topology feature and every scripted history event. M is
the reference fixture for layout and visual tests. M and larger also carry the generator cases of every
catalog group ("Catalog generator cases" below): every Tier-0 container type of the catalog seed and the
prominent Tier-1 types, each with the references its catalog rules read. One of each, with what it
depends on (projects, subnets, service accounts, buckets, topics, keys), costs about 350 assets, which is
why M is above its target of ≈600; L stays near 6 000 because the cases run once per environment or once per
organisation, and L's pods and storefront VMs were trimmed to make room. L and XL are generated on demand
(XL in about two seconds) and not committed.

| Size | Business units | Environments (one Shared VPC host each) | Workload projects per unit | First unit also runs | Generator cases |
|---|---|---|---|---|---|
| S | 1 | prod | web, GKE, serverless, data | | none |
| M | 3 | prod, nonprod | prod: web, GKE, serverless, data; nonprod: serverless | prod: VM, ML | standard |
| L | 10 | prod, staging, dev | prod: web, GKE, serverless, data, VM; staging: web, GKE, serverless; dev: web, serverless, VM | prod: ML | standard and `large` |
| XL | 30 | prod, staging, dev | prod: web, GKE, serverless, data, VM; staging: web, GKE, serverless, data; dev: GKE, serverless, VM | prod: ML | standard and `large` |

The per-project intensities (instances, node pools, namespaces, replicas, tables, …) and the generator cases
(`features`, listed in `src/topology/features.ts`) are in `src/topology/profiles.ts`; that file is the only
place where sizes differ.

## What is modelled

Every organisation has the same skeleton:

- **Hierarchy.** Organisation › `Platform` (with `Networking`, `Security`, `Operations` sub-folders from M up)
  and `Workloads` › business unit › environment: three folder levels. Projects are
  `demo-<role>-<n>` (`demo-net-1`, `demo-web-3`, …) with numbers `1000000000x`, folders `2000000000x`.
- **Shared VPC.** One host project per environment (`compute.googleapis.com/Project` with
  `xpnProjectStatus: HOST`) and a custom-mode VPC with global routing. Every web, GKE and VM service project
  gets its own subnet in the host; their VMs, node pools, clusters and load balancers attach to it across
  projects. Cloud SQL attaches through private services access on the host network.
- **Networking fabric.** Firewall rules (internal, health checks, by-service-account targets, GKE's own
  rules, a disabled egress lock-down from M up), the default internet route and a static route whose next hop
  is an internal load balancer, Cloud Routers with Cloud NAT (one static NAT address in production),
  private DNS zones (plus a forwarding zone and the public `example.org.` zone with records from M up).
- **Hybrid connectivity.** HA VPN (gateway, external gateway, two tunnels) and a Dedicated Interconnect with
  one VLAN attachment, both with BGP sessions on a Cloud Router.
- **Peered VPCs.** A standalone partner project with its own VPC; the history peers it with the production
  Shared VPC (both networks list the peering afterwards). The private services access peering is there from
  the start.
- **Load balancing.** Per web project: a global external Application Load Balancer — global address →
  forwarding rule → target HTTPS proxy (managed certificate, SSL policy from M) → URL map → backend services
  with Cloud Armor → the managed instance group (whose VMs carry `created-by` and `instance-template`
  metadata) and a serverless NEG for a Cloud Run API, plus a backend bucket and an HTTP-to-HTTPS redirect
  from M. An internal passthrough load balancer fronts a second managed group. The GKE ingress gets the load
  balancer GKE's ingress controller creates (`k8s2-…` names, zonal `GCE_VM_IP_PORT` NEGs) from M.
- **GKE.** A private regional cluster per GKE project with secondary ranges on its host subnet, node pools
  (from M with the managed instance groups, templates and VMs GKE creates, and matching Kubernetes `Node`
  objects), a fleet membership, namespaces, deployments, replica sets, pods (with owner references, node
  names and pod IPs from the node's pod range), services and an ingress; from M also `default` and
  `kube-system` with kube-dns and a per-node logging DaemonSet.
- **Serverless.** Cloud Run services using the host's Serverless VPC Access connector, Cloud SQL for
  PostgreSQL on its private services access address, Pub/Sub topics, and Cloud Run functions with their
  Eventarc trigger, push subscription and underlying Cloud Run service; from M also Direct VPC egress, Secret
  Manager secrets mounted as environment variables, and archive subscriptions with a dead-letter topic.
- **Data.** A CMEK data-lake bucket, BigQuery datasets with partitioned tables and external tables reading
  Parquet files from the lake bucket; from M also export buckets and a view.
- **Security.** Cloud KMS key rings per region with keys for Compute, Cloud Storage, Cloud SQL, GKE and
  Pub/Sub (one shared key in S) used by disks, buckets, datasets, tables, SQL, cluster secrets and topics;
  service accounts used by VMs, templates, node pools, Cloud Run, functions, triggers, push subscriptions and
  firewall rules; an access policy with a VPC Service Controls perimeter around the first serverless and the
  first data project.
- **Edge cases.** One empty project (`demo-sandbox-1`), one project with only hidden-tier assets
  (`demo-ops-1`: Cloud Build builds and enabled-service records; from M up only the enabled services, the
  builds run in `demo-mgmt-1`), and one project deleted during the history (`demo-reports-1`, left in
  `DELETE_REQUESTED`).

### Catalog generator cases (M and larger)

There is a generator case for the Tier 0/1 types each catalog group maps, so the demo draws them with their
relations resolved. The cases are switched on per size (`features` in `profiles.ts`); each runs once per
organisation, once per environment or in production projects only, which keeps L near its target. Every
reference they write resolves to an asset of the organisation (the graph package's demo test fails on a
reference into the organisation that dangles); what stays dangling points outside it (public images, Google
tenant projects, Google-managed service agents).

| Feature | What it adds |
|---|---|
| `registries` | An Artifact Registry repository for every image path the assets name (`apps` per workload project, `gcf-artifacts` per functions project, `images` for the builds, `models` for Vertex AI), CMEK in production. One pass at the end reads the image paths (`registries.ts`), validating each complete host location with `@gcportrait/model`'s `isRegion`: ordinary and sovereign regions are preserved; other locations are ignored. |
| `management` | `demo-mgmt-1` "Platform management": a Cloud Build private pool peered with the production Shared VPC and a runner VM, a GitHub Enterprise connection with repositories, triggers and their secrets, the builds, a Cloud Deploy pipeline (Cloud Run staging, GKE production) with a release and rollout, an Infra Manager deployment; the central log bucket with its linked dataset, the organisation's audit sink, a sink per host, the project's `_Default` and `_Required` sinks and buckets; alert policies with Pub/Sub and e-mail channels, an uptime check per production storefront, an asset feed; a Backup and DR vault with plans, associations and data sources; the App Hub `storefront` application; the billing account. |
| `fabric` | Per host: subnet routes (hidden), a network firewall policy, a Cloud DNS server and response policy (with rules), Private Service Connect for Google APIs, a subnet for PSC endpoints, an internal range. Production: the hierarchical firewall policy with Cloud NGFW Enterprise (security profile, group, firewall endpoint, association), Cloud IDS, a network appliance with static routes (one over the HA VPN), a policy-based route, a network attachment, the PSC NAT subnet, a DNS peering zone into the partner VPC, Service Directory with its DNS zone, and the `example.org` Cloud Domains registration. |
| `ncc` | A Network Connectivity Center hub with a VPC spoke per host network, a VPN and an Interconnect spoke, its group and route table, and learned routes (hidden). |
| `edge` | Certificate Manager behind the first storefront's proxy, Cloud Armor edge policies for the static buckets and a hierarchical policy on the Workloads folder, Cloud CDN and IAP on backend services, reserved VIPs of the internal load balancers, a PSC service attachment consumed from the partner VPC, Apigee X, and API Gateway in front of a Cloud Run API. |
| `compute` | A custom image family (current and deprecated), a canary instance template, and in production VM projects a snapshot schedule with manual and scheduled snapshots (hidden), a stopped VM, a reservation under a commitment, and Google Cloud VMware Engine (network, private cloud, cluster, policy, peering with the Shared VPC). |
| `kubernetes` | Kubernetes service accounts bound to a Google service account (Workload Identity; M also lists every namespace's `default` account, which starts hidden), a StatefulSet with its claim, volume, CMEK storage class and disk, a CronJob with its Job, an HPA, CMEK node boot disks, and in production cluster-scope Cloud DNS zones and Backup for GKE plans. |
| `serverless` | The functions' source buckets (hidden), a Cloud Run job with its executions, a Cloud Tasks queue, the revisions behind a project's services, Cloud Run v2 volumes and CMEK, a workflow started by Eventarc, and a function triggered by new objects in a bucket. |
| `data` | Memorystore for Redis and for Valkey (over PSC), Filestore, Firestore, a Cloud SQL read replica, PSC and backups, a Pub/Sub schema; and the data platform of the first data project per environment: Dataproc (with its VMs) on Dataproc Metastore, Composer (with its GKE cluster and bucket), a streaming Dataflow job and a BigQuery subscription on the orders topic, Dataplex lake › zone › asset, Dataform, Managed Kafka, a Batch job, AlloyDB, Spanner, Bigtable, a BigQuery routine, model, table snapshot, linked dataset and reservation. The `ml` archetype (first unit, production) adds Vertex AI (Workbench, TPU, datasets, model, peered and PSC endpoints, deployment resource pool, index and index endpoint, an Agent Engine agent on the network attachment, Colab Enterprise runtimes), Vertex AI Search, Dialogflow CX and Document AI. |
| `security` | Signing keys, CA Service (root and subordinate CA), the Binary Authorization attestor and the GKE projects' policies, Security Command Center notifications and BigQuery export, workload identity federation for GitHub Actions, Sensitive Data Protection in the data platform, CMEK and event topics on secrets. |
| `large` | Classic VPN with its forwarding rules and route, Partner Interconnect, HA VPN between the production and the second host network, Secure Web Proxy (with its certificate) in every host, Datastream, Analytics Hub, a BigQuery Data Transfer, an AlloyDB secondary cluster, the production network inside the perimeter and a perimeter bridge. |

The registry pass scans image-like references in serialized asset data, not whole JSON string values.
Region validation applies to each extracted host token; JSON quotes, escapes, slashes and whitespace
separate tokens.

### Realism checklist (M, counted from the generated data)

`realismChecklist(assets)` computes this table from the assets, and a test fails when it no longer matches
the generated M organisation; regenerate it with
`pnpm --filter @gcportrait/demo-data generate --size M --format checklist`.

| Feature | Count |
|---|---|
| Folder levels below the organisation | 3 |
| Folders | 14 |
| Projects (active) | 24 |
| Projects being deleted (DELETE_REQUESTED) | 1 |
| Shared VPC host projects | 2 |
| Service projects attached to a host (VMs, GKE, Cloud SQL) | 16 |
| Service projects with VMs on host subnets | 10 |
| VPC networks | 3 |
| Subnets | 22 |
| VPC peerings (network side, without private services access) | 2 |
| HA VPN gateways | 1 |
| VPN tunnels | 2 |
| Interconnect attachments | 1 |
| Cloud Routers | 5 |
| Cloud NAT gateways | 4 |
| Global external HTTPS forwarding rules | 6 |
| Internal passthrough load balancers | 3 |
| Backend services (global and regional) | 12 |
| Network endpoint groups | 9 |
| Managed instance groups | 12 |
| VMs created by a managed instance group (created-by) | 17 |
| VMs | 28 |
| Cloud Armor policies | 7 |
| GKE clusters | 4 |
| GKE node pools | 3 |
| Kubernetes namespaces | 12 |
| Kubernetes deployments | 15 |
| Kubernetes pods | 37 |
| Kubernetes services | 15 |
| Kubernetes ingresses | 3 |
| Cloud Run services | 22 |
| Serverless VPC Access connectors | 4 |
| Cloud SQL instances on private services access | 7 |
| Private services access connections | 2 |
| Pub/Sub topics | 24 |
| Pub/Sub subscriptions | 22 |
| Eventarc triggers | 8 |
| Cloud Run functions | 7 |
| BigQuery datasets | 9 |
| BigQuery tables | 25 |
| BigQuery external tables on a bucket | 3 |
| Cloud Storage buckets | 31 |
| Cloud KMS keys | 12 |
| Resources encrypted with a customer-managed key | 139 |
| Service accounts | 28 |
| Resources that name a service account | 147 |
| VPC Service Controls perimeters | 1 |
| Projects inside a perimeter | 2 |
| Empty active projects | 1 |
| Projects with only hidden-tier assets | 1 |
| Cloud DNS managed zones | 10 |
| Firewall rules | 21 |
| Routes | 27 |
| Reserved addresses | 11 |
| Tier-0 container types of the catalog seed present (of 19) | 19 |
| Asset types | 208 |
| Artifact Registry repositories | 21 |
| Subnet routes (start hidden) | 21 |
| Static routes to an appliance, a VPN tunnel or a load balancer | 3 |
| Firewall policies (hierarchical and network) | 3 |
| Cloud NGFW firewall endpoint associations | 1 |
| Private Service Connect endpoints for Google APIs | 2 |
| Private Service Connect service attachments | 1 |
| Network attachments | 1 |
| Network Connectivity Center spokes | 4 |
| Cloud DNS server and response policies | 4 |
| Certificate Manager certificate maps | 1 |
| Backend services behind IAP or Cloud CDN | 4 |
| Apigee organisations | 1 |
| Custom images (current and deprecated) | 2 |
| Snapshots | 3 |
| Stopped VMs | 1 |
| VMware Engine private clouds | 1 |
| Kubernetes service accounts bound to a Google service account | 6 |
| Kubernetes StatefulSets with persistent volume claims | 1 |
| Backup for GKE plans | 3 |
| Cloud Run jobs | 2 |
| Workflows | 1 |
| Memorystore instances (Redis and Valkey) | 2 |
| AlloyDB clusters | 1 |
| Spanner instances | 1 |
| Bigtable instances | 1 |
| Firestore databases | 2 |
| Filestore instances | 1 |
| Dataproc clusters | 1 |
| Composer environments | 1 |
| Dataflow jobs | 1 |
| Dataplex lakes | 1 |
| Vertex AI endpoints | 2 |
| Vertex AI Search engines | 2 |
| CA Service certificate authorities | 2 |
| Binary Authorization policies requiring an attestor | 3 |
| Cloud Build worker pools and triggers | 4 |
| Cloud Deploy targets | 2 |
| Log sinks | 5 |
| Alert policies and uptime checks | 5 |
| Backup plan associations | 2 |
| App Hub applications | 1 |

## History

`historyFor(size, seed, today)` returns the organisation at the first tick (`base`) and 35 ticks: `today` and
the 34 days before it, each at `00:00:00Z`, oldest first. A tick's mutations are what happened during the day
before it (their `updateTime` lies in that day, in working hours); the first tick has none.
`snapshotAt(history, tick)` applies them up to a tick (an index or a `YYYY-MM-DD` day) and checks each step:
an add never duplicates an asset, a remove or change never misses one. `generateOrganization` is
`snapshotAt(historyFor(…), 34)`.

| Mutation | Shape |
|---|---|
| `add` | `{ kind: 'add', asset }`: the asset as created |
| `remove` | `{ kind: 'remove', name, assetType }` |
| `change` | `{ kind: 'change', asset, fields }`: the new version (new `updateTime`) and the dotted data paths that changed |

`DemoHistory`, `HistoryTick` and `Mutation` are `@gcportrait/model`'s schemas (`DemoHistorySchema`, …),
re-exported here: a stored history is read through `DemoHistorySchema`, which names the place of a problem.

Four scripted events happen in every size, at fixed ticks:

| Tick (with today = 2026-10-08) | Event |
|---|---|
| 6 (2026-09-10) | **Key rotation**: a new `CryptoKeyVersion` is added and the key's `primary` and `nextRotationTime` change. |
| 13 (2026-09-17) | **Project deletion**: every asset of `demo-reports-1` is removed and the project changes to `DELETE_REQUESTED`. |
| 20 (2026-09-24) | **MIG scale-out**: the first web project's group grows; the manager's `targetSize`, the group's `size` and the autoscaler's `recommendedSize` change and new VMs (with disks and `created-by`) are added. |
| 27 (2026-10-01) | **Peering added**: the partner VPC and the production Shared VPC each gain a peering entry. |

Around them, a daily churn proportional to the size (`history` in `profiles.ts`; weekends are quieter): pod
restarts (an older pod incarnation is removed, a new one with a new name is added), growth (builds, tables,
export buckets and DNS records of today that were created inside the window and that nothing names: a
template that names one calls `OrgBuilder.referenced`, which keeps it out of the window), transients (test
VMs, scratch tables and buckets, debugging firewall rules and subscriptions that live one to six days),
retirements (such assets deleted during the window) and field changes (a disk resize, a new Cloud Run
revision, a firewall rule that gains a source range, a Cloud Armor rate-limit rule, a firewall policy that
gains a rule, a Memorystore or Spanner resize, a Composer upgrade, … — `src/history/mutators.ts`, one per
type). From M up the transients and retirements are also drawn from scheduled snapshots, Dataflow batch jobs,
Batch jobs and Cloud Run job executions. The draw is weighted by kind and M's daily rates are low, so the
default M history shows only some of them (Cloud Run executions and a Batch job); L shows all four.

## Output shapes

- `toCaiNdjson(assets)` writes one record per line in the `assets.list` shape: `name`, `assetType`,
  `resource.{version, discoveryDocumentUri, discoveryName, parent, data, location}`, `ancestors`,
  `updateTime`. `toCaiNdjson(assets, 'export')` writes the shape `exportAssets` puts in Cloud Storage, which
  uses snake_case envelope keys (`asset_type`, `update_time`, `discovery_document_uri`, `discovery_name`);
  `data` is identical. `@gcportrait/ingest` accepts both.
- `toSnapshot(org)` returns a Snapshot that passes `migrateSnapshot`: scope `organizations/<its size's
  number>`, source `{ kind: 'demo', detail: 'demo:<size> seed <seed>' }`, a ULID derived from size, seed and
  tick, and `stats.bytes` equal to the size of the equivalent NDJSON.
- Assets are sorted by name in every output.

### Fidelity notes

The data follows the public API shapes, including their quirks, so that the catalog rules meet the
real thing:

- Compute references are self-links (`https://www.googleapis.com/compute/v1/projects/<id>/…`) and use project
  ids; `created-by` and `instance-template` metadata use project **numbers**, as Compute writes them.
- Cloud Run, Secret Manager, Service Networking, GKE Hub, Cloud Build and Service Usage use project numbers
  in `data.name`; asset names keep the project id where CAI does (`//run.googleapis.com/projects/<id>/…`).
- Cloud SQL assets are named `//cloudsql.googleapis.com/projects/<id>/instances/<name>` while their type is
  `sqladmin.googleapis.com/Instance`.
- Kubernetes objects are named after their cluster (`…/clusters/<c>/k8s/namespaces/<ns>/pods/<pod>`), their
  `parent` is the cluster, their `location` the cluster's region.
- BigQuery tables, KMS keys and versions, secret versions and node pools have their container as `parent`;
  access levels and perimeters have the access policy, which has the organisation.
- Resource Manager objects come in the shapes Cloud Asset Inventory serves (and the catalog's rules read):
  the organisation and projects in the v1 shape (a project's `data.name` is its display name, `parent` is
  `{ type, id }`, `projectId` and `projectNumber` are both present), folders in the v2 shape
  (`parent: 'organizations/N'`, `displayName`); all three use `lifecycleState` and `location: global`.
- Assumed shapes, to verify when the catalog rules are written: the Service Networking connection's asset
  name, the Interconnect location URL, the discovery URIs of the self-hosted APIs.
- Google-owned public ranges (load-balancer health-check probers, IAP) would fail the synthetic-only guard,
  so the health-check firewall rule uses `203.0.113.224/27` instead. BGP sessions use `169.254.0.0/16`
  because Cloud Router requires link-local addresses there.
- Project ids and numbers follow what each API writes and what Cloud Asset Inventory names the asset with,
  so the catalog's rules resolve: Binary Authorization, Vertex AI, Discovery Engine, Document AI, Cloud
  Tasks, Firestore, BigQuery reservations, NCC, logging buckets and monitoring use numbers in the asset
  name; the references to them use the same form (an attestor as `projects/<number>/attestors/…`, alert
  channels as `projects/<number>/notificationChannels/…`). Cloud Run executions name their job and Dataplex
  assets their dataset with the project id, which the API also accepts.
- Two documented fields are left out because the catalog maps the documented form to no asset name yet
  (`docs/catalog-followups.md`): a Service Directory endpoint's `network`
  (`projects/<number>/locations/global/networks/<n>`) and Dataplex bucket assets
  (`projects/<number>/buckets/<b>`). A Private Service Connect endpoint for Google APIs targets `all-apis`,
  which the forwarding-rule rule reads as a (dangling) reference.

## Determinism and naming rules

- All randomness comes from `src/core/rng.ts` (mulberry32). Each template forks its own stream from the seed
  and a label (`web:demo-web-1`), so adding a template does not change what the others produce. Creation and
  update instants come from a hash of the asset name, so they do not depend on generation order.
- No clock: `today` is a parameter (default `DEMO_TODAY = '2026-10-08'`); every timestamp is derived from it.
  Template assets are older than the window; only history events fall inside it.
- Names: one organisation per size, all `example.com`: S `30000000001`, M `30000000002`, L `30000000003`, XL
  `30000000004` (`DEMO_ORGANIZATION_IDS`, so an export of one size is an extra tick of that size's
  timeline only), folders `2000000000x`, projects `demo-<role>-<n>` with
  numbers `1000000000x`, access policy `40000000001`; e-mail addresses at `example.com`, service accounts
  `<name>@demo-<role>-<n>.iam.gserviceaccount.com`; public names under `example.org`.
- Addresses: subnets and services in `10.0.0.0/8`, standalone VPCs and GKE control planes in
  `172.16.0.0/12`, BGP in `169.254.0.0/16`, every public address in `203.0.113.0/24`. The pools in
  `AddressPlan` (`src/builder/builder.ts`) throw when exhausted rather than overlap.
- Changing anything that changes the output means regenerating the fixtures in the same change
  (`pnpm --filter @gcportrait/demo-data fixtures`) and reviewing the `stats.json` diff.

## The synthetic-only guard

The guard lives in `@gcportrait/model/testing` (`findNonSyntheticData`, `assertSyntheticOnly`), with the one
allowlist every package uses; this package's tests run it over every generated organisation, history and
committed fixture, with the narrower IPv4 ranges above. Its rules are documented with it in
`packages/model/src/testing/synthetic.ts`.

## Fixtures and the `generate` command

`fixtures/S.ndjson` and `fixtures/M.ndjson` are today's S and M organisations in the `assets.list` shape;
`fixtures/stats.json` holds the golden counts (total, per type, history mutations) of all four sizes. The
tests regenerate all of them, including L and XL, and compare byte for byte.

```sh
pnpm --filter @gcportrait/demo-data fixtures                               # rewrite the three fixture files
pnpm --filter @gcportrait/demo-data generate --size L --out /tmp/demo-L.ndjson
pnpm --filter @gcportrait/demo-data generate --size XL --format cai-export --out xl-export.ndjson
pnpm --filter @gcportrait/demo-data generate --size M --format snapshot --tick 2026-09-20 --out m.json
pnpm --filter @gcportrait/demo-data generate --help
```

Formats: `cai` (default), `cai-export`, `snapshot`, `history`, `stats`, `checklist`. Options: `--seed`,
`--today`, `--tick` (index or date). A relative `--out` is resolved against the directory pnpm was started
from. Without `--out` the output goes to standard output.

## Adding a generator case (catalog skill §6 step 9)

When a Tier 0/1 asset type joins the catalog, add it to the demo so the diagram shows it:

1. Pick the template it belongs to (`src/topology/<area>.ts`) or add one; a new kind of workload project is a
   new `Archetype` in `profiles.ts` plus an entry in `WORKLOAD_TEMPLATES` (`organization.ts`). A case that S
   should not have goes behind a feature (`features.ts`, `has(profile, '<feature>')`), so S stays byte for
   byte what it is; run it once per organisation or environment (`ctx.once`) unless it is per project by
   nature. Platform templates that point at workloads read `ctx.inventory` from a `b.defer` callback.
2. Emit it with the helpers in `src/topology/kit.ts` (`addCompute`, `addProjectAsset`, …): the real asset
   name, `parent`, `location` and the API's `data` shape, with every field the catalog fixture's relation
   paths read, pointing at assets that exist (self-links for Compute, relative names for v2 APIs). Use the
   project form (id or number) of the target's asset name; check with
   `pnpm --filter @gcportrait/graph test` (its demo test lists every reference into the organisation that
   dangles) and `pnpm render-scene --fixture M --lens <lens>`. Image paths need no repository: the
   `registries` pass creates it.
3. Add its discovery metadata to `src/data/discovery.ts` and its timestamp fields to `src/data/timestamps.ts`.
4. If it changes over time, add a mutator in `src/history/mutators.ts`; if it can be created or deleted inside
   the window, give it the `addable` trait or an ephemeral factory. When a template names an asset that may
   carry `addable` (a table, an export bucket, a build), it calls `b.referenced(name)` and uses the returned
   creation instant as its own `after`; the per-tick test in `src/generate.test.ts` and the graph package's
   demo test fail on any reference that dangles at an earlier tick.
5. Add its relation paths to `SEED_PATHS` in `src/testing/seed-paths.ts`, which `src/generate.test.ts` checks,
   and, if it is a feature worth listing, a row to `realismChecklist`.
6. Run `pnpm --filter @gcportrait/demo-data fixtures`, review the `stats.json` diff, update the counts in this
   README (the tests point out every stale number), and run
   `pnpm --filter @gcportrait/demo-data lint typecheck test`.

## Layout

```
src/index.ts          public API
src/generate.ts       historyFor, generateOrganization (the generator's entry points)
src/core/             seeded PRNG, hashing, time formats, IPv4 pools, JSON helpers, id formats
src/data/             discovery metadata and timestamp fields per asset type
src/builder/          the builder, asset type, timestamp stamping
src/topology/         templates (hierarchy kit, network, hybrid, partner, security, operations, retired,
                      web, gke, serverless, data, vm, ml), the size profiles and the composer; the catalog
                      generator cases: features, fabric, connectivity, edge, machines, stores, pipelines,
                      serverless-extras, management, trust, protection, secrets, registries
src/history/          planner, change mutators, public history types; replay.ts (snapshotAt), which imports
                      none of the generator, so an app that only replays a history bundles none of it
src/output/           CAI records and NDJSON, Snapshot and statistics
src/report/           the realism checklist
scripts/generate.ts   the generate / fixtures command (Node)
fixtures/             S.ndjson, M.ndjson, stats.json
```

## Tests

```sh
pnpm --filter @gcportrait/demo-data test
```

Unit tests (`src/**`): PRNG, time, address and JSON helpers; for S and M: byte-identical
determinism, seed and `today` independence of structure, every asset against `AssetSchema` and snapshots
through `migrateSnapshot`, CAI record shape and round trip, parent and ancestor consistency at several ticks,
no real-looking data, clean history replay with every mutation inside its day, changes that really change a
field, weekly activity, the four scripted events, every topology feature, and every catalog-seed field path.
Fixture tests (`scripts/**`): committed fixtures and golden statistics of all four sizes regenerated byte for
byte, XL generated in under five seconds and swept by the synthetic-only guard in under twenty, the README's
numbers and checklist, and the `generate` command. The two XL limits use `measureBatches`, `measureRuns`
and `skipIfOverloaded` from `@gcportrait/model/testing`
([Testing export](../model/README.md#testing-export-gcportraitmodeltesting)), with one run per batch.
