// SPDX-License-Identifier: Apache-2.0
/**
 * The data platform of a data project (feature `data`, first data project of each environment): a subnet on
 * the Shared VPC for the processing services, Dataproc Metastore, a Dataproc cluster with its master and
 * worker VMs, Cloud Composer with the GKE Autopilot cluster and bucket it runs on, a streaming Dataflow job
 * reading a Pub/Sub subscription (with daily batch jobs that come and go), Dataplex (lake › zone › asset),
 * Dataform, Managed Service for Apache Kafka, a Batch job, AlloyDB, Spanner, Bigtable, BigQuery extras and a
 * BigQuery subscription that streams the serverless project's orders into the warehouse; Datastream with its
 * connection profiles and private connection from `large`.
 */
import type { OrgBuilder } from '../builder/builder.js';
import type { GenAsset } from '../builder/types.js';
import type { JsonObject } from '../core/json.js';
import { hostAt } from '../core/ip.js';
import { DAY_MS, HOUR_MS } from '../core/time.js';
import { addInstance } from './compute.js';
import { hostFor, type OrgContext } from './context.js';
import { uuidFrom } from './fabric.js';
import { has } from './features.js';
import {
  addProjectAsset,
  addServiceAccount,
  fullName,
  projectInput,
  standardLabels,
  type ProjectCtx,
} from './kit.js';
import { addSubnet } from './network.js';
import { addSecretWithVersion } from './secrets.js';
import { addBucket } from './storage.js';
import { addAlloyDb, addBigQueryExtras, addBigQueryReservation, addBigtable, addSpanner } from './stores.js';
import { REGIONS, type Region } from './vocabulary.js';

export interface DataPlatformInput {
  readonly project: ProjectCtx;
  readonly region: Region;
  readonly lake: string;
  readonly dataset: string;
  readonly table: string;
  /** The warehouse table's full name (a BigQuery subscription writes to it, a snapshot copies it). */
  readonly tableName: string;
  readonly datasetCreatedAt: number;
}

function add(
  b: OrgBuilder,
  project: ProjectCtx,
  service: string,
  kind: string,
  path: string,
  location: string,
  data: JsonObject,
  after?: number,
): GenAsset {
  return addProjectAsset(b, project, {
    assetType: `${service}/${kind}`,
    name: fullName(service, path),
    location,
    data,
    ...(after === undefined ? {} : { after }),
  });
}

/** `2026-09-14_03_12_45-<19 digits>`, the shape of a Dataflow job id, for an instant. */
function dataflowJobId(at: number, digits: string): string {
  const iso = new Date(at).toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 13)}_${iso.slice(14, 16)}_${iso.slice(17, 19)}-${digits}`;
}

export function addDataPlatform(ctx: OrgContext, input: DataPlatformInput): void {
  const { b, profile } = ctx;
  const { project, region, lake, dataset, table } = input;
  const tableCreatedAt = b.referenced(input.tableName);
  const host = hostFor(ctx, project.env);
  const rng = b.rng.fork(`platform:${project.id}`);
  const subnet = addSubnet(b, host, { region, name: `${project.id}-${region.name}`, prefix: 24 });
  const account = addServiceAccount(b, project, 'data-pipelines', 'Dataproc, Dataflow, Composer and Batch');
  const storageKey = ctx.keys.key(region.name, 'storage');
  const computeKey = ctx.keys.key(region.name, 'compute');
  const computeKeyVersion = ctx.keys.keyVersion(region.name, 'compute');
  const location = `projects/${project.id}/locations/${region.name}`;
  const zone = region.zones[0] ?? `${region.name}-a`;
  const labels = standardLabels(project);

  // Dataproc Metastore on the Shared VPC (the API writes the network with the project number).
  const metastore = `${location}/services/hive`;
  add(
    b,
    project,
    'metastore.googleapis.com',
    'Service',
    metastore,
    region.name,
    {
      name: metastore,
      uid: uuidFrom(b, metastore),
      network: `projects/${host.project.number}/global/networks/${host.name}`,
      endpointUri: `thrift://${host.psa.hosts.next()}:9083`,
      port: 9083,
      state: 'ACTIVE',
      tier: 'ENTERPRISE',
      hiveMetastoreConfig: { version: '3.1.2', endpointProtocol: 'THRIFT' },
      databaseType: 'MYSQL',
      releaseChannel: 'STABLE',
      labels,
      ...(storageKey === undefined ? {} : { encryptionConfig: { kmsKey: storageKey } }),
    },
    host.psa.createdAt,
  );

  // A Dataproc cluster on the data subnet, with the VMs it runs on and its staging and temp buckets.
  const clusterName = 'spark-etl';
  const staging = `dataproc-staging-${region.name}-${project.number}-${rng.chars('abcdefghijklmnopqrstuvwxyz0123456789', 8)}`;
  const temp = `dataproc-temp-${region.name}-${project.number}-${rng.chars('abcdefghijklmnopqrstuvwxyz0123456789', 8)}`;
  for (const bucket of [staging, temp])
    addBucket(b, project, { name: bucket, region, labels: { 'goog-dataproc-location': region.name } });
  const vms = [`${clusterName}-m`, `${clusterName}-w-0`];
  const vmLabels = { 'goog-dataproc-cluster-name': clusterName, 'goog-dataproc-location': region.name };
  for (const vm of vms) {
    addInstance(b, project, {
      zone,
      name: vm,
      machineType: 'n2-standard-4',
      nic: { network: host.selfLink, subnetwork: subnet.selfLink, ip: subnet.hosts.next() },
      serviceAccount: account.email,
      tags: ['dataproc'],
      labels: vmLabels,
      diskSizeGb: 100,
      ...(computeKeyVersion === undefined ? {} : { kmsKeyVersion: computeKeyVersion }),
      after: subnet.createdAt,
    });
  }
  add(
    b,
    project,
    'dataproc.googleapis.com',
    'Cluster',
    `projects/${project.id}/regions/${region.name}/clusters/${clusterName}`,
    region.name,
    {
      projectId: project.id,
      clusterName,
      clusterUuid: uuidFrom(b, `${project.id}/${clusterName}`),
      labels: vmLabels,
      config: {
        configBucket: staging,
        tempBucket: temp,
        gceClusterConfig: {
          zoneUri: `https://www.googleapis.com/compute/v1/projects/${project.id}/zones/${zone}`,
          subnetworkUri: subnet.selfLink,
          internalIpOnly: true,
          serviceAccount: account.email,
          serviceAccountScopes: ['https://www.googleapis.com/auth/cloud-platform'],
          tags: ['dataproc'],
        },
        masterConfig: { numInstances: 1, instanceNames: [vms[0] ?? ''], machineTypeUri: 'n2-standard-4' },
        workerConfig: { numInstances: 1, instanceNames: vms.slice(1), machineTypeUri: 'n2-standard-4' },
        softwareConfig: { imageVersion: '2.2.40-debian12', optionalComponents: ['JUPYTER'] },
        ...(computeKey === undefined ? {} : { encryptionConfig: { gcePdKmsKeyName: computeKey } }),
        metastoreConfig: { dataprocMetastoreService: metastore },
      },
      status: { state: 'RUNNING', stateStartTime: new Date(b.windowStart - 3 * DAY_MS).toISOString() },
    },
    subnet.createdAt,
  );

  // Cloud Composer 2: the environment, the GKE Autopilot cluster it runs on and its DAG bucket.
  const envName = 'orchestration';
  const envHash = rng.hex(8);
  const composerBucket = `${region.name}-${envName}-${envHash}-bucket`;
  const gke = `${region.name}-${envName}-${envHash}-gke`;
  const gkePath = `${location}/clusters/${gke}`;
  addBucket(b, project, { name: composerBucket, region, labels: { 'goog-composer-environment': envName } });
  const master = b.addresses.controlPlanes.allocate(28);
  addProjectAsset(b, project, {
    assetType: 'container.googleapis.com/Cluster',
    name: fullName('container.googleapis.com', gkePath),
    location: region.name,
    after: subnet.createdAt,
    data: {
      name: gke,
      description: `Runs the Cloud Composer environment ${envName}`,
      selfLink: `https://container.googleapis.com/v1/${gkePath}`,
      location: region.name,
      network: host.name,
      subnetwork: subnet.name,
      networkConfig: { network: host.path, subnetwork: subnet.path, datapathProvider: 'ADVANCED_DATAPATH' },
      privateClusterConfig: {
        enablePrivateNodes: true,
        masterIpv4CidrBlock: master,
        privateEndpoint: hostAt(master, 2),
      },
      endpoint: hostAt(master, 2),
      nodeConfig: { serviceAccount: account.email, imageType: 'COS_CONTAINERD' },
      autopilot: { enabled: true },
      releaseChannel: { channel: 'REGULAR' },
      currentMasterVersion: '1.33.4-gke.1245000',
      status: 'RUNNING',
      resourceLabels: { 'goog-composer-environment': envName, 'goog-composer-location': region.name },
    },
  });
  add(
    b,
    project,
    'composer.googleapis.com',
    'Environment',
    `${location}/environments/${envName}`,
    region.name,
    {
      name: `${location}/environments/${envName}`,
      uuid: uuidFrom(b, `${project.id}/${envName}`),
      state: 'RUNNING',
      labels,
      config: {
        gkeCluster: gkePath,
        dagGcsPrefix: `gs://${composerBucket}/dags`,
        nodeConfig: { network: host.path, subnetwork: subnet.path, serviceAccount: account.email },
        softwareConfig: { imageVersion: 'composer-2.9.7-airflow-2.9.3' },
        privateEnvironmentConfig: {
          enablePrivateEnvironment: true,
          privateClusterConfig: { masterIpv4CidrBlock: master },
        },
        environmentSize: 'ENVIRONMENT_SIZE_SMALL',
        airflowUri: `https://${envHash}-dot-${region.name}.composer.googleusercontent.com`,
        ...(storageKey === undefined ? {} : { encryptionConfig: { kmsKeyName: storageKey } }),
      },
      storageConfig: { bucket: composerBucket },
    },
    subnet.createdAt,
  );

  // Dataflow: a streaming job that reads the serverless project's orders, and daily batch exports.
  const source = ctx.inventory.serverless.find(
    (s) => s.project.env === project.env && s.project.team === project.team,
  );
  const sourceTopic = source?.topics[0];
  const subscription = `projects/${project.id}/subscriptions/orders-dataflow`;
  if (sourceTopic !== undefined) {
    add(b, project, 'pubsub.googleapis.com', 'Subscription', subscription, 'global', {
      name: subscription,
      topic: sourceTopic,
      ackDeadlineSeconds: 60,
      messageRetentionDuration: '604800s',
      expirationPolicy: {},
      state: 'ACTIVE',
      labels,
    });
    // The warehouse receives the orders directly as well (a BigQuery subscription).
    add(
      b,
      project,
      'pubsub.googleapis.com',
      'Subscription',
      `projects/${project.id}/subscriptions/orders-to-bigquery`,
      'global',
      {
        name: `projects/${project.id}/subscriptions/orders-to-bigquery`,
        topic: sourceTopic,
        bigqueryConfig: {
          table: `${project.id}.${dataset}.${table}`,
          useTopicSchema: true,
          writeMetadata: true,
          serviceAccountEmail: account.email,
          state: 'ACTIVE',
        },
        ackDeadlineSeconds: 60,
        messageRetentionDuration: '604800s',
        expirationPolicy: {},
        state: 'ACTIVE',
        labels,
      },
      tableCreatedAt,
    );
  }
  const dataflowBucket = `${project.id}-dataflow`;
  addBucket(b, project, { name: dataflowBucket, region, labels });
  const dataflowJob = (
    at: number,
    streaming: boolean,
    digits: string,
  ): { path: string; data: JsonObject } => {
    const id = dataflowJobId(at, digits);
    return {
      path: `${location}/jobs/${id}`,
      data: {
        id,
        projectId: project.id,
        name: streaming ? 'orders-to-bigquery' : `nightly-export-${id.slice(0, 10)}`,
        type: streaming ? 'JOB_TYPE_STREAMING' : 'JOB_TYPE_BATCH',
        currentState: streaming ? 'JOB_STATE_RUNNING' : 'JOB_STATE_DONE',
        location: region.name,
        environment: {
          tempStoragePrefix: `storage.googleapis.com/${dataflowBucket}/temp`,
          serviceAccountEmail: account.email,
          workerRegion: region.name,
          workerPools: [
            {
              kind: 'harness',
              numWorkers: streaming ? 2 : 4,
              machineType: 'n2-standard-4',
              network: host.name,
              subnetwork: subnet.selfLink,
            },
          ],
          ...(storageKey === undefined ? {} : { serviceKmsKeyName: storageKey }),
        },
        ...(streaming && sourceTopic !== undefined
          ? {
              jobMetadata: {
                sdkVersion: { version: '2.66.0', versionDisplayName: 'Apache Beam SDK for Java' },
                pubsubDetails: [{ subscription }],
                bigqueryDetails: [{ projectId: project.id, dataset, table }],
              },
            }
          : {}),
      },
    };
  };
  const streaming = dataflowJob(b.windowStart - 23 * DAY_MS, true, rng.digits(19));
  add(
    b,
    project,
    'dataflow.googleapis.com',
    'Job',
    streaming.path,
    region.name,
    streaming.data,
    subnet.createdAt,
  );
  b.ephemerals.push({
    kind: 'dataflow-batch',
    weight: 1,
    notBefore: subnet.createdAt,
    make: (createdAt, _serial, r) => {
      const job = dataflowJob(createdAt, false, r.digits(19));
      return [
        b.make(
          {
            ...projectInput(project, {
              assetType: 'dataflow.googleapis.com/Job',
              name: fullName('dataflow.googleapis.com', job.path),
              location: region.name,
              data: job.data,
            }),
            after: createdAt,
          },
          createdAt,
        ),
      ];
    },
  });

  // Dataplex: a lake on the metastore with a curated zone that manages the warehouse dataset.
  const lakePath = `${location}/lakes/analytics`;
  const zonePath = `${lakePath}/zones/curated`;
  add(b, project, 'dataplex.googleapis.com', 'Lake', lakePath, region.name, {
    name: lakePath,
    displayName: 'Analytics',
    uid: uuidFrom(b, lakePath),
    state: 'ACTIVE',
    serviceAccount: `service-${project.number}@gcp-sa-dataplex.iam.gserviceaccount.com`,
    metastore: { service: metastore },
    labels,
  });
  add(b, project, 'dataplex.googleapis.com', 'Zone', zonePath, region.name, {
    name: zonePath,
    displayName: 'Curated',
    uid: uuidFrom(b, zonePath),
    state: 'ACTIVE',
    type: 'CURATED',
    resourceSpec: { locationType: 'SINGLE_REGION' },
    discoverySpec: { enabled: true },
  });
  // A bucket asset is left out: the API names buckets projects/<number>/buckets/<b>, which the catalog's rule
  // does not map to the bucket's asset name yet.
  add(
    b,
    project,
    'dataplex.googleapis.com',
    'Asset',
    `${zonePath}/assets/${dataset.replaceAll('_', '-')}`,
    region.name,
    {
      name: `${zonePath}/assets/${dataset.replaceAll('_', '-')}`,
      displayName: `${dataset} dataset`,
      uid: uuidFrom(b, `${zonePath}/${dataset}`),
      state: 'ACTIVE',
      resourceSpec: { name: `projects/${project.id}/datasets/${dataset}`, type: 'BIGQUERY_DATASET' },
      resourceStatus: { state: 'READY' },
      discoverySpec: { enabled: true },
    },
    input.datasetCreatedAt,
  );

  // Dataform: the warehouse transformations, from a Git repository whose token is a secret.
  const token = addSecretWithVersion(ctx, project, 'dataform-git-token', region);
  add(
    b,
    project,
    'dataform.googleapis.com',
    'Repository',
    `${location}/repositories/warehouse`,
    region.name,
    {
      name: `${location}/repositories/warehouse`,
      displayName: 'warehouse',
      gitRemoteSettings: {
        url: 'https://git.example.com/data/warehouse.git',
        defaultBranch: 'main',
        authenticationTokenSecretVersion: token,
        tokenStatus: 'VALID',
      },
      serviceAccount: account.email,
      setAuthenticatedUserAdmin: false,
      labels,
      ...(storageKey === undefined ? {} : { kmsKeyName: storageKey }),
    },
  );

  // Managed Service for Apache Kafka on the data subnet. The asset name carries the project id, while the API
  // writes the project number into `data.name`.
  addProjectAsset(b, project, {
    assetType: 'managedkafka.googleapis.com/Cluster',
    name: fullName('managedkafka.googleapis.com', `${location}/clusters/events`),
    location: region.name,
    data: {
      name: `projects/${project.number}/locations/${region.name}/clusters/events`,
      labels,
      capacityConfig: { vcpuCount: '3', memoryBytes: '12884901888' },
      rebalanceConfig: { mode: 'AUTO_REBALANCE_ON_SCALE_UP' },
      state: 'ACTIVE',
      gcpConfig: {
        accessConfig: { networkConfigs: [{ subnet: subnet.path }] },
        ...(storageKey === undefined ? {} : { kmsKey: storageKey }),
      },
    },
    after: subnet.createdAt,
  });

  // Batch: the nightly ETL job, notifying a topic of the project.
  const batchTopic = `projects/${project.id}/topics/batch-events`;
  add(b, project, 'pubsub.googleapis.com', 'Topic', batchTopic, 'global', { name: batchTopic, labels });
  const batchJob = (at: number, state: string): { path: string; data: JsonObject } => {
    const day = new Date(at).toISOString().slice(0, 10).replaceAll('-', '');
    const path = `${location}/jobs/nightly-etl-${day}`;
    return {
      path,
      data: {
        name: `projects/${project.number}/locations/${region.name}/jobs/nightly-etl-${day}`,
        uid: `nightly-etl-${day}-${b.rng.fork(`batch:${project.id}/${day}`).hex(4)}`,
        priority: '0',
        status: { state, runDuration: '1800s' },
        taskGroups: [
          {
            taskCount: '8',
            parallelism: '4',
            taskSpec: {
              runnables: [
                {
                  container: {
                    imageUri: `${region.name}-docker.pkg.dev/${project.id}/apps/etl:1.4.0`,
                    commands: ['--incremental'],
                  },
                },
              ],
              volumes: [{ gcs: { remotePath: `${lake}/exports` }, mountPath: '/mnt/lake' }],
              computeResource: { cpuMilli: '2000', memoryMib: '4096' },
              maxRetryCount: 2,
            },
          },
        ],
        allocationPolicy: {
          location: { allowedLocations: [`regions/${region.name}`] },
          instances: [{ policy: { machineType: 'e2-standard-4', provisioningModel: 'SPOT' } }],
          serviceAccount: { email: account.email },
          network: {
            networkInterfaces: [{ network: host.path, subnetwork: subnet.path, noExternalIpAddress: true }],
          },
        },
        notifications: [{ pubsubTopic: batchTopic, message: { type: 'JOB_STATE_CHANGED' } }],
        logsPolicy: { destination: 'CLOUD_LOGGING' },
      },
    };
  };
  const running = batchJob(b.windowStart - HOUR_MS * 20, 'RUNNING');
  add(b, project, 'batch.googleapis.com', 'Job', running.path, region.name, running.data, subnet.createdAt);
  b.ephemerals.push({
    kind: 'batch-job',
    weight: 1,
    notBefore: subnet.createdAt,
    make: (createdAt) => {
      const job = batchJob(createdAt, 'SUCCEEDED');
      return [
        b.make(
          {
            ...projectInput(project, {
              assetType: 'batch.googleapis.com/Job',
              name: fullName('batch.googleapis.com', job.path),
              location: region.name,
              data: job.data,
            }),
            after: createdAt,
          },
          createdAt,
        ),
      ];
    },
  });

  // Databases and warehouse extras of the platform.
  const regions = REGIONS.slice(0, profile.regions);
  addAlloyDb(ctx, project, [region, ...regions.filter((r) => r !== region)], host, has(profile, 'large'));
  addSpanner(ctx, project, region);
  addBigtable(ctx, project, region);
  addBigQueryExtras(ctx, project, region, {
    dataset,
    table,
    datasetCreatedAt: input.datasetCreatedAt,
    tableCreatedAt,
  });
  if (ctx.once('bigquery-reservation')) addBigQueryReservation(ctx, project, region);
  if (has(profile, 'large')) {
    addDatastream(ctx, project, region, dataset);
    addSharing(ctx, project, region, dataset, table, lake, account.email);
  }
}

/** Analytics Hub (a data exchange listing the warehouse dataset) and a BigQuery Data Transfer from the lake. */
function addSharing(
  ctx: OrgContext,
  project: ProjectCtx,
  region: Region,
  dataset: string,
  table: string,
  lake: string,
  account: string,
): void {
  const { b } = ctx;
  const location = `projects/${project.id}/locations/${region.name}`;
  const exchange = `${location}/dataExchanges/sales_exchange`;
  const created = add(b, project, 'analyticshub.googleapis.com', 'DataExchange', exchange, region.name, {
    name: exchange,
    displayName: 'Sales exchange',
    description: 'Curated sales data for the business units',
    primaryContact: 'data-platform@example.com',
    listingCount: 1,
  }).createdAt;
  add(
    b,
    project,
    'analyticshub.googleapis.com',
    'Listing',
    `${exchange}/listings/orders`,
    region.name,
    {
      name: `${exchange}/listings/orders`,
      displayName: 'Orders',
      state: 'ACTIVE',
      resourceType: 'BIGQUERY_DATASET',
      bigqueryDataset: { dataset: `projects/${project.id}/datasets/${dataset}` },
      categories: ['CATEGORY_COMMERCE'],
    },
    created,
  );
  const transfer = `projects/${project.number}/locations/${region.name}/transferConfigs/${uuidFrom(b, `${project.id}/transfer`)}`;
  add(b, project, 'bigquerydatatransfer.googleapis.com', 'TransferConfig', transfer, region.name, {
    name: transfer,
    displayName: 'Daily partner files',
    dataSourceId: 'google_cloud_storage',
    destinationDatasetId: dataset,
    schedule: 'every 24 hours',
    state: 'SUCCEEDED',
    params: {
      data_path_template: `gs://${lake}/partners/*.csv`,
      destination_table_name_template: `${table}_partner`,
      file_format: 'CSV',
    },
    ownerInfo: { email: account },
  });
}

/** Datastream: a MySQL source over a private connection on the Shared VPC into the warehouse dataset. */
function addDatastream(ctx: OrgContext, project: ProjectCtx, region: Region, dataset: string): void {
  const { b } = ctx;
  const host = hostFor(ctx, project.env);
  const location = `projects/${project.id}/locations/${region.name}`;
  const privateConnection = `${location}/privateConnections/shared-vpc`;
  add(
    b,
    project,
    'datastream.googleapis.com',
    'PrivateConnection',
    privateConnection,
    region.name,
    {
      name: privateConnection,
      displayName: 'Shared VPC peering',
      state: 'CREATED',
      vpcPeeringConfig: { vpc: host.path, subnet: b.addresses.privateServices.allocate(29) },
      labels: standardLabels(project),
    },
    host.createdAt,
  );
  const password = addSecretWithVersion(ctx, project, 'datastream-mysql-password', region);
  const sourceProfile = `${location}/connectionProfiles/orders-mysql`;
  add(b, project, 'datastream.googleapis.com', 'ConnectionProfile', sourceProfile, region.name, {
    name: sourceProfile,
    displayName: 'Orders MySQL (data centre)',
    mysqlProfile: {
      hostname: '172.16.12.40',
      port: 3306,
      username: 'datastream',
      secretManagerStoredPassword: password.replace(/\/versions\/1$/, ''),
    },
    privateConnectivity: { privateConnection },
  });
  const destinationProfile = `${location}/connectionProfiles/warehouse`;
  add(b, project, 'datastream.googleapis.com', 'ConnectionProfile', destinationProfile, region.name, {
    name: destinationProfile,
    displayName: 'Warehouse',
    bigqueryProfile: {},
  });
  add(b, project, 'datastream.googleapis.com', 'Stream', `${location}/streams/orders-cdc`, region.name, {
    name: `${location}/streams/orders-cdc`,
    displayName: 'Orders change data capture',
    state: 'RUNNING',
    sourceConfig: { sourceConnectionProfile: sourceProfile, mysqlSourceConfig: { maxConcurrentCdcTasks: 5 } },
    destinationConfig: {
      destinationConnectionProfile: destinationProfile,
      bigqueryDestinationConfig: {
        singleTargetDataset: { datasetId: `${project.id}:${dataset}` },
        dataFreshness: '900s',
      },
    },
    backfillAll: {},
  });
}
