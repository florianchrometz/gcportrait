// SPDX-License-Identifier: MIT
import { AssetSchema, migrateSnapshot, type Asset, type DemoSize } from '@gcportrait/model';
import { findNonSyntheticData } from '@gcportrait/model/testing';
import { describe, expect, it } from 'vitest';
import {
  DEMO_TODAY,
  HISTORY_TICKS,
  computeStats,
  generateOrganization,
  historyFor,
  realismChecklist,
  snapshotAt,
  toCaiAsset,
  toCaiNdjson,
  toSnapshot,
  type DemoHistory,
  type Mutation,
} from './index.js';
import {
  danglingComputeReferences,
  hierarchyProblems,
  parsePath,
  referencesToAbsent,
  valuesAt,
} from './testing.js';
import { SEED_PATHS } from './testing/seed-paths.js';

const SIZES: readonly DemoSize[] = ['S', 'M'];

const cache = new Map<string, DemoHistory>();
function history(size: DemoSize): DemoHistory {
  let found = cache.get(size);
  if (found === undefined) {
    found = historyFor(size);
    cache.set(size, found);
  }
  return found;
}
function today(size: DemoSize): readonly Asset[] {
  const h = history(size);
  return snapshotAt(h, h.ticks.length - 1).assets;
}
function data(asset: Asset): Record<string, unknown> {
  return asset.data as Record<string, unknown>;
}
function mutationsOf(h: DemoHistory, tick: number): readonly Mutation[] {
  return h.ticks[tick]?.mutations ?? [];
}

describe.each(SIZES)('demo organisation %s', (size) => {
  it('is deterministic: the same arguments give byte-identical output', () => {
    const again = historyFor(size);
    expect(JSON.stringify(again)).toBe(JSON.stringify(history(size)));
    expect(toCaiNdjson(generateOrganization({ size }).assets)).toBe(toCaiNdjson(today(size)));
  });

  it('changes names, not structure, with another seed', () => {
    const other = generateOrganization({ size, seed: 7 });
    expect(toCaiNdjson(other.assets)).not.toBe(toCaiNdjson(today(size)));
    expect(computeStats(other.assets).count).toBe(computeStats(today(size)).count);
  });

  it('moves every timestamp with the `today` argument', () => {
    const later = generateOrganization({ size, today: '2027-03-01' });
    expect(later.readTime).toBe('2027-03-01T00:00:00Z');
    expect(later.assets.length).toBe(today(size).length);
    for (const asset of later.assets) expect(asset.updateTime < later.readTime).toBe(true);
  });

  it('validates every asset against the model Asset schema and the snapshot against migrateSnapshot', () => {
    for (const asset of today(size)) expect(AssetSchema.safeParse(asset).success).toBe(true);
    const h = history(size);
    for (const tick of [0, 17, h.ticks.length - 1]) {
      const snapshot = migrateSnapshot(JSON.parse(JSON.stringify(toSnapshot(snapshotAt(h, tick)))));
      expect(snapshot.readTime).toBe(h.ticks[tick]?.readTime);
      expect(snapshot.stats.count).toBe(snapshot.assets.length);
      expect(snapshot.source).toEqual({ kind: 'demo', detail: `demo:${size} seed 1` });
    }
  });

  it('emits Cloud Asset Inventory records that flatten back to the assets', () => {
    for (const line of toCaiNdjson(today(size)).trimEnd().split('\n')) {
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(record)).toEqual(['name', 'assetType', 'resource', 'ancestors', 'updateTime']);
      const resource = record['resource'] as Record<string, unknown>;
      for (const key of Object.keys(resource)) {
        expect(['version', 'discoveryDocumentUri', 'discoveryName', 'parent', 'data', 'location']).toContain(
          key,
        );
      }
      expect(resource['version']).toMatch(/^v\d/);
      expect(resource['discoveryDocumentUri']).toMatch(/^https:\/\//);
      expect(resource['discoveryName']).toMatch(/^[A-Za-z][\w.]*$/);
      const asset = AssetSchema.parse({
        name: record['name'],
        assetType: record['assetType'],
        ...('parent' in resource ? { parent: resource['parent'] } : {}),
        ancestors: record['ancestors'],
        ...('location' in resource ? { location: resource['location'] } : {}),
        updateTime: record['updateTime'],
        data: resource['data'],
      });
      expect(toCaiAsset(asset)).toEqual(record);
    }
    const exported = JSON.parse(toCaiNdjson(today(size).slice(0, 1), 'export').trim()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(exported)).toEqual(['name', 'asset_type', 'resource', 'ancestors', 'update_time']);
    expect(Object.keys(exported['resource'] as object)).toContain('discovery_document_uri');
  });

  it('keeps parents and ancestors consistent at every tick', () => {
    const h = history(size);
    const problems = h.ticks.flatMap((tick, index) =>
      hierarchyProblems(snapshotAt(h, index).assets).map((problem) => `${tick.tick} ${problem}`),
    );
    expect(problems).toEqual([]);
  });

  it('points every Compute reference at an asset of the organisation (or at a Google-owned object)', () => {
    expect(danglingComputeReferences(today(size))).toEqual([]);
  });

  it('never names an asset the history creates later or has already removed, at any tick', () => {
    // An `addable` asset is one nothing names: a template that names one calls `OrgBuilder.referenced`.
    const h = history(size);
    const everyAsset = new Map<string, Asset>();
    for (const asset of h.base) everyAsset.set(asset.name, asset);
    for (const tick of h.ticks) {
      for (const m of tick.mutations) if (m.kind !== 'remove') everyAsset.set(m.asset.name, m.asset);
    }
    const aliases = new Map<string, string>();
    for (const asset of everyAsset.values()) {
      if (asset.assetType !== 'cloudresourcemanager.googleapis.com/Project') continue;
      const id = String(data(asset)['projectId']);
      const number = String(data(asset)['projectNumber']);
      aliases.set(id, number).set(number, id);
    }
    const found = h.ticks.flatMap((tick, index) => {
      const present = snapshotAt(h, index).assets;
      const here = new Set(present.map((asset) => asset.name));
      const absent = [...everyAsset.values()].filter((asset) => !here.has(asset.name));
      return referencesToAbsent(present, absent, aliases).map((reference) => `${tick.tick} ${reference}`);
    });
    expect(found).toEqual([]);
  });

  it('contains no data that looks real', () => {
    const text = toCaiNdjson(today(size));
    // Stricter than the general guard, whose IPv4 allow-list holds these ranges and more: the demo uses only these.
    const ranges = ['10.0.0.0/8', '172.16.0.0/12', '203.0.113.0/24', '169.254.0.0/16'];
    expect(findNonSyntheticData(text, { allowedIpv4Ranges: ranges })).toEqual([]);
    expect(findNonSyntheticData(JSON.stringify(history(size)))).toEqual([]);
  });

  it('applies the history cleanly and ends at today', () => {
    const h = history(size);
    expect(h.ticks).toHaveLength(HISTORY_TICKS);
    expect(h.ticks.at(-1)?.tick).toBe(DEMO_TODAY);
    expect(h.ticks[0]?.tick).toBe('2026-09-04');
    expect(h.ticks[0]?.mutations).toEqual([]);
    const names = new Set(h.base.map((a) => a.name));
    expect(names.size).toBe(h.base.length);
    for (let tick = 1; tick < h.ticks.length; tick++) {
      const entry = h.ticks[tick];
      const previous = h.ticks[tick - 1];
      if (entry === undefined || previous === undefined) throw new Error('missing tick');
      for (const mutation of entry.mutations) {
        if (mutation.kind === 'remove') {
          expect(names.has(mutation.name), `remove of missing ${mutation.name}`).toBe(true);
          names.delete(mutation.name);
          continue;
        }
        const { asset } = mutation;
        // Each change happened during the day before its tick.
        expect(asset.updateTime >= previous.readTime && asset.updateTime < entry.readTime).toBe(true);
        if (mutation.kind === 'add') {
          expect(names.has(asset.name), `duplicate add of ${asset.name}`).toBe(false);
          names.add(asset.name);
        } else {
          expect(names.has(asset.name), `change of missing ${asset.name}`).toBe(true);
          expect(mutation.fields.length).toBeGreaterThan(0);
        }
      }
    }
    expect([...names].sort()).toEqual(today(size).map((a) => a.name));
  });

  it('records each change as a new version with a different field value', () => {
    const h = history(size);
    let state = new Map(h.base.map((a) => [a.name, a]));
    let changes = 0;
    for (const tick of h.ticks) {
      for (const mutation of tick.mutations) {
        if (mutation.kind === 'change') {
          const before = state.get(mutation.asset.name);
          if (before === undefined) throw new Error('missing');
          expect(mutation.asset.updateTime > before.updateTime).toBe(true);
          const differs = mutation.fields.some(
            (field) =>
              JSON.stringify(valuesAt(before.data, parsePath(field))) !==
              JSON.stringify(valuesAt(mutation.asset.data, parsePath(field))),
          );
          const dataDiffers = JSON.stringify(before.data) !== JSON.stringify(mutation.asset.data);
          expect(differs || dataDiffers, `${mutation.asset.name} ${mutation.fields.join(',')}`).toBe(true);
          changes += 1;
        }
        if (mutation.kind === 'remove') state.delete(mutation.name);
        else state.set(mutation.asset.name, mutation.asset);
      }
      state = new Map(state);
    }
    expect(changes).toBeGreaterThan(20);
  });

  it('has a few adds, removes and changes every week', () => {
    const h = history(size);
    for (let week = 0; week < 4; week++) {
      const days = h.ticks.slice(1 + week * 7, 8 + week * 7).flatMap((t) => t.mutations);
      expect(days.filter((m) => m.kind === 'add').length).toBeGreaterThan(0);
      expect(days.filter((m) => m.kind === 'remove').length).toBeGreaterThan(0);
      expect(days.filter((m) => m.kind === 'change').length).toBeGreaterThan(0);
    }
  });

  it('replays the four scripted events', () => {
    const h = history(size);
    // Key rotation: a new key version and the key's new primary.
    const rotation = mutationsOf(h, 6);
    const version = rotation.find(
      (m) => m.kind === 'add' && m.asset.assetType === 'cloudkms.googleapis.com/CryptoKeyVersion',
    );
    const key = rotation.find(
      (m) => m.kind === 'change' && m.asset.assetType === 'cloudkms.googleapis.com/CryptoKey',
    );
    expect(version).toBeDefined();
    expect(key?.kind === 'change' ? key.fields : []).toContain('primary');
    if (version?.kind === 'add' && key?.kind === 'change') {
      expect((data(key.asset)['primary'] as { name: string }).name).toBe(data(version.asset)['name']);
    }
    // Project deletion: everything in the retired project goes, the project is DELETE_REQUESTED.
    const deletion = mutationsOf(h, 13);
    const project = deletion.find(
      (m) => m.kind === 'change' && m.asset.assetType === 'cloudresourcemanager.googleapis.com/Project',
    );
    expect(project?.kind === 'change' ? data(project.asset)['lifecycleState'] : undefined).toBe(
      'DELETE_REQUESTED',
    );
    const projectRef = project?.kind === 'change' ? project.asset.ancestors[0] : undefined;
    const before = snapshotAt(h, 12).assets.filter(
      (a) => a.ancestors[0] === projectRef && a.assetType !== 'cloudresourcemanager.googleapis.com/Project',
    );
    expect(before.length).toBeGreaterThan(3);
    expect(snapshotAt(h, 13).assets.filter((a) => a.ancestors[0] === projectRef)).toHaveLength(1);
    // MIG scale-out: the manager's target size grows by the number of new VMs it created.
    const scaleOut = mutationsOf(h, 20);
    const managerChange = scaleOut.find(
      (m) => m.kind === 'change' && m.asset.assetType === 'compute.googleapis.com/InstanceGroupManager',
    );
    if (managerChange?.kind !== 'change') throw new Error('no scale-out of a managed instance group');
    const manager = managerChange.asset;
    const newVms = scaleOut.filter(
      (m) =>
        m.kind === 'add' &&
        m.asset.assetType === 'compute.googleapis.com/Instance' &&
        JSON.stringify(m.asset.data).includes(`instanceGroupManagers/${String(data(manager)['name'])}"`),
    );
    expect(newVms.length).toBeGreaterThan(0);
    const managerBefore = snapshotAt(h, 19).assets.find((a) => a.name === manager.name);
    if (managerBefore === undefined) throw new Error('the manager did not exist before');
    expect(Number(data(manager)['targetSize'])).toBe(
      Number(data(managerBefore)['targetSize']) + newVms.length,
    );
    // Peering added: both networks gain the other one.
    const peering = mutationsOf(h, 27).filter(
      (m) => m.kind === 'change' && m.asset.assetType === 'compute.googleapis.com/Network',
    );
    expect(peering).toHaveLength(2);
    const peers = (asset: Asset): string[] =>
      (data(asset)['peerings'] as { network: string }[]).map((p) => p.network);
    const [a, b] = peering.map((m) => (m.kind === 'change' ? m.asset : undefined));
    if (a === undefined || b === undefined) throw new Error('missing peering change');
    expect(peers(a)).toContain(data(b)['selfLink']);
    expect(peers(b)).toContain(data(a)['selfLink']);
    const earlier = snapshotAt(h, 26).assets.find((x) => x.name === a.name);
    expect(peers(earlier as Asset)).not.toContain(data(b)['selfLink']);
  });

  it('models every topology feature', () => {
    const rows = new Map(realismChecklist(today(size)).map((row) => [row.feature, row.count]));
    const atLeast = (feature: string, n: number): void => {
      expect(rows.get(feature), feature).toBeGreaterThanOrEqual(n);
    };
    const levels = rows.get('Folder levels below the organisation') ?? 0;
    expect(levels).toBeGreaterThanOrEqual(2);
    expect(levels).toBeLessThanOrEqual(3);
    atLeast('Shared VPC host projects', 1);
    atLeast('Service projects attached to a host (VMs, GKE, Cloud SQL)', 3);
    atLeast('Service projects with VMs on host subnets', size === 'S' ? 1 : 3);
    atLeast('VPC peerings (network side, without private services access)', 2);
    for (const feature of [
      'HA VPN gateways',
      'Interconnect attachments',
      'Cloud NAT gateways',
      'Global external HTTPS forwarding rules',
      'Internal passthrough load balancers',
      'Network endpoint groups',
      'VMs created by a managed instance group (created-by)',
      'Cloud Armor policies',
      'GKE clusters',
      'GKE node pools',
      'Kubernetes namespaces',
      'Kubernetes deployments',
      'Kubernetes pods',
      'Kubernetes services',
      'Kubernetes ingresses',
      'Cloud Run services',
      'Serverless VPC Access connectors',
      'Cloud SQL instances on private services access',
      'Private services access connections',
      'Pub/Sub topics',
      'Pub/Sub subscriptions',
      'Eventarc triggers',
      'Cloud Run functions',
      'BigQuery datasets',
      'BigQuery external tables on a bucket',
      'Cloud Storage buckets',
      'Cloud KMS keys',
      'Service accounts',
      'VPC Service Controls perimeters',
      'Empty active projects',
      'Projects with only hidden-tier assets',
      'Cloud DNS managed zones',
      'Firewall rules',
      'Routes',
      'Reserved addresses',
    ]) {
      atLeast(feature, 1);
    }
    atLeast('VPN tunnels', 2);
    atLeast('Projects inside a perimeter', 2);
    atLeast('Resources that name a service account', 10);
    // M and larger: every Tier-0 container type, and at least one of each catalog generator case.
    if (size !== 'S') {
      expect(rows.get('Tier-0 container types of the catalog seed present (of 19)')).toBe(19);
      const features = [...rows.keys()];
      for (const feature of features.slice(features.indexOf('Asset types') + 1)) atLeast(feature, 1);
    }
    // Customer-managed keys protect disks, buckets and Cloud SQL.
    const assets = today(size);
    const cmek = (type: string, path: string): boolean =>
      assets.some(
        (a) =>
          a.assetType === type &&
          valuesAt(a.data, parsePath(path)).some((v) => typeof v === 'string' && v.includes('/cryptoKeys/')),
      );
    expect(cmek('compute.googleapis.com/Disk', 'diskEncryptionKey.kmsKeyName')).toBe(true);
    expect(cmek('storage.googleapis.com/Bucket', 'encryption.defaultKmsKeyName')).toBe(true);
    expect(cmek('sqladmin.googleapis.com/Instance', 'diskEncryptionConfiguration.kmsKeyName')).toBe(true);
    // The external table reads from a bucket of the organisation.
    const buckets = new Set(
      assets
        .filter((a) => a.assetType === 'storage.googleapis.com/Bucket')
        .map((a) => String(data(a)['name'])),
    );
    const external = assets.find((a) => data(a)['type'] === 'EXTERNAL');
    const uri = String(valuesAt(external?.data, ['externalDataConfiguration', 'sourceUris', '*'])[0]);
    expect(buckets.has(uri.replace(/^gs:\/\//, '').split('/')[0] ?? '')).toBe(true);
  });

  it('writes every field the catalog seed reads where the seed says it is', () => {
    const assets = today(size);
    const missing = SEED_PATHS.filter(([, , minimum]) => minimum !== 'M' || size !== 'S')
      .filter(
        ([type, path]) =>
          !assets.some(
            (a) =>
              a.assetType === type &&
              valuesAt(a.data, parsePath(path)).some(
                (v) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
              ),
          ),
      )
      .map(([type, path]) => `${type} ${path}`);
    expect(missing).toEqual([]);
    const createdBy = assets.filter(
      (a) =>
        a.assetType === 'compute.googleapis.com/Instance' &&
        valuesAt(a.data, ['metadata', 'items', '*']).some(
          (item) => (item as { key?: string }).key === 'created-by',
        ),
    );
    expect(createdBy.length).toBeGreaterThan(0);
  });
});

describe('snapshotAt', () => {
  it('refuses ticks outside the window and finds a tick by date', () => {
    const h = history('S');
    expect(() => snapshotAt(h, 35)).toThrow(RangeError);
    expect(() => snapshotAt(h, '2026-09-03')).toThrow(RangeError);
    expect(snapshotAt(h, '2026-09-20').tick).toBe('2026-09-20');
  });
});
