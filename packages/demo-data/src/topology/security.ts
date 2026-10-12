// SPDX-License-Identifier: MIT
/**
 * The security project: Cloud KMS key rings and keys (customer-managed encryption keys for disks, buckets,
 * Cloud SQL, GKE secrets and Pub/Sub), with the key rotation the history replays; and the organisation's
 * Access Context Manager policy with a VPC Service Controls perimeter around two projects.
 */
import type { AddInput, OrgBuilder } from '../builder/builder.js';
import type { GenAsset } from '../builder/types.js';
import { setPath, type JsonObject } from '../core/json.js';
import { DAY_MS } from '../core/time.js';
import { addProject, addProjectAsset, fullName, type ContainerCtx, type ProjectCtx } from './kit.js';
import type { Region } from './vocabulary.js';

/** What a customer-managed key protects. One key per purpose and region; `shared` covers all purposes. */
export type KeyPurpose = 'compute' | 'storage' | 'sql' | 'gke' | 'pubsub';

export interface KeyCatalog {
  readonly project: ProjectCtx | undefined;
  /** `projects/<id>/locations/<region>/keyRings/<ring>/cryptoKeys/<key>`, or `undefined` without a ring there. */
  readonly key: (region: string, purpose: KeyPurpose) => string | undefined;
  /** The key's primary version path (what Compute records on a disk). */
  readonly keyVersion: (region: string, purpose: KeyPurpose) => string | undefined;
}

export interface SecurityOptions {
  readonly regions: readonly Region[];
  /** `['shared']` for one key per region, else one key per purpose. */
  readonly purposes: readonly (KeyPurpose | 'shared')[];
  readonly versionsPerKey: number;
}

const ROTATION_PERIOD_DAYS = 90;

export function addSecurityProject(
  b: OrgBuilder,
  folder: ContainerCtx,
  options: SecurityOptions,
): KeyCatalog {
  const primary = options.regions[0];
  if (primary === undefined) throw new Error('the security project needs a region');
  const project = addProject(b, folder, {
    role: 'sec',
    displayName: 'Security and keys',
    env: 'prod',
    region: primary,
    team: 'security',
  });
  const keys = new Map<string, { path: string; primary: number }>();
  let rotationRegistered = false;
  for (const region of options.regions) {
    const ringPath = `projects/${project.id}/locations/${region.name}/keyRings/kr-${region.name}`;
    const ring = addProjectAsset(b, project, {
      assetType: 'cloudkms.googleapis.com/KeyRing',
      name: fullName('cloudkms.googleapis.com', ringPath),
      location: region.name,
      data: { name: ringPath },
    });
    for (const purpose of options.purposes) {
      const keyName = purpose === 'shared' ? 'cmek-shared' : `cmek-${purpose}`;
      const keyPath = `${ringPath}/cryptoKeys/${keyName}`;
      const rotates = !rotationRegistered;
      rotationRegistered = true;
      const key = addCryptoKey(b, project, ring, keyPath, options.versionsPerKey, rotates);
      const purposes: readonly KeyPurpose[] =
        purpose === 'shared' ? ['compute', 'storage', 'sql', 'gke', 'pubsub'] : [purpose];
      for (const p of purposes) keys.set(`${region.name}/${p}`, { path: keyPath, primary: key.primary });
    }
  }
  return {
    project,
    key: (region, purpose) => keys.get(`${region}/${purpose}`)?.path,
    keyVersion: (region, purpose) => {
      const key = keys.get(`${region}/${purpose}`);
      return key === undefined ? undefined : `${key.path}/cryptoKeyVersions/${String(key.primary)}`;
    },
  };
}

function versionData(keyPath: string, version: number): JsonObject {
  return {
    name: `${keyPath}/cryptoKeyVersions/${String(version)}`,
    state: 'ENABLED',
    protectionLevel: 'SOFTWARE',
    algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION',
  };
}

function addCryptoKey(
  b: OrgBuilder,
  project: ProjectCtx,
  ring: GenAsset,
  keyPath: string,
  versions: number,
  rotates: boolean,
): { primary: number } {
  const keyFull = fullName('cloudkms.googleapis.com', keyPath);
  const keyCreated = b.createdAt(keyFull, ring.createdAt);
  // Versions are created one rotation period apart, ending before the window.
  const versionCreated = (v: number): number =>
    Math.max(
      keyCreated + (v - 1) * 60_000,
      Math.min(
        keyCreated + (v - 1) * ROTATION_PERIOD_DAYS * DAY_MS,
        b.windowStart - (versions - v + 2) * DAY_MS,
      ),
    );
  const keyData = (primary: number, primaryCreated: number): JsonObject => ({
    name: keyPath,
    primary: { ...versionData(keyPath, primary), createTime: new Date(primaryCreated).toISOString() },
    purpose: 'ENCRYPT_DECRYPT',
    rotationPeriod: `${String(ROTATION_PERIOD_DAYS * 86400)}s`,
    nextRotationTime: new Date(primaryCreated + ROTATION_PERIOD_DAYS * DAY_MS).toISOString(),
    versionTemplate: { protectionLevel: 'SOFTWARE', algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION' },
    destroyScheduledDuration: '2592000s',
    labels: { 'managed-by': 'terraform' },
  });
  addProjectAsset(b, project, {
    assetType: 'cloudkms.googleapis.com/CryptoKey',
    name: keyFull,
    parent: ring.name,
    location: ring.location ?? 'global',
    after: ring.createdAt,
    data: keyData(versions, versionCreated(versions)),
    ...(rotates ? { traits: { pinned: true } } : {}),
  });
  const versionInput = (v: number): AddInput => ({
    assetType: 'cloudkms.googleapis.com/CryptoKeyVersion',
    name: `${keyFull}/cryptoKeyVersions/${String(v)}`,
    parent: keyFull,
    ancestors: project.ancestors,
    location: ring.location ?? 'global',
    data: versionData(keyPath, v),
    after: keyCreated,
    createdAt: versionCreated(v),
  });
  for (let v = 1; v <= versions; v++) b.add(versionInput(v));
  if (rotates) {
    b.specials.push({
      id: 'key-rotation',
      plan: (at) => ({
        adds: [b.make(versionInput(versions + 1), at)],
        removes: [],
        changes: [
          {
            name: keyFull,
            fields: ['primary', 'nextRotationTime'],
            forward: (data) => {
              const next = keyData(versions + 1, at);
              return setPath(
                setPath(data, ['primary'], next['primary'] ?? null),
                ['nextRotationTime'],
                next['nextRotationTime'] ?? null,
              );
            },
          },
        ],
      }),
    });
  }
  return { primary: versions };
}

/** What the larger organisations add to the perimeter: VPC networks inside it and a perimeter bridge. */
export interface PerimeterExtras {
  /** Full names (`//compute.googleapis.com/projects/<id>/global/networks/<n>`) of networks to protect. */
  readonly networks: readonly string[];
  /** Projects a bridge perimeter connects (one inside the regular perimeter, one outside). */
  readonly bridge: readonly ProjectCtx[];
}

/** The organisation's access policy, an access level, and a regular perimeter around `protectedProjects`. */
export function addPerimeter(
  b: OrgBuilder,
  org: ContainerCtx,
  protectedProjects: readonly ProjectCtx[],
  withAccessLevel: boolean,
  extras?: PerimeterExtras,
): void {
  const policyRef = 'accessPolicies/40000000001';
  const policyFull = fullName('accesscontextmanager.googleapis.com', policyRef);
  const policy = b.add({
    assetType: 'identity.accesscontextmanager.googleapis.com/AccessPolicy',
    name: policyFull,
    parent: org.full,
    ancestors: org.ancestors,
    data: { name: policyRef, parent: org.ref, title: 'example.com default policy', etag: 'a1b2c3d4e5f60718' },
    after: org.createdAt,
  });
  const accessLevel = `${policyRef}/accessLevels/corp_network`;
  if (withAccessLevel) {
    b.add({
      assetType: 'identity.accesscontextmanager.googleapis.com/AccessLevel',
      name: fullName('accesscontextmanager.googleapis.com', accessLevel),
      parent: policyFull,
      ancestors: org.ancestors,
      data: {
        name: accessLevel,
        title: 'corp_network',
        description: 'Requests from the corporate egress range',
        basic: { conditions: [{ ipSubnetworks: ['203.0.113.0/24'] }], combiningFunction: 'AND' },
      },
      after: policy.createdAt,
    });
  }
  const perimeter = `${policyRef}/servicePerimeters/data_perimeter`;
  const latest = Math.max(policy.createdAt, ...protectedProjects.map((p) => p.createdAt));
  b.add({
    assetType: 'identity.accesscontextmanager.googleapis.com/ServicePerimeter',
    name: fullName('accesscontextmanager.googleapis.com', perimeter),
    parent: policyFull,
    ancestors: org.ancestors,
    data: {
      name: perimeter,
      title: 'data_perimeter',
      description: 'Keeps customer data inside the serverless and analytics projects',
      perimeterType: 'PERIMETER_TYPE_REGULAR',
      status: {
        resources: [...protectedProjects.map((p) => p.ref), ...(extras?.networks ?? [])],
        restrictedServices: ['bigquery.googleapis.com', 'storage.googleapis.com', 'sqladmin.googleapis.com'],
        accessLevels: withAccessLevel ? [accessLevel] : [],
        vpcAccessibleServices: { enableRestriction: true, allowedServices: ['RESTRICTED-SERVICES'] },
      },
      useExplicitDryRunSpec: false,
    },
    after: latest,
  });
  if (extras === undefined || extras.bridge.length < 2) return;
  const bridge = `${policyRef}/servicePerimeters/data_bridge`;
  b.add({
    assetType: 'identity.accesscontextmanager.googleapis.com/ServicePerimeter',
    name: fullName('accesscontextmanager.googleapis.com', bridge),
    parent: policyFull,
    ancestors: org.ancestors,
    data: {
      name: bridge,
      title: 'data_bridge',
      description: 'Lets the analytics projects share data across the perimeter boundary',
      perimeterType: 'PERIMETER_TYPE_BRIDGE',
      status: { resources: extras.bridge.map((p) => p.ref) },
      useExplicitDryRunSpec: false,
    },
    after: Math.max(latest, ...extras.bridge.map((p) => p.createdAt)),
  });
}
