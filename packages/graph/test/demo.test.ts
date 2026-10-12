// SPDX-License-Identifier: MIT
/**
 * The builder on the demo organisations S and M (@gcportrait/demo-data, default seed, DEMO_TODAY): Shared
 * VPC pairs, the load-balancer chains, private services access, Kubernetes nesting and dangling references,
 * checked against what the demo-data README promises. The catalog is the real compiled one: it maps every
 * type the demo emits, so no test-only stand-in rules are needed.
 */
import { historyFor, snapshotAt, toSnapshot } from '@gcportrait/demo-data';
import {
  DiffSchema,
  GraphBuildSchema,
  type Asset,
  type Graph,
  type GraphBuild,
  type Snapshot,
} from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { buildGraphWithReport } from '../src/build.js';
import { diffSnapshots } from '../src/diff.js';
import { BuildMemo } from '../src/memo.js';
import { REAL_CATALOG } from '../src/testing/fixtures.js';
import { ancestorsOf, edgeBetween, targets } from '../src/testing/graph.js';
import { demoGraphBuild, demoSnapshot } from './views/fixtures.js';

const CATALOG = REAL_CATALOG;
const SIZES = ['S', 'M'] as const;
type Size = (typeof SIZES)[number];
const SNAPSHOTS: Readonly<Record<Size, Snapshot>> = { S: demoSnapshot('S'), M: demoSnapshot('M') };
const BUILDS: Readonly<Record<Size, GraphBuild>> = {
  S: demoGraphBuild('S', { application: false }),
  M: demoGraphBuild('M', { application: false }),
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assetsOf(size: Size, assetType: string): Asset[] {
  return SNAPSHOTS[size].assets.filter((asset) => asset.assetType === assetType);
}

function projectIdOf(graph: Graph, id: string): string {
  return graph.nodes[id]?.projectId ?? id;
}

const COMPUTE_LINK = 'https://www.googleapis.com/compute/v1/';
const toName = (link: string): string => link.replace(COMPUTE_LINK, '//compute.googleapis.com/');

/** Shared VPC pairs read straight from the demo data, without the builder: VM NICs, GKE clusters, Cloud SQL. */
function pairsFromData(size: Size): string[] {
  const assets = SNAPSHOTS[size].assets;
  const idByNumber = new Map(
    assets
      .filter((a) => a.assetType === 'cloudresourcemanager.googleapis.com/Project')
      .map((a) => [String(record(a.data)['projectNumber']), String(record(a.data)['projectId'])]),
  );
  const hosts = new Set(
    assets
      .filter(
        (a) =>
          a.assetType === 'compute.googleapis.com/Project' && record(a.data)['xpnProjectStatus'] === 'HOST',
      )
      .map((a) => String(record(a.data)['name'])),
  );
  const projectIn = (reference: string): string => /projects\/([^/]+)\//.exec(reference)?.[1] ?? '';
  const pairs = new Set<string>();
  const add = (asset: Asset, reference: unknown): void => {
    const service = idByNumber.get(asset.ancestors[0]?.slice('projects/'.length) ?? '') ?? '';
    const host = projectIn(typeof reference === 'string' ? reference : '');
    if (hosts.has(host) && host !== service) pairs.add(`${service} -> ${host}`);
  };
  for (const vm of assets.filter((a) => a.assetType === 'compute.googleapis.com/Instance')) {
    const nics = record(vm.data)['networkInterfaces'];
    for (const nic of Array.isArray(nics) ? nics : []) add(vm, record(nic)['subnetwork']);
  }
  for (const cluster of assets.filter((a) => a.assetType === 'container.googleapis.com/Cluster')) {
    add(cluster, record(record(cluster.data)['networkConfig'])['subnetwork']);
  }
  for (const sql of assets.filter((a) => a.assetType === 'sqladmin.googleapis.com/Instance')) {
    add(sql, `${String(record(record(record(sql.data)['settings'])['ipConfiguration'])['privateNetwork'])}/`);
  }
  return [...pairs].sort();
}

function pairsFromGraph({ graph, report }: GraphBuild): string[] {
  return report.sharedVpc
    .map((pair) => `${projectIdOf(graph, pair.service)} -> ${projectIdOf(graph, pair.host)}`)
    .sort();
}

describe('Shared VPC on the demo', () => {
  it('detects the pairs the demo-data README promises (S: one host, three service projects)', () => {
    expect(pairsFromGraph(BUILDS.S)).toEqual([
      'demo-gke-1 -> demo-net-1',
      'demo-svc-1 -> demo-net-1',
      'demo-web-1 -> demo-net-1',
    ]);
  });

  // With the catalog generator cases the data platform (Dataproc VMs), the management project (CI runner,
  // private build pool), the ML project (Workbench VM, Vertex AI) and the VM project attach to the production
  // host as well.
  it('detects the sixteen pairs of M: prod host demo-net-1, nonprod host demo-net-2', () => {
    expect(pairsFromGraph(BUILDS.M)).toEqual([
      'demo-data-1 -> demo-net-1',
      'demo-gke-1 -> demo-net-1',
      'demo-gke-2 -> demo-net-1',
      'demo-gke-3 -> demo-net-1',
      'demo-mgmt-1 -> demo-net-1',
      'demo-ml-1 -> demo-net-1',
      'demo-svc-1 -> demo-net-1',
      'demo-svc-2 -> demo-net-2',
      'demo-svc-3 -> demo-net-1',
      'demo-svc-4 -> demo-net-2',
      'demo-svc-5 -> demo-net-1',
      'demo-svc-6 -> demo-net-2',
      'demo-vm-1 -> demo-net-1',
      'demo-web-1 -> demo-net-1',
      'demo-web-2 -> demo-net-1',
      'demo-web-3 -> demo-net-1',
    ]);
  });

  it.each(SIZES)(
    '%s: agrees with the pairs read straight from the data (VMs, clusters, Cloud SQL)',
    (size) => {
      expect(pairsFromGraph(BUILDS[size])).toEqual(pairsFromData(size));
    },
  );

  it.each(SIZES)('%s: keeps every attaching resource in its service project, never in the host', (size) => {
    const { graph, report } = BUILDS[size];
    for (const pair of report.sharedVpc) {
      expect(edgeBetween(graph, pair.service, pair.host, 'shares')).toBeDefined();
      for (const { from, to } of pair.attachments) {
        const chain = ancestorsOf(graph, from);
        expect(chain).toContain(pair.service);
        expect(chain).not.toContain(pair.host);
        expect(chain).not.toContain(to);
      }
    }
  });

  it('M: counts the projects sharing each host subnet', () => {
    const { report } = BUILDS.M;
    const webSubnet =
      '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/demo-web-1-europe-west3';
    expect(report.sharedWith[webSubnet]).toBe(1);
    expect(Object.values(report.sharedWith).every((count) => count >= 1)).toBe(true);
    expect(Object.keys(report.sharedWith).length).toBeGreaterThanOrEqual(12);
  });
});

describe('load-balancer chains on the demo', () => {
  it.each(SIZES)(
    '%s: forwarding rule → HTTPS proxy → URL map → backend service → instance group or NEG',
    (size) => {
      const { graph } = BUILDS[size];
      const rules = assetsOf(size, 'compute.googleapis.com/GlobalForwardingRule').filter((rule) =>
        String(record(rule.data)['target']).includes('/targetHttpsProxies/'),
      );
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        const [proxy] = targets(graph, rule.name, 'routes');
        expect(proxy).toBe(toName(String(record(rule.data)['target'])));
        const [urlMap] = targets(graph, proxy ?? '', 'routes');
        expect(graph.nodes[urlMap ?? '']?.assetType).toBe('compute.googleapis.com/UrlMap');
        const services = targets(graph, urlMap ?? '', 'routes');
        expect(services.length).toBeGreaterThan(0);
        const groups = services.flatMap((service) => targets(graph, service, 'routes'));
        expect(groups.length).toBeGreaterThan(0);
        for (const group of groups) {
          expect([
            'compute.googleapis.com/InstanceGroup',
            'compute.googleapis.com/NetworkEndpointGroup',
          ]).toContain(graph.nodes[group]?.assetType);
        }
      }
    },
  );

  it.each(SIZES)('%s: the managed group behind a backend service reaches its VMs (created-by)', (size) => {
    const { graph } = BUILDS[size];
    const managers = assetsOf(size, 'compute.googleapis.com/InstanceGroupManager');
    expect(managers.length).toBeGreaterThan(0);
    for (const manager of managers) {
      const group = toName(String(record(manager.data)['instanceGroup']));
      expect(edgeBetween(graph, manager.name, group, 'uses')).toBeDefined();
      const members = graph.edges.filter((edge) => edge.kind === 'memberOf' && edge.to === manager.name);
      expect(members.length).toBeGreaterThan(0);
      for (const member of members)
        expect(graph.nodes[member.from]?.assetType).toBe('compute.googleapis.com/Instance');
    }
  });

  it('M: the internal passthrough load balancer routes to a regional backend service in its project', () => {
    const { graph } = BUILDS.M;
    const internal = assetsOf('M', 'compute.googleapis.com/ForwardingRule').filter(
      (rule) => record(rule.data)['loadBalancingScheme'] === 'INTERNAL',
    );
    expect(internal).toHaveLength(3);
    for (const rule of internal) {
      const [service] = targets(graph, rule.name, 'routes');
      expect(graph.nodes[service ?? '']?.assetType).toBe('compute.googleapis.com/RegionBackendService');
      expect(ancestorsOf(graph, rule.name)[0]).toBe(ancestorsOf(graph, service ?? '')[0]);
    }
  });
});

describe('private services access on the demo', () => {
  it.each(SIZES)(
    '%s: the reserved ranges and the Service Networking connection attach to the VPC and nest in it',
    (size) => {
      const { graph } = BUILDS[size];
      const ranges = assetsOf(size, 'compute.googleapis.com/GlobalAddress').filter(
        (address) => record(address.data)['purpose'] === 'VPC_PEERING',
      );
      const connections = assetsOf(size, 'servicenetworking.googleapis.com/Connection');
      expect(ranges.length).toBeGreaterThan(0);
      expect(connections).toHaveLength(ranges.length);
      for (const range of ranges) {
        const network = toName(String(record(range.data)['network']));
        expect(edgeBetween(graph, range.name, network, 'attaches')).toBeDefined();
        expect(graph.containment.parent[range.name]).toBe(network);
      }
      for (const connection of connections) {
        const [network] = targets(graph, connection.name, 'attaches');
        expect(graph.nodes[network ?? '']?.assetType).toBe('compute.googleapis.com/Network');
        expect(graph.containment.parent[connection.name]).toBe(network);
      }
    },
  );

  it.each(SIZES)('%s: Cloud SQL attaches to the host VPC and stays in its own project', (size) => {
    const { graph } = BUILDS[size];
    const instances = assetsOf(size, 'sqladmin.googleapis.com/Instance');
    expect(instances.length).toBeGreaterThan(0);
    for (const sql of instances) {
      const [network] = targets(graph, sql.name, 'attaches');
      expect(graph.nodes[network ?? '']?.assetType).toBe('compute.googleapis.com/Network');
      expect(graph.nodes[network ?? '']?.projectId).toMatch(/^demo-net-/);
      expect(graph.nodes[graph.containment.parent[sql.name] ?? '']?.assetType).toBe(
        'cloudresourcemanager.googleapis.com/Project',
      );
    }
  });
});

describe('Kubernetes on the demo', () => {
  it.each(SIZES)(
    '%s: objects nest under their namespace, namespaces and nodes under their cluster',
    (size) => {
      const { graph } = BUILDS[size];
      const kubernetes = SNAPSHOTS[size].assets.filter((asset) => asset.name.includes('/k8s/'));
      expect(kubernetes.length).toBeGreaterThan(0);
      for (const asset of kubernetes) {
        const cluster = asset.name.slice(0, asset.name.indexOf('/k8s/'));
        const namespace = /^(.*\/k8s\/namespaces\/[^/]+)\//.exec(asset.name)?.[1];
        const expected = namespace ?? cluster;
        expect([asset.name, graph.containment.parent[asset.name]]).toEqual([asset.name, expected]);
        if (namespace !== undefined) expect(graph.containment.parent[namespace]).toBe(cluster);
      }
    },
  );

  it.each(SIZES)('%s: clusters stay in their GKE project; node pools nest in their cluster', (size) => {
    const { graph } = BUILDS[size];
    for (const cluster of assetsOf(size, 'container.googleapis.com/Cluster')) {
      expect(graph.nodes[graph.containment.parent[cluster.name] ?? '']?.projectId).toBe(
        graph.nodes[cluster.name]?.projectId,
      );
    }
    for (const pool of assetsOf(size, 'container.googleapis.com/NodePool')) {
      expect(graph.containment.parent[pool.name]).toBe(pool.parent);
    }
  });

  it('M: pods belong to their replica set, daemon set or stateful set, replica sets to their deployment', () => {
    const { graph } = BUILDS.M;
    for (const pod of assetsOf('M', 'k8s.io/Pod')) {
      const [owner] = targets(graph, pod.name, 'memberOf');
      expect(['apps.k8s.io/ReplicaSet', 'apps.k8s.io/DaemonSet', 'apps.k8s.io/StatefulSet']).toContain(
        graph.nodes[owner ?? '']?.assetType,
      );
    }
    for (const set of assetsOf('M', 'apps.k8s.io/ReplicaSet')) {
      const [owner] = targets(graph, set.name, 'memberOf');
      expect(graph.nodes[owner ?? '']?.assetType).toBe('apps.k8s.io/Deployment');
    }
  });
});

describe('dangling references on the demo', () => {
  /**
   * What the demo leaves outside the snapshot on purpose, or does not model: the Google-managed tenant
   * projects of private services access, Google's own projects (public images, service agents), and the
   * Compute Engine default service accounts, which the demo does not generate as IAM assets (real inventories
   * list them). S also has two gaps of its own, which M and larger fill: it has no generator
   * cases, so the Artifact Registry repositories its container images, function builds and Cloud Build images
   * name do not exist; and it emits a GKE cluster's pods but not their nodes, whose names the pods carry in
   * spec.nodeName (drawn through k8sRef). Both are demo-data follow-ups (docs/catalog-followups.md §2).
   * These tests hold whatever the catalog maps correctly: a seed-faithful rule may add references of these
   * kinds (a disk's public source image, say), never one into the organisation that fails to resolve.
   */
  const TENANT_PEERING =
    /^\/\/compute\.googleapis\.com\/projects\/[0-9a-f]{14}-tp\/global\/networks\/servicenetworking$/;
  const DEFAULT_COMPUTE_SA = /^(1[0-9]{10})-compute@developer\.gserviceaccount\.com$/;
  const ARTIFACT_REPOSITORY =
    /^\/\/artifactregistry\.googleapis\.com\/projects\/[^/]+\/locations\/[^/]+\/repositories\/[^/]+$/;
  const KUBERNETES_NODE =
    /^\/\/container\.googleapis\.com\/projects\/[^/]+\/locations\/[^/]+\/clusters\/[^/]+\/k8s\/nodes\/[^/]+$/;
  /** The gaps each size is allowed: S's only (see above). */
  const GAPS: Readonly<Record<Size, readonly RegExp[]>> = {
    S: [ARTIFACT_REPOSITORY, KUBERNETES_NODE],
    M: [],
  };

  /** The project a dangling target names: `projects/<p>` of a full name, or a service account's project. */
  function projectOf(target: string): string | undefined {
    return (
      /^\/\/[^/]+\/projects\/([^/]+)/.exec(target)?.[1] ??
      /@([a-z][a-z0-9-]*)\.iam\.gserviceaccount\.com$/.exec(target)?.[1] ??
      DEFAULT_COMPUTE_SA.exec(target)?.[1]
    );
  }

  /** The organisation's projects, by id and by number. */
  function organisationProjects(assets: readonly Asset[]): Set<string> {
    return new Set(
      assets
        .filter((asset) => asset.assetType === 'cloudresourcemanager.googleapis.com/Project')
        .flatMap((project) => [
          String(record(project.data)['projectId']),
          String(record(project.data)['projectNumber']),
        ]),
    );
  }

  /** Dangling references into the organisation, except to a Compute default SA or one of the size's gaps. */
  function intoOrganisation(graph: Graph, own: ReadonlySet<string>, size: Size): Graph['dangling'] {
    return graph.dangling.filter((d) => {
      const project = projectOf(d.to);
      return (
        project !== undefined &&
        own.has(project) &&
        !DEFAULT_COMPUTE_SA.test(d.to) &&
        !GAPS[size].some((gap) => gap.test(d.to))
      );
    });
  }

  it.each(SIZES)(
    '%s: no reference into the organisation dangles, except to a Compute default service account (and S’s gaps)',
    (size) => {
      const { graph, report } = BUILDS[size];
      const own = organisationProjects(SNAPSHOTS[size].assets);
      expect(intoOrganisation(graph, own, size)).toEqual([]);
      for (const d of graph.dangling.filter((dangling) => DEFAULT_COMPUTE_SA.test(dangling.to))) {
        expect(own.has(projectOf(d.to) ?? '')).toBe(true);
      }
      expect(Object.values(report.danglingByNode).reduce((a, b) => a + b, 0)).toBe(graph.dangling.length);
    },
  );

  // The same holds at every tick, not only today: an asset the history creates inside the window (demo-data's
  // `addable` trait) must not be named by an asset that is older, or that reference dangles until it appears.
  // Templates that name one call `OrgBuilder.referenced`, which keeps it out of the window.
  // The days share their unchanged asset objects, so one builder's memo serves them all, as in the app's data
  // worker; a build with the memo is the build without it (build.property.test.ts).
  it.each(SIZES)('%s: no reference into the organisation dangles at any tick of the history', (size) => {
    const history = historyFor(size);
    const memo = new BuildMemo();
    const found = history.ticks.flatMap((tick, index) => {
      const { assets } = snapshotAt(history, index);
      const { graph } = buildGraphWithReport({ assets }, CATALOG, { memo });
      return intoOrganisation(graph, organisationProjects(assets), size).map(
        (d) => `${tick.tick} ${d.kind} ${d.from} -> ${d.to}`,
      );
    });
    expect(found).toEqual([]);
  });

  it('S: the private services access peering into the Google-managed tenant project', () => {
    const { graph } = BUILDS.S;
    const peerings = graph.dangling.filter((d) => d.kind === 'peers');
    expect(peerings).toHaveLength(1);
    expect(peerings[0]?.to).toMatch(TENANT_PEERING);
  });

  it('M: the two tenant peerings, and the partner VMs’ Compute default service account', () => {
    const { graph } = BUILDS.M;
    const peerings = graph.dangling.filter((d) => d.kind === 'peers');
    expect(peerings).toHaveLength(2);
    for (const d of peerings) expect(d.to).toMatch(TENANT_PEERING);
    // The demo does not generate the Compute default service account as an IAM asset (real inventories list
    // it), so the partner gateways' runsAs reference has nothing to resolve to.
    const partner = graph.dangling.filter(
      (d) => d.kind === 'runsAs' && projectIdOf(graph, d.from) === 'demo-partner-1',
    );
    expect(partner).toHaveLength(2);
    for (const d of partner) expect(d.to).toMatch(DEFAULT_COMPUTE_SA);
  });

  it.each(SIZES)('%s: refuses no containment cycle', (size) => {
    expect(BUILDS[size].report.cycles).toEqual([]);
  });
});

describe('virtual regions on the demo', () => {
  it('M: groups project-level resources by location without touching VPCs, subnets or what nests in them', () => {
    const plain = BUILDS.M.graph;
    const { graph, report } = GraphBuildSchema.parse(
      buildGraphWithReport(SNAPSHOTS.M, CATALOG, { showRegions: true }),
    );
    expect(report.counts.virtualNodes).toBeGreaterThan(0);
    for (const [child, parentId] of Object.entries(plain.containment.parent)) {
      const node = plain.nodes[child];
      const moved = graph.containment.parent[child] !== parentId;
      const projectLevel = plain.nodes[parentId]?.assetType === 'cloudresourcemanager.googleapis.com/Project';
      const located = node?.location !== undefined && node.location.toLowerCase() !== 'global';
      expect(moved).toBe(projectLevel && located);
    }
  });
});

describe('timeline diff on the demo history', () => {
  it.each(SIZES)('%s: each tick’s diff is exactly what that tick’s mutations did', (size) => {
    const history = historyFor(size);
    let previous: Snapshot | undefined;
    history.ticks.forEach((tick, index) => {
      const current = toSnapshot(snapshotAt(history, index));
      if (previous !== undefined) {
        const state = new Map<string, 'added' | 'removed' | 'changed'>();
        for (const mutation of tick.mutations) {
          const name = mutation.kind === 'remove' ? mutation.name : mutation.asset.name;
          const before = state.get(name);
          if (mutation.kind === 'add') state.set(name, before === 'removed' ? 'changed' : 'added');
          else if (mutation.kind === 'remove') {
            if (before === 'added') state.delete(name);
            else state.set(name, 'removed');
          } else if (before !== 'added') state.set(name, 'changed');
        }
        const expected = (kind: string): string[] =>
          [...state]
            .filter(([, value]) => value === kind)
            .map(([name]) => name)
            .sort();
        const diff = DiffSchema.parse(diffSnapshots(previous, current));
        expect(diff).toEqual({
          added: expected('added'),
          removed: expected('removed'),
          changed: expected('changed'),
        });
      }
      previous = current;
    });
  });
});
