// SPDX-License-Identifier: Apache-2.0
/**
 * Data stores beyond Cloud Storage, BigQuery tables and Cloud SQL (feature `data`): Memorystore for Redis on
 * private services access and Memorystore for Valkey over Private Service Connect next to the web tiers,
 * Filestore for the GKE projects, Firestore for the serverless projects, Cloud SQL read replicas, PSC and
 * backups, and in the data platform AlloyDB (with a cross-region secondary from `large`), Spanner, Bigtable,
 * BigQuery routines, models, table snapshots, a linked dataset and an Enterprise reservation.
 */
import type { OrgBuilder } from '../builder/builder.js';
import type { GenAsset } from '../builder/types.js';
import type { JsonObject } from '../core/json.js';
import { DAY_MS, HOUR_MS } from '../core/time.js';
import type { OrgContext } from './context.js';
import type { HostFabric } from './fabric.js';
import { uuidFrom } from './fabric.js';
import {
  addCompute,
  addProjectAsset,
  computeSelfLink,
  fullName,
  standardLabels,
  type ProjectCtx,
} from './kit.js';
import type { HostNetwork } from './network.js';
import type { Region } from './vocabulary.js';

function add(
  b: OrgBuilder,
  project: ProjectCtx,
  assetType: string,
  name: string,
  location: string,
  data: JsonObject,
  after?: number,
  parent?: string,
): GenAsset {
  return addProjectAsset(b, project, {
    assetType,
    name,
    location,
    data,
    ...(after === undefined ? {} : { after }),
    ...(parent === undefined ? {} : { parent }),
  });
}

/** Memorystore for Redis (Standard tier) on the host's private services access range. */
export function addRedis(ctx: OrgContext, project: ProjectCtx, region: Region, host: HostNetwork): void {
  const path = `projects/${project.id}/locations/${region.name}/instances/sessions`;
  const key = project.env === 'prod' ? ctx.keys.key(region.name, 'storage') : undefined;
  add(
    ctx.b,
    project,
    'redis.googleapis.com/Instance',
    fullName('redis.googleapis.com', path),
    region.name,
    {
      name: path,
      displayName: 'Storefront sessions',
      labels: standardLabels(project),
      locationId: region.zones[0] ?? `${region.name}-a`,
      alternativeLocationId: region.zones[1] ?? `${region.name}-b`,
      redisVersion: 'REDIS_7_2',
      reservedIpRange: host.psa.rangeName,
      host: host.psa.hosts.next(),
      port: 6379,
      currentLocationId: region.zones[0] ?? `${region.name}-a`,
      state: 'READY',
      tier: 'STANDARD_HA',
      memorySizeGb: 5,
      authorizedNetwork: host.path,
      connectMode: 'PRIVATE_SERVICE_ACCESS',
      transitEncryptionMode: 'SERVER_AUTHENTICATION',
      replicaCount: 1,
      readReplicasMode: 'READ_REPLICAS_ENABLED',
      ...(key === undefined ? {} : { customerManagedKey: key }),
    },
    host.psa.createdAt,
  );
}

/**
 * Memorystore for Valkey reached over Private Service Connect: the instance and the consumer forwarding rule
 * the service connection policy created for it in the project (on the host's endpoint subnet).
 */
export function addValkey(ctx: OrgContext, project: ProjectCtx, region: Region, fabric: HostFabric): void {
  const { b } = ctx;
  const host = fabric.host;
  const rng = b.rng.fork(`valkey:${project.id}`);
  const ruleName = `sca-auto-fr-${rng.hex(8)}-${rng.hex(4)}`;
  const ip = fabric.endpoints.hosts.next();
  const tenant = `${rng.hex(14)}-tp`;
  const attachment = computeSelfLink(
    tenant,
    `regions/${region.name}/serviceAttachments/gcp-memorystore-auto-${rng.hex(8)}`,
  );
  const connectionId = rng.digits(17);
  const rule = addCompute(b, project, {
    kind: 'ForwardingRule',
    collection: 'forwardingRules',
    scope: { region: region.name },
    name: ruleName,
    after: fabric.endpoints.createdAt,
    data: {
      description: 'Service connection policy endpoint for Memorystore catalog-cache',
      IPAddress: ip,
      target: attachment,
      network: host.selfLink,
      subnetwork: fabric.endpoints.selfLink,
      loadBalancingScheme: '',
      pscConnectionId: connectionId,
      pscConnectionStatus: 'ACCEPTED',
      labelFingerprint: '42WmSpB8rSM=',
      fingerprint: 'Rm2qK7tVn0c=',
    },
  });
  const path = `projects/${project.id}/locations/${region.name}/instances/catalog-cache`;
  const key = ctx.keys.key(region.name, 'storage');
  add(
    b,
    project,
    'memorystore.googleapis.com/Instance',
    fullName('memorystore.googleapis.com', path),
    region.name,
    {
      name: path,
      labels: standardLabels(project),
      state: 'ACTIVE',
      uid: uuidFrom(b, path),
      engineVersion: 'VALKEY_8_0',
      nodeType: 'HIGHMEM_MEDIUM',
      shardCount: 3,
      replicaCount: 1,
      mode: 'CLUSTER',
      authorizationMode: 'IAM_AUTH',
      transitEncryptionMode: 'SERVER_AUTHENTICATION',
      zoneDistributionConfig: { mode: 'MULTI_ZONE' },
      endpoints: [
        {
          connections: [
            {
              pscAutoConnection: {
                pscConnectionId: connectionId,
                ipAddress: ip,
                forwardingRule: `projects/${project.id}/regions/${region.name}/forwardingRules/${ruleName}`,
                projectId: project.id,
                network: host.path,
                serviceAttachment: attachment.replace('https://www.googleapis.com/compute/v1/', ''),
                pscConnectionStatus: 'PSC_CONNECTION_STATUS_ACTIVE',
                connectionType: 'CONNECTION_TYPE_DISCOVERY',
              },
            },
          ],
        },
      ],
      ...(key === undefined ? {} : { kmsKey: key }),
    },
    rule.asset.createdAt,
  );
}

/** A zonal Filestore share on the host's private services access range. */
export function addFilestore(ctx: OrgContext, project: ProjectCtx, region: Region, host: HostNetwork): void {
  const zone = region.zones[0] ?? `${region.name}-a`;
  const path = `projects/${project.id}/locations/${zone}/instances/shared-volumes`;
  const key = ctx.keys.key(region.name, 'storage');
  add(
    ctx.b,
    project,
    'file.googleapis.com/Instance',
    fullName('file.googleapis.com', path),
    zone,
    {
      name: path,
      description: 'ReadWriteMany volumes for the cluster',
      state: 'READY',
      tier: 'ZONAL',
      protocol: 'NFS_V3',
      labels: standardLabels(project),
      fileShares: [{ name: 'vol1', capacityGb: '1024' }],
      networks: [
        {
          network: host.path,
          modes: ['MODE_IPV4'],
          reservedIpRange: host.psa.rangeName,
          connectMode: 'PRIVATE_SERVICE_ACCESS',
          ipAddresses: [host.psa.hosts.next()],
        },
      ],
      ...(key === undefined ? {} : { kmsKeyName: key }),
    },
    host.psa.createdAt,
  );
}

/** The `(default)` Firestore database of a serverless project (CAI names it with the project number). */
export function addFirestore(ctx: OrgContext, project: ProjectCtx, region: Region): void {
  add(
    ctx.b,
    project,
    'firestore.googleapis.com/Database',
    fullName('firestore.googleapis.com', `projects/${project.number}/databases/(default)`),
    region.name,
    {
      name: `projects/${project.id}/databases/(default)`,
      uid: uuidFrom(ctx.b, `${project.id}/firestore`),
      locationId: region.name,
      type: 'FIRESTORE_NATIVE',
      concurrencyMode: 'PESSIMISTIC',
      appEngineIntegrationMode: 'DISABLED',
      pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED',
      deleteProtectionState: 'DELETE_PROTECTION_ENABLED',
      databaseEdition: 'STANDARD',
      etag: 'IOvm0bLzvogDMOiQ',
    },
  );
}

/** Hidden automated backups of a Cloud SQL instance (CAI names them in the `cloudsql` family). */
export function addSqlBackups(
  ctx: OrgContext,
  project: ProjectCtx,
  region: Region,
  instance: string,
  kmsKey: string | undefined,
  after: number,
): void {
  for (const daysAgo of [2, 1]) {
    const id = String(ctx.b.windowStart - daysAgo * DAY_MS);
    add(
      ctx.b,
      project,
      'sqladmin.googleapis.com/Backup',
      fullName('cloudsql.googleapis.com', `projects/${project.id}/backups/${id}`),
      region.name,
      {
        name: `projects/${project.id}/backups/${id}`,
        kind: 'sql#backup',
        instance,
        type: 'AUTOMATED',
        state: 'SUCCESSFUL',
        backupKind: 'SNAPSHOT',
        location: region.name,
        databaseVersion: 'POSTGRES_16',
        ...(kmsKey === undefined ? {} : { kmsKey }),
      },
      after,
    );
  }
}

/** AlloyDB for PostgreSQL: a primary cluster with its primary instance, and (with `large`) a secondary. */
export function addAlloyDb(
  ctx: OrgContext,
  project: ProjectCtx,
  regions: readonly Region[],
  host: HostNetwork,
  secondary: boolean,
): void {
  const { b } = ctx;
  const region = regions[0];
  if (region === undefined) return;
  const dr = secondary ? regions[1] : undefined;
  const cluster = (r: Region, name: string): string =>
    `projects/${project.id}/locations/${r.name}/clusters/${name}`;
  const primaryPath = cluster(region, 'orders');
  const drPath = dr === undefined ? undefined : cluster(dr, 'orders-dr');
  const make = (r: Region, path: string, type: 'PRIMARY' | 'SECONDARY'): number => {
    const key = ctx.keys.key(r.name, 'sql');
    const created = add(
      b,
      project,
      'alloydb.googleapis.com/Cluster',
      fullName('alloydb.googleapis.com', path),
      r.name,
      {
        name: path,
        displayName: type === 'PRIMARY' ? 'Orders' : 'Orders (disaster recovery)',
        uid: uuidFrom(b, path),
        labels: standardLabels(project),
        state: 'READY',
        clusterType: type,
        databaseVersion: 'POSTGRES_16',
        networkConfig: { network: host.path, allocatedIpRange: host.psa.rangeName },
        ...(key === undefined ? {} : { encryptionConfig: { kmsKeyName: key } }),
        ...(type === 'PRIMARY'
          ? {
              automatedBackupPolicy: {
                enabled: true,
                weeklySchedule: { daysOfWeek: ['MONDAY', 'THURSDAY'], startTimes: [{ hours: 2 }] },
                quantityBasedRetention: { count: 14 },
              },
              ...(drPath === undefined ? {} : { primaryConfig: { secondaryClusterNames: [drPath] } }),
            }
          : { secondaryConfig: { primaryClusterName: primaryPath } }),
      },
      host.psa.createdAt,
    ).createdAt;
    const instance = `${path}/instances/${type === 'PRIMARY' ? 'orders-primary' : 'orders-secondary'}`;
    add(
      b,
      project,
      'alloydb.googleapis.com/Instance',
      fullName('alloydb.googleapis.com', instance),
      r.name,
      {
        name: instance,
        uid: uuidFrom(b, instance),
        state: 'READY',
        instanceType: type,
        machineConfig: { cpuCount: 4 },
        availabilityType: type === 'PRIMARY' ? 'REGIONAL' : 'ZONAL',
        ipAddress: host.psa.hosts.next(),
        databaseFlags: { 'alloydb.enable_pgaudit': 'on' },
      },
      created,
    );
    return created;
  };
  make(region, primaryPath, 'PRIMARY');
  if (dr !== undefined && drPath !== undefined) make(dr, drPath, 'SECONDARY');
}

/** Cloud Spanner: a regional instance with one CMEK database. */
export function addSpanner(ctx: OrgContext, project: ProjectCtx, region: Region): void {
  const { b } = ctx;
  const instance = `projects/${project.id}/instances/ledger`;
  const created = add(
    b,
    project,
    'spanner.googleapis.com/Instance',
    fullName('spanner.googleapis.com', instance),
    region.name,
    {
      name: instance,
      config: `projects/${project.id}/instanceConfigs/regional-${region.name}`,
      displayName: 'Ledger',
      processingUnits: 1000,
      nodeCount: 1,
      state: 'READY',
      edition: 'ENTERPRISE',
      labels: standardLabels(project),
    },
  ).createdAt;
  const key = ctx.keys.key(region.name, 'storage');
  const database = `${instance}/databases/payments`;
  add(
    b,
    project,
    'spanner.googleapis.com/Database',
    fullName('spanner.googleapis.com', database),
    region.name,
    {
      name: database,
      state: 'READY',
      databaseDialect: 'GOOGLE_STANDARD_SQL',
      defaultLeader: region.name,
      versionRetentionPeriod: '1h',
      ...(key === undefined ? {} : { encryptionConfig: { kmsKeyName: key } }),
    },
    created,
    fullName('spanner.googleapis.com', instance),
  );
}

/** Cloud Bigtable: a production instance with one cluster and one table (CAI names it `bigtable.…`). */
export function addBigtable(ctx: OrgContext, project: ProjectCtx, region: Region): void {
  const { b } = ctx;
  const instance = `projects/${project.id}/instances/events`;
  const full = fullName('bigtable.googleapis.com', instance);
  const created = add(b, project, 'bigtableadmin.googleapis.com/Instance', full, region.name, {
    name: instance,
    displayName: 'Click events',
    state: 'READY',
    type: 'PRODUCTION',
    labels: standardLabels(project),
  }).createdAt;
  const key = ctx.keys.key(region.name, 'storage');
  const zone = region.zones[0] ?? `${region.name}-a`;
  add(
    b,
    project,
    'bigtableadmin.googleapis.com/Cluster',
    `${full}/clusters/events-c1`,
    zone,
    {
      name: `${instance}/clusters/events-c1`,
      location: `projects/${project.id}/locations/${zone}`,
      state: 'READY',
      serveNodes: 3,
      defaultStorageType: 'SSD',
      ...(key === undefined ? {} : { encryptionConfig: { kmsKeyName: key } }),
    },
    created,
    full,
  );
  add(
    b,
    project,
    'bigtableadmin.googleapis.com/Table',
    `${full}/tables/clickstream`,
    region.name,
    {
      name: `${instance}/tables/clickstream`,
      granularity: 'MILLIS',
      columnFamilies: { click: { gcRule: { maxNumVersions: 1 } } },
      deletionProtection: true,
    },
    created,
    full,
  );
}

/** A routine, a BigQuery ML model and a snapshot of one of the dataset's tables. */
export function addBigQueryExtras(
  ctx: OrgContext,
  project: ProjectCtx,
  region: Region,
  input: {
    readonly dataset: string;
    readonly table: string;
    readonly datasetCreatedAt: number;
    /** The snapshot copies the table, so it is younger. */
    readonly tableCreatedAt: number;
  },
): void {
  const { b } = ctx;
  const { dataset, table, datasetCreatedAt: after } = input;
  const datasetFull = fullName('bigquery.googleapis.com', `projects/${project.id}/datasets/${dataset}`);
  add(
    b,
    project,
    'bigquery.googleapis.com/Routine',
    `${datasetFull}/routines/net_amount`,
    region.name,
    {
      etag: 'c2FsZXMtbmV0',
      routineReference: { projectId: project.id, datasetId: dataset, routineId: 'net_amount' },
      routineType: 'SCALAR_FUNCTION',
      language: 'SQL',
      arguments: [{ name: 'gross', dataType: { typeKind: 'NUMERIC' } }],
      returnType: { typeKind: 'NUMERIC' },
      definitionBody: 'gross / 1.19',
    },
    after,
    datasetFull,
  );
  add(
    b,
    project,
    'bigquery.googleapis.com/Model',
    `${datasetFull}/models/churn_forecast`,
    region.name,
    {
      modelReference: { projectId: project.id, datasetId: dataset, modelId: 'churn_forecast' },
      modelType: 'BOOSTED_TREE_CLASSIFIER',
      location: region.name,
      featureColumns: [{ name: 'orders_90d', type: { typeKind: 'INT64' } }],
      labelColumns: [{ name: 'predicted_churned', type: { typeKind: 'BOOL' } }],
    },
    after,
    datasetFull,
  );
  const snapshot = `${table}_snapshot_month_end`;
  // A snapshot table is created at its snapshot time (or up to seven days later, from time travel).
  const snapshotAt = b.createdAt(`${datasetFull}/tables/${snapshot}`, input.tableCreatedAt);
  add(
    b,
    project,
    'bigquery.googleapis.com/Table',
    `${datasetFull}/tables/${snapshot}`,
    region.name,
    {
      kind: 'bigquery#table',
      id: `${project.id}:${dataset}.${snapshot}`,
      tableReference: { projectId: project.id, datasetId: dataset, tableId: snapshot },
      location: region.name,
      type: 'SNAPSHOT',
      snapshotDefinition: {
        baseTableReference: { projectId: project.id, datasetId: dataset, tableId: table },
        snapshotTime: new Date(snapshotAt - HOUR_MS).toISOString(),
      },
      labels: standardLabels(project),
    },
    input.tableCreatedAt,
    datasetFull,
  );
}

/** A linked dataset (BigQuery sharing) that reads another project's dataset. */
export function addLinkedDataset(
  ctx: OrgContext,
  project: ProjectCtx,
  region: Region,
  source: { readonly project: ProjectCtx; readonly dataset: string },
): void {
  const id = `${source.dataset}_shared`;
  add(
    ctx.b,
    project,
    'bigquery.googleapis.com/Dataset',
    fullName('bigquery.googleapis.com', `projects/${project.id}/datasets/${id}`),
    region.name,
    {
      kind: 'bigquery#dataset',
      id: `${project.id}:${id}`,
      datasetReference: { projectId: project.id, datasetId: id },
      location: region.name,
      type: 'LINKED',
      linkedDatasetSource: { sourceDataset: { projectId: source.project.id, datasetId: source.dataset } },
      labels: standardLabels(project),
    },
    source.project.createdAt,
  );
}

/** An Enterprise reservation for the analytics projects, assigned to a project and the Workloads folder. */
export function addBigQueryReservation(ctx: OrgContext, project: ProjectCtx, region: Region): void {
  const { b } = ctx;
  const path = `projects/${project.id}/locations/${region.name}/reservations/prod`;
  const full = fullName(
    'bigqueryreservation.googleapis.com',
    `projects/${project.number}/locations/${region.name}/reservations/prod`,
  );
  const created = add(b, project, 'bigqueryreservation.googleapis.com/Reservation', full, region.name, {
    name: path,
    slotCapacity: '100',
    ignoreIdleSlots: false,
    autoscale: { currentSlots: '0', maxSlots: '400' },
    concurrency: '0',
    edition: 'ENTERPRISE',
  }).createdAt;
  const assignments: readonly [string, string, string][] = [
    ['a-analytics', `projects/${project.id}`, 'QUERY'],
    ['a-workloads', ctx.folders.workloads.ref, 'PIPELINE'],
  ];
  for (const [id, assignee, jobType] of assignments) {
    add(
      b,
      project,
      'bigqueryreservation.googleapis.com/ReservationAssignment',
      `${full}/assignments/${id}`,
      region.name,
      {
        name: `${path}/assignments/${id}`,
        assignee,
        jobType,
        state: 'ACTIVE',
      },
      created,
    );
  }
}
