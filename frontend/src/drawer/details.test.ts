// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The drawer's details, worked out in the data worker: relations grouped by kind in the model's order
 * (outgoing, then `peers`, then incoming, each by label; a container's children capped), a subnet target naming
 * its network, dangling references with why they dangle, labels and tags read from `resource.data`; and the
 * whole answer for demo organisation M's bastion VM and its project.
 */
import { catalog } from '@gcportrait/catalog';
import { RelationKindSchema, type Graph, type GraphNode, type RelationEdge } from '@gcportrait/model';
import { beforeAll, describe, expect, it } from 'vitest';

import { demoGraph } from '../diagram/testing/demoScenes';
import { danglingEntry, groupRelations, labelsOf, nodeDetails, RELATION_ORDER, tagsOf } from './details';
import type { NodeDetails } from './types';

function node(id: string, assetType: string, label: string, role: GraphNode['role'] = 'core'): GraphNode {
  return { id, assetType, label, role, product: 'Compute Engine', ips: [], domains: [], hidden: false };
}

const X = '//compute.googleapis.com/projects/demo-a/zones/z/instances/x';
const IDS = {
  a: '//compute.googleapis.com/projects/demo-a/zones/z/disks/a-disk',
  b: '//compute.googleapis.com/projects/demo-a/zones/z/disks/b-disk',
  user: '//compute.googleapis.com/projects/demo-a/zones/z/instances/user',
  router: '//compute.googleapis.com/projects/demo-a/regions/r/forwardingRules/fr',
  peer: '//compute.googleapis.com/projects/demo-a/global/networks/peer',
  vpc: '//compute.googleapis.com/projects/demo-a/global/networks/vpc',
  subnet: '//compute.googleapis.com/projects/demo-a/regions/r/subnetworks/subnet',
  sa: '//iam.googleapis.com/projects/demo-a/serviceAccounts/1',
  host: '//cloudresourcemanager.googleapis.com/projects/2',
  c1: '//compute.googleapis.com/projects/demo-a/zones/z/disks/child-c',
  c2: '//compute.googleapis.com/projects/demo-a/zones/z/disks/child-a',
  c3: '//compute.googleapis.com/projects/demo-a/zones/z/disks/child-b',
};

/** A small Graph around X: one relation of most kinds, both directions, three children. */
function graphAroundX(): Graph {
  const nodes: Record<string, GraphNode> = {
    [X]: node(X, 'compute.googleapis.com/Instance', 'x', 'container'),
    [IDS.a]: node(IDS.a, 'compute.googleapis.com/Disk', 'A disk'),
    [IDS.b]: node(IDS.b, 'compute.googleapis.com/Disk', 'b disk'),
    [IDS.user]: node(IDS.user, 'compute.googleapis.com/Instance', 'user'),
    [IDS.router]: node(IDS.router, 'compute.googleapis.com/ForwardingRule', 'fr'),
    [IDS.peer]: node(IDS.peer, 'compute.googleapis.com/Network', 'peer', 'container'),
    [IDS.vpc]: node(IDS.vpc, 'compute.googleapis.com/Network', 'vpc', 'container'),
    [IDS.subnet]: node(IDS.subnet, 'compute.googleapis.com/Subnetwork', 'subnet', 'container'),
    [IDS.sa]: node(IDS.sa, 'iam.googleapis.com/ServiceAccount', 'runner'),
    [IDS.host]: node(IDS.host, 'cloudresourcemanager.googleapis.com/Project', 'host', 'container'),
    [IDS.c1]: node(IDS.c1, 'compute.googleapis.com/Disk', 'child c'),
    [IDS.c2]: node(IDS.c2, 'compute.googleapis.com/Disk', 'child a'),
    [IDS.c3]: node(IDS.c3, 'compute.googleapis.com/Disk', 'child b'),
  };
  const edges: RelationEdge[] = [
    { from: X, to: IDS.host, kind: 'shares' },
    { from: IDS.user, to: X, kind: 'uses' },
    { from: X, to: IDS.b, kind: 'uses' },
    { from: X, to: IDS.a, kind: 'uses' },
    { from: X, to: IDS.peer, kind: 'peers' },
    { from: X, to: IDS.subnet, kind: 'attaches' },
    { from: X, to: IDS.vpc, kind: 'attaches', weak: true },
    { from: IDS.router, to: X, kind: 'routes' },
    { from: X, to: IDS.sa, kind: 'runsAs' },
  ];
  return {
    nodes,
    containment: {
      parent: { [IDS.subnet]: IDS.vpc, [IDS.c1]: X, [IDS.c2]: X, [IDS.c3]: X },
      children: { [IDS.vpc]: [IDS.subnet], [X]: [IDS.c2, IDS.c3, IDS.c1] },
    },
    edges,
    dangling: [],
    indexes: { byType: {}, byProject: {}, byIp: {}, byDomain: {}, aliases: {} },
  };
}

describe('relation grouping', () => {
  it('follows the model’s relation kinds in their declared order (catalog skill §4)', () => {
    expect(RELATION_ORDER).toEqual(RelationKindSchema.options);
    expect(RELATION_ORDER.slice(0, 4)).toEqual(['contains', 'attaches', 'routes', 'uses']);
    expect(RELATION_ORDER.at(-1)).toBe('shares');
  });

  it('groups by kind in that order, outgoing before peers before incoming, each by label', () => {
    const groups = groupRelations(graphAroundX(), X, catalog, 2);
    expect(groups.map((group) => group.kind)).toEqual([
      'contains',
      'attaches',
      'routes',
      'uses',
      'peers',
      'runsAs',
      'shares',
    ]);
    const uses = groups.find((group) => group.kind === 'uses');
    expect(uses?.entries.map((entry) => [entry.direction, entry.target.label])).toEqual([
      ['out', 'A disk'],
      ['out', 'b disk'],
      ['in', 'user'],
    ]);
    expect(groups.find((group) => group.kind === 'routes')?.entries[0]?.direction).toBe('in');
    expect(groups.find((group) => group.kind === 'peers')?.entries[0]?.direction).toBe('both');
  });

  it('caps a container’s children and counts the rest', () => {
    const contains = groupRelations(graphAroundX(), X, catalog, 2).find((group) => group.kind === 'contains');
    expect(contains?.entries.map((entry) => entry.target.label)).toEqual(['child a', 'child b']);
    expect(contains?.more).toBe(1);
  });

  it('names the network a subnet target sits in, and marks a weak relation', () => {
    const attaches = groupRelations(graphAroundX(), X, catalog).find((group) => group.kind === 'attaches');
    expect(attaches?.entries).toEqual([
      {
        direction: 'out',
        target: { id: IDS.subnet, label: 'subnet', typeName: 'Compute Engine subnetwork' },
        via: { id: IDS.vpc, label: 'vpc', typeName: 'Compute Engine network' },
      },
      {
        direction: 'out',
        target: { id: IDS.vpc, label: 'vpc', typeName: 'Compute Engine network' },
        weak: true,
      },
    ]);
  });

  it('leaves out kinds without relations', () => {
    const lonely = groupRelations(graphAroundX(), IDS.c1, catalog);
    expect(lonely).toEqual([]);
  });
});

describe('dangling references, labels and tags', () => {
  const projects = { numberById: { 'demo-a': '10000000001' }, idByNumber: { '10000000001': 'demo-a' } };

  it('says why a reference dangles', () => {
    const edge = (to: string, raw = to): RelationEdge => ({ from: X, to, kind: 'uses', dangling: { raw } });
    expect(
      danglingEntry(edge('//compute.googleapis.com/projects/debian-cloud/global/images/debian-12'), projects),
    ).toMatchObject({ reason: 'outside-project', project: 'debian-cloud' });
    expect(
      danglingEntry(edge('//compute.googleapis.com/projects/demo-a/global/images/gone'), projects),
    ).toMatchObject({ reason: 'missing' });
    expect(danglingEntry(edge('service-1@gcp-sa-logging.iam.gserviceaccount.com'), projects)).toMatchObject({
      reason: 'identity',
    });
    expect(danglingEntry(edge('all-apis', 'all-apis'), projects)).toEqual({
      kind: 'uses',
      to: 'all-apis',
      raw: 'all-apis',
      reason: 'unreadable',
    });
  });

  it('reads labels (and GKE’s resource labels) and plain tag lists from resource.data', () => {
    expect(
      labelsOf({ labels: { team: 'retail', env: 'prod', bad: 3 }, resourceLabels: { env: 'x', a: 'b' } }),
    ).toEqual([
      { key: 'a', value: 'b' },
      { key: 'env', value: 'prod' },
      { key: 'team', value: 'retail' },
    ]);
    expect(labelsOf(null)).toEqual([]);
    expect(tagsOf({ tags: { items: ['web', 'lb-backend', 'web'] } })).toEqual(['lb-backend', 'web']);
    expect(tagsOf({ tags: ['app-catalog'] })).toEqual(['app-catalog']);
    expect(tagsOf({ tags: { fingerprint: 'abc' } })).toEqual([]);
  });
});

describe('demo organisation M', () => {
  const VM = '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/instances/bastion';
  const PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000013';
  let details: (id: string) => NodeDetails | null;

  beforeAll(async () => {
    const { graph, console: links } = await demoGraph('M');
    const source = { graph, ...links };
    details = (id) => nodeDetails(source, id, catalog);
  }, 60_000);

  it('describes the bastion VM: place, addresses, labels, relations, console link and data', () => {
    const vm = details(VM);
    expect(vm).toMatchObject({
      label: 'bastion',
      assetType: 'compute.googleapis.com/Instance',
      typeName: 'Compute Engine instance',
      product: 'Compute Engine',
      drillable: false,
      parent: { id: PROJECT, typeName: 'Resource Manager project' },
      project: { id: 'demo-vm-1', number: '10000000013', node: PROJECT },
      location: 'europe-west3-a',
      ips: ['10.0.14.5', '203.0.113.19'],
      domains: ['bastion.corp.example.com'],
      tags: ['bastion'],
      console: {
        kind: 'resource',
        url: 'https://console.cloud.google.com/compute/instancesDetail/zones/europe-west3-a/instances/bastion?project=demo-vm-1',
      },
    });
    expect(vm?.labels).toContainEqual({ key: 'team', value: 'retail' });
    expect(vm?.relations.map((group) => group.kind)).toEqual(['attaches', 'uses', 'runsAs']);
    const [attaches, uses] = vm?.relations ?? [];
    expect(attaches?.entries[0]?.target.label).toBe('demo-vm-1-europe-west3');
    expect(attaches?.entries[0]?.via?.label).toBe('vpc-shared-prod');
    expect(uses?.entries[0]?.target.id).toBe(
      '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/disks/bastion',
    );
    expect(vm?.resource?.data).toMatchObject({ name: 'bastion', kind: 'compute#instance' });
  });

  it('describes its project: a container one can drill into, with its children and its Shared VPC host', () => {
    const project = details(PROJECT);
    expect(project?.drillable).toBe(true);
    expect(project?.relations.map((group) => group.kind)).toEqual(['contains', 'shares']);
    expect(project?.relations[0]?.entries.some((entry) => entry.target.id === VM)).toBe(true);
  });

  it('explains the boot disk’s public image as a reference into a project outside the snapshot', () => {
    const disk = details('//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/disks/bastion');
    expect(disk?.dangling).toContainEqual(
      expect.objectContaining({
        kind: 'uses',
        reason: 'outside-project',
        project: 'debian-cloud',
        raw: expect.stringContaining('/projects/debian-cloud/global/images/') as unknown,
      }),
    );
  });

  it('answers null for an id the Graph does not hold (a bundle the scene draws)', () => {
    expect(details('group://cloudresourcemanager.googleapis.com/projects/1')).toBeNull();
  });
});
