// SPDX-License-Identifier: Apache-2.0
import {
  NormaliserNameSchema,
  RelationTargetSchema,
  type Asset,
  type NormaliserName,
  type RelationTarget,
} from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { asset, PROJECTS, RUN_SERVICE } from '../testing/assets.js';
import { kubernetesPlural, NORMALISERS, normalise, type NormaliserContext } from './normalisers.js';

const POD = asset(
  '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s/namespaces/shop/pods/web-5d9c-x7k2p',
  'k8s.io/Pod',
  {},
);
const NODE = asset(
  '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s/nodes/gke-shop-pool-1',
  'k8s.io/Node',
  {},
);
const CLUSTER = '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s';
const INGRESS = asset(
  `${CLUSTER}/namespaces/shop/networking.k8s.io/ingresses/storefront`,
  'networking.k8s.io/Ingress',
  {},
);
const PV = asset(`${CLUSTER}/persistentvolumes/pvc-0a1b`, 'k8s.io/PersistentVolume', {});
const PIPELINE = asset(
  '//clouddeploy.googleapis.com/projects/demo-app-1/locations/europe-west3/deliveryPipelines/shop',
  'clouddeploy.googleapis.com/DeliveryPipeline',
  {},
);
const NEG = asset(
  '//compute.googleapis.com/projects/demo-app-1/regions/europe-west3/networkEndpointGroups/shop-neg',
  'compute.googleapis.com/NetworkEndpointGroup',
  {},
);
const VM = asset(
  '//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instances/web-1',
  'compute.googleapis.com/Instance',
  {},
  { location: 'europe-west3-a' },
);
/** A TPU node in an AI zone: its name holds the zone under `locations/`, not `zones/`. */
const TPU = asset(
  '//tpu.googleapis.com/projects/demo-app-1/locations/us-central1-ai1a/nodes/train',
  'tpu.googleapis.com/Node',
  {},
  { location: 'us-central1-ai1a' },
);
const PSA = asset(
  '//servicenetworking.googleapis.com/projects/10000000001/global/networks/core/connections/servicenetworking-googleapis-com',
  'servicenetworking.googleapis.com/Connection',
  {},
  { location: 'global' },
);
const FOLDER: Asset = {
  name: '//cloudresourcemanager.googleapis.com/folders/20000000001',
  assetType: 'cloudresourcemanager.googleapis.com/Folder',
  ancestors: ['folders/20000000001', 'organizations/30000000001'],
  updateTime: '2026-10-01T08:00:00Z',
  data: {},
};

function context(overrides: Partial<NormaliserContext> = {}): NormaliserContext {
  return {
    asset: RUN_SERVICE,
    projects: PROJECTS,
    service: 'run.googleapis.com',
    versionLevel: false,
    ...overrides,
  };
}

type Expected = string | { alias: string } | undefined;

function expectTarget(result: RelationTarget | undefined, expected: Expected): void {
  if (expected === undefined) {
    expect(result).toBeUndefined();
    return;
  }
  expect(RelationTargetSchema.parse(result)).toEqual(
    typeof expected === 'string' ? { by: 'name', name: expected } : { by: 'alias', alias: expected.alias },
  );
}

const NET = '//compute.googleapis.com/projects/demo-net-1/global/networks/core';
const APP_SUBNET = '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/app';
const SELF = 'https://www.googleapis.com/compute/v1/projects';

type Case = [
  normaliser: NormaliserName,
  value: unknown,
  expected: Expected,
  overrides?: Partial<NormaliserContext>,
];

const CASES: Case[] = [
  // name ------------------------------------------------------------------------------------------------
  [
    'name',
    'projects/demo-app-1/locations/europe-west3/connectors/c',
    '//vpcaccess.googleapis.com/projects/demo-app-1/locations/europe-west3/connectors/c',
    { service: 'vpcaccess.googleapis.com' },
  ],
  ['name', 'projects/demo-app-1/secrets/db', '//run.googleapis.com/projects/demo-app-1/secrets/db'],
  [
    'name',
    '//secretmanager.googleapis.com/projects/demo-app-1/secrets/db',
    '//secretmanager.googleapis.com/projects/demo-app-1/secrets/db',
  ],
  ['name', ' projects/demo-app-1/secrets/db/ ', '//run.googleapis.com/projects/demo-app-1/secrets/db'],
  ['name', '/projects/demo-app-1/secrets/db', '//run.googleapis.com/projects/demo-app-1/secrets/db'],
  [
    'name',
    'pubsub.googleapis.com/projects/demo-app-1/topics/orders',
    '//pubsub.googleapis.com/projects/demo-app-1/topics/orders',
  ],
  [
    'name',
    'https://container.googleapis.com/v1/projects/demo-app-1/locations/europe-west3/clusters/shop',
    '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop',
  ],
  [
    'name',
    'https://gkehub.googleapis.com/v1beta1/projects/demo-app-1/locations/global/memberships/shop',
    '//gkehub.googleapis.com/projects/demo-app-1/locations/global/memberships/shop',
  ],
  [
    'name',
    'https://run.googleapis.com/projects/demo-app-1/locations/europe-west3/services/shop',
    '//run.googleapis.com/projects/demo-app-1/locations/europe-west3/services/shop',
  ],
  ['name', `${SELF}/demo-net-1/global/networks/core`, NET],
  [
    'name',
    '%2F%2Fcloudresourcemanager.googleapis.com%2Fprojects%2F10000000002',
    '//cloudresourcemanager.googleapis.com/projects/10000000002',
  ],
  [
    'name',
    'tagKeys/40000000001',
    '//cloudresourcemanager.googleapis.com/tagKeys/40000000001',
    { service: 'cloudresourcemanager.googleapis.com' },
  ],
  ['name', '%2F%2F%E0%A4%A', undefined],
  ['name', 'default', undefined],
  ['name', '', undefined],
  ['name', '   ', undefined],
  ['name', 'projects/a b/secrets/c', undefined],
  ['name', 42, undefined],
  ['name', null, undefined],
  ['name', 'https://git.example.org/data/warehouse.git', undefined],
  ['name', 'http://container.googleapis.com/v1/projects/p/x/y', undefined],
  ['name', 'https://container.googleapis.com/v1/projects', undefined],
  ['name', 'example.org/data/warehouse', undefined],
  ['name', 'pubsub.googleapis.com/projects', undefined],

  // computeSelfLink and computeRelative ------------------------------------------------------------------------
  ['computeSelfLink', `${SELF}/demo-net-1/global/networks/core`, NET],
  [
    'computeSelfLink',
    'https://www.googleapis.com/compute/beta/projects/demo-net-1/regions/europe-west3/subnetworks/app',
    APP_SUBNET,
  ],
  [
    'computeSelfLink',
    'https://compute.googleapis.com/compute/v1/projects/demo-net-1/regions/europe-west3/subnetworks/app',
    APP_SUBNET,
  ],
  ['computeSelfLink', 'www.googleapis.com/compute/v1/projects/demo-net-1/global/networks/core', NET],
  ['computeSelfLink', `${SELF}/demo-net-1/global/networks/core/`, NET],
  ['computeSelfLink', `${SELF}/10000000001/global/networks/core`, NET],
  ['computeSelfLink', '//compute.googleapis.com/projects/10000000001/global/networks/core', NET],
  [
    'computeSelfLink',
    `${SELF}/10000000099/global/networks/core`,
    '//compute.googleapis.com/projects/10000000099/global/networks/core',
  ],
  [
    'computeSelfLink',
    '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop',
    '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop',
  ],
  [
    'computeSelfLink',
    'global/networks/default',
    '//compute.googleapis.com/projects/demo-app-1/global/networks/default',
  ],
  [
    'computeSelfLink',
    'regions/europe-west3/subnetworks/default',
    '//compute.googleapis.com/projects/demo-app-1/regions/europe-west3/subnetworks/default',
  ],
  ['computeSelfLink', 'global/networks/default', undefined, { asset: FOLDER }],
  ['computeSelfLink', 'default', undefined],
  ['computeSelfLink', 'projects/demo-net-1', undefined],
  ['computeSelfLink', 'https://www.googleapis.com/storage/v1/b/demo-logs-1', undefined],
  ['computeSelfLink', ['projects/demo-net-1/global/networks/core'], undefined],
  ['computeRelative', 'projects/demo-net-1/regions/europe-west3/subnetworks/app', APP_SUBNET],
  ['computeRelative', 'projects/10000000001/global/networks/core', NET],
  ['computeRelative', `${SELF}/demo-net-1/global/networks/core`, NET],
  ['computeRelative', 'core', undefined],

  // serviceAccountEmail --------------------------------------------------------------------------------------
  [
    'serviceAccountEmail',
    'runner@demo-app-1.iam.gserviceaccount.com',
    { alias: 'runner@demo-app-1.iam.gserviceaccount.com' },
  ],
  [
    'serviceAccountEmail',
    'Runner@Demo-App-1.iam.gserviceaccount.com',
    { alias: 'runner@demo-app-1.iam.gserviceaccount.com' },
  ],
  [
    'serviceAccountEmail',
    'serviceAccount:runner@demo-app-1.iam.gserviceaccount.com',
    { alias: 'runner@demo-app-1.iam.gserviceaccount.com' },
  ],
  [
    'serviceAccountEmail',
    'projects/demo-app-1/serviceAccounts/runner@demo-app-1.iam.gserviceaccount.com',
    { alias: 'runner@demo-app-1.iam.gserviceaccount.com' },
  ],
  [
    'serviceAccountEmail',
    '//iam.googleapis.com/projects/demo-app-1/serviceAccounts/runner@demo-app-1.iam.gserviceaccount.com',
    { alias: 'runner@demo-app-1.iam.gserviceaccount.com' },
  ],
  [
    'serviceAccountEmail',
    '//iam.googleapis.com/projects/demo-app-1/serviceAccounts/100000000000000000001',
    '//iam.googleapis.com/projects/demo-app-1/serviceAccounts/100000000000000000001',
  ],
  ['serviceAccountEmail', 'default', { alias: '10000000002-compute@developer.gserviceaccount.com' }],
  ['serviceAccountEmail', 'default', undefined, { asset: FOLDER }],
  ['serviceAccountEmail', 'user:alice@example.com', undefined],
  ['serviceAccountEmail', 'not-an-email', undefined],
  ['serviceAccountEmail', 'a@b', undefined],

  // gcsUri ------------------------------------------------------------------------------------------------------
  ['gcsUri', 'gs://demo-logs-1/path/to/object.json', '//storage.googleapis.com/demo-logs-1'],
  ['gcsUri', 'demo-logs-1', '//storage.googleapis.com/demo-logs-1'],
  ['gcsUri', 'gs://demo-logs-1/', '//storage.googleapis.com/demo-logs-1'],
  ['gcsUri', 'gs://demo-logs-1', '//storage.googleapis.com/demo-logs-1'],
  ['gcsUri', 'projects/_/buckets/demo-logs-1', '//storage.googleapis.com/demo-logs-1'],
  ['gcsUri', 'projects/_/buckets/demo-logs-1/objects/a.txt', '//storage.googleapis.com/demo-logs-1'],
  ['gcsUri', 'https://storage.googleapis.com/demo-logs-1/a/b.txt', '//storage.googleapis.com/demo-logs-1'],
  ['gcsUri', 'https://storage.cloud.google.com/demo-logs-1/a.txt', '//storage.googleapis.com/demo-logs-1'],
  [
    'gcsUri',
    'https://storage.googleapis.com/storage/v1/b/demo-logs-1',
    '//storage.googleapis.com/demo-logs-1',
  ],
  ['gcsUri', 'storage.googleapis.com/demo-logs-1', '//storage.googleapis.com/demo-logs-1'],
  ['gcsUri', '//storage.googleapis.com/demo-logs-1', '//storage.googleapis.com/demo-logs-1'],
  ['gcsUri', 'logs.example.org', '//storage.googleapis.com/logs.example.org'],
  ['gcsUri', 'gs://', undefined],
  ['gcsUri', 'Demo_Logs', undefined],
  ['gcsUri', 's3://demo-logs-1', undefined],
  ['gcsUri', 'ab', undefined],

  // bigqueryUri -------------------------------------------------------------------------------------------------
  [
    'bigqueryUri',
    'bigquery.googleapis.com/projects/demo-data-1/datasets/sales',
    '//bigquery.googleapis.com/projects/demo-data-1/datasets/sales',
  ],
  [
    'bigqueryUri',
    'projects/demo-data-1/datasets/sales/tables/orders',
    '//bigquery.googleapis.com/projects/demo-data-1/datasets/sales/tables/orders',
  ],
  [
    'bigqueryUri',
    '//bigquery.googleapis.com/projects/demo-data-1/datasets/sales',
    '//bigquery.googleapis.com/projects/demo-data-1/datasets/sales',
  ],
  [
    'bigqueryUri',
    'https://bigquery.googleapis.com/bigquery/v2/projects/demo-data-1/datasets/sales/tables/orders',
    '//bigquery.googleapis.com/projects/demo-data-1/datasets/sales/tables/orders',
  ],
  [
    'bigqueryUri',
    'bq://demo-data-1.sales.orders',
    '//bigquery.googleapis.com/projects/demo-data-1/datasets/sales/tables/orders',
  ],
  ['bigqueryUri', 'bq://demo-data-1.sales', '//bigquery.googleapis.com/projects/demo-data-1/datasets/sales'],
  [
    'bigqueryUri',
    'demo-data-1:sales.orders',
    '//bigquery.googleapis.com/projects/demo-data-1/datasets/sales/tables/orders',
  ],
  ['bigqueryUri', 'demo-data-1:sales', '//bigquery.googleapis.com/projects/demo-data-1/datasets/sales'],
  [
    'bigqueryUri',
    'example.com:demo-data-1:sales.orders',
    '//bigquery.googleapis.com/projects/example.com:demo-data-1/datasets/sales/tables/orders',
  ],
  [
    'bigqueryUri',
    { projectId: 'demo-data-1', datasetId: 'sales', tableId: 'orders' },
    '//bigquery.googleapis.com/projects/demo-data-1/datasets/sales/tables/orders',
  ],
  ['bigqueryUri', { datasetId: 'sales' }, '//bigquery.googleapis.com/projects/demo-app-1/datasets/sales'],
  ['bigqueryUri', { datasetId: 'sales' }, undefined, { asset: FOLDER }],
  ['bigqueryUri', { datasetId: 5 }, undefined],
  ['bigqueryUri', { datasetId: 'sales', tableId: 5 }, undefined],
  ['bigqueryUri', 'a.b.c.d', undefined],
  ['bigqueryUri', 'projects/demo-data-1/datasets/bad-name', undefined],
  ['bigqueryUri', 'projects/demo-data-1/datasets/sales/models/churn', undefined],
  ['bigqueryUri', 'projects/demo-data-1/datasets/sales/tables/or ders', undefined],
  ['bigqueryUri', 'sales', undefined],

  // pubsubUri ---------------------------------------------------------------------------------------------------
  [
    'pubsubUri',
    'pubsub.googleapis.com/projects/demo-app-1/topics/orders',
    '//pubsub.googleapis.com/projects/demo-app-1/topics/orders',
  ],
  [
    'pubsubUri',
    'projects/demo-app-1/topics/orders',
    '//pubsub.googleapis.com/projects/demo-app-1/topics/orders',
  ],
  [
    'pubsubUri',
    'projects/demo-app-1/topics/orders/',
    '//pubsub.googleapis.com/projects/demo-app-1/topics/orders',
  ],
  [
    'pubsubUri',
    'projects/demo-app-1/subscriptions/billing',
    '//pubsub.googleapis.com/projects/demo-app-1/subscriptions/billing',
  ],
  [
    'pubsubUri',
    '//pubsub.googleapis.com/projects/demo-app-1/schemas/order',
    '//pubsub.googleapis.com/projects/demo-app-1/schemas/order',
  ],
  [
    'pubsubUri',
    'https://pubsub.googleapis.com/v1/projects/demo-app-1/topics/orders',
    '//pubsub.googleapis.com/projects/demo-app-1/topics/orders',
  ],
  ['pubsubUri', '_deleted-topic_', undefined],
  ['pubsubUri', 'projects/demo-app-1/queues/orders', undefined],
  ['pubsubUri', 'projects/Bad_Project/topics/orders', undefined],

  // kmsKey ------------------------------------------------------------------------------------------------------
  [
    'kmsKey',
    'projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/disks',
    '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/disks',
  ],
  [
    'kmsKey',
    'projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/disks/cryptoKeyVersions/3',
    '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/disks',
  ],
  [
    'kmsKey',
    'projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/disks/cryptoKeyVersions/3',
    '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/disks/cryptoKeyVersions/3',
    { versionLevel: true },
  ],
  [
    'kmsKey',
    'projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/disks',
    '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/disks',
    { versionLevel: true },
  ],
  [
    'kmsKey',
    '//cloudkms.googleapis.com/v1/projects/demo-sec-1/locations/global/keyRings/attest/cryptoKeys/signer/cryptoKeyVersions/1',
    '//cloudkms.googleapis.com/projects/demo-sec-1/locations/global/keyRings/attest/cryptoKeys/signer/cryptoKeyVersions/1',
    { versionLevel: true },
  ],
  [
    'kmsKey',
    'https://cloudkms.googleapis.com/v1/projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/disks',
    '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/data/cryptoKeys/disks',
  ],
  ['kmsKey', 'projects/demo-sec-1/locations/europe-west3/keyRings/data', undefined],
  ['kmsKey', 'projects/demo-sec-1/secrets/db', undefined],

  // cloudSqlConnectionName ----------------------------------------------------------------------------------------
  // CAI names sqladmin.googleapis.com/Instance assets //cloudsql.googleapis.com/projects/<id>/instances/<name>.
  [
    'cloudSqlConnectionName',
    'demo-app-1:europe-west3:orders-db',
    '//cloudsql.googleapis.com/projects/demo-app-1/instances/orders-db',
  ],
  [
    'cloudSqlConnectionName',
    'demo-app-1:orders-db',
    '//cloudsql.googleapis.com/projects/demo-app-1/instances/orders-db',
  ],
  [
    'cloudSqlConnectionName',
    'example.com:demo-app-1:europe-west3:orders-db',
    '//cloudsql.googleapis.com/projects/example.com:demo-app-1/instances/orders-db',
  ],
  [
    'cloudSqlConnectionName',
    'projects/demo-app-1/instances/orders-db',
    '//cloudsql.googleapis.com/projects/demo-app-1/instances/orders-db',
  ],
  [
    'cloudSqlConnectionName',
    '//sqladmin.googleapis.com/projects/demo-app-1/instances/orders-db',
    '//cloudsql.googleapis.com/projects/demo-app-1/instances/orders-db',
  ],
  [
    'cloudSqlConnectionName',
    '//cloudsql.googleapis.com/projects/demo-app-1/instances/orders-db',
    '//cloudsql.googleapis.com/projects/demo-app-1/instances/orders-db',
  ],
  [
    'cloudSqlConnectionName',
    'sqladmin.googleapis.com/projects/demo-app-1/instances/orders-db',
    '//cloudsql.googleapis.com/projects/demo-app-1/instances/orders-db',
  ],
  ['cloudSqlConnectionName', 'projects/demo-app-1/instances/Orders_DB', undefined],
  ['cloudSqlConnectionName', 'demo-app-1:Europe:orders-db', undefined],
  ['cloudSqlConnectionName', 'orders-db', undefined],
  ['cloudSqlConnectionName', 'a:b:c:d', undefined],
  ['cloudSqlConnectionName', 'demo-app-1:europe-west3:Orders_DB', undefined],

  // artifactImage -----------------------------------------------------------------------------------------------
  [
    'artifactImage',
    'europe-west3-docker.pkg.dev/demo-app-1/containers/shop:1.4.2',
    '//artifactregistry.googleapis.com/projects/demo-app-1/locations/europe-west3/repositories/containers',
  ],
  [
    'artifactImage',
    'europe-west3-docker.pkg.dev/demo-app-1/containers@sha256:0123456789abcdef',
    '//artifactregistry.googleapis.com/projects/demo-app-1/locations/europe-west3/repositories/containers',
  ],
  [
    'artifactImage',
    'https://europe-docker.pkg.dev/demo-app-1/containers/shop',
    '//artifactregistry.googleapis.com/projects/demo-app-1/locations/europe/repositories/containers',
  ],
  [
    'artifactImage',
    'europe-west3-maven.pkg.dev/demo-app-1/libs',
    '//artifactregistry.googleapis.com/projects/demo-app-1/locations/europe-west3/repositories/libs',
  ],
  [
    'artifactImage',
    'europe-west3-docker.pkg.dev/example.com/demo-app-1/containers/shop',
    '//artifactregistry.googleapis.com/projects/example.com:demo-app-1/locations/europe-west3/repositories/containers',
  ],
  [
    'artifactImage',
    'gcr.io/demo-app-1/shop:latest',
    '//artifactregistry.googleapis.com/projects/demo-app-1/locations/us/repositories/gcr.io',
  ],
  [
    'artifactImage',
    'eu.gcr.io/demo-app-1/shop',
    '//artifactregistry.googleapis.com/projects/demo-app-1/locations/europe/repositories/eu.gcr.io',
  ],
  [
    'artifactImage',
    'asia.gcr.io/demo-app-1/shop',
    '//artifactregistry.googleapis.com/projects/demo-app-1/locations/asia/repositories/asia.gcr.io',
  ],
  [
    'artifactImage',
    'us.gcr.io/demo-app-1/shop',
    '//artifactregistry.googleapis.com/projects/demo-app-1/locations/us/repositories/us.gcr.io',
  ],
  [
    'artifactImage',
    'docker://gcr.io/demo-app-1/shop',
    '//artifactregistry.googleapis.com/projects/demo-app-1/locations/us/repositories/gcr.io',
  ],
  ['artifactImage', 'nginx:1.27', undefined],
  ['artifactImage', 'docker.io/library/nginx', undefined],
  ['artifactImage', 'gcr.io/demo-app-1', undefined],
  ['artifactImage', 'europe-west3-docker.pkg.dev/example.com', undefined],
  ['artifactImage', 'europe-west3-docker.pkg.dev/demo-app-1/Bad_Repo/x', undefined],

  // projectNumberOrId -------------------------------------------------------------------------------------------
  ['projectNumberOrId', '10000000002', '//cloudresourcemanager.googleapis.com/projects/10000000002'],
  ['projectNumberOrId', 'projects/10000000002', '//cloudresourcemanager.googleapis.com/projects/10000000002'],
  ['projectNumberOrId', 'demo-app-1', '//cloudresourcemanager.googleapis.com/projects/10000000002'],
  ['projectNumberOrId', 'projects/demo-app-1', '//cloudresourcemanager.googleapis.com/projects/10000000002'],
  [
    'projectNumberOrId',
    '//cloudresourcemanager.googleapis.com/projects/demo-app-1',
    '//cloudresourcemanager.googleapis.com/projects/10000000002',
  ],
  ['projectNumberOrId', 10000000002, '//cloudresourcemanager.googleapis.com/projects/10000000002'],
  ['projectNumberOrId', 'unknown-project', '//cloudresourcemanager.googleapis.com/projects/unknown-project'],
  ['projectNumberOrId', 'projects/demo-app-1/locations/global', undefined],
  ['projectNumberOrId', 'Bad_Project', undefined],
  ['projectNumberOrId', -5, undefined],
  ['projectNumberOrId', 1.5, undefined],

  // k8sOwner ------------------------------------------------------------------------------------------------------
  [
    'k8sOwner',
    { apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'web-5d9c', uid: 'x', controller: true },
    '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s/namespaces/shop/apps/replicasets/web-5d9c',
    { asset: POD },
  ],
  [
    'k8sOwner',
    { apiVersion: 'batch/v1', kind: 'Job', name: 'nightly-29000000' },
    '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s/namespaces/shop/batch/jobs/nightly-29000000',
    { asset: POD },
  ],
  [
    'k8sOwner',
    { apiVersion: 'v1', kind: 'ReplicationController', name: 'legacy' },
    '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s/namespaces/shop/replicationcontrollers/legacy',
    { asset: POD },
  ],
  [
    'k8sOwner',
    { apiVersion: 'v1', kind: 'Node', name: 'gke-shop-pool-1' },
    '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s/nodes/gke-shop-pool-1',
    { asset: POD },
  ],
  [
    'k8sOwner',
    { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', name: 'web' },
    '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s/namespaces/shop/networking.k8s.io/ingresses/web',
    { asset: POD },
  ],
  ['k8sOwner', { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web' }, undefined, { asset: NODE }],
  [
    'k8sOwner',
    { apiVersion: 'v1', kind: 'Namespace', name: 'shop' },
    '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/shop/k8s/namespaces/shop',
    { asset: NODE },
  ],
  [
    'k8sOwner',
    { apiVersion: 'argoproj.io/v1alpha1', kind: 'Rollout', name: 'web' },
    `${CLUSTER}/namespaces/shop/apis/argoproj.io/rollouts/web`,
    { asset: POD },
  ],
  ['k8sOwner', { apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'web' }, undefined],
  ['k8sOwner', 'apps/v1/ReplicaSet/web', undefined, { asset: POD }],
  ['k8sOwner', { apiVersion: 'apps/v1', kind: 'ReplicaSet' }, undefined, { asset: POD }],
  ['k8sOwner', { apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'Web Server' }, undefined, { asset: POD }],
  ['k8sOwner', { apiVersion: 'apps/v1', kind: 'replica-set', name: 'web' }, undefined, { asset: POD }],

  // siblingName --------------------------------------------------------------------------------------------
  [
    'siblingName',
    'staging',
    '//clouddeploy.googleapis.com/projects/demo-app-1/locations/europe-west3/targets/staging',
    { asset: PIPELINE, service: 'clouddeploy.googleapis.com', pattern: '{parent}/targets/{id}' },
  ],
  [
    'siblingName',
    'projects/demo-data-1/locations/us-central1/targets/prod',
    '//clouddeploy.googleapis.com/projects/demo-data-1/locations/us-central1/targets/prod',
    { asset: PIPELINE, service: 'clouddeploy.googleapis.com', pattern: '{parent}/targets/{id}' },
  ],
  [
    'siblingName',
    'shop',
    '//run.googleapis.com/projects/demo-app-1/locations/europe-west3/services/shop',
    { asset: NEG, pattern: 'projects/{project}/locations/{region}/services/{id}' },
  ],
  [
    'siblingName',
    'default',
    '//appengine.googleapis.com/apps/demo-net-1/services/default',
    { asset: PSA, service: 'appengine.googleapis.com', pattern: 'apps/{projectId}/services/{id}' },
  ],
  [
    'siblingName',
    'projects/10000000002/zones/europe-west3-a/instanceGroupManagers/web-mig',
    '//compute.googleapis.com/projects/10000000002/zones/europe-west3-a/instanceGroups/web-mig',
    { asset: VM, service: 'compute.googleapis.com', pattern: '{parent}/instanceGroups/{id}' },
  ],
  [
    'siblingName',
    'tenant-group',
    '//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/nodeGroups/tenant-group',
    {
      asset: VM,
      service: 'compute.googleapis.com',
      pattern: 'projects/{project}/zones/{zone}/nodeGroups/{id}',
    },
  ],
  // An AI zone is a zone of its region (`isZone`, `regionOfZone` of @gcportrait/model).
  [
    'siblingName',
    'tenant-group',
    '//compute.googleapis.com/projects/demo-app-1/zones/us-central1-ai1a/nodeGroups/tenant-group',
    {
      asset: TPU,
      service: 'compute.googleapis.com',
      pattern: 'projects/{project}/zones/{zone}/nodeGroups/{id}',
    },
  ],
  [
    'siblingName',
    'trainer',
    '//run.googleapis.com/projects/demo-app-1/locations/us-central1/services/trainer',
    { asset: TPU, pattern: 'projects/{project}/locations/{region}/services/{id}' },
  ],
  [
    'siblingName',
    { service: 'orders', region: 'us-central1', path: '/' },
    '//run.googleapis.com/projects/demo-app-1/locations/us-central1/services/orders',
    { pattern: 'projects/{project}/locations/{region}/services/{.service}' },
  ],
  [
    'siblingName',
    { name: 'app', projectId: 'demo-net-1' },
    '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/app',
    { service: 'compute.googleapis.com', pattern: 'projects/{project}/regions/{region}/subnetworks/{id}' },
  ],
  [
    'siblingName',
    'psa-range',
    '//compute.googleapis.com/projects/10000000001/global/addresses/psa-range',
    { asset: PSA, service: 'compute.googleapis.com', pattern: 'projects/{project}/global/addresses/{id}' },
  ],
  [
    'siblingName',
    `${SELF}/demo-net-1/global/networks/core`,
    NET,
    { service: 'compute.googleapis.com', pattern: 'projects/{project}/global/networks/{id}' },
  ],
  [
    'siblingName',
    RUN_SERVICE.name,
    '//run.googleapis.com/projects/10000000002/locations/global/fleets/default',
    { pattern: 'projects/{projectNumber}/locations/global/fleets/default' },
  ],
  ['siblingName', 'staging', undefined, { asset: PIPELINE }],
  ['siblingName', 'two words', undefined, { pattern: '{parent}/targets/{id}' }],
  [
    'siblingName',
    { region: 'us-central1' },
    undefined,
    { pattern: 'projects/{project}/locations/{region}/services/{.service}' },
  ],
  [
    'siblingName',
    'shop',
    undefined,
    { asset: NEG, pattern: 'projects/{project}/zones/{zone}/instances/{id}' },
  ],
  [
    'siblingName',
    'projects/10000000099/zones/europe-west3-a/instanceGroupManagers/web-mig',
    undefined,
    { pattern: 'apps/{projectId}/services/{id}' },
  ],
  ['siblingName', 'https://example.org/a/b', undefined, { pattern: '{parent}/targets/{id}' }],
  ['siblingName', 42, undefined, { pattern: '{parent}/targets/{id}' }],

  // k8sRef -------------------------------------------------------------------------------------------------
  ['k8sRef', 'gke-shop-pool-1', `${CLUSTER}/nodes/gke-shop-pool-1`, { asset: POD, k8sKind: 'Node' }],
  [
    'k8sRef',
    'frontend',
    `${CLUSTER}/namespaces/shop/services/frontend`,
    { asset: INGRESS, k8sKind: 'Service' },
  ],
  [
    'k8sRef',
    { kind: 'PersistentVolumeClaim', namespace: 'shop', name: 'data-0', apiVersion: 'v1' },
    `${CLUSTER}/namespaces/shop/persistentvolumeclaims/data-0`,
    { asset: PV, k8sKind: 'PersistentVolumeClaim' },
  ],
  [
    'k8sRef',
    'pvc-0a1b',
    `${CLUSTER}/persistentvolumes/pvc-0a1b`,
    { asset: POD, k8sKind: 'PersistentVolume' },
  ],
  [
    'k8sRef',
    { name: 'frontend', port: 80 },
    `${CLUSTER}/namespaces/shop/services/frontend`,
    { asset: INGRESS, k8sKind: 'Service' },
  ],
  [
    'k8sRef',
    { group: 'gateway.networking.k8s.io', kind: 'Gateway', name: 'external', namespace: 'infra' },
    `${CLUSTER}/namespaces/infra/apis/gateway.networking.k8s.io/gateways/external`,
    { asset: INGRESS, k8sKind: 'Service' },
  ],
  [
    'k8sRef',
    { name: 'external' },
    `${CLUSTER}/namespaces/shop/apis/gateway.networking.k8s.io/gateways/external`,
    { asset: INGRESS, k8sKind: 'gateway.networking.k8s.io/Gateway' },
  ],
  [
    'k8sRef',
    { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'view' },
    `${CLUSTER}/rbac.authorization.k8s.io/clusterroles/view`,
    { asset: POD },
  ],
  [
    'k8sRef',
    { group: '', kind: 'Service', name: 'cart' },
    `${CLUSTER}/namespaces/shop/services/cart`,
    { asset: POD, k8sKind: 'gateway.networking.k8s.io/Gateway' },
  ],
  ['k8sRef', 'gke-shop-pool-1', undefined, { k8sKind: 'Node' }],
  ['k8sRef', 'gke-shop-pool-1', undefined, { asset: POD }],
  ['k8sRef', 'nodes/gke-shop-pool-1', undefined, { asset: POD, k8sKind: 'Node' }],
  ['k8sRef', { kind: 'Pod' }, undefined, { asset: POD }],
  ['k8sRef', 'Web Server', undefined, { asset: POD, k8sKind: 'Service' }],
  ['k8sRef', 'data-0', undefined, { asset: NODE, k8sKind: 'PersistentVolumeClaim' }],

  // logSinkDestination ------------------------------------------------------------------------------------------
  ['logSinkDestination', 'storage.googleapis.com/demo-logs-1', '//storage.googleapis.com/demo-logs-1'],
  [
    'logSinkDestination',
    'bigquery.googleapis.com/projects/demo-data-1/datasets/logs',
    '//bigquery.googleapis.com/projects/demo-data-1/datasets/logs',
  ],
  [
    'logSinkDestination',
    'pubsub.googleapis.com/projects/demo-app-1/topics/logs',
    '//pubsub.googleapis.com/projects/demo-app-1/topics/logs',
  ],
  [
    'logSinkDestination',
    'logging.googleapis.com/projects/demo-app-1/locations/global/buckets/_Default',
    '//logging.googleapis.com/projects/demo-app-1/locations/global/buckets/_Default',
  ],
  [
    'logSinkDestination',
    'logging.googleapis.com/organizations/30000000001/locations/global/buckets/audit',
    '//logging.googleapis.com/organizations/30000000001/locations/global/buckets/audit',
  ],
  [
    'logSinkDestination',
    'logging.googleapis.com/projects/demo-data-1',
    '//cloudresourcemanager.googleapis.com/projects/10000000003',
  ],
  ['logSinkDestination', '//storage.googleapis.com/demo-logs-1', '//storage.googleapis.com/demo-logs-1'],
  ['logSinkDestination', 'logging.googleapis.com/projects/demo-app-1/sinks/all', undefined],
  ['logSinkDestination', 'spanner.googleapis.com/projects/demo-data-1/instances/ledger', undefined],
  ['logSinkDestination', 'splunk.example.org/collector', undefined],
];

describe('normalisers', () => {
  it('implements exactly the normalisers the model names', () => {
    expect(Object.keys(NORMALISERS).sort()).toEqual([...NormaliserNameSchema.options].sort());
  });

  it.each(CASES)('%s(%j) → %j', (normaliser, value, expected, overrides) => {
    expectTarget(normalise(normaliser, value, context(overrides)), expected);
  });

  it('has a case for every normaliser, including one it rejects', () => {
    for (const normaliser of NormaliserNameSchema.options) {
      const cases = CASES.filter(([name]) => name === normaliser);
      expect(
        cases.some(([, , expected]) => expected !== undefined),
        normaliser,
      ).toBe(true);
      expect(
        cases.some(([, , expected]) => expected === undefined),
        normaliser,
      ).toBe(true);
    }
  });
});

describe('kubernetesPlural', () => {
  it.each([
    ['ReplicaSet', 'replicasets'],
    ['Deployment', 'deployments'],
    ['Ingress', 'ingresses'],
    ['NetworkPolicy', 'networkpolicies'],
    ['Endpoints', 'endpoints'],
    ['Gateway', 'gateways'],
    ['Key', 'keys'],
    ['Box', 'boxes'],
    ['Patch', 'patches'],
  ])('%s → %s', (kind, plural) => {
    expect(kubernetesPlural(kind)).toBe(plural);
  });
});
