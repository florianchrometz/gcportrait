<!-- SPDX-License-Identifier: MIT -->

# Asset catalog follow-ups

The backlog that the catalog's twelve product groups left open, collected and deduplicated by the catalog review
on 2026-10-09. It is written for a maintainer with access to a real
Cloud Asset Inventory export and to the engine code: every item either needs evidence that public
documentation could not give, or a change outside the catalog's data files (the compiler and normalisers in
`packages/catalog/src/`, the schemas in `packages/model`, the graph builder, the demo generator).

State of the catalog when this list was written: 632 of the 641 official types mapped (98.6 %: 63
containers, 257 core, 79 leaf, 233 hidden), 9 unmapped with a reason (7 IAP policy-only types, 2 BeyondCorp
client-connector types shut down in 2023), 1 350 rules, 0 rules without a fixture, `pnpm catalog:check` clean.
After the engine follow-ups (section 6): the same 632 types (69 containers, 258 core, 71 leaf, 234
hidden), 1 387 rules, every `hiddenWhen` proven both ways.

How to read an item: **what** is open, **where** it bites (types and fields), and **how to settle** it. "Real
export" means one read-only `gcloud asset search-all-resources` or `gcloud asset export` of the type in a real
organisation, looking at the asset `name`, `resource.parent` and the field in question.

## 1. Engine and schema work (cross-cutting)

The engine follow-ups (2026-10-09) resolved most of this section; section 6 records what changed and where it is
documented (ADRs [0022](adr/0022-reverse-rules-and-child-side-containment.md),
[0023](adr/0023-sibling-and-kubernetes-reference-normalisers.md) and
[0024](adr/0024-graph-builder-project-matching-and-shared-vpc.md)). What is still open:

### 1.1 Project id versus project number in resource names

Resolved in the graph builder (canonical matching, ADR 0024): a reference that matches no asset is tried with
its project segment swapped between id and number, so every edge this item listed resolves whichever form
the API wrote. Open: several fixtures and the demo generator still write the form that resolved before the engine follow-ups
(their notes say so); switching them to the documented forms would exercise the swap on more types
(section 2).

### 1.2 Rules the schema cannot express

- **Badges**: the entry schema has no badge field, so subnet purpose, Cloud NAT, PSC, IAP, CDN, DNSSEC,
  connection preference and "suspended" exist only in notes.
- **Per-container count thresholds** (the seed's "BigQuery tables hidden above 50 per dataset", "Bigtable
  tables above 30").

### 1.3 Normalisers: rules not written yet, and forms no normaliser reads

The `siblingName` and `k8sRef` normalisers exist since the engine follow-ups; these references could use them but have no rule
yet (each needs its fixture shape checked): Cloud Deploy automation and deploy-policy selectors,
`Build.buildTriggerId`; bare secret ids of Cloud Run and Cloud Run functions (`{projectId, secret}`); DMS
`cloudSqlId`, `alloydbClusterId`; Bigtable `AppProfile` clusters; Data Transfer `destinationDatasetId`;
Filestore `networks[].network` given as a bare same-project name; Dataflow worker `network`; App Engine
flexible `network.name`; Data Fusion `DnsPeering.targetProject` + `targetNetwork`; Vertex AI bare
`pscInterfaceConfig.networkAttachment` names; GKE Ingress and Gateway annotations that name Compute resources
by bare name (`ingress.kubernetes.io/forwarding-rule`, `url-map`, …; reverse `routes` from the forwarding
rule); Kubernetes `Endpoints` → Pod (`targetRef`) and workloads' `serviceAccountName` (a `runsAs` the identity
lens would have to list).

Forms no normaliser reads yet:

- **Compute forms the Compute normalisers reject**: `projects/<p>/locations/global/<collection>/<n>` (Cloud
  Service Mesh route destinations, `TlsRoute.targetProxies`, Service Directory `Endpoint.network`,
  `InternalRange.network`), a leading slash `/projects/…` (the Cloud SQL `privateNetwork` example, InternalRange
  migration, GKE `networking.gke.io/*` annotations, Financial Services), `gce://<project>/<zone>/<instance>`
  (k8s Node `spec.providerID` → Instance).
- **Other forms**: `cloudSqlConnectionName` for `projects/<p>/locations/<l>/instances/<i>` (Firebase Data
  Connect); `gcsUri` for `projects/<p>/buckets/<b>` and `//storage.googleapis.com/projects/<p>/buckets/<b>`
  (Dataplex Asset and DataScan; today it reads "projects" as the bucket); a version-to-secret option, since
  Secret Manager versions are hidden and most references name a version; service-account unique ids
  (`projects/{p}/accounts/{id}`, API Gateway); trimming Dialogflow `/environments/<env>` suffixes; an
  Artifact Registry upstream given as a repository URL.

### 1.4 Templates and the checker

- No enum-prefix filter (`LINK_TYPE_…`, `SOLUTION_TYPE_…`, `JOB_STATE_…` render raw and lower-cased).
- `first(…)` names the variant a union-shaped resource holds by its value, not by which key is set:
  Pub/Sub delivery type, Datastream profile kind, Storage Transfer source and DNS response-policy rule behavior
  want the key's name, which needs a literal argument or a key filter.

- **Console templates.** 265 types have no `console` template (`pnpm catalog:check`, the list
  with `--verbose`); the app offers their project's console home instead ("Open project in Cloud Console").
  Four templates first added that opened a list page under the resource wording were removed again (App Hub
  `Service`, `Workload` and `ServiceProjectAttachment`, the App Hub applications page; the Hub `Membership`,
  the Kubernetes clusters page): they fall back to the project until someone confirms their resources' exact
  pages (261 → 265). Older templates still open list pages (Apigee environments and instances, Network
  Services meshes, edge caches and service extensions, Developer Connect, the App Hub `Application`, Memorystore
  for Redis clusters and Valkey instances, Storage Transfer, Infra Manager, Serverless VPC Access, several
  Vertex AI types): the same question per type. Still without a template among the types demo M draws: Backup
  and DR, Backup for GKE, the Kubernetes `ServiceAccount`, Security Command Center notification and export
  configs, the Cloud Asset feed and the Compute `ResourcePolicy`.
- **Counting subtitles.** Fixed on 2026-10-10: `redis.googleapis.com/Cluster` renders `{{data.shardCount |
  plural(shard)}}`, and `tooling/plurals.test.ts` fails on any label or subtitle that writes a value straight
  before a plural noun (ranges such as `{{min}}–{{max}} replicas` and units such as `GB` aside).

### 1.5 Graph builder

- **IP-match edges** (the seed's DNS record set → forwarding rule `uses` by IP) are not implemented; the
  addresses are indexed only (ADR 0024).
- **App Hub applications** keep the `product` zone kind: the scene treats `group` zones as label bundles that
  never collapse and count as bundles, so drawing applications in a logical lens only (the intent recorded in
  layout skill §2) needs a scene decision first.
- **Shared VPC with producer networks peered into a host's network** still counts (a Cloud Build private pool
  peered into the host's shared network): the rule of ADR 0024 cannot tell it from a service project's
  database on the host network. A real export would show whether the pool's project is a service project.

### 1.6 Icons

117 icon keys were pending on 2026-10-09, before the icons package existed (`pnpm catalog:check` lists them). Infra Manager, App Design
Center, App Lifecycle Manager, Network Security Integration and Workload Manager may have no official product
icon; the category fallback applies until `packages/icons` decides.

Since 2026-10-11 the weekly `icon-drift.yml` (`pnpm --filter @gcportrait/icons drift`) reports when Google
Cloud's icon page (<https://cloud.google.com/icons>) gains an icon for one of the 73 product keys still on a
legacy console symbol or the 44 on a category mark; adopt it in `packages/icons/mapping.json` as the README's
"Keeping the icons current" describes. The first online run found no drift.

## 2. Demo data (`packages/demo-data`)

The demo generator has a case per catalog group for M and larger (the demo-data README's "Catalog generator
cases"): Artifact Registry repositories for every image path the assets name, and the Tier-1 types the groups
asked for, from Network Connectivity Center, Cloud NGFW Enterprise, hierarchical firewall policies and Private
Service Connect to Cloud DNS policies, logging sinks, alerting, Backup and DR, Certificate Manager, the data
platform (Memorystore, Filestore, AlloyDB, Spanner, Bigtable, Composer, Dataproc, Dataflow, Metastore),
Vertex AI and Discovery Engine, Cloud Build, Cloud Deploy, Infra Manager, Binary Authorization, CA Service,
workload identity federation and Cloud IDS. M grew from 587 to 952 assets. Still open:

- **Size of M.** 952 assets against the ≈600 the demo was designed for (cai-ingestion skill §7). Bringing it
  back (under 800, say) means trimming M's base, which changes many pinned graph goldens and the layout goldens
  on M, or moving cases such as the VM or ML project to L only.
- **S has no generator cases**, so its container images, function builds and Cloud Build images name
  Artifact Registry repositories that do not exist. Since the engine follow-ups `packages/graph/test/demo.test.ts` exempts
  them for S only (M's history resolves every repository at every tick); giving S the `registries` case would
  remove the exemption.
- **S emits pods without their nodes.** Its GKE cluster's two pods name a node in `spec.nodeName`
  (`gke-retail-prod-default-…`), drawn since the engine follow-ups (k8sRef), but S has no `k8s.io/Node` asset, so the two
  references dangle (S: 17 → 19 dangling). The demo test exempts them for S; emitting the node in S (M does)
  would remove the exemption.
- **App Hub.** The generator emits the `storefront` application now; the graph view tests still add their own
  (`applicationAssets` in `packages/graph/test/views/fixtures.ts`) and could move onto the generated one.
- **Documented forms left out**, because the catalog maps them to no asset yet (§1.3): a Service Directory
  endpoint's `network` (`projects/<number>/locations/global/networks/<n>`) and Dataplex bucket assets
  (`projects/<number>/buckets/<b>`). The Private Service Connect endpoint for Google APIs targets the bundle
  `all-apis`, which the forwarding-rule rule reads as a dangling reference; skipping bundle names (`all-apis`,
  `vpc-sc`) in that rule would avoid it.
- **Project id versus number (§1.1).** The generator writes each reference in the form that resolved
  before the engine follow-ups (an attestor as `projects/<number>/attestors/…`, alert channels as
  `projects/<number>/notificationChannels/…`). The graph now matches either form (only M's private services
  access ranges exercise the swap today); writing ids where the APIs document them would show it on more
  types.
- **Realism notes.** Demo zones are named by zone name rather than the numeric id CAI uses, and record sets
  without `locations/global` (see Cloud DNS in §4).
- **Ignored source directory.** The root `.gitignore` rule `build/` matches any directory of that name,
  which is how the generator's former `src/build/` stayed out of git (it is `src/builder/` now). Narrowing the
  rule to `/build/` would stop that from recurring.

## 3. Documentation outside the catalog to refresh

Resolved by the engine follow-ups: `packages/graph/README.md` no longer describes the first stand-in rules (stand-in
section, dangling-reference paragraph, view-test paragraph, performance table), the
`.agents/skills/gcp-asset-catalog/SKILL.md` §6 step 6 no longer points at `demo-rules.ts`, and the comment
above the demo test's exemptions says what they are for. ADR 0021 describes the stand-ins as they were and
can stay.

## 4. Open questions and unverified paths, by service

Unless an item says otherwise, the rule is in place and resolves on the fixtures; what is open is whether
real data has the shape the fixture assumes. Console URL templates are best-effort links; the ones listed
were not confirmed against the live console.

### Compute Engine — networking fabric

- Hierarchical `FirewallPolicy.associations[*].attachmentTarget`: `organizations/N` / `folders/N` assumed
  (the rule also takes network self-links). The console link exists for project policies only; regional
  network policies probably need the region in the link.
- `Route.nextHopHub` and `nextHopInterconnectAttachment` are output only: do they appear in exports?
- `Address`/`GlobalAddress` `ipCollection` partial forms (`regions/r/publicDelegatedPrefixes/p`,
  `projects/p/locations/global/internalRanges/r`) normalise to the wrong service; full URLs resolve.
- Not read yet: `Router` interfaces' `linkedVpnTunnel`/`linkedInterconnectAttachment` (deliberately: the
  hybrid side draws them), `nccGateway`, `PublicDelegatedPrefix.delegateeProject`, NAT
  `sourceNatActiveIps`.
- GKE-managed firewall rules and routes-based GKE node routes now start hidden (the catalog review: names `gke-…`,
  `k8s-…`, `k8s2-…` targeting a `gke-…` tag; route description `k8s-node-route`). Check the patterns against
  a real GKE host project.
- Console URLs to click through: PSC producers and network attachments, packet mirroring, BYOIP, firewall
  endpoints, security profiles and profile groups, address groups, VPC Flow Logs, Connectivity Tests.

### Compute Engine — hybrid connectivity

- `NextHopSpoke.uri` format (relative name assumed; an `https://networkconnectivity…` URL also resolves).
- Gateway spokes: are `gateway.cloudRouters` routers in the customer's project or a Google-managed one?
- L2 (`L2_DEDICATED`) attachments: `vlanTag8021q` and `privateInterconnectInfo.tag8021q` assumed present.
- `InternalRange.network` in the `projects/<p>/locations/global/networks/<n>` spelling dangles (§1.3).
- `RegionalEndpoint.address` may hold an Address URI; a filtered `uses` rule could link it.
- Console list pages: Serverless VPC Access connectors, PSC consumers (regional endpoints), internal ranges,
  external VPN gateways, Cross-Site Interconnect.

### Compute Engine — load balancing and edge

- Cloud Service Mesh route destinations written as `projects/<p>/locations/global/backendServices/<b>`
  (Google's own examples) dangle (§1.3); the fixtures carry both spellings on purpose.
- `TlsRoute.targetProxies`, Certificate Manager `gclbTargets`, backend service and Wasm `usedBy`,
  `ForwardingRule.attachedExtensions` are not read (repeats or unresolvable forms).
- Value formats not documented: `AuthzPolicy.target.resources`, `LbTraffic/LbRouteExtension.forwardingRules`,
  `BackendService.serviceLbPolicy`/`serviceBindings`, `SecurityPolicy.associations[*].attachmentId`.
- Global external passthrough Network Load Balancer: the `GlobalForwardingRule` fixture shape is a best guess.
- Are regional variants (TargetHttpsProxy, UrlMap, HealthCheck, SslCertificate, SslPolicy, SecurityPolicy,
  BackendBucket, RegionBackendService) exported under the same asset type as the global ones?
- Not read: `ForwardingRule.ipCollection` (→ PublicDelegatedPrefix), `BackendService.haPolicy`.
- High cardinality to watch: GKE-managed NEGs and health checks (`k8s1-…`), API Gateway configs, Certificate
  Manager map entries in SaaS custom-domain setups.
- Console URLs: every load-balancing deep link (`loadbalancing/advanced/…`, `loadbalancing/backends/details/…`,
  `loadbalancing/details/http/<urlmap>`), Certificate Manager, API Gateway, Cloud Domains, service mesh,
  Media CDN, service extensions, Secure Web Proxy.

### Compute Engine — compute

- Value formats: `WorkstationCluster.network`/`subnetwork` and TPU v2 `networkConfig` (documented only as
  "name"; `projects/…` paths assumed), Migrate to VMs NIC network/subnetwork, Workstations
  `privateClusterConfig.serviceAttachmentUri`, Cluster Director `BucketReference.bucket`.
- Which TPU Node version Cloud Asset Inventory exports (both shapes are read).
- Not read: Instance node affinity and reservation affinity (plain names), TPU `queuedResource`,
  `WorkstationCluster.privateClusterConfig.allowedProjects`, Batch boot image and reservation, Disk `users`,
  `licenses`, template `resourcePolicies`.
- Roles: ResourcePolicy, Commitment and NodeTemplate are leaves although disks and reservations point at
  them (the catalog's leaf means "no outgoing references", like health checks); Workstation may need
  `hidden` or a `hiddenWhen` on stopped workstations at scale; attached disks stay visible.
- Console URLs from memory: instance, disk, image and snapshot detail pages, instance groups, commitments,
  storage pools, instant snapshots, `compute/metadata`.

### Cloud DNS and Cloud Domains

- Record-set `resource.parent`: the fixture assumes the zone. CAI names zones `projects/PROJECT_ID/
  managedZones/ZONE_NUMBER` and record sets `projects/PROJECT_NUMBER/locations/LOCATION/managedZones/…/rrsets/…`,
  so nesting relies on `parent`. Settle with one real export.
- `RESOURCE_RECORD_SET` assumed `<name>/<type>`; response policy names assumed to be the policy name, not its id.
- Enum case of `visibility` and friends (the REST reference is lower case; subtitles lower-case anyway).
- A zonal GKE cluster as `gkeClusterName` (`…/locations/<zone>/clusters/…`) may not match the cluster asset
  (`…/zones/<zone>/clusters/…`).
- DNS peering is drawn as symmetric `peers`; it is directional in reality.
- GKE cluster-scope zones (one or two per Cloud DNS cluster) may need a `hiddenWhen`.
- Console: the ManagedZone detail link (`net-services/dns/zones/<name>/details`) is unverified; list links
  now use `networking/dns/zones`, the form the Cloud DNS documentation links (the catalog review).

### GKE, Kubernetes objects, fleets, multi-cloud and on-premises, Backup for GKE

- gkehub asset names: the asset-names page says PROJECT_ID, GKE's `fleet.membership` and the fixtures use the
  number; the graph matches either since the engine follow-ups (§1.1). The fleet's own name is assumed to be
  `projects/<p>/locations/global/fleets/default` (the membership, scope and feature `nestsIn` rules build it).
- Resolved by the engine follow-ups: the membership's `endpoint.*.resourceLink` rules are back as weak reverse rules, so a
  registered cluster without `fleet.membership` still links, and with it the two copies merge into one edge.
- Zonal clusters: `Membership.endpoint.gkeCluster.resourceLink` and `BackupPlan.cluster` use
  `…/locations/<zone>/…`; zonal cluster assets may be `…/zones/<zone>/…`.
- Paths from knowledge only: Backup for GKE `backupConfig.encryptionKey.gcpKmsEncryptionKey`, multi-cloud and
  on-prem `fleet.membership`, `AzureCluster.azureClient`, bare-metal node pool `nodeIp`, gkehub Fleet,
  Feature, Scope, MembershipBinding and RBACRoleBinding fields, the PD CSI `volumeHandle` form, the
  `iam.gke.io/gcp-service-account` annotation, `anthos.googleapis.com/ConnectedCluster` (shape undocumented).
- Drawn since the engine follow-ups (k8sRef): Pod → Node, Ingress and HTTPRoute → Service, HTTPRoute → Gateway, PV ↔ PVC,
  role bindings → roles. Not drawn yet (§1.3): Service selectors (label queries), GKE load balancers from
  annotations, Node → Instance (`gce://` provider ids), workloads' `serviceAccountName`.
- `ownerReferences` on Deployment, StatefulSet, DaemonSet and CronJob are not read (owners are usually custom
  resources outside the inventory; additive if wanted).
- Console URL tails for k8s object pages (`/overview`, `/details`, `/summary`), node pools, Eventarc,
  Cloud Tasks, Workflows, Cloud Run jobs, functions (now under Cloud Run).

### Cloud Run, Cloud Run functions, App Engine, Eventarc, Cloud Tasks, Workflows

- Cloud Run shape in CAI: the supported-types page links the v1 (Knative) API for Service, Revision, Job,
  Execution and DomainMapping, the demo emits v2; rules read both. Revision and Execution `memberOf` read v2
  fields; if CAI carries v1 data there, those edges do not fire. v1 annotation keys and the gcsfuse CSI
  `volumeAttributes.bucketName` are from knowledge.
- App Engine versions: automatically scaled standard versions stay `SERVING` after a new deploy, so old
  versions stay visible; make the role `hidden` if that proves noisy.
- Cloud Run `DomainMapping` addresses are Google's shared front ends; the catalog review stopped indexing them as the
  mapping's IPs.
- Eventarc `Pipeline.destinations[*].topic` (`projects/<p>/locations/<l>/topics/<t>`, not a Pub/Sub name) is
  not read.

### Cloud Storage, BigQuery family, Cloud SQL, Spanner, Bigtable, AlloyDB, Firestore

- Cloud SQL replication is drawn since the engine follow-ups (a reverse rule on the replica's `masterInstanceName`); Cloud SQL
  `pscConfig.allowedConsumerProjects` (an allow list, consumer → instance) is not.
- Formats unconfirmed: AlloyDB `primaryConfig.secondaryClusterNames` and `Backup.clusterName`, Cloud SQL
  `Backup.kmsKey` (key or key version; both normalise), Cloud SQL `pscAutoConnections`, BigQuery
  `biglakeConfiguration`, `cloneDefinition`, `snapshotDefinition`, `linkedDatasetSource`, BI reservations and
  reservation groups, `MigrationWorkflow` state `COMPLETED`.
- Please confirm the hiding rules beyond the seed: datasets whose id starts with `_`, and platform staging
  buckets (`gcf-sources-`, `gcf-v2-sources-`, `gcf-v2-uploads-`, `run-sources-`, `*_cloudbuild`,
  `dataproc-staging-`/`-temp-`, `staging.*`/`artifacts.*.appspot.com`).
- BigQuery `ReservationAssignment` reads its assignee through filters over every string value of `data`.
- Bigtable fixtures carry no `location` and parent backups, authorized views and schema bundles on the instance.
- Console URLs: BigQuery models and routines, Bigtable sub-pages, Spanner, AlloyDB and Filestore backups,
  the Redis detail path, Parallelstore.

### Memorystore, Redis, Memcached, Filestore, NetApp Volumes, Managed Lustre, Parallelstore, Oracle Database

- Memorystore and Redis Cluster draw `uses` from the instance to the consumer's PSC forwarding rule (the
  attachment side lives in a Google tenant project).
- Formats unconfirmed: Oracle `peerAutonomousDatabases`, NetApp `StoragePool.activeDirectory`/`kmsConfig`
  and `Volume.backupConfig.backupPolicies` (id or full name), Memcached `authorizedNetwork`.
- Filestore backups are named with the project number (the API's name; the catalog review aligned the fixture).
- Parallelstore's documentation redirects to Managed Lustre: the product may be on a deprecation path.
- No verifiable console link for Oracle Autonomous Database.

### Pub/Sub, Managed Kafka, Dataflow, Dataproc, Metastore, Composer, Data Fusion, Dataform, Dataplex, Data Lineage, Datastream, Database Migration, Healthcare, Looker, Storage Transfer, Storage Insights, Storage Batch Operations

- Formats unconfirmed: Dataproc `autoscalingConfig.policyUri` (documented as `…/locations/…`, the policy
  asset is named `…/regions/…`), Dataflow `jobMetadata.pubsubDetails` and whether CAI includes
  `environment.workerPools`, Dataplex `Task` network fields, Metastore PSC `endpointUri`, Datastream
  `singleTargetDataset.datasetId` (`project:dataset` assumed), DMS `vpcName` and `MigrationJob.vpc`,
  Healthcare `bulkExportGcsDestination.uriPrefix`, Dataform `invocationConfig.serviceAccount`, Storage Batch
  Operations `rewriteObject.kmsKey`, Composer `config.gkeCluster`, whether CAI exports Dataplex system entry
  groups (`@bigquery`), the `resource.parent` of sub-resources (project or container).
- Not read: Metastore `scheduledBackup.backupLocation` and Kerberos `krb5ConfigGcsUri`, Metastore federation
  Dataplex backends, Looker `periodicExportConfig`, Dataflow Python `temp_location`.
- Design choices to confirm: Data Fusion Instance as a container (its DNS peerings nest; most instances
  will be empty zones), Dataflow Job `core` with a hide rule on finished states, Metastore Service and Looker
  Instance `core` (their backups count on the project), DMS MigrationJob nesting in its VPC, Dataform
  Workspace (`leaf`, per developer) and Dataplex DataScan (`core`, auto-created scans can be numerous).
- Console URLs: Managed Kafka, Metastore, Datastream, DMS migrations, Healthcare, Dataform tabs, Dataproc
  batches, Dataplex tasks.

### Vertex AI, Discovery Engine, Dialogflow, Document AI, Speech-to-Text, Retail, Gemini, Customer Experience Insights

- Tabular and time-series `Dataset.metadata.inputConfig`: the rules read the SDK/console shape
  (`gcsSource.uri[]`, `bigquerySource.uri`); the published schema sketches a discriminated union.
- Formats unconfirmed: `PSCAutomationConfig.forwardingRule`, the AlloyDB federated-search instance,
  `NotebookRuntime.proxyUri` host, whether CAI returns `Collection.dataConnector`.
- Additive references not read yet: reservation affinity on IndexEndpoint, NotebookRuntime and
  NotebookRuntimeTemplate; ReasoningEngine `spec.buildSpec.workerPool`; Discovery Engine
  `cmekConfig.singleRegionKeys[*].kmsKey` and `workspaceConfig.superAdminServiceAccount`; Model
  `originalModelInfo.model`; Dialogflow CX `bigqueryExportSettings` (v3beta1 only).
- The ModelDeploymentMonitoringJob fixture names its channel with a project id, which the graph's project swap
  resolves since the engine follow-ups (§1.1).
- Console URLs: `speech/recognizers`, `gemini-code-assist/code-customization`, `ai/retail/catalogs/<c>/data`,
  legacy `vertex-ai/features`, and the `agent-platform` pages for agent engines, index endpoints, datasets,
  custom and tuning jobs, the Dialogflow CX agent deep link.

### Security and identity (IAM, KMS, Secret and Parameter Manager, CA Service, Access Context Manager, Binary Authorization, Security Command Center, DLP, reCAPTCHA, BeyondCorp, IAP, Managed AD, IDS, Web Security Scanner, Assured Workloads, Org Policy)

- Binary Authorization `requireAttestationsBy` resolves with either project form since the engine follow-ups (§1.1); whether
  `data.name` carries the id or the number is still unconfirmed.
- Workload identity pool, provider, key, namespace and managed-identity asset names: the asset-names page says
  PROJECT_ID, the IAM API and `PolicyBinding.target.principalSet` the number; the fixtures use the number.
- `apikeys.googleapis.com/Key`: the asset-names page (id) and the API Keys reference (number) disagree.
- `AppGateway.uri` assumed to be an https URL; `AppConnection.gateway.appGateway` may be spelled with the
  collection `appgateways`.
- Signing keys are drawn as `uses`, not `encryptedBy` (CA keys, attestor public keys, Access Approval's
  signing key): signing is not encryption at rest. The catalog review kept that; revisit if the security lens should
  layer them with CMEK.
- Engine limits: Assured Workloads `CONSUMER_FOLDER` and the DLP organisation/folder discovery scope are bare
  numbers; Binary Authorization `clusterAdmissionRules` keys name clusters (map keys are not readable);
  ServicePerimeter ingress/egress rules and dry-run spec, AccessLevel members, Identity Platform blocking
  functions, DLP wrapped keys are not read.
- `memberOf` is used for CryptoKeyVersion → CryptoKey and DlpJob → JobTrigger (both hidden).
- Console links without context: AccessLevel and ServicePerimeter (no organisation), regional secrets (no
  location), CA Service, DLP, Parameter Manager, reCAPTCHA, IDS, Managed AD, Web Security Scanner.

### Cloud Build, Artifact Registry, Container Registry, Cloud Deploy, Developer Connect, Secure Source Manager, Infra Manager, App Design Center, App Lifecycle Manager

- Formats unconfirmed: App Design Center `Application.apphubApplication` and `serviceAccount`,
  `Component.sharedTemplateRevisionUri` (the `google/<template>/revisions/<rev>` catalog form always dangles),
  the ApplicationTemplateRevision name and the App Design Center asset-name format; App Lifecycle Manager
  references (relative names in the same service assumed); GlobalTriggerSettings and Container Registry
  `Image` have no public schema; Cloud Build's `developerConnectEventConfig.gitRepositoryLink` is spelled
  `gitRepositoryLink/*` in its reference (Developer Connect's real collection `gitRepositoryLinks` is used).
- Not read yet: BuildTrigger `gitFileSource.*`, `sourceToBuild` enterprise configs,
  `availableSecrets.secretManager[*].versionName`, `pubsubConfig.serviceAccountEmail`; Build `artifacts.images`,
  `source.gitSource.url`; Cloud Deploy custom-target skaffold sources; Developer Connect
  `InsightsConfig.runtimeConfigs` and `projects.projectIds`; Secure Source Manager `pscAllowedProjects`;
  Infra Manager Preview inputs; Artifact Registry upstream repositories given as URLs.
- Console URLs: Cloud Build worker pools and 1st/2nd gen repositories, Developer Connect, Secure Source
  Manager, Infra Manager, Cloud Deploy targets, custom target types and deploy policies.

### Logging, Monitoring, OS Config, Asset Inventory, Billing, Service Usage and Management, Service Directory, App Hub, Backup and DR, Application Integration, Integration Connectors, Apigee, API hub, Firebase, media APIs, Financial Services, Blockchain Node Engine, KRM API Hosting, Workload Manager, Migration Center, Cloud Controls Partner

- Logging sinks into central log buckets resolve with either project form since the engine follow-ups (§1.1); hiding every project's `_Default` and
  `_Required` buckets means a sink into another project's `_Default` bucket points at a hidden node.
- Service Directory `Endpoint.network` (`projects/<number>/locations/global/networks/<n>`, §1.3) and Firebase
  Data Connect Cloud SQL instances (§1.3) always dangle today.
- App Hub `serviceReference.uri`/`workloadReference.uri`: the catalog review switched them to `computeRelative`, so a
  Compute registration resolves with either project form; whether the API writes numbers for other services is
  open. Managed instance groups register as instance groups (the fixtures and graph tests now say so).
- Asset-names page inconsistencies followed as written: Service Directory namespace (number) vs service and
  endpoint (id); OS Config, Financial Services, Live Stream and Transcoder (id) while their APIs return
  numbers; `VulnerabilityReport` capitalisation.
- Unverified: KRM API Hosting (no public reference; management-config fields from knowledge), Video Stitcher
  `Slate.uri` and `VodConfig.sourceUri`, `LiveConfig.defaultSlate` (a resource reference in the v1 proto, so
  readable), Migration Center `CostAssessmentJob`, Backup and DR `dataSourceGcpResource.gcpResourcename` and
  `ManagementServer.networks[].network`, Workload Manager `bigQueryDestination.destinationDataset`.
- Not read: Integration Connectors `eventingConfig` authentication and listener secrets, Apigee
  `Instance.host` as a host name (always an address in practice), Apigee `ipRange` with two ranges (the IP
  extractor reads one), uptime-check → VM (numeric instance ids), OS policy → VMs (labels), Firebase release
  targets.
- Roles to watch: Backup and DR DataSource (`core`, one per protected resource), Apigee ApiProxy (`leaf`,
  hundreds in large organisations), App Hub ServiceProjectAttachment (`core`), Logging LogBucket (`container`
  whose children are all hidden).
- Console URLs: App Hub, Application Integration, Integration Connectors (connections, endpoint attachments,
  managed zones), API hub, uptime check details, dashboards, Endpoints, Firebase console pages.

## 5. What the catalog review changed (for the record)

- Lenses: all 11 rewritten as catalog-driven type lists. Overview lists its Compute, Network Services, data
  and processing types one by one (no `compute.googleapis.com/*`); networking lists Cloud NGFW, Network
  Security Integration and DNS Armor explicitly and draws `secures`; security lists every visible
  `encryptedBy` holder and draws `triggers`; identity lists every visible `runsAs` holder and draws
  `secures`; operations takes delivery, backups, migrations and the resources App Hub and Backup and DR point
  at; compute draws `peers` and `connects`; serverless draws `memberOf`; data takes the AI services.
- Relations: membership → cluster `uses` and function → Eventarc trigger `uses` dropped (each repeated an
  edge drawn from the other side); a Compute instance's PSC interface NIC `connects` instead of `attaches`
  (no false Shared VPC pair); notification topics are `triggers` everywhere (Batch, Data Transfer, Dialogflow
  conversation profiles, model-monitoring channels); Migrate to VMs target identity and key are `uses`; Cloud
  Service Mesh gRPC routes split backend-service and Service Directory destinations; URL maps read request
  mirroring at every level and custom error buckets; firewall policies secure target secure tags and use
  source secure tags; Cloud NAT uses the subnetworks it serves; Media CDN reads response-signing keysets; OS
  policy assignments and patch deployments use their Cloud Storage buckets; Integration Connectors read
  secrets from every authentication method and the TLS configuration.
- Visibility: GKE-managed firewall rules and node routes start hidden; forwarding rules no longer index
  `0.0.0.0`; uptime checks and connector destinations index IP hosts; Cloud Run domain mappings no longer
  index Google's shared front-end addresses.
- Graph tests: the first stand-in rules are gone (`packages/graph/test/demo-rules.ts` deleted, the view
  stand-ins removed); the demo, view and property tests run on the real catalog; the named composition rows
  changed by correct rules or by the lens curation were updated with the reason in a comment; the pinned
  filter-bite matrix was rechecked and is unchanged.

## 6. What the engine follow-ups changed (for the record)

The engine follow-ups of section 1 (2026-10-09; ADRs 0022, 0023 and 0024):

- **Project id versus number** (§1.1): the graph builder matches a reference that names no asset once more
  with its project segment swapped through the project index, records the form that matched
  (`RelationEdge.matchedProject`, `counts.projectSwaps`), and keeps the raw value when neither matches. Asset
  names are never rewritten. Property-tested (`packages/graph/src/names.property.test.ts`).
- **Reverse rules and child-side containment** (§1.2): `reverse: true` on a relation rule, applied to Cloud SQL
  replicas (`replicates` primary → replica), address `users` (the user uses the address), PSC consumer
  endpoints (the endpoint routes to the service attachment) and Cloud Armor (the policy `secures` its
  backend services, backend buckets, target pools and target instances; before, those used the policy).
  `nestsIn` on a type entry, applied to Compute instances (their managed instance group, from `created-by`,
  and sole-tenant node groups), disks (storage pools), NetApp volumes (storage pools), Oracle VM clusters
  (Exadata infrastructure), Eventarc enrollments (message buses) and fleet memberships, scopes and features
  (the project's fleet); those containers changed role to `container` (instance group, node group, Compute
  and NetApp storage pool, Exadata infrastructure, message bus, fleet).
- **Normalisers** (§1.3): `siblingName` (pattern-based, ADR 0023) for Cloud Deploy stages and multi-targets,
  Discovery Engine data stores, serverless NEGs → Cloud Run, Cloud Run functions and App Engine, Eventarc Cloud
  Run and GKE destinations, Cloud Run domain mappings, Dataproc jobs → clusters, Serverless VPC Access networks
  and subnets (connectors now nest in their VPC) and private services access ranges; `k8sRef` for pods →
  nodes, Ingress (both API groups) and HTTPRoute → services, HTTPRoute → gateways, PV ↔ PVC and role bindings
  → roles. Kubernetes nodes, services, PVCs, Ingresses, gateways, HTTP routes and domain mappings became
  `core`. Gateway API object names sit behind `apis/<group>`, which `k8sOwner` and `k8sRef` now write for
  every group Kubernetes does not serve itself.
- **Templates and the checker** (§1.4): a ` · ` segment whose expressions are all missing is dropped with its
  unit words; `first(…)` names the variant of the Cloud Deploy target, Eventarc trigger and serverless NEG
  subtitles; `catalog:check` proves every `hiddenWhen` with a fixture it matches and one it does not
  (`hidden-unproven`; a folder in deletion was added to the Folder fixture, and Migrate to VMs' `Source`
  became `hidden` instead of a container behind an always-true predicate); `includeTypes` no longer reveals a
  hidden type's `hiddenWhen` matches (ADR 0024).
- **Graph builder** (§1.5): Shared VPC pairs come only from attachments into another project's subnet or a
  Shared VPC host's network (`GraphNode.sharedVpcHost`, from `compute.googleapis.com/Project`); reciprocal
  `connects` fold like `peers`; IP-match edges stay documented as not implemented.
- **Synthetic-data guard** (the former §1.6, `packages/model/testing`): `gateway.dev`, `sourcemanager.dev`,
  `developerconnect.dev`, `looker.app`, `blockchainnodeengine.com`, `domains.cloudrun.com`,
  `ghs.googlehosted.com` and 100.64.0.0/10 are allowed; fixtures may now show those real shapes (none was
  switched yet).
- **Demo M** (952 assets): 1 162 → 1 235 graph edges (secures +9, uses +44, routes +8, triggers +7, attaches
  +4, replicates +1), 49 → 49 dangling references, all of them what the demo intends (31 public images, 6
  Google-managed tenant projects, 5 Google-managed logging writer identities, 3 `gke.gcr.io` images, 2
  `all-apis` bundles, 2 Compute default service accounts the demo does not generate); 17 managed VMs nest in
  their instance groups and the 4 connectors in their VPC.
