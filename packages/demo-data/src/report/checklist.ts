// SPDX-License-Identifier: Apache-2.0
/**
 * The realism checklist: what a demo organisation models, counted from the generated assets themselves (not
 * from the profile), so the README table and the tests describe the data that actually ships.
 */
import type { Asset } from '@gcportrait/model';

export interface ChecklistRow {
  readonly feature: string;
  readonly count: number;
}

type Data = Record<string, unknown>;

function data(asset: Asset): Data {
  return typeof asset.data === 'object' && asset.data !== null ? (asset.data as Data) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function obj(value: unknown): Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Data) : {};
}

/** The Compute project id inside a self-link or relative path (`…/projects/<id>/…`). */
function projectOf(link: string): string {
  return /projects\/([^/]+)\//.exec(link)?.[1] ?? '';
}

/** Asset types the catalog seed marks hidden by default (operational records). */
const HIDDEN_TYPES = new Set([
  'cloudbuild.googleapis.com/Build',
  'serviceusage.googleapis.com/Service',
  'cloudkms.googleapis.com/CryptoKeyVersion',
  'secretmanager.googleapis.com/SecretVersion',
  'dns.googleapis.com/ResourceRecordSet',
  'compute.googleapis.com/Project',
]);

/** The container types the catalog seed maps as Tier 0 (the nesting of skill gcp-diagram-layout §2). */
export const TIER0_CONTAINER_TYPES: readonly string[] = [
  'cloudresourcemanager.googleapis.com/Organization',
  'cloudresourcemanager.googleapis.com/Folder',
  'cloudresourcemanager.googleapis.com/Project',
  'compute.googleapis.com/Network',
  'compute.googleapis.com/Subnetwork',
  'container.googleapis.com/Cluster',
  'k8s.io/Namespace',
  'bigquery.googleapis.com/Dataset',
  'cloudkms.googleapis.com/KeyRing',
  'alloydb.googleapis.com/Cluster',
  'apigee.googleapis.com/Organization',
  'bigtableadmin.googleapis.com/Instance',
  'dataform.googleapis.com/Repository',
  'dataplex.googleapis.com/Lake',
  'dataplex.googleapis.com/Zone',
  'servicedirectory.googleapis.com/Namespace',
  'servicedirectory.googleapis.com/Service',
  'spanner.googleapis.com/Instance',
  'vmwareengine.googleapis.com/PrivateCloud',
];

export function realismChecklist(assets: readonly Asset[]): ChecklistRow[] {
  const byType = new Map<string, Asset[]>();
  for (const asset of assets) {
    const bucket = byType.get(asset.assetType) ?? [];
    bucket.push(asset);
    byType.set(asset.assetType, bucket);
  }
  const of = (type: string): Asset[] => byType.get(type) ?? [];
  const count = (type: string, predicate: (asset: Asset) => boolean = () => true): number =>
    of(type).filter(predicate).length;

  const projects = of('cloudresourcemanager.googleapis.com/Project');
  const projectIdByNumber = new Map(projects.map((p) => [p.ancestors[0] ?? '', str(data(p)['projectId'])]));
  const folderDepth = Math.max(
    0,
    ...projects.map((p) => p.ancestors.filter((a) => a.startsWith('folders/')).length),
  );
  const hostIds = new Set(
    of('compute.googleapis.com/Project')
      .filter((p) => data(p)['xpnProjectStatus'] === 'HOST')
      .map((p) => str(data(p)['name'])),
  );
  const projectIdOf = (asset: Asset): string => projectIdByNumber.get(asset.ancestors[0] ?? '') ?? '';
  const attachedProjects = new Set<string>();
  const vmProjects = new Set<string>();
  for (const vm of of('compute.googleapis.com/Instance')) {
    for (const nic of list(data(vm)['networkInterfaces'])) {
      const host = projectOf(str(obj(nic)['subnetwork']));
      if (hostIds.has(host) && host !== projectIdOf(vm)) {
        vmProjects.add(projectIdOf(vm));
        attachedProjects.add(projectIdOf(vm));
      }
    }
  }
  for (const cluster of of('container.googleapis.com/Cluster')) {
    const host = projectOf(`${str(obj(data(cluster)['networkConfig'])['subnetwork'])}/`);
    if (hostIds.has(host) && host !== projectIdOf(cluster)) attachedProjects.add(projectIdOf(cluster));
  }
  for (const sql of of('sqladmin.googleapis.com/Instance')) {
    const network = str(obj(obj(data(sql)['settings'])['ipConfiguration'])['privateNetwork']);
    if (hostIds.has(projectOf(`${network}/`))) attachedProjects.add(projectIdOf(sql));
  }
  const peerings = of('compute.googleapis.com/Network').reduce(
    (sum, n) =>
      sum +
      list(data(n)['peerings']).filter((p) => str(obj(p)['name']) !== 'servicenetworking-googleapis-com')
        .length,
    0,
  );
  const childrenByProject = new Map<string, Asset[]>();
  for (const asset of assets) {
    if (asset.assetType === 'cloudresourcemanager.googleapis.com/Project') continue;
    const owner = asset.ancestors[0] ?? '';
    if (!owner.startsWith('projects/')) continue;
    const bucket = childrenByProject.get(owner) ?? [];
    bucket.push(asset);
    childrenByProject.set(owner, bucket);
  }
  const active = projects.filter((p) => data(p)['lifecycleState'] === 'ACTIVE');
  const emptyActive = active.filter(
    (p) => (childrenByProject.get(p.ancestors[0] ?? '') ?? []).length === 0,
  ).length;
  const hiddenOnly = active.filter((p) => {
    const children = childrenByProject.get(p.ancestors[0] ?? '') ?? [];
    return children.length > 0 && children.every((c) => HIDDEN_TYPES.has(c.assetType));
  }).length;
  const cmek = assets.filter((a) =>
    /"(kmsKeyName|defaultKmsKeyName|keyName)":"projects\/[^"]+\/cryptoKeys\//.test(JSON.stringify(a.data)),
  ).length;
  const runsAs = assets.filter(
    (a) =>
      /iam\.gserviceaccount\.com/.test(JSON.stringify(a.data)) &&
      a.assetType !== 'iam.googleapis.com/ServiceAccount',
  ).length;
  const perimeter = of('identity.accesscontextmanager.googleapis.com/ServicePerimeter');
  const protectedProjects = perimeter.reduce(
    (sum, p) => sum + list(obj(data(p)['status'])['resources']).length,
    0,
  );

  return [
    { feature: 'Folder levels below the organisation', count: folderDepth },
    { feature: 'Folders', count: count('cloudresourcemanager.googleapis.com/Folder') },
    { feature: 'Projects (active)', count: active.length },
    { feature: 'Projects being deleted (DELETE_REQUESTED)', count: projects.length - active.length },
    { feature: 'Shared VPC host projects', count: hostIds.size },
    { feature: 'Service projects attached to a host (VMs, GKE, Cloud SQL)', count: attachedProjects.size },
    { feature: 'Service projects with VMs on host subnets', count: vmProjects.size },
    { feature: 'VPC networks', count: count('compute.googleapis.com/Network') },
    { feature: 'Subnets', count: count('compute.googleapis.com/Subnetwork') },
    { feature: 'VPC peerings (network side, without private services access)', count: peerings },
    { feature: 'HA VPN gateways', count: count('compute.googleapis.com/VpnGateway') },
    { feature: 'VPN tunnels', count: count('compute.googleapis.com/VpnTunnel') },
    { feature: 'Interconnect attachments', count: count('compute.googleapis.com/InterconnectAttachment') },
    { feature: 'Cloud Routers', count: count('compute.googleapis.com/Router') },
    {
      feature: 'Cloud NAT gateways',
      count: of('compute.googleapis.com/Router').reduce((sum, r) => sum + list(data(r)['nats']).length, 0),
    },
    {
      feature: 'Global external HTTPS forwarding rules',
      count: count('compute.googleapis.com/GlobalForwardingRule', (a) =>
        str(data(a)['target']).includes('/targetHttpsProxies/'),
      ),
    },
    {
      feature: 'Internal passthrough load balancers',
      count: count(
        'compute.googleapis.com/ForwardingRule',
        (a) => data(a)['loadBalancingScheme'] === 'INTERNAL',
      ),
    },
    {
      feature: 'Backend services (global and regional)',
      count:
        count('compute.googleapis.com/BackendService') + count('compute.googleapis.com/RegionBackendService'),
    },
    { feature: 'Network endpoint groups', count: count('compute.googleapis.com/NetworkEndpointGroup') },
    { feature: 'Managed instance groups', count: count('compute.googleapis.com/InstanceGroupManager') },
    {
      feature: 'VMs created by a managed instance group (created-by)',
      count: count('compute.googleapis.com/Instance', (a) =>
        JSON.stringify(obj(data(a)['metadata'])).includes('"created-by"'),
      ),
    },
    { feature: 'VMs', count: count('compute.googleapis.com/Instance') },
    { feature: 'Cloud Armor policies', count: count('compute.googleapis.com/SecurityPolicy') },
    { feature: 'GKE clusters', count: count('container.googleapis.com/Cluster') },
    { feature: 'GKE node pools', count: count('container.googleapis.com/NodePool') },
    { feature: 'Kubernetes namespaces', count: count('k8s.io/Namespace') },
    { feature: 'Kubernetes deployments', count: count('apps.k8s.io/Deployment') },
    { feature: 'Kubernetes pods', count: count('k8s.io/Pod') },
    { feature: 'Kubernetes services', count: count('k8s.io/Service') },
    { feature: 'Kubernetes ingresses', count: count('networking.k8s.io/Ingress') },
    { feature: 'Cloud Run services', count: count('run.googleapis.com/Service') },
    { feature: 'Serverless VPC Access connectors', count: count('vpcaccess.googleapis.com/Connector') },
    {
      feature: 'Cloud SQL instances on private services access',
      count: count('sqladmin.googleapis.com/Instance'),
    },
    {
      feature: 'Private services access connections',
      count: count('servicenetworking.googleapis.com/Connection'),
    },
    { feature: 'Pub/Sub topics', count: count('pubsub.googleapis.com/Topic') },
    { feature: 'Pub/Sub subscriptions', count: count('pubsub.googleapis.com/Subscription') },
    { feature: 'Eventarc triggers', count: count('eventarc.googleapis.com/Trigger') },
    { feature: 'Cloud Run functions', count: count('cloudfunctions.googleapis.com/Function') },
    { feature: 'BigQuery datasets', count: count('bigquery.googleapis.com/Dataset') },
    { feature: 'BigQuery tables', count: count('bigquery.googleapis.com/Table') },
    {
      feature: 'BigQuery external tables on a bucket',
      count: count('bigquery.googleapis.com/Table', (a) => data(a)['type'] === 'EXTERNAL'),
    },
    { feature: 'Cloud Storage buckets', count: count('storage.googleapis.com/Bucket') },
    { feature: 'Cloud KMS keys', count: count('cloudkms.googleapis.com/CryptoKey') },
    { feature: 'Resources encrypted with a customer-managed key', count: cmek },
    { feature: 'Service accounts', count: count('iam.googleapis.com/ServiceAccount') },
    { feature: 'Resources that name a service account', count: runsAs },
    { feature: 'VPC Service Controls perimeters', count: perimeter.length },
    { feature: 'Projects inside a perimeter', count: protectedProjects },
    { feature: 'Empty active projects', count: emptyActive },
    { feature: 'Projects with only hidden-tier assets', count: hiddenOnly },
    { feature: 'Cloud DNS managed zones', count: count('dns.googleapis.com/ManagedZone') },
    { feature: 'Firewall rules', count: count('compute.googleapis.com/Firewall') },
    { feature: 'Routes', count: count('compute.googleapis.com/Route') },
    {
      feature: 'Reserved addresses',
      count: count('compute.googleapis.com/Address') + count('compute.googleapis.com/GlobalAddress'),
    },
    // The optional generator cases of M and larger (features.ts).
    {
      feature: `Tier-0 container types of the catalog seed present (of ${String(TIER0_CONTAINER_TYPES.length)})`,
      count: TIER0_CONTAINER_TYPES.filter((type) => of(type).length > 0).length,
    },
    { feature: 'Asset types', count: byType.size },
    { feature: 'Artifact Registry repositories', count: count('artifactregistry.googleapis.com/Repository') },
    {
      feature: 'Subnet routes (start hidden)',
      count: count('compute.googleapis.com/Route', (a) => data(a)['routeType'] === 'SUBNET'),
    },
    {
      feature: 'Static routes to an appliance, a VPN tunnel or a load balancer',
      count: count(
        'compute.googleapis.com/Route',
        (a) =>
          data(a)['nextHopInstance'] !== undefined ||
          data(a)['nextHopVpnTunnel'] !== undefined ||
          data(a)['nextHopIlb'] !== undefined,
      ),
    },
    {
      feature: 'Firewall policies (hierarchical and network)',
      count: count('compute.googleapis.com/FirewallPolicy'),
    },
    {
      feature: 'Cloud NGFW firewall endpoint associations',
      count: count('networksecurity.googleapis.com/FirewallEndpointAssociation'),
    },
    {
      feature: 'Private Service Connect endpoints for Google APIs',
      count: count('compute.googleapis.com/GlobalForwardingRule', (a) => data(a)['target'] === 'all-apis'),
    },
    {
      feature: 'Private Service Connect service attachments',
      count: count('compute.googleapis.com/ServiceAttachment'),
    },
    { feature: 'Network attachments', count: count('compute.googleapis.com/NetworkAttachment') },
    {
      feature: 'Network Connectivity Center spokes',
      count: count('networkconnectivity.googleapis.com/Spoke'),
    },
    {
      feature: 'Cloud DNS server and response policies',
      count: count('dns.googleapis.com/Policy') + count('dns.googleapis.com/ResponsePolicy'),
    },
    {
      feature: 'Certificate Manager certificate maps',
      count: count('certificatemanager.googleapis.com/CertificateMap'),
    },
    {
      feature: 'Backend services behind IAP or Cloud CDN',
      count: [
        ...of('compute.googleapis.com/BackendService'),
        ...of('compute.googleapis.com/RegionBackendService'),
      ].filter((a) => data(a)['enableCDN'] === true || obj(data(a)['iap'])['enabled'] === true).length,
    },
    { feature: 'Apigee organisations', count: count('apigee.googleapis.com/Organization') },
    { feature: 'Custom images (current and deprecated)', count: count('compute.googleapis.com/Image') },
    { feature: 'Snapshots', count: count('compute.googleapis.com/Snapshot') },
    {
      feature: 'Stopped VMs',
      count: count('compute.googleapis.com/Instance', (a) => data(a)['status'] === 'TERMINATED'),
    },
    { feature: 'VMware Engine private clouds', count: count('vmwareengine.googleapis.com/PrivateCloud') },
    {
      feature: 'Kubernetes service accounts bound to a Google service account',
      count: count('k8s.io/ServiceAccount', (a) =>
        JSON.stringify(obj(data(a)['metadata'])).includes('iam.gke.io/gcp-service-account'),
      ),
    },
    {
      feature: 'Kubernetes StatefulSets with persistent volume claims',
      count: count(
        'apps.k8s.io/StatefulSet',
        (set) => list(obj(data(set)['spec'])['volumeClaimTemplates']).length > 0,
      ),
    },
    { feature: 'Backup for GKE plans', count: count('gkebackup.googleapis.com/BackupPlan') },
    { feature: 'Cloud Run jobs', count: count('run.googleapis.com/Job') },
    { feature: 'Workflows', count: count('workflows.googleapis.com/Workflow') },
    {
      feature: 'Memorystore instances (Redis and Valkey)',
      count: count('redis.googleapis.com/Instance') + count('memorystore.googleapis.com/Instance'),
    },
    { feature: 'AlloyDB clusters', count: count('alloydb.googleapis.com/Cluster') },
    { feature: 'Spanner instances', count: count('spanner.googleapis.com/Instance') },
    { feature: 'Bigtable instances', count: count('bigtableadmin.googleapis.com/Instance') },
    { feature: 'Firestore databases', count: count('firestore.googleapis.com/Database') },
    { feature: 'Filestore instances', count: count('file.googleapis.com/Instance') },
    { feature: 'Dataproc clusters', count: count('dataproc.googleapis.com/Cluster') },
    { feature: 'Composer environments', count: count('composer.googleapis.com/Environment') },
    { feature: 'Dataflow jobs', count: count('dataflow.googleapis.com/Job') },
    { feature: 'Dataplex lakes', count: count('dataplex.googleapis.com/Lake') },
    { feature: 'Vertex AI endpoints', count: count('aiplatform.googleapis.com/Endpoint') },
    { feature: 'Vertex AI Search engines', count: count('discoveryengine.googleapis.com/Engine') },
    {
      feature: 'CA Service certificate authorities',
      count: count('privateca.googleapis.com/CertificateAuthority'),
    },
    {
      feature: 'Binary Authorization policies requiring an attestor',
      count: count('binaryauthorization.googleapis.com/Policy', (a) =>
        JSON.stringify(data(a)).includes('/attestors/'),
      ),
    },
    {
      feature: 'Cloud Build worker pools and triggers',
      count: count('cloudbuild.googleapis.com/WorkerPool') + count('cloudbuild.googleapis.com/BuildTrigger'),
    },
    { feature: 'Cloud Deploy targets', count: count('clouddeploy.googleapis.com/Target') },
    { feature: 'Log sinks', count: count('logging.googleapis.com/LogSink') },
    {
      feature: 'Alert policies and uptime checks',
      count:
        count('monitoring.googleapis.com/AlertPolicy') + count('monitoring.googleapis.com/UptimeCheckConfig'),
    },
    { feature: 'Backup plan associations', count: count('backupdr.googleapis.com/BackupPlanAssociation') },
    { feature: 'App Hub applications', count: count('apphub.googleapis.com/Application') },
  ];
}

/** The checklist as Markdown table rows, `| feature | count |`. */
export function checklistMarkdown(rows: readonly ChecklistRow[]): string {
  return rows.map((row) => `| ${row.feature} | ${String(row.count)} |`).join('\n');
}
