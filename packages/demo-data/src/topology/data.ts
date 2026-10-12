// SPDX-License-Identifier: MIT
/**
 * An analytics project: a data-lake bucket (CMEK, versioned), export buckets, BigQuery datasets with native
 * tables, a view and external tables over the lake bucket. Native tables and export buckets may have been
 * created inside the history window; temporary tables come and go.
 */
import type { JsonObject } from '../core/json.js';
import { DAY_MS } from '../core/time.js';
import type { OrgContext } from './context.js';
import { has } from './features.js';
import {
  addProject,
  addProjectAsset,
  fullName,
  projectInput,
  standardLabels,
  type ContainerCtx,
  type ProjectCtx,
} from './kit.js';
import { addDataPlatform } from './pipelines.js';
import { addDataProtection } from './protection.js';
import { addBucket } from './storage.js';
import { addLinkedDataset } from './stores.js';
import { DATASETS, TABLES, nth, type Env, type Region } from './vocabulary.js';
import { title } from './web.js';

export interface DataProfile {
  readonly buckets: number;
  readonly datasets: number;
  readonly tablesPerDataset: number;
  /** External tables over the lake bucket in the first dataset. */
  readonly externalTables: number;
  readonly views: boolean;
}

const SCHEMA: readonly JsonObject[] = [
  { name: 'id', type: 'STRING', mode: 'REQUIRED' },
  { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  { name: 'customer_id', type: 'STRING', mode: 'NULLABLE' },
  { name: 'amount', type: 'NUMERIC', mode: 'NULLABLE' },
  { name: 'attributes', type: 'JSON', mode: 'NULLABLE' },
];

export function addDataProject(
  ctx: OrgContext,
  folder: ContainerCtx,
  team: string,
  env: Env,
  region: Region,
): ProjectCtx {
  const { b, profile } = ctx;
  const dp = profile.data;
  const project = addProject(b, folder, {
    role: 'data',
    displayName: `${title(team)} analytics (${env})`,
    env,
    region,
    team,
  });
  const rng = b.rng.fork(`data:${project.id}`);
  const labels = standardLabels(project);
  const storageKey = ctx.keys.key(region.name, 'storage');
  const lake = `${project.id}-lake`;
  addBucket(b, project, {
    name: lake,
    region,
    labels,
    versioning: true,
    ...(storageKey === undefined ? {} : { kmsKey: storageKey }),
  });
  for (let i = 1; i < dp.buckets; i++) {
    addBucket(b, project, {
      name: `${project.id}-exports-${String(i)}`,
      region,
      labels: { ...labels, purpose: 'exports' },
      storageClass: i % 2 === 0 ? 'NEARLINE' : 'STANDARD',
      traits: { addable: true },
    });
  }
  const tableData = (dataset: string, table: string, extra: JsonObject): JsonObject => ({
    kind: 'bigquery#table',
    id: `${project.id}:${dataset}.${table}`,
    selfLink: `https://bigquery.googleapis.com/bigquery/v2/projects/${project.id}/datasets/${dataset}/tables/${table}`,
    tableReference: { projectId: project.id, datasetId: dataset, tableId: table },
    location: region.name,
    labels,
    ...extra,
  });
  let firstDataset: { name: string; full: string; createdAt: number } | undefined;
  let tableSerial = 0;
  for (let d = 0; d < dp.datasets; d++) {
    const dataset = nth(DATASETS, d).replaceAll('-', '_');
    const datasetFull = fullName('bigquery.googleapis.com', `projects/${project.id}/datasets/${dataset}`);
    const ds = addProjectAsset(b, project, {
      assetType: 'bigquery.googleapis.com/Dataset',
      name: datasetFull,
      location: region.name,
      data: {
        kind: 'bigquery#dataset',
        id: `${project.id}:${dataset}`,
        selfLink: `https://bigquery.googleapis.com/bigquery/v2/projects/${project.id}/datasets/${dataset}`,
        datasetReference: { projectId: project.id, datasetId: dataset },
        location: region.name,
        labels,
        type: 'DEFAULT',
        access: [
          { role: 'OWNER', specialGroup: 'projectOwners' },
          { role: 'READER', groupByEmail: `${team}-analysts@example.com` },
        ],
        ...(storageKey === undefined ? {} : { defaultEncryptionConfiguration: { kmsKeyName: storageKey } }),
      },
    });
    firstDataset ??= { name: dataset, full: datasetFull, createdAt: ds.createdAt };
    const firstTableId = nth(TABLES, tableSerial).replaceAll('-', '_');
    const firstTable = `${datasetFull}/tables/${firstTableId}`;
    for (let t = 0; t < dp.tablesPerDataset; t++) {
      const table = nth(TABLES, tableSerial++).replaceAll('-', '_');
      const rows = rng.int(1_000, 90_000_000);
      addProjectAsset(b, project, {
        assetType: 'bigquery.googleapis.com/Table',
        name: `${datasetFull}/tables/${table}`,
        parent: datasetFull,
        location: region.name,
        after: ds.createdAt,
        data: tableData(dataset, table, {
          type: 'TABLE',
          numRows: String(rows),
          numBytes: String(rows * rng.int(80, 400)),
          schema: { fields: [...SCHEMA] },
          timePartitioning: { type: 'DAY', field: 'created_at' },
          ...(storageKey === undefined ? {} : { encryptionConfiguration: { kmsKeyName: storageKey } }),
        }),
        traits: { addable: true },
      });
    }
    if (d === 0) {
      for (let e = 0; e < dp.externalTables; e++) {
        const table = `ext_${nth(TABLES, e).replaceAll('-', '_')}`;
        addProjectAsset(b, project, {
          assetType: 'bigquery.googleapis.com/Table',
          name: `${datasetFull}/tables/${table}`,
          parent: datasetFull,
          location: region.name,
          after: ds.createdAt,
          data: tableData(dataset, table, {
            type: 'EXTERNAL',
            externalDataConfiguration: {
              sourceUris: [`gs://${lake}/${table.slice(4)}/*.parquet`],
              sourceFormat: 'PARQUET',
              autodetect: true,
            },
          }),
        });
      }
      if (dp.views && dp.tablesPerDataset > 0) {
        // The view selects from the dataset's first table, so that table predates the window.
        const view = 'daily_summary';
        addProjectAsset(b, project, {
          assetType: 'bigquery.googleapis.com/Table',
          name: `${datasetFull}/tables/${view}`,
          parent: datasetFull,
          location: region.name,
          after: b.referenced(firstTable),
          data: tableData(dataset, view, {
            type: 'VIEW',
            view: {
              query: `SELECT DATE(created_at) AS day, COUNT(*) AS n FROM \`${project.id}.${dataset}.${firstTableId}\` GROUP BY day`,
              useLegacySql: false,
            },
          }),
        });
      }
    }
  }
  const scratch = firstDataset;
  if (scratch !== undefined) {
    b.ephemerals.push({
      kind: 'scratch-table',
      weight: 2,
      notBefore: scratch.createdAt,
      make: (createdAt, serial) => {
        const table = `tmp_scratch_${String(serial)}`;
        return [
          b.make(
            {
              ...projectInput(project, {
                assetType: 'bigquery.googleapis.com/Table',
                name: `${scratch.full}/tables/${table}`,
                parent: scratch.full,
                location: region.name,
                data: tableData(scratch.name, table, {
                  type: 'TABLE',
                  numRows: '0',
                  numBytes: '0',
                  expirationTime: String(createdAt + 7 * DAY_MS),
                  schema: { fields: [...SCHEMA] },
                }),
              }),
              after: createdAt,
            },
            createdAt,
          ),
        ];
      },
    });
  }
  b.ephemerals.push({
    kind: 'scratch-bucket',
    weight: 1,
    notBefore: project.createdAt,
    make: (createdAt, serial) => [
      b.make(
        {
          ...projectInput(project, {
            assetType: 'storage.googleapis.com/Bucket',
            name: fullName('storage.googleapis.com', `${project.id}-scratch-${String(serial)}`),
            location: region.name,
            data: {},
          }),
          data: {
            kind: 'storage#bucket',
            id: `${project.id}-scratch-${String(serial)}`,
            name: `${project.id}-scratch-${String(serial)}`,
            projectNumber: project.number,
            location: region.storageLocation,
            locationType: 'region',
            storageClass: 'STANDARD',
            iamConfiguration: {
              uniformBucketLevelAccess: { enabled: true },
              publicAccessPrevention: 'enforced',
            },
            labels: { ...labels, purpose: 'scratch' },
          },
          after: createdAt,
        },
        createdAt,
      ),
    ],
  });
  const first = firstDataset;
  if (first !== undefined) {
    const table = nth(TABLES, 0).replaceAll('-', '_');
    const tableName = `${first.full}/tables/${table}`;
    // The first data project of each environment is the data platform; the others share its warehouse.
    const source = ctx.inventory.data.find((d) => d.project.env === env);
    if (has(profile, 'data') && source === undefined) {
      addDataPlatform(ctx, {
        project,
        region,
        lake,
        dataset: first.name,
        table,
        tableName,
        datasetCreatedAt: first.createdAt,
      });
    } else if (has(profile, 'data') && source !== undefined && ctx.once('linked-dataset')) {
      addLinkedDataset(ctx, project, region, { project: source.project, dataset: source.dataset });
    }
    if (has(profile, 'security') && source === undefined)
      addDataProtection(ctx, project, region, lake, first.name, table, tableName);
    ctx.inventory.data.push({ project, region, lake, dataset: first.name, table, tableName });
  }
  ctx.perimeterCandidates.data.push(project);
  return project;
}
