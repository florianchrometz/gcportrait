// SPDX-License-Identifier: Apache-2.0
/** Unit tests of the builder's steps, for the edge cases the end-to-end tests do not reach. */
import type { Asset, EvaluatedRelation, GraphNode } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { buildAliases } from './aliases.js';
import { uniqueAssets } from './assets.js';
import { resolveContainment } from './containment.js';
import { nameResolver, swapProject } from './names.js';
import { addRegionContainers } from './regions.js';
import { applyWeakPrecedence, mergeCopies, mergeReciprocal, resolveRelations } from './relations.js';
import { deriveSharedVpc } from './shared-vpc.js';
import { graphNode as node, project, projectName, resource } from './testing/fixtures.js';

const EMPTY_INDEX = { numberById: {}, idByNumber: {} };
const SA_TYPE = 'iam.googleapis.com/ServiceAccount';
/** The catalog entry the alias index reads: service accounts are known by `data.email`. */
const typeOf = (asset: Asset) => (asset.assetType === SA_TYPE ? { aliases: ['$.data.email'] } : undefined);

describe('buildAliases', () => {
  it("indexes the catalog's alias paths, skipping values that are no key, and projects named by number", () => {
    const assets: Asset[] = [
      resource('//iam.googleapis.com/projects/p/serviceAccounts/1', SA_TYPE, '10000000001', null),
      resource('//iam.googleapis.com/projects/p/serviceAccounts/2', SA_TYPE, '10000000001', [
        'x@example.com',
      ]),
      resource('//iam.googleapis.com/projects/p/serviceAccounts/3', SA_TYPE, '10000000001', { email: 42 }),
      resource('//iam.googleapis.com/projects/p/serviceAccounts/4', SA_TYPE, '10000000001', {
        email: 'no address',
      }),
      resource('//iam.googleapis.com/projects/p/serviceAccounts/5', SA_TYPE, '10000000001', {
        email: ' Ok@Example.com ',
      }),
      {
        ...project('10000000002', 'demo-a-1'),
        name: '//cloudresourcemanager.googleapis.com/projects/demo-a-1',
      },
      project('10000000003', 'demo-b-1'),
    ];
    const { aliases, conflicts } = buildAliases(assets, EMPTY_INDEX, typeOf);
    expect(Object.fromEntries(aliases)).toEqual({
      'ok@example.com': '//iam.googleapis.com/projects/p/serviceAccounts/5',
      '10000000003': projectName('10000000003'),
    });
    expect(conflicts).toBe(0);
    // Without alias paths in the catalog, a service account is known by its name only.
    expect(buildAliases(assets, EMPTY_INDEX, () => undefined).aliases.has('ok@example.com')).toBe(false);
  });

  it('does not count a key claimed twice by the same node as a conflict', () => {
    const index = {
      numberById: { '10000000003': '10000000003' },
      idByNumber: { '10000000003': '10000000003' },
    };
    const { aliases, conflicts } = buildAliases([project('10000000003', 'demo-b-1')], index, typeOf);
    expect(Object.fromEntries(aliases)).toEqual({ '10000000003': projectName('10000000003') });
    expect(conflicts).toBe(0);
  });
});

describe('uniqueAssets', () => {
  it('breaks an updateTime tie by the data text, whatever the input order', () => {
    const name = '//storage.googleapis.com/b';
    const a = resource(name, 'storage.googleapis.com/Bucket', '10000000001', { v: 'a' });
    const b = resource(name, 'storage.googleapis.com/Bucket', '10000000001', { v: 'b' });
    const none = resource(name, 'storage.googleapis.com/Bucket', '10000000001', undefined);
    expect(uniqueAssets([a, b]).assets).toEqual([a]);
    expect(uniqueAssets([b, a]).assets).toEqual([a]);
    expect(uniqueAssets([a, none]).assets).toEqual([none]);
    expect(uniqueAssets([none, a]).assets).toEqual([none]);
  });
});

const INDEX = {
  numberById: { 'demo-net-1': '10000000001', 'demo-app-1': '10000000002' },
  idByNumber: { '10000000001': 'demo-net-1', '10000000002': 'demo-app-1' },
};

describe('names: canonical matching by project id or number', () => {
  it.each([
    [
      '//secretmanager.googleapis.com/projects/demo-app-1/secrets/db',
      { name: '//secretmanager.googleapis.com/projects/10000000002/secrets/db', form: 'number' },
    ],
    [
      '//compute.googleapis.com/projects/10000000001/global/networks/core',
      { name: '//compute.googleapis.com/projects/demo-net-1/global/networks/core', form: 'id' },
    ],
    [
      '//cloudresourcemanager.googleapis.com/projects/demo-app-1',
      { name: '//cloudresourcemanager.googleapis.com/projects/10000000002', form: 'number' },
    ],
    // Only the first project segment.
    [
      '//x.googleapis.com/projects/demo-app-1/things/projects/demo-net-1',
      { name: '//x.googleapis.com/projects/10000000002/things/projects/demo-net-1', form: 'number' },
    ],
    // Names without a project segment the index knows stay as they are.
    ['//x.googleapis.com/projects/demo-other-1/things/a', undefined],
    ['//logging.googleapis.com/organizations/30000000001/sinks/s', undefined],
    ['//x.googleapis.com/projects/', undefined],
    ['projects/demo-app-1/secrets/db', undefined],
    ['//x.googleapis.com', undefined],
  ])('swapProject(%s) is %j', (name, swapped) => {
    expect(swapProject(name, INDEX)).toEqual(swapped);
  });

  it('resolves exactly first, then with the swapped project, recording the form that matched', () => {
    const nodes = new Set([
      '//secretmanager.googleapis.com/projects/10000000002/secrets/db',
      '//secretmanager.googleapis.com/projects/demo-app-1/secrets/api',
      '//secretmanager.googleapis.com/projects/10000000002/secrets/api',
    ]);
    const resolve = nameResolver((id) => nodes.has(id), INDEX);
    expect(resolve('//secretmanager.googleapis.com/projects/demo-app-1/secrets/db')).toEqual({
      id: '//secretmanager.googleapis.com/projects/10000000002/secrets/db',
      matchedProject: 'number',
    });
    expect(resolve('//secretmanager.googleapis.com/projects/demo-app-1/secrets/api')).toEqual({
      id: '//secretmanager.googleapis.com/projects/demo-app-1/secrets/api',
    });
    expect(resolve('//secretmanager.googleapis.com/projects/demo-app-1/secrets/gone')).toBeUndefined();
  });
});

describe('relations', () => {
  const ids = ['//x.googleapis.com/a', '//x.googleapis.com/b'];
  const isNode = (id: string) => (ids.includes(id) ? { id } : undefined);
  const relation = (extra: Partial<EvaluatedRelation>): EvaluatedRelation => ({
    kind: 'uses',
    rule: 0,
    raw: 'r',
    ...extra,
  });

  it('drops references to the asset itself, also through an alias, and resolves a raw node id', () => {
    const aliases = new Map([['self@example.com', '//x.googleapis.com/a']]);
    const result = resolveRelations(
      '//x.googleapis.com/a',
      [
        relation({ target: { by: 'alias', alias: 'self@example.com' } }),
        relation({ raw: '//x.googleapis.com/b' }),
        relation({ raw: '//x.googleapis.com/b', weak: true }),
      ],
      isNode,
      aliases,
    );
    expect(result.resolved).toEqual([
      { from: '//x.googleapis.com/a', kind: 'uses', to: '//x.googleapis.com/b', weak: false },
    ]);
  });

  it('merges dangling copies, weak only when every copy is weak, keeping the first raw value', () => {
    const result = resolveRelations(
      '//x.googleapis.com/a',
      [
        relation({ raw: 'first', target: { by: 'name', name: '//x.googleapis.com/gone' }, weak: true }),
        relation({ raw: 'second', target: { by: 'name', name: '//x.googleapis.com/gone' }, weak: true }),
        relation({ raw: 'third', target: { by: 'name', name: '//x.googleapis.com/lost' }, weak: true }),
        relation({ raw: 'fourth', target: { by: 'name', name: '//x.googleapis.com/lost' } }),
      ],
      isNode,
      new Map(),
    );
    expect(result.dangling).toEqual([
      { from: '//x.googleapis.com/a', kind: 'uses', to: '//x.googleapis.com/gone', weak: true, raw: 'first' },
      {
        from: '//x.googleapis.com/a',
        kind: 'uses',
        to: '//x.googleapis.com/lost',
        weak: false,
        raw: 'third',
      },
    ]);
  });

  it('draws a reverse relation from its target, and keeps a dangling one with the asset', () => {
    const result = resolveRelations(
      '//x.googleapis.com/a',
      [
        relation({ target: { by: 'name', name: '//x.googleapis.com/b' }, reverse: true }),
        relation({ target: { by: 'name', name: '//x.googleapis.com/b' } }),
        relation({ target: { by: 'name', name: '//x.googleapis.com/gone' }, reverse: true, raw: 'gone' }),
      ],
      isNode,
      new Map(),
    );
    expect(result.resolved).toEqual([
      { from: '//x.googleapis.com/b', kind: 'uses', to: '//x.googleapis.com/a', weak: false },
      { from: '//x.googleapis.com/a', kind: 'uses', to: '//x.googleapis.com/b', weak: false },
    ]);
    expect(result.dangling).toEqual([
      { from: '//x.googleapis.com/a', kind: 'uses', to: '//x.googleapis.com/gone', weak: false, raw: 'gone' },
    ]);
  });

  it('resolveRelations records the project form that matched', () => {
    const swapped = resolveRelations(
      '//x.googleapis.com/a',
      [relation({ target: { by: 'name', name: '//x.googleapis.com/b2' } })],
      (name) =>
        name === '//x.googleapis.com/b2' ? { id: '//x.googleapis.com/b', matchedProject: 'id' } : undefined,
      new Map(),
    );
    expect(swapped.resolved).toEqual([
      {
        from: '//x.googleapis.com/a',
        kind: 'uses',
        to: '//x.googleapis.com/b',
        weak: false,
        matchedProject: 'id',
      },
    ]);
  });

  it('mergeCopies keeps one edge per copy of it, strong when any copy is', () => {
    expect(
      mergeCopies([
        { from: 'a', kind: 'memberOf', to: 'b', weak: true, matchedProject: 'number' },
        { from: 'a', kind: 'memberOf', to: 'b', weak: false },
        { from: 'a', kind: 'uses', to: 'b', weak: true },
        { from: 'a', kind: 'uses', to: 'b', weak: true, matchedProject: 'id' },
      ]),
    ).toEqual([
      { from: 'a', kind: 'memberOf', to: 'b', weak: false, matchedProject: undefined },
      { from: 'a', kind: 'uses', to: 'b', weak: true, matchedProject: undefined },
    ]);
  });

  it('folds reciprocal peers and connects, and leaves other kinds and one-sided edges alone', () => {
    const folded = mergeReciprocal([
      { from: 'tunnel', kind: 'connects', to: 'router', weak: false },
      { from: 'router', kind: 'connects', to: 'tunnel', weak: false },
      { from: 'a', kind: 'uses', to: 'b', weak: false },
      { from: 'b', kind: 'uses', to: 'a', weak: false },
      { from: 'x', kind: 'connects', to: 'y', weak: false },
    ]);
    expect(folded).toEqual({
      edges: [
        { from: 'router', kind: 'connects', to: 'tunnel', weak: false, matchedProject: undefined },
        { from: 'a', kind: 'uses', to: 'b', weak: false },
        { from: 'b', kind: 'uses', to: 'a', weak: false },
        { from: 'x', kind: 'connects', to: 'y', weak: false },
      ],
      merged: { peers: 0, connects: 1 },
    });
  });

  it('mergeReciprocal keeps a weak peering when both sides are weak', () => {
    const merged = mergeReciprocal([
      { from: 'b', kind: 'peers', to: 'a', weak: true },
      { from: 'a', kind: 'peers', to: 'b', weak: true },
    ]);
    expect(merged).toEqual({
      edges: [{ from: 'a', kind: 'peers', to: 'b', weak: true, matchedProject: undefined }],
      merged: { peers: 1, connects: 0 },
    });
  });

  it('applyWeakPrecedence leaves strong edges alone', () => {
    const kept = applyWeakPrecedence([{ from: 'a', kind: 'uses', to: 'b', weak: false }], () => true);
    expect(kept).toEqual({ kept: [{ from: 'a', kind: 'uses', to: 'b', weak: false }], yielded: 0 });
  });
});

describe('addRegionContainers', () => {
  it('names a region after the project number when the id is unknown, or the node id without either', () => {
    const projectNode = node('//cloudresourcemanager.googleapis.com/projects/10000000001', {
      assetType: 'cloudresourcemanager.googleapis.com/Project',
      projectNumber: '10000000001',
    });
    const bare = node('//cloudresourcemanager.googleapis.com/projects/demo-x-1', {
      assetType: 'cloudresourcemanager.googleapis.com/Project',
    });
    const nodes = new Map<string, GraphNode>([
      [projectNode.id, projectNode],
      [bare.id, bare],
      ['//x.googleapis.com/a', node('//x.googleapis.com/a', { location: 'us-central1' })],
      ['//x.googleapis.com/b', node('//x.googleapis.com/b', { location: 'Not/A Location' })],
      ['//x.googleapis.com/c', node('//x.googleapis.com/c', { location: 'us-east1' })],
    ]);
    const parent = new Map([
      ['//x.googleapis.com/a', projectNode.id],
      ['//x.googleapis.com/b', projectNode.id],
      ['//x.googleapis.com/c', bare.id],
    ]);
    expect(
      addRegionContainers(
        ['//x.googleapis.com/a', '//x.googleapis.com/b', '//x.googleapis.com/c'],
        nodes,
        parent,
      ),
    ).toBe(2);
    expect(parent.get('//x.googleapis.com/a')).toBe(
      '//gcportrait.virtual/projects/10000000001/locations/us-central1',
    );
    expect(parent.get('//x.googleapis.com/b')).toBe(projectNode.id);
    expect(parent.get('//x.googleapis.com/c')).toBe(
      '//gcportrait.virtual/projects/demo-x-1/locations/us-east1',
    );
    const region = nodes.get('//gcportrait.virtual/projects/demo-x-1/locations/us-east1');
    expect(region?.projectId).toBeUndefined();
    expect(region?.projectNumber).toBeUndefined();
  });
});

describe('deriveSharedVpc', () => {
  const PROJECT = 'cloudresourcemanager.googleapis.com/Project';
  const layers: Record<string, 'subnet' | 'vpc'> = {
    '//x.googleapis.com/host-subnet': 'subnet',
    '//x.googleapis.com/host-net': 'vpc',
    '//x.googleapis.com/plain-net': 'vpc',
    '//x.googleapis.com/b': 'subnet',
  };
  const zoneKindOf = (id: string) => layers[id];

  it('counts subnets of other projects, and networks of Shared VPC hosts only', () => {
    const host = '//cloudresourcemanager.googleapis.com/projects/10000000001';
    const plain = '//cloudresourcemanager.googleapis.com/projects/10000000003';
    const service = '//cloudresourcemanager.googleapis.com/projects/10000000002';
    const nodes = new Map<string, GraphNode>([
      [host, node(host, { assetType: PROJECT, projectNumber: '10000000001', sharedVpcHost: true })],
      [plain, node(plain, { assetType: PROJECT, projectNumber: '10000000003' })],
      [service, node(service, { assetType: PROJECT, projectNumber: '10000000002' })],
      [
        '//x.googleapis.com/host-subnet',
        node('//x.googleapis.com/host-subnet', { projectNumber: '10000000001' }),
      ],
      ['//x.googleapis.com/host-net', node('//x.googleapis.com/host-net', { projectNumber: '10000000001' })],
      [
        '//x.googleapis.com/connector',
        node('//x.googleapis.com/connector', { projectNumber: '10000000001' }),
      ],
      [
        '//x.googleapis.com/plain-net',
        node('//x.googleapis.com/plain-net', { projectNumber: '10000000003' }),
      ],
      ['//x.googleapis.com/vm', node('//x.googleapis.com/vm', { projectNumber: '10000000002' })],
      ['//x.googleapis.com/sql', node('//x.googleapis.com/sql', { projectNumber: '10000000002' })],
      ['//x.googleapis.com/run', node('//x.googleapis.com/run', { projectNumber: '10000000002' })],
      ['//x.googleapis.com/pool', node('//x.googleapis.com/pool', { projectNumber: '10000000002' })],
    ]);
    const attach = (from: string, to: string) =>
      ({
        from: `//x.googleapis.com/${from}`,
        kind: 'attaches',
        to: `//x.googleapis.com/${to}`,
        weak: false,
      }) as const;
    const result = deriveSharedVpc(
      [
        attach('vm', 'host-subnet'),
        attach('sql', 'host-net'),
        attach('run', 'connector'),
        attach('pool', 'plain-net'),
      ],
      nodes,
      zoneKindOf,
    );
    expect(result.pairs).toEqual([
      {
        service,
        host,
        attachments: [
          { from: '//x.googleapis.com/sql', to: '//x.googleapis.com/host-net' },
          { from: '//x.googleapis.com/vm', to: '//x.googleapis.com/host-subnet' },
        ],
      },
    ]);
    expect(result.sharedWith).toEqual(
      new Map([
        ['//x.googleapis.com/host-subnet', 1],
        ['//x.googleapis.com/host-net', 1],
      ]),
    );
  });

  it('ignores attachments whose project node is not in the snapshot', () => {
    const nodes = new Map<string, GraphNode>([
      ['//x.googleapis.com/a', node('//x.googleapis.com/a', { projectNumber: '10000000001' })],
      ['//x.googleapis.com/b', node('//x.googleapis.com/b', { projectNumber: '10000000002' })],
      ['//x.googleapis.com/c', node('//x.googleapis.com/c')],
    ]);
    const result = deriveSharedVpc(
      [
        { from: '//x.googleapis.com/a', kind: 'attaches', to: '//x.googleapis.com/b', weak: false },
        { from: '//x.googleapis.com/c', kind: 'attaches', to: '//x.googleapis.com/b', weak: false },
      ],
      nodes,
      zoneKindOf,
    );
    expect(result).toEqual({ shares: [], pairs: [], sharedWith: new Map() });
  });
});

describe('resolveContainment with nestsIn', () => {
  const PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000002';
  const OTHER = '//cloudresourcemanager.googleapis.com/projects/10000000001';
  const asset = (name: string, number: string): Asset => ({
    name,
    assetType: 'a.googleapis.com/Thing',
    parent: `//cloudresourcemanager.googleapis.com/projects/${number}`,
    ancestors: [`projects/${number}`],
    updateTime: '2026-10-01T08:00:00Z',
    data: {},
  });
  const ids = ['//x/group', '//x/pool', '//x/remote-pool', '//x/subnet', '//x/vm', '//x/disk', '//x/card'];
  const nodes = new Map<string, GraphNode>([
    [PROJECT, node(PROJECT, { assetType: 'cloudresourcemanager.googleapis.com/Project', role: 'container' })],
    [OTHER, node(OTHER, { assetType: 'cloudresourcemanager.googleapis.com/Project', role: 'container' })],
    ['//x/group', node('//x/group', { role: 'container', projectNumber: '10000000002' })],
    ['//x/pool', node('//x/pool', { role: 'container', projectNumber: '10000000002' })],
    ['//x/remote-pool', node('//x/remote-pool', { role: 'container', projectNumber: '10000000001' })],
    ['//x/subnet', node('//x/subnet', { role: 'container', projectNumber: '10000000002' })],
    ['//x/vm', node('//x/vm', { projectNumber: '10000000002' })],
    ['//x/disk', node('//x/disk', { projectNumber: '10000000002' })],
    ['//x/card', node('//x/card', { projectNumber: '10000000002' })],
  ]);
  const assets = new Map(
    ids.map((id) => [id, asset(id, id === '//x/remote-pool' ? '10000000001' : '10000000002')] as const),
  );

  it('nests by the first acceptable container the node names, before its attachments', () => {
    const result = resolveContainment({
      ids: [...ids, PROJECT, OTHER].sort(),
      assets,
      nodes,
      declared: new Map(),
      nestsIn: new Map([
        ['//x/vm', ['//x/card', '//x/group']],
        ['//x/disk', ['//x/remote-pool', '//x/pool']],
        ['//x/card', ['//x/remote-pool']],
      ]),
      attaches: new Map([['//x/vm', ['//x/subnet']]]),
      projects: { numberById: {}, idByNumber: {} },
    });
    expect(result.parent.get('//x/vm')).toBe('//x/group');
    expect(result.parent.get('//x/disk')).toBe('//x/pool');
    expect(result.parent.get('//x/card')).toBe(PROJECT);
    expect(result.nestedByReference).toBe(2);
    expect(result.crossProjectRefused).toBe(2);
  });

  it("lets a container's own claim win, and refuses a cycle of references", () => {
    const result = resolveContainment({
      ids: [...ids, PROJECT, OTHER].sort(),
      assets,
      nodes,
      declared: new Map([['//x/vm', ['//x/subnet']]]),
      nestsIn: new Map([
        ['//x/vm', ['//x/group']],
        ['//x/group', ['//x/pool']],
        ['//x/pool', ['//x/group']],
      ]),
      attaches: new Map(),
      projects: { numberById: {}, idByNumber: {} },
    });
    expect(result.parent.get('//x/vm')).toBe('//x/subnet');
    expect(result.cycles).toEqual([['//x/group', '//x/pool']]);
    expect(result.parent.get('//x/group')).toBe(PROJECT);
    expect(result.parent.get('//x/pool')).toBe('//x/group');
    expect(result.nestedByReference).toBe(1);
  });
});
