<!-- SPDX-License-Identifier: Apache-2.0 -->

# Asset catalog follow-ups

The asset catalog's own backlog, by product group. It is written for a maintainer with access to a real Cloud
Asset Inventory export and to the engine code: every item either needs evidence that public documentation
could not give, or a change outside the catalog's data files (the compiler and normalisers in
`packages/catalog/src/`, the schemas in `packages/model`, the graph builder, the demo generator). Take an item
off this list in the pull request that settles it.

`pnpm catalog:coverage` reports the current mapped types and each group's unmapped reasons;
[the coverage page](https://gcportrait.app/coverage/) publishes the report for the site. `pnpm catalog:check`
checks each rule's fixture and both sides of every `hiddenWhen` predicate.

How to read an item: **what** is open, **where** it bites (types and fields), and **how to settle** it. "Real
export" means one read-only `gcloud asset search-all-resources` or `gcloud asset export` of the type in a real
organisation, looking at the asset `name`, `resource.parent` and the field in question.

## 1. Engine and schema work (cross-cutting)

The engine's rules are in the catalog README and the gcp-asset-catalog skill, and the graph builder's in
`packages/graph/README.md` ([packages/AGENTS.md](../packages/AGENTS.md), "Catalog and graph semantics").
What is still open:

### 1.1 Project id versus project number in resource names

The graph builder tries a reference that matches no asset once more with its project segment swapped between
id and number, so an edge resolves whichever form the API wrote. Open: several fixtures and the demo generator
write a form that resolves without the swap (their notes say so); switching them to the documented forms would
exercise the swap on more types (section 2).

### 1.2 Rules the schema cannot express

- **Badges**: the entry schema has no badge field, so subnet purpose, Cloud NAT, PSC, IAP, CDN, DNSSEC,
  connection preference and "suspended" exist only in notes.
- **Per-container count thresholds** (the seed's "BigQuery tables hidden above 50 per dataset", "Bigtable
  tables above 30").

### 1.3 Normalisers: rules not written yet, and forms no normaliser reads

The `siblingName` and `k8sRef` normalisers could resolve these references, but they have no rule
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
  `InternalRange.network`), a leading slash `/projects/…` (the Cloud SQL `privateNetwork` example,
  InternalRange migration, GKE `networking.gke.io/*` annotations, Financial Services),
  `gce://<project>/<zone>/<instance>` (k8s Node `spec.providerID` → Instance).
- **Other forms**: `cloudSqlConnectionName` for `projects/<p>/locations/<l>/instances/<i>` (Firebase Data
  Connect); `gcsUri` for `projects/<p>/buckets/<b>` and `//storage.googleapis.com/projects/<p>/buckets/<b>`
  (Dataplex Asset and DataScan; today it reads "projects" as the bucket); a version-to-secret option, since
  Secret Manager versions are hidden and most references name a version; service-account unique ids
  (`projects/{p}/accounts/{id}`, API Gateway); trimming Dialogflow `/environments/<env>` suffixes; an
  Artifact Registry upstream given as a repository URL.

### 1.4 Templates and the checker

- No enum-prefix filter (`LINK_TYPE_…`, `SOLUTION_TYPE_…`, `JOB_STATE_…` render raw and lower-cased).
- `first(…)` names the variant a union-shaped resource holds by its value, not by which key is set: Pub/Sub
  delivery type, Datastream profile kind, Storage Transfer source and DNS response-policy rule behavior want
  the key's name, which needs a literal argument or a key filter.

- **Console templates.** 265 types have no `console` template (`pnpm catalog:check`, the list with
  `--verbose`); the app offers their project's console home instead ("Open project in Cloud Console"). Four
  types have no template, because the only page known for them is a list page, not the resource (App Hub
  `Service`, `Workload` and `ServiceProjectAttachment`, the App Hub applications page; the Hub `Membership`,
  the Kubernetes clusters page): they fall back to the project until someone confirms their resources' exact
  pages (261 → 265). Older templates still open list pages (Apigee environments and instances, Network
  Services meshes, edge caches and service extensions, Developer Connect, the App Hub `Application`,
  Memorystore for Redis clusters and Valkey instances, Storage Transfer, Infra Manager, Serverless VPC Access,
  several Vertex AI types): the same question per type. Still without a template among the types demo M draws:
  Backup and DR, Backup for GKE, the Kubernetes `ServiceAccount`, Security Command Center notification and
  export configs, the Cloud Asset feed and the Compute `ResourcePolicy`.

### 1.5 Graph builder

- **IP-match edges** (the seed's DNS record set → forwarding rule `uses` by IP) are not implemented; the
  addresses are indexed only.
- **App Hub applications** keep the `product` zone kind: the scene treats `group` zones as label bundles that
  never collapse and count as bundles, so drawing applications in a logical lens only (the intent recorded in
  layout skill §2) needs a scene decision first.
- **Shared VPC with producer networks peered into a host's network** still counts (a Cloud Build private pool
  peered into the host's shared network): the Shared VPC rule cannot tell it from a service project's
  database on the host network. A real export would show whether the pool's project is a service project.

### 1.6 Icons

Infra Manager, App Design Center, App Lifecycle Manager, Network Security Integration and Workload Manager may
have no official product icon; the category fallback applies until `packages/icons` decides.

The weekly `icon-drift.yml` (`pnpm --filter @gcportrait/icons drift`) reports when Google Cloud's icon page
(<https://cloud.google.com/icons>) gains an icon for one of the 73 product keys still on a legacy console
symbol or the 44 on a category mark; adopt it in `packages/icons/mapping.json` as the README's "Keeping the
icons current" describes.

## 2. Demo data (`packages/demo-data`)

The demo generator has a case per catalog group for M and larger (the demo-data README's "Catalog generator
cases"): Artifact Registry repositories for every image path the assets name, and the Tier-1 types the groups
asked for, from Network Connectivity Center, Cloud NGFW Enterprise, hierarchical firewall policies and Private
Service Connect to Cloud DNS policies, logging sinks, alerting, Backup and DR, Certificate Manager, the data
platform (Memorystore, Filestore, AlloyDB, Spanner, Bigtable, Composer, Dataproc, Dataflow, Metastore),
Vertex AI and Discovery Engine, Cloud Build, Cloud Deploy, Infra Manager, Binary Authorization, CA Service,
workload identity federation and Cloud IDS. Still open:

- **Size of M.** Above the ≈600 assets the demo was designed for (cai-ingestion skill §7; current counts in
  [modes.md](modes.md#4-the-demo)). Bringing it
  back (under 800, say) means trimming M's base, which changes many pinned graph goldens and the layout
  goldens on M, or moving cases such as the VM or ML project to L only.
- **S has no generator cases**, so its container images, function builds and Cloud Build images name Artifact
  Registry repositories that do not exist. `packages/graph/test/demo.test.ts` exempts them for S only (M's
  history resolves every repository at every tick); giving S the `registries` case would remove the exemption.
- **S emits pods without their nodes.** Its GKE cluster's two pods name a node in `spec.nodeName`
  (`gke-retail-prod-default-…`), drawn through `k8sRef`, but S has no `k8s.io/Node` asset, so the two
  references dangle. The demo test exempts them for S; emitting the node in S (M does)
  would remove the exemption.
- **App Hub.** The generator emits the `storefront` application now; the graph view tests still add their own
  (`applicationAssets` in `packages/graph/test/views/fixtures.ts`) and could move onto the generated one.
- **Documented forms left out**, because the catalog maps them to no asset yet (§1.3): a Service Directory
  endpoint's `network` (`projects/<number>/locations/global/networks/<n>`) and Dataplex bucket assets
  (`projects/<number>/buckets/<b>`). The Private Service Connect endpoint for Google APIs targets the bundle
  `all-apis`, which the forwarding-rule rule reads as a dangling reference; skipping bundle names (`all-apis`,
  `vpc-sc`) in that rule would avoid it.
- **Project id versus number (§1.1).** The generator writes some references in a project-number form that
  resolves without the swap (an attestor as `projects/<number>/attestors/…`, alert channels as
  `projects/<number>/notificationChannels/…`). The graph matches either form (only M's private services
  access ranges exercise the swap today); writing ids where the APIs document them would show it on more
  types.
- **Realism notes.** Demo zones are named by zone name rather than the numeric id CAI uses, and record sets
  without `locations/global` (see Cloud DNS in §3).
- **Ignored source directory.** The root `.gitignore` rule `build/` matches any directory of that name, so a
  source directory named `build/` would stay out of git unnoticed; narrowing the rule to `/build/` would
  prevent that.

## 3. Open questions and unverified paths, by service

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
- GKE-managed firewall rules and routes-based GKE node routes start hidden (names `gke-…`,
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
- Console URLs: every load-balancing deep link (`loadbalancing/advanced/…`,
  `loadbalancing/backends/details/…`, `loadbalancing/details/http/<urlmap>`), Certificate Manager, API
  Gateway, Cloud Domains, service mesh, Media CDN, service extensions, Secure Web Proxy.

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
  managedZones/ZONE_NUMBER` and record sets
  `projects/PROJECT_NUMBER/locations/LOCATION/managedZones/…/rrsets/…`, so nesting relies on `parent`. Settle
  with one real export.
- `RESOURCE_RECORD_SET` assumed `<name>/<type>`; response policy names assumed to be the policy name, not its
  id.
- Enum case of `visibility` and friends (the REST reference is lower case; subtitles lower-case anyway).
- A zonal GKE cluster as `gkeClusterName` (`…/locations/<zone>/clusters/…`) may not match the cluster asset
  (`…/zones/<zone>/clusters/…`).
- DNS peering is drawn as symmetric `peers`; it is directional in reality.
- GKE cluster-scope zones (one or two per Cloud DNS cluster) may need a `hiddenWhen`.
- Console: the ManagedZone detail link (`net-services/dns/zones/<name>/details`) is unverified; list links
  use `networking/dns/zones`, the form the Cloud DNS documentation links.

### GKE, Kubernetes objects, fleets, multi-cloud and on-premises, Backup for GKE

- gkehub asset names: the asset-names page says PROJECT_ID, GKE's `fleet.membership` and the fixtures use the
  number; the graph matches either (§1.1). The fleet's own name is assumed to be
  `projects/<p>/locations/global/fleets/default` (the membership, scope and feature `nestsIn` rules build it).
- Zonal clusters: `Membership.endpoint.gkeCluster.resourceLink` and `BackupPlan.cluster` use
  `…/locations/<zone>/…`; zonal cluster assets may be `…/zones/<zone>/…`.
- Paths from knowledge only: Backup for GKE `backupConfig.encryptionKey.gcpKmsEncryptionKey`, multi-cloud and
  on-prem `fleet.membership`, `AzureCluster.azureClient`, bare-metal node pool `nodeIp`, gkehub Fleet,
  Feature, Scope, MembershipBinding and RBACRoleBinding fields, the PD CSI `volumeHandle` form, the
  `iam.gke.io/gcp-service-account` annotation, `anthos.googleapis.com/ConnectedCluster` (shape undocumented).
- Drawn through `k8sRef`: Pod → Node, Ingress and HTTPRoute → Service, HTTPRoute → Gateway, PV ↔ PVC,
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
- Eventarc `Pipeline.destinations[*].topic` (`projects/<p>/locations/<l>/topics/<t>`, not a Pub/Sub name) is
  not read.

### Cloud Storage, BigQuery family, Cloud SQL, Spanner, Bigtable, AlloyDB, Firestore

- Cloud SQL replication is drawn (a reverse rule on the replica's `masterInstanceName`); Cloud SQL
  `pscConfig.allowedConsumerProjects` (an allow list, consumer → instance) is not.
- Formats unconfirmed: AlloyDB `primaryConfig.secondaryClusterNames` and `Backup.clusterName`, Cloud SQL
  `Backup.kmsKey` (key or key version; both normalise), Cloud SQL `pscAutoConnections`, BigQuery
  `biglakeConfiguration`, `cloneDefinition`, `snapshotDefinition`, `linkedDatasetSource`, BI reservations and
  reservation groups, `MigrationWorkflow` state `COMPLETED`.
- Please confirm the hiding rules beyond the seed: datasets whose id starts with `_`, and platform staging
  buckets (`gcf-sources-`, `gcf-v2-sources-`, `gcf-v2-uploads-`, `run-sources-`, `*_cloudbuild`,
  `dataproc-staging-`/`-temp-`, `staging.*`/`artifacts.*.appspot.com`).
- BigQuery `ReservationAssignment` reads its assignee through filters over every string value of `data`.
- Bigtable fixtures carry no `location` and parent backups, authorized views and schema bundles on the
  instance.
- Console URLs: BigQuery models and routines, Bigtable sub-pages, Spanner, AlloyDB and Filestore backups,
  the Redis detail path, Parallelstore.

### Memorystore, Redis, Memcached, Filestore, NetApp Volumes, Managed Lustre, Parallelstore, Oracle Database

- Memorystore and Redis Cluster draw `uses` from the instance to the consumer's PSC forwarding rule (the
  attachment side lives in a Google tenant project).
- Formats unconfirmed: Oracle `peerAutonomousDatabases`, NetApp `StoragePool.activeDirectory`/`kmsConfig`
  and `Volume.backupConfig.backupPolicies` (id or full name), Memcached `authorizedNetwork`.
- Parallelstore's documentation redirects to Managed Lustre: the product may be on a deprecation path.
- No verifiable console link for Oracle Autonomous Database.

### Data processing and messaging

Services: Pub/Sub, Managed Kafka, Dataflow, Dataproc, Metastore, Composer, Data Fusion, Dataform, Dataplex,
Data Lineage, Datastream, Database Migration, Healthcare, Looker, Storage Transfer, Storage Insights, Storage
Batch Operations.

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

### AI

Services: Vertex AI, Discovery Engine, Dialogflow, Document AI, Speech-to-Text, Retail, Gemini, Customer
Experience Insights.

- Tabular and time-series `Dataset.metadata.inputConfig`: the rules read the SDK/console shape
  (`gcsSource.uri[]`, `bigquerySource.uri`); the published schema sketches a discriminated union.
- Formats unconfirmed: `PSCAutomationConfig.forwardingRule`, the AlloyDB federated-search instance,
  `NotebookRuntime.proxyUri` host, whether CAI returns `Collection.dataConnector`.
- Additive references not read yet: reservation affinity on IndexEndpoint, NotebookRuntime and
  NotebookRuntimeTemplate; ReasoningEngine `spec.buildSpec.workerPool`; Discovery Engine
  `cmekConfig.singleRegionKeys[*].kmsKey` and `workspaceConfig.superAdminServiceAccount`; Model
  `originalModelInfo.model`; Dialogflow CX `bigqueryExportSettings` (v3beta1 only).
- Console URLs: `speech/recognizers`, `gemini-code-assist/code-customization`, `ai/retail/catalogs/<c>/data`,
  legacy `vertex-ai/features`, and the `agent-platform` pages for agent engines, index endpoints, datasets,
  custom and tuning jobs, the Dialogflow CX agent deep link.

### Security and identity

Services: IAM, KMS, Secret and Parameter Manager, CA Service, Access Context Manager, Binary Authorization,
Security Command Center, DLP, reCAPTCHA, BeyondCorp, IAP, Managed AD, IDS, Web Security Scanner, Assured
Workloads, Org Policy.

- Binary Authorization `requireAttestationsBy` resolves with either project form (§1.1); whether
  `data.name` carries the id or the number is still unconfirmed.
- Workload identity pool, provider, key, namespace and managed-identity asset names: the asset-names page says
  PROJECT_ID, the IAM API and `PolicyBinding.target.principalSet` the number; the fixtures use the number.
- `apikeys.googleapis.com/Key`: the asset-names page (id) and the API Keys reference (number) disagree.
- `AppGateway.uri` assumed to be an https URL; `AppConnection.gateway.appGateway` may be spelled with the
  collection `appgateways`.
- Signing keys are drawn as `uses`, not `encryptedBy` (CA keys, attestor public keys, Access Approval's
  signing key): signing is not encryption at rest; revisit if the security lens should
  layer them with CMEK.
- Engine limits: Assured Workloads `CONSUMER_FOLDER` and the DLP organisation/folder discovery scope are bare
  numbers; Binary Authorization `clusterAdmissionRules` keys name clusters (map keys are not readable);
  ServicePerimeter ingress/egress rules and dry-run spec, AccessLevel members, Identity Platform blocking
  functions, DLP wrapped keys are not read.
- `memberOf` is used for CryptoKeyVersion → CryptoKey and DlpJob → JobTrigger (both hidden).
- Console links without context: AccessLevel and ServicePerimeter (no organisation), regional secrets (no
  location), CA Service, DLP, Parameter Manager, reCAPTCHA, IDS, Managed AD, Web Security Scanner.

### Developer tooling and delivery

Services: Cloud Build, Artifact Registry, Container Registry, Cloud Deploy, Developer Connect, Secure Source
Manager, Infra Manager, App Design Center, App Lifecycle Manager.

- Formats unconfirmed: App Design Center `Application.apphubApplication` and `serviceAccount`,
  `Component.sharedTemplateRevisionUri` (the `google/<template>/revisions/<rev>` catalog form always dangles),
  the ApplicationTemplateRevision name and the App Design Center asset-name format; App Lifecycle Manager
  references (relative names in the same service assumed); GlobalTriggerSettings and Container Registry
  `Image` have no public schema; Cloud Build's `developerConnectEventConfig.gitRepositoryLink` is spelled
  `gitRepositoryLink/*` in its reference (Developer Connect's real collection `gitRepositoryLinks` is used).
- Not read yet: BuildTrigger `gitFileSource.*`, `sourceToBuild` enterprise configs,
  `availableSecrets.secretManager[*].versionName`, `pubsubConfig.serviceAccountEmail`; Build
  `artifacts.images`, `source.gitSource.url`; Cloud Deploy custom-target skaffold sources; Developer Connect
  `InsightsConfig.runtimeConfigs` and `projects.projectIds`; Secure Source Manager `pscAllowedProjects`; Infra
  Manager Preview inputs; Artifact Registry upstream repositories given as URLs.
- Console URLs: Cloud Build worker pools and 1st/2nd gen repositories, Developer Connect, Secure Source
  Manager, Infra Manager, Cloud Deploy targets, custom target types and deploy policies.

### Operations and platform

Services: Logging, Monitoring, OS Config, Asset Inventory, Billing, Service Usage and Management, Service
Directory, App Hub, Backup and DR, Application Integration, Integration Connectors, Apigee, API hub, Firebase,
media APIs, Financial Services, Blockchain Node Engine, KRM API Hosting, Workload Manager, Migration Center,
Cloud Controls Partner.

- Logging sinks into central log buckets resolve with either project form (§1.1); hiding every project's
  `_Default` and `_Required` buckets means a sink into another project's `_Default` bucket points at a hidden
  node.
- Service Directory `Endpoint.network` (`projects/<number>/locations/global/networks/<n>`, §1.3) and Firebase
  Data Connect Cloud SQL instances (§1.3) always dangle today.
- App Hub `serviceReference.uri`/`workloadReference.uri` use `computeRelative`, so a Compute registration
  resolves with either project form; whether the API writes numbers for other services is open. Managed
  instance groups register as instance groups (the fixtures and graph tests say so).
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
