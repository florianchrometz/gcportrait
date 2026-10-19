// SPDX-License-Identifier: Apache-2.0
/**
 * Compute Engine beyond VMs and groups (feature `compute`): custom image families (the current image baked
 * on the previous, deprecated one), regional snapshot schedules, manual and scheduled snapshots (scheduled
 * ones start hidden and come and go every day), committed-use reservations, and Google Cloud VMware Engine
 * (a VMware Engine network, a private cloud with a cluster, the peering with the Shared VPC and the network
 * policy).
 */
import type { OrgBuilder } from '../builder/builder.js';
import type { GenAsset } from '../builder/types.js';
import type { JsonObject } from '../core/json.js';
import { DAY_MS, HOUR_MS } from '../core/time.js';
import type { OrgContext } from './context.js';
import { uuidFrom } from './fabric.js';
import {
  addCompute,
  addProjectAsset,
  computeSelfLink,
  fullName,
  makeCompute,
  type ProjectCtx,
} from './kit.js';
import type { HostNetwork } from './network.js';
import { DEBIAN_IMAGE, DEBIAN_LICENSE, type Region } from './vocabulary.js';

export interface CustomImage {
  /** Self-link of the current image of the family. */
  readonly selfLink: string;
  /** `projects/<id>/global/images/<name>`, as instance templates name it. */
  readonly relative: string;
  readonly createdAt: number;
}

/** A custom image family: the current image, built on its deprecated predecessor, built on Debian. */
export function addCustomImages(
  b: OrgBuilder,
  project: ProjectCtx,
  region: Region,
  family: string,
  kmsKeyVersion: string | undefined,
): CustomImage {
  const version = 3 + b.rng.fork(`image:${project.id}/${family}`).int(0, 9);
  const name = (v: number): string => `${family}-v${String(v)}`;
  const link = (v: number): string => computeSelfLink(project.id, `global/images/${name(v)}`);
  const image = (v: number, source: string, extra: JsonObject): GenAsset =>
    addCompute(b, project, {
      kind: 'Image',
      collection: 'images',
      scope: 'global',
      name: name(v),
      data: {
        description: `${family} base image, release ${String(v)}`,
        family,
        sourceType: 'RAW',
        status: 'READY',
        diskSizeGb: '20',
        archiveSizeBytes: String(1_900_000_000 + v * 7_340_032),
        sourceImage: source,
        storageLocations: [region.name],
        architecture: 'X86_64',
        licenses: [DEBIAN_LICENSE],
        labels: { family, 'built-by': 'packer' },
        ...(kmsKeyVersion === undefined ? {} : { imageEncryptionKey: { kmsKeyName: kmsKeyVersion } }),
        ...extra,
      },
    }).asset;
  image(version - 1, DEBIAN_IMAGE, { deprecated: { state: 'DEPRECATED', replacement: link(version) } });
  const current = image(version, link(version - 1), {});
  return {
    selfLink: link(version),
    relative: `projects/${project.id}/global/images/${name(version)}`,
    createdAt: current.createdAt,
  };
}

/** A daily snapshot schedule (regional resource policy) for the disks of a project. */
export function addSnapshotSchedule(b: OrgBuilder, project: ProjectCtx, region: Region): string {
  return addCompute(b, project, {
    kind: 'ResourcePolicy',
    collection: 'resourcePolicies',
    scope: { region: region.name },
    name: 'daily-snapshots',
    data: {
      description: 'Daily snapshots of the batch disks, kept for 14 days',
      status: 'READY',
      snapshotSchedulePolicy: {
        schedule: { dailySchedule: { daysInCycle: 1, startTime: '04:00', duration: 'PT14400S' } },
        retentionPolicy: { maxRetentionDays: 14, onSourceDiskDelete: 'KEEP_AUTO_SNAPSHOTS' },
        snapshotProperties: { storageLocations: [region.name], guestFlush: false },
      },
    },
  }).selfLink;
}

export interface SnapshotSource {
  readonly zone: string;
  /** The disk's name (also its VM's). */
  readonly disk: string;
  readonly sizeGb: number;
  readonly createdAt: number;
}

function snapshotData(
  project: ProjectCtx,
  source: SnapshotSource,
  region: Region,
  kmsKeyVersion: string | undefined,
  scheduled: string | undefined,
): JsonObject {
  return {
    status: 'READY',
    snapshotType: 'STANDARD',
    diskSizeGb: String(source.sizeGb),
    storageBytes: String(source.sizeGb * 214_748_365),
    sourceDisk: computeSelfLink(project.id, `zones/${source.zone}/disks/${source.disk}`),
    storageLocations: [region.name],
    autoCreated: scheduled !== undefined,
    ...(scheduled === undefined ? {} : { sourceSnapshotSchedulePolicy: scheduled }),
    ...(kmsKeyVersion === undefined ? {} : { snapshotEncryptionKey: { kmsKeyName: kmsKeyVersion } }),
  };
}

/** The scheduled snapshot of `source` taken on the day `at` falls in. */
function scheduledName(source: SnapshotSource, at: number, suffix: string): string {
  const day = new Date(at - (at % DAY_MS) + 4 * HOUR_MS).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${source.disk}-${source.zone}-${day}-${suffix}`;
}

/**
 * A manual snapshot of the first disk, the two most recent scheduled snapshots of each disk (hidden), and a
 * factory for the daily snapshots that the schedule creates and expires inside the history window.
 */
export function addSnapshots(
  b: OrgBuilder,
  project: ProjectCtx,
  region: Region,
  sources: readonly SnapshotSource[],
  schedule: string,
  kmsKeyVersion: string | undefined,
): void {
  const first = sources[0];
  if (first === undefined) return;
  addCompute(b, project, {
    kind: 'Snapshot',
    collection: 'snapshots',
    scope: 'global',
    name: `${first.disk}-pre-upgrade`,
    after: first.createdAt,
    data: {
      description: 'Taken by hand before the OS upgrade',
      ...snapshotData(project, first, region, kmsKeyVersion, undefined),
    },
  });
  const rng = b.rng.fork(`snapshots:${project.id}`);
  for (const source of sources) {
    for (const daysAgo of [2, 1]) {
      const at = b.windowStart - daysAgo * DAY_MS;
      addCompute(b, project, {
        kind: 'Snapshot',
        collection: 'snapshots',
        scope: 'global',
        name: scheduledName(source, at, rng.hex(8)),
        createdAt: at + 4 * HOUR_MS,
        data: snapshotData(project, source, region, kmsKeyVersion, schedule),
      });
    }
  }
  b.ephemerals.push({
    kind: 'scheduled-snapshot',
    weight: 1,
    notBefore: first.createdAt,
    make: (createdAt, serial, r) => {
      const source = sources[serial % sources.length] ?? first;
      return [
        makeCompute(
          b,
          project,
          {
            kind: 'Snapshot',
            collection: 'snapshots',
            scope: 'global',
            name: scheduledName(source, createdAt, r.hex(8)),
            data: snapshotData(project, source, region, kmsKeyVersion, schedule),
          },
          createdAt,
        ).asset,
      ];
    },
  });
}

/** A one-year commitment and the zonal reservation that consumes it. */
export function addReservation(
  b: OrgBuilder,
  project: ProjectCtx,
  region: Region,
  zone: string,
  machineType: string,
  count: number,
): string {
  const commitment = addCompute(b, project, {
    kind: 'Commitment',
    collection: 'commitments',
    scope: { region: region.name },
    name: 'cud-n2-1y',
    data: {
      description: 'One-year commitment for the batch fleet',
      plan: 'TWELVE_MONTH',
      type: 'GENERAL_PURPOSE_N2',
      category: 'MACHINE',
      status: 'ACTIVE',
      autoRenew: true,
      startTimestamp: '2026-06-01T00:00:00.000-07:00',
      endTimestamp: '2027-06-01T00:00:00.000-07:00',
      resources: [
        { type: 'VCPU', amount: String(count * 4) },
        { type: 'MEMORY', amount: String(count * 16384) },
      ],
    },
  });
  return addCompute(b, project, {
    kind: 'Reservation',
    collection: 'reservations',
    scope: { zone },
    name: 'batch-capacity',
    after: commitment.asset.createdAt,
    data: {
      description: 'Capacity for the nightly batch run',
      specificReservation: {
        count: String(count),
        inUseCount: String(Math.max(1, count - 1)),
        instanceProperties: { machineType },
      },
      specificReservationRequired: false,
      status: 'READY',
      commitment: commitment.selfLink,
      shareSettings: { shareType: 'LOCAL' },
    },
  }).selfLink;
}

/**
 * Google Cloud VMware Engine in a project: the VMware Engine network, a private cloud with one workload
 * cluster, the network policy (internet access through the edge services range) and the peering with the
 * environment's Shared VPC.
 */
export function addVmwareEngine(
  ctx: OrgContext,
  project: ProjectCtx,
  region: Region,
  host: HostNetwork,
): void {
  const { b } = ctx;
  const zone = region.zones[0] ?? `${region.name}-a`;
  const service = 'vmwareengine.googleapis.com';
  const network = `projects/${project.id}/locations/global/vmwareEngineNetworks/vmware-${project.env}`;
  const cloud = `projects/${project.id}/locations/${zone}/privateClouds/pc-1`;
  const management = b.addresses.standalone.allocate(22);
  const edge = b.addresses.standalone.allocate(26);
  const at = (offset: number): string => {
    const [a = '172', bOctet = '20', c = '0'] = management.split('.');
    return `${a}.${bOctet}.${c}.${String(offset)}`;
  };
  const add = (kind: string, path: string, location: string, after: number, data: JsonObject): number =>
    addProjectAsset(b, project, {
      assetType: `${service}/${kind}`,
      name: fullName(service, path),
      location,
      after,
      data: { name: path, uid: uuidFrom(b, path), ...data },
    }).createdAt;
  const networkCreated = add('VmwareEngineNetwork', network, 'global', project.createdAt, {
    description: 'Network of the migrated VMware workloads',
    type: 'STANDARD',
    state: 'ACTIVE',
    etag: 'W/"a1"',
  });
  const cloudCreated = add('PrivateCloud', cloud, zone, networkCreated, {
    description: 'Lift-and-shift landing zone for the data-centre VMs',
    state: 'ACTIVE',
    type: 'STANDARD',
    networkConfig: {
      managementCidr: management,
      vmwareEngineNetwork: network,
      vmwareEngineNetworkCanonical: network,
      managementIpAddressLayoutVersion: 2,
      dnsServerIp: at(8),
    },
    managementCluster: { clusterId: 'mgmt', nodeTypeConfigs: { 'standard-72': { nodeCount: 3 } } },
    vcenter: { internalIp: at(6), version: '8.0.2', fqdn: `vcsa-pc1.${zone}.gve.goog`, state: 'ACTIVE' },
    nsx: { internalIp: at(11), version: '4.1.2', fqdn: `nsx-pc1.${zone}.gve.goog`, state: 'ACTIVE' },
    hcx: { internalIp: at(9), version: '4.9.1', fqdn: `hcx-pc1.${zone}.gve.goog`, state: 'ACTIVE' },
  });
  add('Cluster', `${cloud}/clusters/workload-1`, zone, cloudCreated, {
    state: 'ACTIVE',
    management: false,
    nodeTypeConfigs: { 'standard-72': { nodeCount: 4 } },
  });
  add(
    'NetworkPolicy',
    `projects/${project.id}/locations/${region.name}/networkPolicies/pc-1-policy`,
    region.name,
    networkCreated,
    {
      description: 'Internet access for the private cloud through the edge services range',
      edgeServicesCidr: edge,
      internetAccess: { enabled: true, state: 'ACTIVE' },
      externalIp: { enabled: false, state: 'UNPROVISIONED' },
      vmwareEngineNetwork: network,
      vmwareEngineNetworkCanonical: network,
    },
  );
  add(
    'NetworkPeering',
    `projects/${project.id}/locations/global/networkPeerings/vmware-to-${host.name}`,
    'global',
    Math.max(networkCreated, host.createdAt),
    {
      description: `Peers the VMware Engine network with ${host.name}`,
      peerNetwork: host.path,
      peerNetworkType: 'STANDARD',
      vmwareEngineNetwork: network,
      state: 'ACTIVE',
      stateDetails: 'Peering is active',
      exportCustomRoutes: true,
      importCustomRoutes: true,
      exchangeSubnetRoutes: true,
    },
  );
}
