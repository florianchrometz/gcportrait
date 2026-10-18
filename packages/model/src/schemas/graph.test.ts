// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { DISK, FOLDER, INSTANCE, NETWORK, ORG, PROJECT, SUBNET, sampleGraph } from '../testing/fixtures.js';
import { issuePaths, present, withChange } from '../testing/issues.js';
import { GraphNodeSchema, GraphSchema, NodeRoleSchema, type Graph } from './graph.js';

const UNKNOWN = '//compute.googleapis.com/projects/demo-net/global/networks/missing';

const graphWith = (change: (graph: Graph) => void): Graph => withChange(sampleGraph, change);

describe('GraphSchema', () => {
  it('accepts a consistent graph', () => {
    expect(issuePaths(GraphSchema, sampleGraph())).toEqual([]);
  });

  it('accepts an empty graph', () => {
    const empty = {
      nodes: {},
      containment: { parent: {}, children: {} },
      edges: [],
      dangling: [],
      indexes: { byType: {}, byProject: {}, byIp: {}, byDomain: {}, aliases: {} },
    };
    expect(issuePaths(GraphSchema, empty)).toEqual([]);
  });

  it('rejects unknown top-level keys', () => {
    expect(issuePaths(GraphSchema, { ...sampleGraph(), layout: {} })).toEqual(['']);
  });

  it('rejects a node stored under another key', () => {
    const graph = graphWith((g) => {
      g.nodes[UNKNOWN] = { ...present(g.nodes[INSTANCE]), id: INSTANCE };
    });
    expect(issuePaths(GraphSchema, graph)).toEqual([`nodes.${UNKNOWN}.id`]);
  });

  describe('containment', () => {
    it('rejects a parent entry for an unknown child or an unknown parent', () => {
      const graph = graphWith((g) => {
        g.containment.parent[UNKNOWN] = PROJECT;
        present(g.containment.children[PROJECT]).push(UNKNOWN);
        g.containment.parent[DISK] = UNKNOWN;
        g.containment.children[UNKNOWN] = [DISK];
      });
      expect(issuePaths(GraphSchema, graph)).toEqual([
        `containment.parent.${UNKNOWN}`,
        `containment.parent.${DISK}`,
        `containment.parent.${DISK}`,
      ]);
    });

    it('rejects a child missing from its parent’s children', () => {
      const listedElsewhere = graphWith((g) => {
        g.containment.children[NETWORK] = [];
      });
      expect(issuePaths(GraphSchema, listedElsewhere)).toEqual([`containment.parent.${SUBNET}`]);
      const noChildrenEntry = graphWith((g) => {
        Reflect.deleteProperty(g.containment.children, NETWORK);
      });
      expect(issuePaths(GraphSchema, noChildrenEntry)).toEqual([`containment.parent.${SUBNET}`]);
    });

    it('rejects a children entry whose child has another parent', () => {
      const graph = graphWith((g) => {
        present(g.containment.children[ORG]).push(SUBNET);
      });
      expect(issuePaths(GraphSchema, graph)).toEqual([`containment.children.${ORG}.1`]);
    });

    it('rejects containment cycles, once per cycle', () => {
      const graph = graphWith((g) => {
        g.containment.parent[ORG] = SUBNET;
        present(g.containment.children[SUBNET]).push(ORG);
      });
      expect(issuePaths(GraphSchema, graph)).toEqual([`containment.parent.${FOLDER}`]);
    });

    it('rejects a node that contains itself', () => {
      const graph = graphWith((g) => {
        g.containment.parent[ORG] = ORG;
        present(g.containment.children[ORG]).push(ORG);
      });
      expect(issuePaths(GraphSchema, graph)).toEqual([`containment.parent.${ORG}`]);
    });
  });

  describe('edges and dangling references', () => {
    it('rejects an edge from an unknown node', () => {
      const graph = graphWith((g) => {
        present(g.edges[0]).from = UNKNOWN;
        present(g.dangling[0]).from = UNKNOWN;
      });
      expect(issuePaths(GraphSchema, graph)).toEqual(['edges.0.from', 'dangling.0.from']);
    });

    it('rejects an unresolved edge among the resolved ones', () => {
      const toUnknown = graphWith((g) => {
        present(g.edges[0]).to = UNKNOWN;
      });
      expect(issuePaths(GraphSchema, toUnknown)).toEqual(['edges.0']);
      const markedDangling = graphWith((g) => {
        present(g.edges[0]).dangling = { raw: 'app' };
      });
      expect(issuePaths(GraphSchema, markedDangling)).toEqual(['edges.0']);
    });

    it('rejects a resolved reference among the dangling ones', () => {
      const notMarked = graphWith((g) => {
        delete present(g.dangling[0]).dangling;
      });
      expect(issuePaths(GraphSchema, notMarked)).toEqual(['dangling.0']);
      const resolves = graphWith((g) => {
        present(g.dangling[0]).to = SUBNET;
      });
      expect(issuePaths(GraphSchema, resolves)).toEqual(['dangling.0']);
    });

    it('records how a project-swapped reference matched', () => {
      const swapped = graphWith((g) => {
        g.edges = g.edges.map((edge) => ({ ...edge, matchedProject: 'number' as const }));
      });
      expect(issuePaths(GraphSchema, swapped)).toEqual([]);
      const bad = {
        ...sampleGraph(),
        edges: [{ ...present(sampleGraph().edges[0]), matchedProject: 'name' }],
      };
      expect(issuePaths(GraphSchema, bad)).toEqual(['edges.0.matchedProject']);
    });

    it('rejects relation kinds it does not know', () => {
      const graph = graphWith((g) => {
        Object.assign(present(g.edges[0]), { kind: 'linksTo' });
      });
      expect(issuePaths(GraphSchema, graph)).toEqual(['edges.0.kind']);
    });
  });

  describe('indexes', () => {
    it('rejects index entries that name unknown nodes', () => {
      const graph = graphWith((g) => {
        g.indexes.byType['compute.googleapis.com/Disk'] = [DISK];
        g.indexes.aliases['web@example.com'] = UNKNOWN;
      });
      expect(issuePaths(GraphSchema, graph)).toEqual([
        'indexes.byType.compute.googleapis.com/Disk',
        'indexes.aliases.web@example.com',
      ]);
    });

    it.each([
      ['byType', 'Instance'],
      ['byProject', 'Demo Net'],
      ['byIp', '10.10.0.256'],
      ['byDomain', 'WWW.example.com'],
      ['aliases', ''],
    ] as const)('rejects a malformed %s key', (index, key) => {
      const graph = graphWith((g) => {
        Object.assign(g.indexes[index], { [key]: index === 'aliases' ? INSTANCE : [INSTANCE] });
      });
      expect(issuePaths(GraphSchema, graph)).toEqual([`indexes.${index}.${key}`]);
    });
  });
});

describe('GraphNodeSchema', () => {
  const node = () => present(sampleGraph().nodes[INSTANCE]);

  it.each(NodeRoleSchema.options)('accepts role %s', (role) => {
    expect(issuePaths(GraphNodeSchema, { ...node(), role, hidden: true })).toEqual([]);
  });

  it('accepts a hidden node of a visible role (hiddenWhen matched)', () => {
    expect(issuePaths(GraphNodeSchema, { ...node(), hidden: true })).toEqual([]);
  });

  it('rejects a visible node whose role is hidden', () => {
    expect(issuePaths(GraphNodeSchema, { ...node(), role: 'hidden', hidden: false })).toEqual(['hidden']);
  });

  it('marks a matched hiddenWhen, on hidden nodes only', () => {
    expect(issuePaths(GraphNodeSchema, { ...node(), hidden: true, hiddenWhenMatched: true })).toEqual([]);
    expect(
      issuePaths(GraphNodeSchema, { ...node(), role: 'hidden', hidden: true, hiddenWhenMatched: true }),
    ).toEqual([]);
    expect(issuePaths(GraphNodeSchema, { ...node(), hiddenWhenMatched: true })).toEqual([
      'hiddenWhenMatched',
    ]);
    expect(issuePaths(GraphNodeSchema, { ...node(), hidden: true, hiddenWhenMatched: false })).toEqual([
      'hiddenWhenMatched',
    ]);
  });

  it('marks Shared VPC host projects', () => {
    expect(issuePaths(GraphNodeSchema, { ...node(), sharedVpcHost: true })).toEqual([]);
    expect(issuePaths(GraphNodeSchema, { ...node(), sharedVpcHost: 'yes' })).toEqual(['sharedVpcHost']);
  });

  it.each([
    ['id', { id: 'web-1' }],
    ['label', { label: '' }],
    ['subtitle', { subtitle: '' }],
    ['role', { role: 'card' }],
    ['product', { product: '' }],
    ['projectId', { projectId: 'Demo' }],
    ['projectNumber', { projectNumber: 'demo' }],
    ['location', { location: '' }],
    ['ips.0', { ips: ['10.10.0.256'] }],
    ['domains.0', { domains: ['www.example.com.'] }],
    ['', { zone: 'europe-west3-a' }],
  ])('rejects a bad %s', (path, patch) => {
    expect(issuePaths(GraphNodeSchema, { ...node(), ...patch })).toEqual([path]);
  });
});
