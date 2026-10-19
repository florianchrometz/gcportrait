// SPDX-License-Identifier: Apache-2.0
/**
 * The `resource.version`, `resource.discoveryDocumentUri` and `resource.discoveryName` that Cloud Asset
 * Inventory reports for each asset type this package generates. They describe the API resource shape inside
 * `resource.data` and appear only in the CAI-shaped output (the normalised Asset drops them).
 */

export interface DiscoveryInfo {
  readonly version: string;
  readonly discoveryDocumentUri: string;
  readonly discoveryName: string;
}

/** APIs whose discovery documents are served from www.googleapis.com. */
function googleapisHosted(api: string, version: string, discoveryName: string): DiscoveryInfo {
  return {
    version,
    discoveryDocumentUri: `https://www.googleapis.com/discovery/v1/apis/${api}/${version}/rest`,
    discoveryName,
  };
}

/** APIs that serve their own discovery document. */
function selfHosted(service: string, version: string, discoveryName: string): DiscoveryInfo {
  return {
    version,
    discoveryDocumentUri: `https://${service}/$discovery/rest?version=${version}`,
    discoveryName,
  };
}

const KUBERNETES_SWAGGER =
  'https://raw.githubusercontent.com/kubernetes/kubernetes/master/api/openapi-spec/swagger.json';

function kubernetes(group: string, kind: string): DiscoveryInfo {
  return {
    version: 'v1',
    discoveryDocumentUri: KUBERNETES_SWAGGER,
    discoveryName: `io.k8s.api.${group}.v1.${kind}`,
  };
}

const COMPUTE_KINDS = [
  'Address',
  'Autoscaler',
  'BackendBucket',
  'BackendService',
  'Commitment',
  'Disk',
  'ExternalVpnGateway',
  'Firewall',
  'FirewallPolicy',
  'ForwardingRule',
  'HealthCheck',
  'Image',
  'Instance',
  'InstanceGroup',
  'InstanceGroupManager',
  'InstanceTemplate',
  'Interconnect',
  'InterconnectAttachment',
  'Network',
  'NetworkAttachment',
  'NetworkEndpointGroup',
  'Project',
  'Reservation',
  'ResourcePolicy',
  'Route',
  'Router',
  'SecurityPolicy',
  'ServiceAttachment',
  'Snapshot',
  'SslCertificate',
  'SslPolicy',
  'Subnetwork',
  'TargetHttpProxy',
  'TargetHttpsProxy',
  'TargetVpnGateway',
  'UrlMap',
  'VpnGateway',
  'VpnTunnel',
] as const;

/**
 * Types of the optional generator cases whose APIs serve their own discovery document:
 * `[asset type, API version, discovery name]`.
 */
const SELF_HOSTED: readonly (readonly [string, string, string])[] = [
  ['alloydb.googleapis.com/Cluster', 'v1', 'Cluster'],
  ['analyticshub.googleapis.com/DataExchange', 'v1', 'DataExchange'],
  ['analyticshub.googleapis.com/Listing', 'v1', 'Listing'],
  ['apigee.googleapis.com/Environment', 'v1', 'GoogleCloudApigeeV1Environment'],
  ['apigee.googleapis.com/Instance', 'v1', 'GoogleCloudApigeeV1Instance'],
  ['apigee.googleapis.com/Organization', 'v1', 'GoogleCloudApigeeV1Organization'],
  ['bigquerydatatransfer.googleapis.com/TransferConfig', 'v1', 'TransferConfig'],
  ['alloydb.googleapis.com/Instance', 'v1', 'Instance'],
  ['apigateway.googleapis.com/Api', 'v1', 'ApigatewayApi'],
  ['apigateway.googleapis.com/ApiConfig', 'v1', 'ApigatewayApiConfig'],
  ['apigateway.googleapis.com/Gateway', 'v1', 'ApigatewayGateway'],
  ['apphub.googleapis.com/Application', 'v1', 'Application'],
  ['apphub.googleapis.com/Service', 'v1', 'Service'],
  ['apphub.googleapis.com/ServiceProjectAttachment', 'v1', 'ServiceProjectAttachment'],
  ['apphub.googleapis.com/Workload', 'v1', 'Workload'],
  ['artifactregistry.googleapis.com/Repository', 'v1', 'Repository'],
  ['aiplatform.googleapis.com/Dataset', 'v1', 'GoogleCloudAiplatformV1Dataset'],
  ['aiplatform.googleapis.com/DeploymentResourcePool', 'v1', 'GoogleCloudAiplatformV1DeploymentResourcePool'],
  ['aiplatform.googleapis.com/Endpoint', 'v1', 'GoogleCloudAiplatformV1Endpoint'],
  ['aiplatform.googleapis.com/Index', 'v1', 'GoogleCloudAiplatformV1Index'],
  ['aiplatform.googleapis.com/IndexEndpoint', 'v1', 'GoogleCloudAiplatformV1IndexEndpoint'],
  ['aiplatform.googleapis.com/Model', 'v1', 'GoogleCloudAiplatformV1Model'],
  ['aiplatform.googleapis.com/NotebookRuntime', 'v1', 'GoogleCloudAiplatformV1NotebookRuntime'],
  [
    'aiplatform.googleapis.com/NotebookRuntimeTemplate',
    'v1',
    'GoogleCloudAiplatformV1NotebookRuntimeTemplate',
  ],
  ['aiplatform.googleapis.com/ReasoningEngine', 'v1', 'GoogleCloudAiplatformV1ReasoningEngine'],
  ['backupdr.googleapis.com/BackupPlan', 'v1', 'BackupPlan'],
  ['backupdr.googleapis.com/BackupPlanAssociation', 'v1', 'BackupPlanAssociation'],
  ['backupdr.googleapis.com/BackupVault', 'v1', 'BackupVault'],
  ['backupdr.googleapis.com/DataSource', 'v1', 'DataSource'],
  ['batch.googleapis.com/Job', 'v1', 'Job'],
  ['bigqueryreservation.googleapis.com/Reservation', 'v1', 'Reservation'],
  ['bigqueryreservation.googleapis.com/ReservationAssignment', 'v1', 'Assignment'],
  ['binaryauthorization.googleapis.com/Attestor', 'v1', 'Attestor'],
  ['binaryauthorization.googleapis.com/Policy', 'v1', 'Policy'],
  ['certificatemanager.googleapis.com/Certificate', 'v1', 'Certificate'],
  ['certificatemanager.googleapis.com/CertificateMap', 'v1', 'CertificateMap'],
  ['certificatemanager.googleapis.com/CertificateMapEntry', 'v1', 'CertificateMapEntry'],
  ['certificatemanager.googleapis.com/DnsAuthorization', 'v1', 'DnsAuthorization'],
  ['cloudasset.googleapis.com/Feed', 'v1', 'Feed'],
  ['cloudbilling.googleapis.com/BillingAccount', 'v1', 'BillingAccount'],
  ['cloudbilling.googleapis.com/ProjectBillingInfo', 'v1', 'ProjectBillingInfo'],
  ['cloudbuild.googleapis.com/BuildTrigger', 'v1', 'BuildTrigger'],
  ['cloudbuild.googleapis.com/Connection', 'v2', 'Connection'],
  ['cloudbuild.googleapis.com/Repository', 'v2', 'Repository'],
  ['cloudbuild.googleapis.com/WorkerPool', 'v1', 'WorkerPool'],
  ['clouddeploy.googleapis.com/DeliveryPipeline', 'v1', 'DeliveryPipeline'],
  ['clouddeploy.googleapis.com/Release', 'v1', 'Release'],
  ['clouddeploy.googleapis.com/Rollout', 'v1', 'Rollout'],
  ['clouddeploy.googleapis.com/Target', 'v1', 'Target'],
  ['cloudtasks.googleapis.com/Queue', 'v2', 'Queue'],
  ['composer.googleapis.com/Environment', 'v1', 'Environment'],
  ['config.googleapis.com/Deployment', 'v1', 'Deployment'],
  ['dataform.googleapis.com/Repository', 'v1beta1', 'Repository'],
  ['dataplex.googleapis.com/Asset', 'v1', 'GoogleCloudDataplexV1Asset'],
  ['dataplex.googleapis.com/Lake', 'v1', 'GoogleCloudDataplexV1Lake'],
  ['dataplex.googleapis.com/Zone', 'v1', 'GoogleCloudDataplexV1Zone'],
  ['dataproc.googleapis.com/Cluster', 'v1', 'Cluster'],
  ['datastream.googleapis.com/ConnectionProfile', 'v1', 'ConnectionProfile'],
  ['datastream.googleapis.com/PrivateConnection', 'v1', 'PrivateConnection'],
  ['datastream.googleapis.com/Stream', 'v1', 'Stream'],
  ['dialogflow.googleapis.com/Agent', 'v3', 'GoogleCloudDialogflowCxV3Agent'],
  ['discoveryengine.googleapis.com/Assistant', 'v1', 'GoogleCloudDiscoveryengineV1Assistant'],
  ['discoveryengine.googleapis.com/Collection', 'v1', 'GoogleCloudDiscoveryengineV1Collection'],
  ['discoveryengine.googleapis.com/DataStore', 'v1', 'GoogleCloudDiscoveryengineV1DataStore'],
  ['discoveryengine.googleapis.com/Engine', 'v1', 'GoogleCloudDiscoveryengineV1Engine'],
  ['dlp.googleapis.com/DiscoveryConfig', 'v2', 'GooglePrivacyDlpV2DiscoveryConfig'],
  ['dlp.googleapis.com/InspectTemplate', 'v2', 'GooglePrivacyDlpV2InspectTemplate'],
  ['dlp.googleapis.com/JobTrigger', 'v2', 'GooglePrivacyDlpV2JobTrigger'],
  ['dns.googleapis.com/Policy', 'v1', 'Policy'],
  ['dns.googleapis.com/ResponsePolicy', 'v1', 'ResponsePolicy'],
  ['dns.googleapis.com/ResponsePolicyRule', 'v1', 'ResponsePolicyRule'],
  ['documentai.googleapis.com/Processor', 'v1', 'GoogleCloudDocumentaiV1Processor'],
  ['documentai.googleapis.com/ProcessorVersion', 'v1', 'GoogleCloudDocumentaiV1ProcessorVersion'],
  ['domains.googleapis.com/Registration', 'v1', 'Registration'],
  ['file.googleapis.com/Instance', 'v1', 'Instance'],
  ['firestore.googleapis.com/Database', 'v1', 'GoogleFirestoreAdminV1Database'],
  ['gkebackup.googleapis.com/BackupPlan', 'v1', 'BackupPlan'],
  ['iam.googleapis.com/WorkloadIdentityPool', 'v1', 'WorkloadIdentityPool'],
  ['iam.googleapis.com/WorkloadIdentityPoolProvider', 'v1', 'WorkloadIdentityPoolProvider'],
  ['ids.googleapis.com/Endpoint', 'v1', 'Endpoint'],
  ['logging.googleapis.com/Link', 'v2', 'Link'],
  ['logging.googleapis.com/LogBucket', 'v2', 'LogBucket'],
  ['logging.googleapis.com/LogSink', 'v2', 'LogSink'],
  ['managedkafka.googleapis.com/Cluster', 'v1', 'Cluster'],
  ['memorystore.googleapis.com/Instance', 'v1', 'Instance'],
  ['metastore.googleapis.com/Service', 'v1', 'Service'],
  ['monitoring.googleapis.com/AlertPolicy', 'v3', 'AlertPolicy'],
  ['monitoring.googleapis.com/NotificationChannel', 'v3', 'NotificationChannel'],
  ['monitoring.googleapis.com/UptimeCheckConfig', 'v3', 'UptimeCheckConfig'],
  ['networkconnectivity.googleapis.com/Group', 'v1', 'Group'],
  ['networkconnectivity.googleapis.com/Hub', 'v1', 'Hub'],
  ['networkconnectivity.googleapis.com/HubRoute', 'v1', 'Route'],
  ['networkconnectivity.googleapis.com/InternalRange', 'v1', 'InternalRange'],
  ['networkconnectivity.googleapis.com/PolicyBasedRoute', 'v1', 'PolicyBasedRoute'],
  ['networkconnectivity.googleapis.com/RouteTable', 'v1', 'RouteTable'],
  ['networkconnectivity.googleapis.com/Spoke', 'v1', 'Spoke'],
  ['networksecurity.googleapis.com/FirewallEndpoint', 'v1', 'FirewallEndpoint'],
  ['networksecurity.googleapis.com/FirewallEndpointAssociation', 'v1', 'FirewallEndpointAssociation'],
  ['networksecurity.googleapis.com/GatewaySecurityPolicy', 'v1', 'GatewaySecurityPolicy'],
  ['networksecurity.googleapis.com/GatewaySecurityPolicyRule', 'v1', 'GatewaySecurityPolicyRule'],
  ['networksecurity.googleapis.com/SecurityProfile', 'v1', 'SecurityProfile'],
  ['networksecurity.googleapis.com/SecurityProfileGroup', 'v1', 'SecurityProfileGroup'],
  ['networksecurity.googleapis.com/UrlList', 'v1', 'UrlList'],
  ['networkservices.googleapis.com/Gateway', 'v1', 'Gateway'],
  ['notebooks.googleapis.com/Instance', 'v2', 'Instance'],
  ['privateca.googleapis.com/CaPool', 'v1', 'CaPool'],
  ['privateca.googleapis.com/CertificateAuthority', 'v1', 'CertificateAuthority'],
  ['pubsub.googleapis.com/Schema', 'v1', 'Schema'],
  ['redis.googleapis.com/Instance', 'v1', 'Instance'],
  ['run.googleapis.com/Execution', 'v2', 'GoogleCloudRunV2Execution'],
  ['run.googleapis.com/Job', 'v2', 'GoogleCloudRunV2Job'],
  ['run.googleapis.com/Revision', 'v2', 'GoogleCloudRunV2Revision'],
  ['securitycenter.googleapis.com/BigQueryExport', 'v2', 'GoogleCloudSecuritycenterV2BigQueryExport'],
  ['securitycenter.googleapis.com/NotificationConfig', 'v2', 'NotificationConfig'],
  ['servicedirectory.googleapis.com/Endpoint', 'v1', 'Endpoint'],
  ['servicedirectory.googleapis.com/Namespace', 'v1', 'Namespace'],
  ['servicedirectory.googleapis.com/Service', 'v1', 'Service'],
  ['spanner.googleapis.com/Database', 'v1', 'Database'],
  ['spanner.googleapis.com/Instance', 'v1', 'Instance'],
  ['tpu.googleapis.com/Node', 'v2', 'Node'],
  ['vmwareengine.googleapis.com/Cluster', 'v1', 'Cluster'],
  ['vmwareengine.googleapis.com/NetworkPeering', 'v1', 'NetworkPeering'],
  ['vmwareengine.googleapis.com/NetworkPolicy', 'v1', 'NetworkPolicy'],
  ['vmwareengine.googleapis.com/PrivateCloud', 'v1', 'PrivateCloud'],
  ['vmwareengine.googleapis.com/VmwareEngineNetwork', 'v1', 'VmwareEngineNetwork'],
  ['workflows.googleapis.com/Workflow', 'v1', 'Workflow'],
];

/** Compute types whose API resource has a different discovery name than the asset type suggests. */
const COMPUTE_ALIASES: Readonly<Record<string, string>> = {
  GlobalAddress: 'Address',
  GlobalForwardingRule: 'ForwardingRule',
  RegionBackendService: 'BackendService',
};

export const DISCOVERY: Readonly<Record<string, DiscoveryInfo>> = Object.freeze({
  ...Object.fromEntries(
    COMPUTE_KINDS.map((kind) => [`compute.googleapis.com/${kind}`, googleapisHosted('compute', 'v1', kind)]),
  ),
  ...Object.fromEntries(
    Object.entries(COMPUTE_ALIASES).map(([kind, name]) => [
      `compute.googleapis.com/${kind}`,
      googleapisHosted('compute', 'v1', name),
    ]),
  ),
  'cloudresourcemanager.googleapis.com/Organization': selfHosted(
    'cloudresourcemanager.googleapis.com',
    'v1',
    'Organization',
  ),
  'cloudresourcemanager.googleapis.com/Folder': selfHosted(
    'cloudresourcemanager.googleapis.com',
    'v2',
    'Folder',
  ),
  'cloudresourcemanager.googleapis.com/Project': selfHosted(
    'cloudresourcemanager.googleapis.com',
    'v1',
    'Project',
  ),
  'storage.googleapis.com/Bucket': googleapisHosted('storage', 'v1', 'Bucket'),
  'bigquery.googleapis.com/Dataset': googleapisHosted('bigquery', 'v2', 'Dataset'),
  'bigquery.googleapis.com/Table': googleapisHosted('bigquery', 'v2', 'Table'),
  'sqladmin.googleapis.com/Instance': googleapisHosted('sqladmin', 'v1beta4', 'DatabaseInstance'),
  'container.googleapis.com/Cluster': selfHosted('container.googleapis.com', 'v1', 'Cluster'),
  'container.googleapis.com/NodePool': selfHosted('container.googleapis.com', 'v1', 'NodePool'),
  'gkehub.googleapis.com/Membership': selfHosted('gkehub.googleapis.com', 'v1', 'Membership'),
  'iam.googleapis.com/ServiceAccount': selfHosted('iam.googleapis.com', 'v1', 'ServiceAccount'),
  'cloudkms.googleapis.com/KeyRing': selfHosted('cloudkms.googleapis.com', 'v1', 'KeyRing'),
  'cloudkms.googleapis.com/CryptoKey': selfHosted('cloudkms.googleapis.com', 'v1', 'CryptoKey'),
  'cloudkms.googleapis.com/CryptoKeyVersion': selfHosted('cloudkms.googleapis.com', 'v1', 'CryptoKeyVersion'),
  'secretmanager.googleapis.com/Secret': selfHosted('secretmanager.googleapis.com', 'v1', 'Secret'),
  'secretmanager.googleapis.com/SecretVersion': selfHosted(
    'secretmanager.googleapis.com',
    'v1',
    'SecretVersion',
  ),
  'pubsub.googleapis.com/Topic': selfHosted('pubsub.googleapis.com', 'v1', 'Topic'),
  'pubsub.googleapis.com/Subscription': selfHosted('pubsub.googleapis.com', 'v1', 'Subscription'),
  'run.googleapis.com/Service': selfHosted('run.googleapis.com', 'v2', 'Service'),
  'cloudfunctions.googleapis.com/Function': selfHosted('cloudfunctions.googleapis.com', 'v2', 'Function'),
  'eventarc.googleapis.com/Trigger': selfHosted('eventarc.googleapis.com', 'v1', 'Trigger'),
  'vpcaccess.googleapis.com/Connector': selfHosted('vpcaccess.googleapis.com', 'v1', 'Connector'),
  'servicenetworking.googleapis.com/Connection': selfHosted(
    'servicenetworking.googleapis.com',
    'v1',
    'Connection',
  ),
  'dns.googleapis.com/ManagedZone': selfHosted('dns.googleapis.com', 'v1', 'ManagedZone'),
  'dns.googleapis.com/ResourceRecordSet': selfHosted('dns.googleapis.com', 'v1', 'ResourceRecordSet'),
  'identity.accesscontextmanager.googleapis.com/AccessPolicy': selfHosted(
    'accesscontextmanager.googleapis.com',
    'v1',
    'AccessPolicy',
  ),
  'identity.accesscontextmanager.googleapis.com/AccessLevel': selfHosted(
    'accesscontextmanager.googleapis.com',
    'v1',
    'AccessLevel',
  ),
  'identity.accesscontextmanager.googleapis.com/ServicePerimeter': selfHosted(
    'accesscontextmanager.googleapis.com',
    'v1',
    'ServicePerimeter',
  ),
  'cloudbuild.googleapis.com/Build': selfHosted('cloudbuild.googleapis.com', 'v1', 'Build'),
  'serviceusage.googleapis.com/Service': selfHosted(
    'serviceusage.googleapis.com',
    'v1',
    'GoogleApiServiceusageV1Service',
  ),
  ...Object.fromEntries(
    SELF_HOSTED.map(([type, version, name]) => [
      type,
      selfHosted(type.slice(0, type.indexOf('/')), version, name),
    ]),
  ),
  'bigquery.googleapis.com/Routine': googleapisHosted('bigquery', 'v2', 'Routine'),
  'bigquery.googleapis.com/Model': googleapisHosted('bigquery', 'v2', 'Model'),
  'sqladmin.googleapis.com/Backup': googleapisHosted('sqladmin', 'v1beta4', 'Backup'),
  'bigtableadmin.googleapis.com/Instance': googleapisHosted('bigtableadmin', 'v2', 'Instance'),
  'bigtableadmin.googleapis.com/Cluster': googleapisHosted('bigtableadmin', 'v2', 'Cluster'),
  'bigtableadmin.googleapis.com/Table': googleapisHosted('bigtableadmin', 'v2', 'Table'),
  'dataflow.googleapis.com/Job': googleapisHosted('dataflow', 'v1b3', 'Job'),
  'k8s.io/Namespace': kubernetes('core', 'Namespace'),
  'k8s.io/ServiceAccount': kubernetes('core', 'ServiceAccount'),
  'k8s.io/PersistentVolume': kubernetes('core', 'PersistentVolume'),
  'k8s.io/PersistentVolumeClaim': kubernetes('core', 'PersistentVolumeClaim'),
  'apps.k8s.io/StatefulSet': kubernetes('apps', 'StatefulSet'),
  'batch.k8s.io/CronJob': kubernetes('batch', 'CronJob'),
  'batch.k8s.io/Job': kubernetes('batch', 'Job'),
  'autoscaling.k8s.io/HorizontalPodAutoscaler': {
    version: 'v2',
    discoveryDocumentUri: KUBERNETES_SWAGGER,
    discoveryName: 'io.k8s.api.autoscaling.v2.HorizontalPodAutoscaler',
  },
  'storage.k8s.io/StorageClass': kubernetes('storage', 'StorageClass'),
  'k8s.io/Node': kubernetes('core', 'Node'),
  'k8s.io/Pod': kubernetes('core', 'Pod'),
  'k8s.io/Service': kubernetes('core', 'Service'),
  'apps.k8s.io/Deployment': kubernetes('apps', 'Deployment'),
  'apps.k8s.io/ReplicaSet': kubernetes('apps', 'ReplicaSet'),
  'apps.k8s.io/DaemonSet': kubernetes('apps', 'DaemonSet'),
  'networking.k8s.io/Ingress': kubernetes('networking', 'Ingress'),
});

/**
 * Discovery metadata for an asset type. Types missing from the table fall back to the self-hosted form, so a
 * new generator case still produces a well-formed CAI record; the coverage test lists every generated type in
 * the table.
 */
export function discoveryFor(assetType: string): DiscoveryInfo {
  const known = DISCOVERY[assetType];
  if (known !== undefined) return known;
  const [service = '', kind = ''] = assetType.split('/');
  return selfHosted(service, 'v1', kind);
}
