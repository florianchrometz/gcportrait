<!-- SPDX-License-Identifier: Apache-2.0 -->

# Lenses, focus views, filters and drill-in

A snapshot of an organisation holds hundreds or thousands of assets; a readable diagram shows a part of them.
The top bar of the diagram page chooses that part with five controls: the **lens** (which kinds of resources
and arrows), the **focus** (which projects), the **filters** (what else to keep or leave out), the **detail**
level (how deep zones open), and the **breadcrumb**, which shows where you drilled in. Each of them is part of
the link, so a reload, Back, a copied link or a saved view shows exactly the same diagram. This guide explains
each one with its exact rules.

| Section | |
|---|---|
| [1. How a view is put together](#1-how-a-view-is-put-together) | The order of the steps, and the link. |
| [2. Lenses](#2-lenses) | The 11 lenses: what each is for, the arrows it draws, how deep it opens, and its type bundle. |
| [3. What an arrow means](#3-what-an-arrow-means) | The 13 relation kinds. |
| [4. Focus views](#4-focus-views) | A project, a Shared VPC, standalone projects, a perimeter, an application. |
| [5. Filters](#5-filters) | Every filter, its control, its key in the link and its exact rule. |
| [6. Drill-in and the breadcrumb](#6-drill-in-and-the-breadcrumb) | Make any container the whole canvas, and get back out. |
| [7. Detail levels and chips](#7-detail-levels-and-chips) | `auto`, the levels, collapsed zones, "Expand all", "N of M shown". |
| [8. Search and the details drawer](#8-search-and-the-details-drawer) | Finding one resource, and everything about it. |

To try everything below without a Google account, run the demo ([modes.md](modes.md#4-the-demo)) and open
`/diagram#snapshot=demo:M`.

## 1. How a view is put together

gcportrait builds the diagram from the snapshot in these steps, each working on what the step before left
(`@gcportrait/graph`, [packages/graph/README.md](../packages/graph/README.md), "Composition order"):

1. **Root** (drill-in): the container you drilled into becomes the canvas; nothing above or beside it is
   drawn. Without one, the organisation is the canvas.
2. **Focus**: picks projects out of what the root left (a project, a Shared VPC, standalone projects, a
   perimeter, an application).
3. **Lens**: keeps the asset types the lens lists, plus the types you include, minus the types you exclude;
   and chooses which relation kinds are drawn as arrows.
4. **Filters**: regions, projects, folders, and the three "hide" switches.
5. **Detail level**: which zones are drawn open and which collapsed into chips.

Because the filters come after the root and the focus, every filter also holds under a drill-in and under
every focus view. The link carries the whole view in its hash, for example:

```text
/diagram#snapshot=demo:M&lens=networking&focus=shared-vpc&focus.host=demo-net-1&detail=networks&hide=empty-projects
```

A value equal to its default is left out (the overview lens, `auto` detail, no filters), so the default view
of a snapshot is just `#snapshot=…`. [packages/model/README.md](../packages/model/README.md), "URL-hash
codec", lists every key.

## 2. Lenses

A lens is a named bundle of asset types and of the relation kinds drawn between them (data, not code). The 11
lenses are files in [packages/catalog/lenses/](../packages/catalog/lenses/), each a curated list of types with
a comment on why it takes them. The table and the bundles below are generated from them (`node
scripts/user-docs.mjs --write` writes them again after a lens file changed).

<!-- user-docs:lens-table:start (generated from packages/catalog/lenses/ by `node scripts/user-docs.mjs --write`; do not edit) -->
| Lens | What it is for | Arrows it draws | `auto` opens at most at | Hidden types |
|---|---|---|---|---|
| **Overview** (`overview`) | The architecture at a glance: the resource hierarchy, networks, load balancing, compute, serverless and data stores. Hidden operational records, identities and keys stay out. | `attaches`, `routes`, `uses`, `peers`, `connects`, `memberOf`, `triggers`, `replicates`, `shares` | no limit | held back (`N hidden`) |
| **Networking** (`networking`) | VPC networks, subnets, routing, firewalls, private connectivity, hybrid links and DNS: how the networks are built and joined. | `attaches`, `peers`, `connects`, `routes`, `uses`, `secures`, `shares` | `networks` | held back (`N hidden`) |
| **Load balancing** (`load-balancing`) | Traffic paths from forwarding rules through proxies, URL maps and backend services to instance groups, network endpoint groups, buckets and serverless backends, with certificates and edge security. | `routes`, `uses`, `attaches`, `secures`, `memberOf` | `all` | held back (`N hidden`) |
| **Compute** (`compute`) | Virtual machines and what they are made of: instances, disks, images, templates, groups and autoscalers, sole tenancy and reservations, TPUs, workstations, notebooks, batch and VMware Engine. | `attaches`, `uses`, `memberOf`, `routes`, `replicates`, `peers`, `connects` | `networks` | held back (`N hidden`) |
| **Serverless** (`serverless`) | Cloud Run, Cloud Run functions, App Engine, Eventarc, Cloud Tasks and Workflows, with the topics, connectors, secrets, databases and buckets they use. | `triggers`, `uses`, `attaches`, `routes`, `memberOf` | `projects` | held back (`N hidden`) |
| **Kubernetes** (`kubernetes`) | GKE clusters, node pools, namespaces and workload objects, fleets, multi-cloud and on-premises clusters, and Backup for GKE. | `attaches`, `uses`, `memberOf`, `routes` | `all` | held back (`N hidden`) |
| **Data** (`data`) | Storage, databases, analytics, messaging and AI: buckets, BigQuery, Cloud SQL, Spanner, Bigtable, AlloyDB, Firestore, Memorystore, file storage, Pub/Sub and Kafka, Vertex AI, and the pipelines between them. | `uses`, `attaches`, `replicates`, `triggers` | `projects` | held back (`N hidden`) |
| **Security** (`security`) | Keys and what they encrypt, secrets, certificate authorities, perimeters and access levels, firewall and security policies, tags, and the security products watching over them. | `secures`, `encryptedBy`, `uses`, `attaches`, `triggers` | `projects` | held back (`N hidden`) |
| **Identity** (`identity`) | Service accounts, workload and workforce identity, and which workloads run as which identity. | `runsAs`, `uses`, `memberOf`, `secures` | `projects` | held back (`N hidden`) |
| **Operations** (`operations`) | Logging sinks and buckets, monitoring and alerting, OS configuration, asset feeds, billing, enabled services, service directories, App Hub, backups, migrations and the delivery pipeline. | `uses`, `triggers`, `secures`, `memberOf` | `projects` | held back (`N hidden`) |
| **Everything** (`everything`) | Every asset type and every relation kind, hidden types included. Useful for search and for checking coverage; large organisations need filters to stay readable. | `attaches`, `routes`, `uses`, `peers`, `connects`, `memberOf`, `runsAs`, `encryptedBy`, `secures`, `triggers`, `replicates`, `shares` | no limit | shown |
<!-- user-docs:lens-table:end -->

How to read it:

- **Arrows it draws.** `contains` is in every lens but is never an arrow: it is the nesting itself. An arrow
  is drawn only when both of its ends are in the view, so a lens lists the targets its arrows need (a `uses`
  edge to a type the lens does not list is not drawn there). Apart from Everything, two kinds belong to one
  lens each: `runsAs` (which identity a workload runs as) to Identity, unless Filters › Identities says Show,
  and `encryptedBy` (customer-managed keys) to Security.
- **`auto` opens at most at.** With the detail level at `auto`, a lens never opens deeper than this level, so
  it opens readable at any size ([section 7](#7-detail-levels-and-chips)), unless the whole view has at most
  100 rectangles: then it opens whole. A level you choose yourself is not capped.
- **Hidden types.** Some types are hidden by default because they are records rather than architecture:
  enabled services, Cloud Build builds, key versions, DNS record sets, tag bindings, Kubernetes RBAC objects.
  A lens draws them only when it says so (Everything), or when you include their type (`Include types`);
  otherwise each zone counts them in an `N hidden` badge.
- **Switching lenses.** While the detail level is `auto` (or the lens's own default), it follows the lens; a
  level you chose stays when you switch.
- **Asset types the catalog does not know** are in no lens but Everything (`*`); they render there, or in any
  lens once you include their type, as generic cards in their project
  ([faq.md](faq.md#what-happens-with-an-asset-type-gcportrait-does-not-know)).

### Type bundles

Each lens lists asset types (`compute.googleapis.com/Instance`), every type of a service
(`run.googleapis.com/*`), or every type there is (`*`). Grouped by service, in the order the lens file lists
them:

<!-- user-docs:lens-types:start (generated from packages/catalog/lenses/ by `node scripts/user-docs.mjs --write`; do not edit) -->
**Overview** (`overview`): 97 entries

- `cloudresourcemanager.googleapis.com`: Organization, Folder, Project
- `compute.googleapis.com`: Network, Subnetwork, Router, NetworkAttachment, ServiceAttachment, Interconnect,
  InterconnectAttachment, VpnGateway, ExternalVpnGateway, TargetVpnGateway, VpnTunnel, CrossSiteNetwork,
  WireGroup, ForwardingRule, GlobalForwardingRule, TargetHttpProxy, TargetHttpsProxy, TargetGrpcProxy,
  TargetSslProxy, TargetTcpProxy, TargetPool, TargetInstance, UrlMap, BackendService, RegionBackendService,
  BackendBucket, NetworkEndpointGroup, Instance, InstanceGroup, InstanceGroupManager
- `networkconnectivity.googleapis.com`: Hub, Spoke
- `servicenetworking.googleapis.com`: Connection
- `vpcaccess.googleapis.com`: Connector
- `dns.googleapis.com`: ManagedZone
- `networkservices.googleapis.com`: Gateway, Mesh, HttpRoute, GrpcRoute, TcpRoute, TlsRoute, EdgeCacheService,
  EdgeCacheOrigin
- `apigateway.googleapis.com`: Gateway
- `apigee.googleapis.com`: Organization, Environment, Instance
- `tpu.googleapis.com`: Node
- `notebooks.googleapis.com`: Instance
- `workstations.googleapis.com`: WorkstationCluster
- `hypercomputecluster.googleapis.com`: Cluster
- `batch.googleapis.com`: Job
- `vmwareengine.googleapis.com`: VmwareEngineNetwork, PrivateCloud
- `container.googleapis.com`: Cluster, NodePool
- `run.googleapis.com`: every type (`*`)
- `cloudfunctions.googleapis.com`: every type (`*`)
- `appengine.googleapis.com`: every type (`*`)
- `eventarc.googleapis.com`: every type (`*`)
- `workflows.googleapis.com`: every type (`*`)
- `cloudtasks.googleapis.com`: every type (`*`)
- `storage.googleapis.com`: Bucket
- `bigquery.googleapis.com`: Dataset
- `sqladmin.googleapis.com`: every type (`*`)
- `spanner.googleapis.com`: Instance, Database
- `bigtableadmin.googleapis.com`: Instance, Cluster
- `alloydb.googleapis.com`: every type (`*`)
- `firestore.googleapis.com`: Database
- `redis.googleapis.com`: every type (`*`)
- `memorystore.googleapis.com`: every type (`*`)
- `memcache.googleapis.com`: every type (`*`)
- `file.googleapis.com`: Instance
- `netapp.googleapis.com`: StoragePool, Volume
- `lustre.googleapis.com`: every type (`*`)
- `parallelstore.googleapis.com`: every type (`*`)
- `oracledatabase.googleapis.com`: every type (`*`)
- `pubsub.googleapis.com`: Topic, Subscription
- `managedkafka.googleapis.com`: Cluster
- `composer.googleapis.com`: Environment
- `dataproc.googleapis.com`: Cluster
- `dataflow.googleapis.com`: Job
- `metastore.googleapis.com`: Service
- `datafusion.googleapis.com`: Instance
- `datastream.googleapis.com`: Stream
- `looker.googleapis.com`: Instance
- `healthcare.googleapis.com`: Dataset
- `dataplex.googleapis.com`: Lake, Zone
- `dataform.googleapis.com`: Repository

**Networking** (`networking`): 64 entries

- `cloudresourcemanager.googleapis.com`: Organization, Folder, Project
- `compute.googleapis.com`: Network, Subnetwork, Route, Router, Address, GlobalAddress, Firewall,
  FirewallPolicy, NetworkAttachment, ServiceAttachment, PacketMirroring, PublicAdvertisedPrefix,
  PublicDelegatedPrefix, NetworkEdgeSecurityService, ForwardingRule, GlobalForwardingRule,
  NetworkEndpointGroup, Interconnect, InterconnectAttachment, VpnGateway, ExternalVpnGateway,
  TargetVpnGateway, VpnTunnel, CrossSiteNetwork, WireGroup
- `networkconnectivity.googleapis.com`: every type (`*`)
- `servicenetworking.googleapis.com`: every type (`*`)
- `vpcaccess.googleapis.com`: every type (`*`)
- `networkmanagement.googleapis.com`: every type (`*`)
- `dns.googleapis.com`: every type (`*`)
- `domains.googleapis.com`: every type (`*`)
- `servicedirectory.googleapis.com`: every type (`*`)
- `networksecurity.googleapis.com`: FirewallEndpoint, FirewallEndpointAssociation, SecurityProfile,
  SecurityProfileGroup, AddressGroup, TlsInspectionPolicy, DnsThreatDetector, InterceptDeployment,
  InterceptDeploymentGroup, InterceptEndpointGroup, InterceptEndpointGroupAssociation, MirroringDeployment,
  MirroringDeploymentGroup, MirroringEndpointGroup, MirroringEndpointGroupAssociation
- `networkservices.googleapis.com`: Gateway
- `ids.googleapis.com`: Endpoint
- `vmwareengine.googleapis.com`: VmwareEngineNetwork, NetworkPeering, NetworkPolicy, PrivateConnection,
  PrivateCloud
- `datastream.googleapis.com`: PrivateConnection
- `datamigration.googleapis.com`: PrivateConnection
- `connectors.googleapis.com`: EndpointAttachment, ManagedZone
- `cloudbuild.googleapis.com`: WorkerPool
- `workstations.googleapis.com`: WorkstationCluster
- `managedidentities.googleapis.com`: Domain

**Load balancing** (`load-balancing`): 59 entries

- `cloudresourcemanager.googleapis.com`: Organization, Folder, Project
- `compute.googleapis.com`: Network, Subnetwork, ForwardingRule, GlobalForwardingRule, TargetHttpProxy,
  TargetHttpsProxy, TargetGrpcProxy, TargetSslProxy, TargetTcpProxy, TargetPool, TargetInstance, UrlMap,
  BackendService, RegionBackendService, BackendBucket, NetworkEndpointGroup, HealthCheck, HttpHealthCheck,
  HttpsHealthCheck, SslCertificate, SslPolicy, SecurityPolicy, NetworkEdgeSecurityService, InstanceGroup,
  InstanceGroupManager, Autoscaler, Instance, Address, GlobalAddress, PublicDelegatedPrefix, ServiceAttachment
- `certificatemanager.googleapis.com`: every type (`*`)
- `privateca.googleapis.com`: CaPool
- `networkservices.googleapis.com`: every type (`*`)
- `servicedirectory.googleapis.com`: Service
- `networksecurity.googleapis.com`: AuthzPolicy, AuthorizationPolicy, ServerTlsPolicy, ClientTlsPolicy,
  GatewaySecurityPolicy, UrlList
- `apigateway.googleapis.com`: every type (`*`)
- `apigee.googleapis.com`: Organization, Environment, Instance
- `domains.googleapis.com`: every type (`*`)
- `dns.googleapis.com`: ManagedZone
- `run.googleapis.com`: Service, DomainMapping
- `cloudfunctions.googleapis.com`: Function, CloudFunction
- `appengine.googleapis.com`: Service
- `storage.googleapis.com`: Bucket
- `networking.k8s.io`: Ingress
- `gateway.networking.k8s.io`: Gateway, HTTPRoute

**Compute** (`compute`): 32 entries

- `cloudresourcemanager.googleapis.com`: Organization, Folder, Project
- `compute.googleapis.com`: Network, Subnetwork, Instance, Disk, RegionDisk, Image, MachineImage, Snapshot,
  InstantSnapshot, InstanceTemplate, InstanceGroup, InstanceGroupManager, Autoscaler, NodeGroup, NodeTemplate,
  Reservation, Commitment, ResourcePolicy, StoragePool
- `tpu.googleapis.com`: every type (`*`)
- `hypercomputecluster.googleapis.com`: every type (`*`)
- `workstations.googleapis.com`: every type (`*`)
- `notebooks.googleapis.com`: every type (`*`)
- `batch.googleapis.com`: every type (`*`)
- `vmwareengine.googleapis.com`: every type (`*`)
- `dataproc.googleapis.com`: Cluster
- `aiplatform.googleapis.com`: NotebookRuntime, NotebookRuntimeTemplate, DeploymentResourcePool

**Serverless** (`serverless`): 27 entries

- `cloudresourcemanager.googleapis.com`: Organization, Folder, Project
- `compute.googleapis.com`: Network, Subnetwork, NetworkAttachment
- `run.googleapis.com`: every type (`*`)
- `cloudfunctions.googleapis.com`: every type (`*`)
- `appengine.googleapis.com`: every type (`*`)
- `eventarc.googleapis.com`: every type (`*`)
- `cloudtasks.googleapis.com`: every type (`*`)
- `workflows.googleapis.com`: every type (`*`)
- `apigateway.googleapis.com`: every type (`*`)
- `integrations.googleapis.com`: every type (`*`)
- `connectors.googleapis.com`: every type (`*`)
- `firebase.googleapis.com`: every type (`*`)
- `firebasedataconnect.googleapis.com`: every type (`*`)
- `aiplatform.googleapis.com`: ReasoningEngine
- `vpcaccess.googleapis.com`: every type (`*`)
- `pubsub.googleapis.com`: Topic, Subscription
- `secretmanager.googleapis.com`: Secret
- `sqladmin.googleapis.com`: Instance
- `storage.googleapis.com`: Bucket
- `artifactregistry.googleapis.com`: Repository
- `cloudbuild.googleapis.com`: WorkerPool
- `clouddeploy.googleapis.com`: Target

**Kubernetes** (`kubernetes`): 33 entries

- `cloudresourcemanager.googleapis.com`: Organization, Folder, Project
- `compute.googleapis.com`: Network, Subnetwork, ForwardingRule, GlobalForwardingRule, InstanceGroupManager,
  Disk
- `container.googleapis.com`: every type (`*`)
- `k8s.io`: every type (`*`)
- `apps.k8s.io`: every type (`*`)
- `batch.k8s.io`: every type (`*`)
- `networking.k8s.io`: every type (`*`)
- `extensions.k8s.io`: every type (`*`)
- `gateway.networking.k8s.io`: every type (`*`)
- `autoscaling.k8s.io`: every type (`*`)
- `policy.k8s.io`: every type (`*`)
- `rbac.authorization.k8s.io`: every type (`*`)
- `storage.k8s.io`: every type (`*`)
- `admissionregistration.k8s.io`: every type (`*`)
- `gkehub.googleapis.com`: every type (`*`)
- `gkemulticloud.googleapis.com`: every type (`*`)
- `gkeonprem.googleapis.com`: every type (`*`)
- `anthos.googleapis.com`: every type (`*`)
- `gkebackup.googleapis.com`: every type (`*`)
- `artifactregistry.googleapis.com`: Repository
- `dns.googleapis.com`: ManagedZone, ResponsePolicy
- `composer.googleapis.com`: Environment
- `dataproc.googleapis.com`: Cluster
- `clouddeploy.googleapis.com`: DeliveryPipeline, Target

**Data** (`data`): 54 entries

- `cloudresourcemanager.googleapis.com`: Organization, Folder, Project
- `compute.googleapis.com`: Network, Subnetwork
- `servicenetworking.googleapis.com`: Connection
- `storage.googleapis.com`: every type (`*`)
- `bigquery.googleapis.com`: every type (`*`)
- `bigqueryreservation.googleapis.com`: every type (`*`)
- `analyticshub.googleapis.com`: every type (`*`)
- `bigquerydatatransfer.googleapis.com`: every type (`*`)
- `bigquerymigration.googleapis.com`: every type (`*`)
- `sqladmin.googleapis.com`: every type (`*`)
- `spanner.googleapis.com`: every type (`*`)
- `bigtableadmin.googleapis.com`: every type (`*`)
- `alloydb.googleapis.com`: every type (`*`)
- `firestore.googleapis.com`: every type (`*`)
- `redis.googleapis.com`: every type (`*`)
- `memorystore.googleapis.com`: every type (`*`)
- `memcache.googleapis.com`: every type (`*`)
- `file.googleapis.com`: every type (`*`)
- `netapp.googleapis.com`: every type (`*`)
- `lustre.googleapis.com`: every type (`*`)
- `parallelstore.googleapis.com`: every type (`*`)
- `oracledatabase.googleapis.com`: every type (`*`)
- `firebasedataconnect.googleapis.com`: every type (`*`)
- `pubsub.googleapis.com`: every type (`*`)
- `managedkafka.googleapis.com`: every type (`*`)
- `dataflow.googleapis.com`: every type (`*`)
- `dataproc.googleapis.com`: every type (`*`)
- `metastore.googleapis.com`: every type (`*`)
- `composer.googleapis.com`: every type (`*`)
- `datafusion.googleapis.com`: every type (`*`)
- `dataform.googleapis.com`: every type (`*`)
- `dataplex.googleapis.com`: every type (`*`)
- `datalineage.googleapis.com`: every type (`*`)
- `datastream.googleapis.com`: every type (`*`)
- `datamigration.googleapis.com`: every type (`*`)
- `healthcare.googleapis.com`: every type (`*`)
- `looker.googleapis.com`: every type (`*`)
- `storagetransfer.googleapis.com`: every type (`*`)
- `storageinsights.googleapis.com`: every type (`*`)
- `storagebatchoperations.googleapis.com`: every type (`*`)
- `financialservices.googleapis.com`: every type (`*`)
- `logging.googleapis.com`: LogSink, Link
- `dlp.googleapis.com`: JobTrigger, DiscoveryConfig, StoredInfoType
- `aiplatform.googleapis.com`: every type (`*`)
- `discoveryengine.googleapis.com`: every type (`*`)
- `documentai.googleapis.com`: every type (`*`)
- `speech.googleapis.com`: every type (`*`)
- `retail.googleapis.com`: every type (`*`)

**Security** (`security`): 131 entries

- `cloudresourcemanager.googleapis.com`: every type (`*`)
- `compute.googleapis.com`: Network, Subnetwork, Firewall, FirewallPolicy, SecurityPolicy, SslPolicy,
  SslCertificate, NetworkEdgeSecurityService, PacketMirroring, BackendService, RegionBackendService,
  BackendBucket, TargetPool, TargetInstance, TargetHttpsProxy, TargetSslProxy, ForwardingRule,
  GlobalForwardingRule, Disk, Image, Instance, InstanceTemplate, MachineImage, RegionDisk, Snapshot
- `networkservices.googleapis.com`: Gateway, WasmPlugin
- `networksecurity.googleapis.com`: every type (`*`)
- `certificatemanager.googleapis.com`: every type (`*`)
- `cloudkms.googleapis.com`: every type (`*`)
- `secretmanager.googleapis.com`: every type (`*`)
- `parametermanager.googleapis.com`: every type (`*`)
- `privateca.googleapis.com`: every type (`*`)
- `accesscontextmanager.googleapis.com`: every type (`*`)
- `identity.accesscontextmanager.googleapis.com`: every type (`*`)
- `binaryauthorization.googleapis.com`: every type (`*`)
- `securitycenter.googleapis.com`: every type (`*`)
- `securitycentermanagement.googleapis.com`: every type (`*`)
- `securityposture.googleapis.com`: every type (`*`)
- `dlp.googleapis.com`: every type (`*`)
- `recaptchaenterprise.googleapis.com`: every type (`*`)
- `beyondcorp.googleapis.com`: every type (`*`)
- `iap.googleapis.com`: every type (`*`)
- `ids.googleapis.com`: every type (`*`)
- `websecurityscanner.googleapis.com`: every type (`*`)
- `assuredworkloads.googleapis.com`: every type (`*`)
- `orgpolicy.googleapis.com`: every type (`*`)
- `accessapproval.googleapis.com`: every type (`*`)
- `privilegedaccessmanager.googleapis.com`: every type (`*`)
- `apikeys.googleapis.com`: every type (`*`)
- `iam.googleapis.com`: PolicyBinding, PrincipalAccessBoundaryPolicy, WorkloadIdentityPool, WorkforcePool,
  ServiceAccountKey
- `aiplatform.googleapis.com`: Dataset, DeploymentResourcePool, Endpoint, FeatureOnlineStore, Featurestore,
  Index, IndexEndpoint, Model, NotebookRuntime, NotebookRuntimeTemplate, ReasoningEngine, Tensorboard
- `alloydb.googleapis.com`: Cluster
- `apigee.googleapis.com`: Instance, Organization
- `apihub.googleapis.com`: ApiHubInstance
- `artifactregistry.googleapis.com`: Repository
- `backupdr.googleapis.com`: BackupVault
- `bigquery.googleapis.com`: Dataset, Table
- `bigquerydatatransfer.googleapis.com`: TransferConfig
- `bigtableadmin.googleapis.com`: Cluster
- `cloudaicompanion.googleapis.com`: CodeRepositoryIndex
- `cloudfunctions.googleapis.com`: CloudFunction, Function
- `composer.googleapis.com`: Environment
- `container.googleapis.com`: Cluster, NodePool
- `dataflow.googleapis.com`: Job
- `dataform.googleapis.com`: Repository
- `datafusion.googleapis.com`: Instance
- `datamigration.googleapis.com`: MigrationJob
- `dataplex.googleapis.com`: Task
- `dataproc.googleapis.com`: Cluster
- `datastream.googleapis.com`: Stream
- `developerconnect.googleapis.com`: Connection
- `discoveryengine.googleapis.com`: DataStore, Engine
- `documentai.googleapis.com`: Processor
- `eventarc.googleapis.com`: Channel, GoogleApiSource, MessageBus, Pipeline
- `file.googleapis.com`: Instance
- `financialservices.googleapis.com`: Instance
- `firestore.googleapis.com`: Database
- `gkebackup.googleapis.com`: BackupPlan
- `healthcare.googleapis.com`: Dataset
- `logging.googleapis.com`: LogBucket
- `looker.googleapis.com`: Instance
- `lustre.googleapis.com`: Instance
- `managedkafka.googleapis.com`: Cluster
- `memorystore.googleapis.com`: Instance
- `metastore.googleapis.com`: Service
- `netapp.googleapis.com`: BackupVault, KmsConfig, StoragePool
- `notebooks.googleapis.com`: Instance
- `pubsub.googleapis.com`: Topic
- `redis.googleapis.com`: Cluster, Instance
- `run.googleapis.com`: Job, Service, WorkerPool
- `securesourcemanager.googleapis.com`: Instance
- `spanner.googleapis.com`: Database
- `speech.googleapis.com`: Recognizer
- `sqladmin.googleapis.com`: Instance
- `storage.googleapis.com`: Bucket
- `storage.k8s.io`: StorageClass
- `tpu.googleapis.com`: Node
- `vmmigration.googleapis.com`: Source
- `vmwareengine.googleapis.com`: PrivateCloud
- `workflows.googleapis.com`: Workflow
- `workstations.googleapis.com`: WorkstationConfig

**Identity** (`identity`): 51 entries

- `cloudresourcemanager.googleapis.com`: Organization, Folder, Project
- `iam.googleapis.com`: every type (`*`)
- `identitytoolkit.googleapis.com`: every type (`*`)
- `managedidentities.googleapis.com`: every type (`*`)
- `privilegedaccessmanager.googleapis.com`: every type (`*`)
- `agentidentity.googleapis.com`: every type (`*`)
- `apikeys.googleapis.com`: every type (`*`)
- `beyondcorp.googleapis.com`: AppConnector
- `aiplatform.googleapis.com`: DeploymentResourcePool, Endpoint, FeatureGroup, ReasoningEngine
- `apigateway.googleapis.com`: ApiConfig
- `appengine.googleapis.com`: Application, Version
- `batch.googleapis.com`: Job
- `bigquerydatatransfer.googleapis.com`: TransferConfig
- `cloudbuild.googleapis.com`: BuildTrigger
- `clouddeploy.googleapis.com`: Automation, Target
- `cloudfunctions.googleapis.com`: every type (`*`)
- `cloudtasks.googleapis.com`: Queue
- `composer.googleapis.com`: Environment
- `compute.googleapis.com`: Instance, InstanceTemplate
- `config.googleapis.com`: Deployment
- `connectors.googleapis.com`: Connection
- `container.googleapis.com`: Cluster, NodePool
- `dataflow.googleapis.com`: Job
- `dataform.googleapis.com`: Repository, WorkflowConfig
- `datafusion.googleapis.com`: Instance
- `dataplex.googleapis.com`: Task
- `dataproc.googleapis.com`: Cluster
- `eventarc.googleapis.com`: Pipeline, Trigger
- `k8s.io`: ServiceAccount
- `logging.googleapis.com`: LogSink
- `notebooks.googleapis.com`: Instance
- `pubsub.googleapis.com`: Subscription, Topic
- `run.googleapis.com`: Job, Service, WorkerPool
- `storagetransfer.googleapis.com`: TransferJob
- `tpu.googleapis.com`: Node
- `workflows.googleapis.com`: Workflow
- `workstations.googleapis.com`: WorkstationConfig

**Operations** (`operations`): 50 entries

- `cloudresourcemanager.googleapis.com`: Organization, Folder, Project
- `logging.googleapis.com`: every type (`*`)
- `monitoring.googleapis.com`: every type (`*`)
- `osconfig.googleapis.com`: every type (`*`)
- `cloudasset.googleapis.com`: every type (`*`)
- `cloudbilling.googleapis.com`: every type (`*`)
- `cloudquotas.googleapis.com`: every type (`*`)
- `serviceusage.googleapis.com`: every type (`*`)
- `servicemanagement.googleapis.com`: every type (`*`)
- `servicedirectory.googleapis.com`: every type (`*`)
- `apphub.googleapis.com`: every type (`*`)
- `workloadmanager.googleapis.com`: every type (`*`)
- `essentialcontacts.googleapis.com`: every type (`*`)
- `networkmanagement.googleapis.com`: every type (`*`)
- `securitycenter.googleapis.com`: NotificationConfig, BigQueryExport
- `bigqueryreservation.googleapis.com`: every type (`*`)
- `storageinsights.googleapis.com`: ReportConfig
- `storagetransfer.googleapis.com`: TransferJob
- `backupdr.googleapis.com`: every type (`*`)
- `gkebackup.googleapis.com`: BackupPlan, RestorePlan
- `compute.googleapis.com`: ResourcePolicy, Snapshot, MachineImage, Instance, Disk, RegionDisk, InstanceGroup,
  ForwardingRule, GlobalForwardingRule
- `vmmigration.googleapis.com`: every type (`*`)
- `batch.googleapis.com`: Job
- `cloudbuild.googleapis.com`: every type (`*`)
- `artifactregistry.googleapis.com`: Repository
- `clouddeploy.googleapis.com`: every type (`*`)
- `developerconnect.googleapis.com`: every type (`*`)
- `securesourcemanager.googleapis.com`: every type (`*`)
- `config.googleapis.com`: every type (`*`)
- `storage.googleapis.com`: Bucket
- `bigquery.googleapis.com`: Dataset
- `pubsub.googleapis.com`: Topic
- `sqladmin.googleapis.com`: Instance
- `alloydb.googleapis.com`: Cluster
- `file.googleapis.com`: Instance
- `run.googleapis.com`: Service
- `cloudfunctions.googleapis.com`: Function
- `container.googleapis.com`: Cluster

**Everything** (`everything`): 1 entry

- every asset type (`*`), hidden types included, known to the catalog or not
<!-- user-docs:lens-types:end -->

## 3. What an arrow means

Every arrow is a reference that exists in an asset's own data, found by a catalog rule (the gcp-asset-catalog
skill §4 has the rules for contributors). The last column is the default style; the legend in the diagram's
corner shows exactly how the kinds on screen are drawn, and colour never carries the meaning alone.

| Kind | Meaning | From → to | Style |
|---|---|---|---|
| `contains` | hierarchy and containment: organisation › folder › project › VPC › subnet; cluster › namespace › workload; dataset › table | parent → child | nesting, never an arrow |
| `attaches` | a resource sits on a network or subnet (a VM's interface, a private IP, a connector) | resource → network or subnet | nesting when it is unambiguous, otherwise a thin solid arrow |
| `routes` | a traffic path: forwarding rule → proxy → URL map → backend service → instance group or NEG → backends | upstream → downstream | solid arrow |
| `uses` | any other reference: a VM's disk and image, a function's topic, a sink's bucket | user → used | solid arrow |
| `peers` | a symmetric peering (VPC peering, VMware Engine network peering) | both ways | dashed, two heads |
| `connects` | hybrid connectivity: VPN tunnels and gateways, interconnect attachments and routers, Network Connectivity Center spokes and hubs | end → end | solid, round caps |
| `memberOf` | group membership: a VM in its managed instance group, a cluster in its fleet | member → group | thin dotted |
| `runsAs` | the identity a workload runs as (a service account) | workload → identity | thin dotted; Identity and Everything lenses |
| `encryptedBy` | a customer-managed encryption key | resource → key | thin dotted; Security and Everything lenses |
| `secures` | a policy or perimeter applies to its targets: a service perimeter to its projects, a firewall policy to a network or folder | policy → target | a dashed outline on what it secures, named in the legend; in the Perimeter focus, a zone around the projects |
| `triggers` | eventing: Eventarc, Pub/Sub push, notifications | source → target | solid arrow |
| `replicates` | replicas and cross-region copies (a Cloud SQL replica, an AlloyDB secondary) | primary → replica | solid, hollow head |
| `shares` | Shared VPC: a service project uses a host project's network | service project → host project | dashed arrow between the project zones |

Arrows that end inside a collapsed zone end at its chip; several arrows of one kind between the same two ends
are drawn once, with their count. A reference to something that is not in the snapshot is not drawn at all: it
is a *dangling reference*, listed in the details drawer ([faq.md](faq.md#what-is-a-dangling-reference)).

## 4. Focus views

The **Focus** button opens a popover: choose the kind, then its one parameter from the snapshot's own choices.
*None* and *Standalone projects* apply at once; the others apply once you pick the parameter. Focus views show
their projects at the top level, without the folders above them.

| Focus | Parameter (key in the link) | What it shows |
|---|---|---|
| None | | the whole scope (or the drill-in root) |
| Single project | the project (`focus.project`: its id, number or resource name) | the project, and every drawn arrow from inside it to anything outside it, with the far end as an "external" stub card in that end's project zone |
| Shared VPC | the host project (`focus.host`) | the host project and every project with a `shares` arrow to it (a project that is no host is refused) |
| Standalone projects | | the projects with no Shared VPC link and no peering or hybrid connection inside them |
| Perimeter | the perimeter (`focus.perimeter`: its label, the last part of its resource name, or the full name) | the projects a VPC Service Controls perimeter (or any node whose `secures` arrows reach projects) covers, inside the perimeter drawn as an overlay zone |
| Application | the application (`focus.application`: its label, the last part of its resource name, or the full name) | an App Hub application (or any container), what it contains, and what those reference, each in its project |

A parameter that names nothing usable leaves the view at its root and says why: the Focus button reads "not
applied", and the popover names the reason ("No perimeter "demo-perimeter" in this snapshot."; ""storefront"
names 3 applications; use the full resource name."). When you drilled into something inside the focus's
project or application, the focus keeps the whole canvas.

## 5. Filters

The **Filters** button opens one popover with every filter of the view; the button counts the
active ones ("Filters (3 active)"), and **Reset** clears them. Each change is a step in the browser's history.

| Filter | In the popover | Key in the link | What it does |
|---|---|---|---|
| hide empty projects | Hide › Empty projects | `hide=empty-projects` | removes projects with nothing visible inside, in this view |
| hide empty folders | Hide › Empty folders | `hide=empty-folders` | removes folders with nothing visible inside, in this view |
| hide disconnected | Hide › Disconnected resources | `hide=disconnected` | removes cards without a drawn arrow, then containers left with neither a visible child nor an arrow |
| regions | Regions | `regions=europe-west3,us-central1` | keeps resources whose location is listed (a zone counts as its region, an AI zone such as `us-central1-ai1a` too; case does not matter). Folders, projects, resources without a location and global containers such as VPC networks stay as structure |
| projects | Projects | `projects=demo-web-1` | keeps the listed projects (id or number); the folders above them stay as structure |
| folders | Folders | `folders=20000000005` | keeps what lies in the listed folders (by number); the folders above them stay as structure |
| include types | Include types | `include=run.googleapis.com/*` | draws these types too, whatever the lens: an asset type or `service/*`. It also shows hidden types it names |
| exclude types | Exclude types | `exclude=compute.googleapis.com/Disk` | never draws these types; exclude wins over include and over the lens |
| depth | Depth (a slider, shallow to deep, "No limit" at the right end) | `depth=2` | zones more than this many levels below the root start collapsed (chips) |
| region zones | Region zones: Default, Show, Hide | `show-regions=1` | groups each project's resources into virtual region (and zone) zones by their location, a zone inside the region the regions filter counts it in; VPC networks and subnets are not regrouped. Default: off |
| identities | Identities: Lens, Show, Hide | `show-identities=1` | Show draws service-account cards and `runsAs` arrows in any lens, Hide removes them from every lens, Lens leaves it to the lens (Identity and Everything draw them) |

The rules behind the table:

- **"Empty" and "disconnected" are about this view.** A project with resources the lens does not draw is empty
  in that lens. The three hide filters repeat until nothing changes, so hiding a disconnected card can make
  its project empty and hide it too; applying them twice changes nothing more.
- **Include does not override a type's own noise rule.** A few types hide some of their assets by a rule
  (disabled firewall rules and the ones GKE creates for itself, snapshots made automatically); including the
  type shows the type, and only the Everything lens shows those assets.
- **Structure stays.** The region, project and folder filters never remove the folders and projects that hold
  what they keep, so the diagram keeps its shape.
- **Every filter composes with every focus and drill-in** (step 4 of [section
  1](#1-how-a-view-is-put-together)). The end-to-end tests check exactly this, because a filter that silently
  stops applying misleads the reader.

## 6. Drill-in and the breadcrumb

Drilling in makes one container the whole canvas: a folder, a project, a VPC network, a subnet, a GKE cluster,
a dataset or any other container of the snapshot. Three ways:

- double-click the container on the canvas;
- its menu (right-click, or Shift+F10 on a focused zone or chip) › **Details**;
- the details drawer's **Details** button (the drawer's primary action for a container).

The link then carries `root=` with the container's full resource name. The **breadcrumb** at the left of the
top bar shows the scope, the containers above the root, and the root; each crumb but the last is a button that
drills out to it. Lens, focus, filters and detail level all apply to what lies inside the root. A link whose
root names nothing in the snapshot shows the whole scope and says "not found".

## 7. Detail levels and chips

The **Detail** control picks how deep zones open: `auto`, `folders`, `projects`, `networks` or `all`.

| Level | Collapsed into chips |
|---|---|
| `folders` | projects, and everything below them |
| `projects` | VPC networks, subnets and product containers (clusters, datasets, key rings, …) |
| `networks` | product containers |
| `all` | nothing |

**`auto`** picks the deepest level whose number of rectangles (zones, cards and chips) fits the canvas: a
budget of the canvas's area in px² divided by 14 000, between 24 and 250 (73 for a 1280 × 800 canvas). A view
of at most 100 rectangles never collapses, whatever the lens; otherwise `auto` never opens deeper than the
lens allows ([section 2](#2-lenses)). The control names the level it picked ("Auto · folders"). When the
window grows or shrinks so much that `auto` picks another level, the page says why.

**Chips.** A collapsed zone is drawn as a chip in the zone's colour, with the zone's icon and what it holds
("2 networks · 39 resources"). Click it (or Enter or Space on a focused chip) to open just that zone; an open
zone has a collapse button (⊟) on its header that closes it again. Each of these is a *flip* of the level's
choice for one zone, kept in the link (`flips=…`, at most 48: a 49th drops the oldest, and the page says so).
Arrows into a chip end at the chip, merged with a count.

**Expand all** opens the next level at which a chip on screen opens, and reopens zones you closed, keeping
what is already open; **Collapse all** closes the zones you opened and goes back to `auto` when the level in
use is deeper, keeping the zones you closed. Neither touches the zones of another drill-in or focus, and a
zone the current lens or filters leave empty keeps what you chose for it, for when it holds something again.
A timeline day's ghosts follow the same rules as the zones they stand for: Expand all closes none of them and
Collapse all opens none. Each is offered only when it would change the diagram on screen, the ghosts included.
**"N of M shown"** in the corner of the canvas counts the rectangles drawn against the rectangles the view
holds when fully open.

**Large flat organisations.** More than 120 things side by side (the projects of a flat organisation, or the
resources of one zone) are bundled into alphabetical groups of 20 to 24, labelled with the shortest prefixes
that tell their ends apart (`demo-a – demo-f`).

## 8. Search and the details drawer

Press `/` (or click the search box) to find any asset by name, id, type, project, IP address or domain.
Choosing a result selects it, moves the canvas to it and opens the collapsed zones that hide it; a result the
current lens or filters leave out offers to drill in ("Show details of …"), switch to the Everything lens or
include its type. Clicking a resource opens the **details drawer**: its type, name, parent and project,
location, IP addresses and domains, labels, its relations grouped by kind with links to each end, its dangling
references, its raw data, "Open in Cloud Console ↗" and, for a container, "Details", which drills in. The
selection keeps the resource's path to the top and its arrows highlighted until you select something else.
