// SPDX-License-Identifier: MIT
/**
 * Synthetic sample documents for the tests: example.com domains, documentation IP ranges, project numbers
 * below 100000000000. Each builder returns a fresh object, so a test can mutate it.
 */
import type { z } from 'zod';
import type { Asset } from '../schemas/asset.js';
import { CatalogSchema, type Catalog, type CatalogEntrySchema } from '../schemas/catalog.js';
import type { Graph } from '../schemas/graph.js';
import { LensIdSchema } from '../schemas/lens.js';
import type { Scene } from '../schemas/scene.js';
import type { Snapshot } from '../schemas/snapshot.js';
import type { ViewSpec } from '../schemas/view-spec.js';

export const ORG = '//cloudresourcemanager.googleapis.com/organizations/30000000001';
export const FOLDER = '//cloudresourcemanager.googleapis.com/folders/20000000001';
export const PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000001';
export const NETWORK = '//compute.googleapis.com/projects/demo-net/global/networks/core';
export const SUBNET = '//compute.googleapis.com/projects/demo-net/regions/europe-west3/subnetworks/app';
export const INSTANCE = '//compute.googleapis.com/projects/demo-net/zones/europe-west3-a/instances/web-1';
export const DISK = '//compute.googleapis.com/projects/demo-net/zones/europe-west3-a/disks/web-1-boot';
export const ULID = '01J9Z3K5Q8XW2V4N6P7R8S9T0A';

export function sampleAsset(): Asset {
  return {
    name: INSTANCE,
    assetType: 'compute.googleapis.com/Instance',
    parent: PROJECT,
    ancestors: ['projects/10000000001', 'folders/20000000001', 'organizations/30000000001'],
    location: 'europe-west3-a',
    updateTime: '2026-10-07T18:22:41.123456Z',
    data: { name: 'web-1', status: 'RUNNING', networkInterfaces: [{ networkIP: '10.10.0.2' }] },
  };
}

export function sampleSnapshot(): Snapshot {
  const project: Asset = {
    name: PROJECT,
    assetType: 'cloudresourcemanager.googleapis.com/Project',
    parent: FOLDER,
    ancestors: ['projects/10000000001', 'folders/20000000001', 'organizations/30000000001'],
    updateTime: '2026-10-01T08:00:00Z',
    data: { projectId: 'demo-net', projectNumber: '10000000001' },
  };
  return {
    id: ULID,
    schemaVersion: 1,
    scope: { kind: 'organization', id: '30000000001', displayName: 'example.com' },
    readTime: '2026-10-08T00:00:00Z',
    source: { kind: 'demo', detail: 'demo:S' },
    contentType: 'RESOURCE',
    assets: [project, sampleAsset()],
    stats: {
      count: 2,
      byType: { 'cloudresourcemanager.googleapis.com/Project': 1, 'compute.googleapis.com/Instance': 1 },
      bytes: 2048,
    },
  };
}

/** org › folder › project › network › subnet › instance, one resolved edge, one dangling reference. */
export function sampleGraph(): Graph {
  const node = (id: string, assetType: string, label: string, role: Graph['nodes'][string]['role']) => ({
    id,
    assetType,
    label,
    role,
    product: assetType.split('/')[0] ?? assetType,
    ips: [] as string[],
    domains: [] as string[],
    hidden: role === 'hidden',
  });
  return {
    nodes: {
      [ORG]: node(ORG, 'cloudresourcemanager.googleapis.com/Organization', 'example.com', 'container'),
      [FOLDER]: node(FOLDER, 'cloudresourcemanager.googleapis.com/Folder', 'Production', 'container'),
      [PROJECT]: {
        ...node(PROJECT, 'cloudresourcemanager.googleapis.com/Project', 'demo-net', 'container'),
        projectId: 'demo-net',
        projectNumber: '10000000001',
      },
      [NETWORK]: node(NETWORK, 'compute.googleapis.com/Network', 'core', 'container'),
      [SUBNET]: {
        ...node(SUBNET, 'compute.googleapis.com/Subnetwork', 'app', 'container'),
        location: 'europe-west3',
      },
      [INSTANCE]: {
        ...node(INSTANCE, 'compute.googleapis.com/Instance', 'web-1', 'core'),
        subtitle: 'e2-small · europe-west3-a',
        projectId: 'demo-net',
        location: 'europe-west3-a',
        ips: ['10.10.0.2', '203.0.113.10'],
        domains: ['www.example.com'],
      },
    },
    containment: {
      parent: { [FOLDER]: ORG, [PROJECT]: FOLDER, [NETWORK]: PROJECT, [SUBNET]: NETWORK, [INSTANCE]: SUBNET },
      children: {
        [ORG]: [FOLDER],
        [FOLDER]: [PROJECT],
        [PROJECT]: [NETWORK],
        [NETWORK]: [SUBNET],
        [SUBNET]: [INSTANCE],
      },
    },
    edges: [
      { from: INSTANCE, to: SUBNET, kind: 'attaches' },
      { from: INSTANCE, to: NETWORK, kind: 'attaches', weak: true },
    ],
    dangling: [
      {
        from: INSTANCE,
        to: DISK,
        kind: 'uses',
        dangling: {
          raw: 'https://www.googleapis.com/compute/v1/projects/demo-net/zones/europe-west3-a/disks/web-1-boot',
        },
      },
    ],
    indexes: {
      byType: { 'compute.googleapis.com/Instance': [INSTANCE] },
      byProject: { 'demo-net': [NETWORK, SUBNET, INSTANCE] },
      byIp: { '10.10.0.2': [INSTANCE], '10.10.0.0/20': [SUBNET] },
      byDomain: { 'www.example.com': [INSTANCE] },
      aliases: { 'demo-net': PROJECT, '10000000001': PROJECT },
    },
  };
}

/** folder › project › (collapsed VPC chip, instance card), with one edge from the card to the chip. */
export function sampleScene(): Scene {
  return {
    children: [
      {
        type: 'zone',
        id: FOLDER,
        kind: 'folder',
        label: 'Production',
        badges: [],
        children: [
          {
            type: 'zone',
            id: PROJECT,
            kind: 'project',
            label: 'demo-net',
            subtitle: '10000000001',
            badges: ['shared with 2 projects'],
            children: [
              {
                type: 'zone',
                id: NETWORK,
                kind: 'vpc',
                label: 'core',
                badges: [],
                collapsed: { subnets: 1, resources: 3 },
                children: [],
              },
              {
                type: 'card',
                id: INSTANCE,
                label: 'web-1',
                subtitle: 'e2-small',
                icon: 'compute_engine',
                product: 'Compute Engine',
                assetType: 'compute.googleapis.com/Instance',
              },
            ],
          },
        ],
      },
    ],
    edges: [{ from: INSTANCE, to: NETWORK, kind: 'attaches', count: 2, merged: true }],
    metadata: {
      rootLabel: 'example.com',
      lens: 'networking',
      readTime: '2026-10-08T00:00:00Z',
      rectCount: 4,
    },
  };
}

/** A sample catalog entry (one product file), trimmed to two types. */
export function sampleCatalogEntry(): z.input<typeof CatalogEntrySchema> {
  return {
    product: 'Compute Engine',
    service: 'compute.googleapis.com',
    icon: 'compute_engine',
    types: {
      'compute.googleapis.com/Instance': {
        role: 'core',
        label: '{{data.name}}',
        subtitle: '{{data.machineType | lastSegment}} · {{location}}',
        icon: 'compute_instance',
        console:
          'https://console.cloud.google.com/compute/instancesDetail/zones/{{location}}/instances/{{data.name}}?project={{projectId}}',
        ips: ['$.data.networkInterfaces[*].networkIP', '$.data.networkInterfaces[*].accessConfigs[*].natIP'],
        relations: [
          { kind: 'attaches', to: '$.data.networkInterfaces[*].subnetwork', normalize: 'computeSelfLink' },
          {
            kind: 'attaches',
            to: '$.data.networkInterfaces[*].network',
            normalize: 'computeSelfLink',
            weak: true,
          },
          { kind: 'uses', to: '$.data.disks[*].source', normalize: 'computeSelfLink' },
          { kind: 'runsAs', to: '$.data.serviceAccounts[*].email', normalize: 'serviceAccountEmail' },
          {
            kind: 'memberOf',
            to: "$.data.metadata.items[?(@.key=='created-by')].value",
            normalize: 'computeRelative',
          },
        ],
        hiddenWhen: "$.data.status in ['TERMINATED']",
      },
      'compute.googleapis.com/Network': {
        role: 'container',
        contains: [{ byParent: 'compute.googleapis.com/Subnetwork' }],
      },
    },
  };
}

/** A compiled catalog with one product, two types and every lens (parsed, so the result is typed). */
export function sampleCatalog(): Catalog {
  const type = {
    label: '{{name | lastSegment}}',
    ips: [],
    domains: [],
    relations: [],
    contains: [],
    product: 'Compute Engine',
    service: 'compute.googleapis.com',
    icon: 'compute_engine',
  };
  const lens = {
    title: 'Lens',
    description: 'A lens.',
    types: ['*'],
    relationKinds: [],
    showHidden: false,
    defaultDetail: 'auto' as const,
  };
  return CatalogSchema.parse({
    version: '1.0.0',
    officialListDate: '2026-10-08',
    products: [
      {
        product: 'Compute Engine',
        service: 'compute.googleapis.com',
        icon: 'compute_engine',
        types: ['compute.googleapis.com/Instance', 'compute.googleapis.com/Network'],
      },
    ],
    types: {
      'compute.googleapis.com/Instance': {
        ...type,
        assetType: 'compute.googleapis.com/Instance',
        role: 'core',
      },
      'compute.googleapis.com/Network': {
        ...type,
        assetType: 'compute.googleapis.com/Network',
        role: 'container',
      },
    },
    lenses: Object.fromEntries(LensIdSchema.options.map((id) => [id, { ...lens, title: id }])),
  });
}

/** A view that sets every field. */
export function sampleViewSpec(): ViewSpec {
  return {
    snapshot: ULID,
    tick: '2026-10-01',
    lens: 'load-balancing',
    focus: { kind: 'shared-vpc', params: { host: 'demo-net' } },
    root: FOLDER,
    filters: {
      hideEmptyProjects: true,
      hideEmptyFolders: false,
      hideDisconnected: true,
      regions: ['europe-west3', 'us-central1'],
      projects: ['demo-app', 'demo-net'],
      folders: ['20000000001'],
      includeTypes: ['run.googleapis.com/*'],
      excludeTypes: ['compute.googleapis.com/Disk'],
      depth: 4,
      showRegions: true,
      showIdentities: false,
    },
    detail: 'networks',
    flips: ['k3x9a1', '7fz2m0'],
    selection: INSTANCE,
    highlight: '10.10.0.2',
  };
}

/**
 * Timeline ticks for `TickSchema` and the zod-free `isTick`: a calendar day that exists (leap days by the
 * Gregorian rule), or a read time to the second, in UTC, on such a day.
 */
export const TICK_CASES: {
  readonly days: readonly string[];
  readonly times: readonly string[];
  readonly invalid: readonly unknown[];
} = {
  days: [
    '2026-10-08',
    '2026-09-04',
    '2024-02-29',
    '2000-02-29',
    '0000-02-29',
    '2026-12-31',
    '2026-04-30',
    '1970-01-01',
  ],
  times: ['2026-10-05T14:30:00Z', '2026-10-08T00:00:00Z', '2026-01-01T00:00:00Z', '2024-02-29T23:59:59Z'],
  invalid: [
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-1-01',
    '08.10.2026',
    '',
    '2026-02-29T00:00:00Z',
    '2026-02-29T12:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-10-05T24:00:00Z',
    '2026-01-01T12:60:00Z',
    '2026-01-01T12:00:60Z',
    '2026-01-01T12:00Z',
    '2026-10-05T14:30Z',
    '2026-01-01T12:00:00.000Z',
    '2026-10-05T14:30:00.000Z',
    '2026-01-01T12:00:00+00:00',
    '2026-10-05T14:30:00+02:00',
    '2026-01-01t12:00:00z',
    '2026-01-01 12:00:00Z',
    20260101,
  ],
};
